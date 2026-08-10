from __future__ import annotations

import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, RedirectResponse, StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import get_current_user, require_roles
from ..config import settings
from ..database import get_db
from ..models import Document, User
from ..schemas import CategoryPatch, DocumentOut, RejectBody
from ..services.ingestion import extract_pdf_pages
from ..services.llm import CATEGORIES, llm_service
from ..services.search import search_service
from ..services.storage import storage_service
from ..services.watermark import watermark_pdf

router = APIRouter(prefix="/api/documents", tags=["documents"])
ALLOWED_TYPES = {"application/pdf"}
MAX_UPLOAD_BYTES = 20 * 1024 * 1024


def can_read(doc: Document, user: User) -> bool:
    return user.role == "HRAdmin" or (doc.status == "approved" and user.role in (doc.allowed_roles or []))


def parse_permissions(value: str) -> list[str]:
    try:
        parsed = json.loads(value)
        if isinstance(parsed, list):
            return [str(x) for x in parsed]
    except Exception:
        pass
    return [x.strip() for x in value.replace(";", ",").split(",") if x.strip()]


@router.post("", response_model=DocumentOut)
def upload_document(
    file: UploadFile = File(...),
    permissions: str = Form("Employee,Manager,Executive"),
    title: str | None = Form(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("HRAdmin")),
):
    if file.content_type not in ALLOWED_TYPES and not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=415, detail="Only PDF policy documents are supported")
    file.file.seek(0, 2)
    size = file.file.tell()
    file.file.seek(0)
    if size > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="PDF exceeds 20 MB upload limit")
    roles = parse_permissions(permissions)
    invalid = [r for r in roles if r not in {"Employee", "Manager", "Executive"}]
    if invalid:
        raise HTTPException(status_code=400, detail=f"Invalid permissions: {invalid}")
    blob_path = storage_service.save_upload(file, "documents")
    data = storage_service.read_bytes(blob_path)
    text = "\n".join(extract_pdf_pages(data)[:4])
    suggested, confidence = llm_service.categorize(title or file.filename or "Policy", text)
    doc = Document(
        filename=file.filename or "policy.pdf",
        title=title or (file.filename or "Policy").rsplit(".", 1)[0].replace("_", " "),
        blob_path=blob_path,
        category=suggested,
        status="pending_approval",
        allowed_roles=roles,
        uploaded_by=user.id,
        ai_suggested_category=suggested,
        ai_confidence=confidence,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return doc


@router.get("")
def list_documents(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    docs = db.scalars(select(Document).order_by(Document.uploaded_at.desc())).all()
    docs = [d for d in docs if can_read(d, user)] if user.role != "HRAdmin" else docs
    return {"items": [DocumentOut.model_validate(d) for d in docs], "total": len(docs)}


@router.get("/pending")
def pending_documents(db: Session = Depends(get_db), user: User = Depends(require_roles("HRAdmin"))):
    docs = db.scalars(select(Document).where(Document.status == "pending_approval").order_by(Document.uploaded_at)).all()
    return {"items": [DocumentOut.model_validate(d) for d in docs], "total": len(docs)}


@router.patch("/{document_id}/category", response_model=DocumentOut)
def update_category(document_id: str, body: CategoryPatch, db: Session = Depends(get_db), user: User = Depends(require_roles("HRAdmin"))):
    if body.category not in CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Category must be one of {CATEGORIES}")
    doc = db.get(Document, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if doc.status not in {"pending_approval", "pending_review"}:
        raise HTTPException(status_code=409, detail="Category can only be changed before approval")
    doc.category = body.category
    db.commit()
    db.refresh(doc)
    return doc


@router.post("/{document_id}/approve", response_model=DocumentOut)
def approve_document(document_id: str, db: Session = Depends(get_db), user: User = Depends(require_roles("HRAdmin"))):
    doc = db.get(Document, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if doc.status not in {"pending_approval", "pending_review"}:
        raise HTTPException(status_code=409, detail=f"Cannot approve document from state {doc.status}")
    doc.status = "approved"
    doc.approved_by = user.id
    doc.approved_at = datetime.now(timezone.utc)
    db.commit()
    search_service.index_document(db, doc)
    doc.indexed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(doc)
    return doc


@router.post("/{document_id}/reject", response_model=DocumentOut)
def reject_document(document_id: str, body: RejectBody, db: Session = Depends(get_db), user: User = Depends(require_roles("HRAdmin"))):
    doc = db.get(Document, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if doc.status not in {"pending_approval", "pending_review"}:
        raise HTTPException(status_code=409, detail=f"Cannot reject document from state {doc.status}")
    search_service.delete_document(db, doc.id)
    doc.status = "rejected"
    doc.rejected_by = user.id
    doc.rejected_at = datetime.now(timezone.utc)
    doc.rejection_comment = body.comment
    doc.indexed_at = None
    db.commit()
    db.refresh(doc)
    return doc


@router.get("/{document_id}/url")
def document_url(document_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    doc = db.get(Document, document_id)
    if not doc or not can_read(doc, user):
        raise HTTPException(status_code=404, detail="Document not found")
    url = storage_service.get_read_url(doc.blob_path)
    return {"url": url or f"/api/documents/{doc.id}/content", "expires_in_seconds": 1200 if url else None}


@router.get("/{document_id}/content")
def document_content(document_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    doc = db.get(Document, document_id)
    if not doc or not can_read(doc, user):
        raise HTTPException(status_code=404, detail="Document not found")
    url = storage_service.get_read_url(doc.blob_path)
    if url:
        return RedirectResponse(url)
    path = storage_service.local_path(doc.blob_path)
    if settings.enable_dynamic_watermark:
        data = watermark_pdf(path.read_bytes(), user.email)
        return StreamingResponse(
            iter([data]),
            media_type="application/pdf",
            headers={"Content-Disposition": f'inline; filename="{doc.filename}"', "Cache-Control": "no-store"},
        )
    return FileResponse(path, media_type="application/pdf", filename=doc.filename)
