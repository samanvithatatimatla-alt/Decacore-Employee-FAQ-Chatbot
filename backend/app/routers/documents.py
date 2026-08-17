from __future__ import annotations

import json
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, RedirectResponse, StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import get_current_user, require_roles
from ..config import settings
from ..database import get_db
from ..models import Document, DocumentCategory, DocumentVersion, User
from ..schemas import CategoryCreate, CategoryPatch, DocumentOut, DocumentVersionOut, RejectBody
from ..services.categories import (
    add_category,
    category_names,
    delete_category,
    documents_using,
    list_categories,
)
from ..services.ingestion import extract_pdf_pages
from ..services.llm import llm_service
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
    suggested, confidence = llm_service.categorize(title or file.filename or "Policy", text, category_names(db))
    now = datetime.now(UTC)
    doc = Document(
        filename=file.filename or "policy.pdf",
        title=title or (file.filename or "Policy").rsplit(".", 1)[0].replace("_", " "),
        blob_path=blob_path,
        category=suggested,
        # Uploads go live immediately: the product decision is that an HRAdmin
        # upload is itself the approval, so there is no second review step and
        # nothing sits in a queue where employees cannot see it. Only HRAdmins can
        # reach this endpoint. The recovery path for a bad upload is DELETE, which
        # drops the chunks as well — /reject only accepts pending documents and so
        # no longer applies to anything uploaded through here.
        status="approved",
        allowed_roles=roles,
        uploaded_by=user.id,
        approved_by=user.id,
        approved_at=now,
        ai_suggested_category=suggested,
        ai_confidence=confidence,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)

    search_service.index_document(db, doc)
    doc.indexed_at = datetime.now(UTC)
    db.add(
        DocumentVersion(
            document_id=doc.id,
            version_number=1,
            blob_path=doc.blob_path,
            filename=doc.filename,
            title=doc.title,
            is_current=True,
            uploaded_by=user.id,
        )
    )
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


@router.get("/categories")
def list_document_categories(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """The categories documents can be filed under. Readable by anyone signed in."""
    return {"items": [{"id": c.id, "name": c.name} for c in list_categories(db)], "total": None}


@router.post("/categories")
def create_document_category(
    body: CategoryCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("HRAdmin")),
):
    """Add a category. Returns the existing one when the name is an equivalent.

    Answering 200-with-the-existing-row rather than 409 is deliberate: from HR's
    point of view "make sure there is a Leave category" succeeded either way, and
    the `created` flag lets the UI say "that already exists as Leave" instead of
    showing an error for something that is not one.
    """
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Category name cannot be empty")
    category, created = add_category(db, name, created_by=user.id)
    return {"id": category.id, "name": category.name, "created": created}


@router.delete("/categories/{category_id}", status_code=204)
def delete_document_category(
    category_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("HRAdmin")),
):
    """Remove a category. Refused while documents are still filed under it.

    Deleting one in use would leave those documents pointing at a name that no longer
    exists — they would fall into Uncategorised with no record of where they had been.
    Relabel them first; the error says how many are in the way.
    """
    category = db.get(DocumentCategory, category_id)
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")
    in_use = documents_using(db, category.name)
    if in_use:
        raise HTTPException(
            status_code=409,
            detail=f"{in_use} document{'s' if in_use != 1 else ''} still use this category. Move them first.",
        )
    delete_category(db, category)


@router.patch("/{document_id}/category", response_model=DocumentOut)
def update_category(document_id: str, body: CategoryPatch, db: Session = Depends(get_db), user: User = Depends(require_roles("HRAdmin"))):
    known = category_names(db)
    if body.category not in known:
        raise HTTPException(status_code=400, detail=f"Category must be one of {known}")
    doc = db.get(Document, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    # Approved documents used to be frozen here. Since an HRAdmin upload approves
    # itself, that made every mislabel permanent — including the ones the classifier
    # produced. Relabelling touches only the label, never the file or its chunks.
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
    doc.approved_at = datetime.now(UTC)
    db.commit()
    search_service.index_document(db, doc)
    doc.indexed_at = datetime.now(UTC)
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
    doc.rejected_at = datetime.now(UTC)
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
    url = storage_service.get_read_url(doc.blob_path, doc.filename)
    return {"url": url or f"/api/documents/{doc.id}/content", "expires_in_seconds": 1200 if url else None}


@router.get("/{document_id}/content")
def document_content(document_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    doc = db.get(Document, document_id)
    if not doc or not can_read(doc, user):
        raise HTTPException(status_code=404, detail="Document not found")
    url = storage_service.get_read_url(doc.blob_path, doc.filename)
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


@router.get("/{document_id}/versions")
def list_versions(document_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    doc = db.get(Document, document_id)
    if not doc or not can_read(doc, user):
        raise HTTPException(status_code=404, detail="Document not found")
    rows = db.scalars(
        select(DocumentVersion)
        .where(DocumentVersion.document_id == document_id)
        .order_by(DocumentVersion.version_number.desc())
    ).all()
    if not rows:
        # Seeded documents predate version tracking. Rather than backfill rows for
        # every one, synthesise the v1 the history pane expects from the document.
        return {
            "items": [
                DocumentVersionOut(
                    id=f"{doc.id}-v1",
                    document_id=doc.id,
                    version_number=1,
                    filename=doc.filename,
                    title=doc.title,
                    change_summary=None,
                    is_current=True,
                    effective_date=doc.effective_date,
                    uploaded_at=doc.uploaded_at,
                    uploaded_by_name=_uploader_name(db, doc.uploaded_by),
                )
            ],
            "total": 1,
        }
    items = []
    for v in rows:
        out = DocumentVersionOut.model_validate(v)
        out.uploaded_by_name = _uploader_name(db, v.uploaded_by)
        items.append(out)
    return {"items": items, "total": len(items)}


def _uploader_name(db: Session, user_id: int | None) -> str | None:
    if not user_id:
        return None
    who = db.get(User, user_id)
    return who.display_name if who else None


@router.post("/{document_id}/versions", response_model=DocumentOut)
def upload_new_version(
    document_id: str,
    file: UploadFile = File(...),
    change_summary: str | None = Form(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("HRAdmin")),
):
    doc = db.get(Document, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if file.content_type not in ALLOWED_TYPES and not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=415, detail="Only PDF policy documents are supported")
    file.file.seek(0, 2)
    if file.file.tell() > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="PDF exceeds 20 MB upload limit")
    file.file.seek(0)

    existing = db.scalars(
        select(DocumentVersion).where(DocumentVersion.document_id == document_id)
    ).all()
    if not existing:
        # Snapshot the current file as v1 before it is replaced, so history is not
        # lost for a document uploaded before version tracking existed.
        db.add(
            DocumentVersion(
                document_id=doc.id,
                version_number=1,
                blob_path=doc.blob_path,
                filename=doc.filename,
                title=doc.title,
                is_current=False,
                uploaded_by=doc.uploaded_by,
                uploaded_at=doc.uploaded_at,
            )
        )
        next_number = 2
    else:
        for v in existing:
            v.is_current = False
        next_number = max(v.version_number for v in existing) + 1

    blob_path = storage_service.save_upload(file, "documents")
    db.add(
        DocumentVersion(
            document_id=doc.id,
            version_number=next_number,
            blob_path=blob_path,
            filename=file.filename or doc.filename,
            title=doc.title,
            change_summary=(change_summary or "").strip() or None,
            is_current=True,
            uploaded_by=user.id,
        )
    )

    # The document row always points at the current version, so every existing
    # reader — search, the viewer, citations — follows the update with no changes.
    doc.blob_path = blob_path
    doc.filename = file.filename or doc.filename
    doc.version = f"v{next_number}"
    doc.status = "approved"
    doc.approved_by = user.id
    doc.approved_at = datetime.now(UTC)
    db.commit()

    # Reindex so answers cite the new text rather than the superseded version.
    search_service.delete_document(db, doc.id)
    search_service.index_document(db, doc)
    doc.indexed_at = datetime.now(UTC)
    db.commit()
    db.refresh(doc)
    return doc


@router.delete("/{document_id}", status_code=204)
def delete_document(document_id: str, db: Session = Depends(get_db), user: User = Depends(require_roles("HRAdmin"))):
    doc = db.get(Document, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    # Drop the chunks first: leaving them behind would keep the document answerable
    # and citable after it had disappeared from the library.
    search_service.delete_document(db, doc.id)
    db.delete(doc)
    db.commit()


@router.get("/updates")
def recently_updated(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Policies that have been revised, newest first.

    Drives the employee-facing "Recently Updated Policies" list. A document only
    appears once it has a second version carrying a change summary, so the list is
    empty on a fresh corpus and fills in as HR publishes updates.
    """
    current = db.scalars(
        select(DocumentVersion)
        .where(DocumentVersion.is_current, DocumentVersion.version_number > 1)
        .order_by(DocumentVersion.uploaded_at.desc())
    ).all()
    items = []
    for version in current:
        doc = db.get(Document, version.document_id)
        if not doc or not can_read(doc, user):
            continue
        previous = db.scalar(
            select(DocumentVersion)
            .where(
                DocumentVersion.document_id == doc.id,
                DocumentVersion.version_number == version.version_number - 1,
            )
        )
        items.append({
            "document_id": doc.id,
            "name": doc.filename,
            "title": doc.title,
            "summary": version.change_summary,
            "version_number": version.version_number,
            "updated_at": version.uploaded_at,
            "previous_version_number": previous.version_number if previous else None,
            "previous_updated_at": previous.uploaded_at if previous else None,
        })
    return {"items": items, "total": len(items)}


@router.get("/{document_id}/versions/{version_number}/content")
def version_content(
    document_id: str,
    version_number: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Serves one specific version, so the compare view can show old beside new."""
    doc = db.get(Document, document_id)
    if not doc or not can_read(doc, user):
        raise HTTPException(status_code=404, detail="Document not found")
    version = db.scalar(
        select(DocumentVersion).where(
            DocumentVersion.document_id == document_id,
            DocumentVersion.version_number == version_number,
        )
    )
    if not version:
        raise HTTPException(status_code=404, detail="Version not found")
    url = storage_service.get_read_url(version.blob_path, version.filename)
    if url:
        return RedirectResponse(url)
    path = storage_service.local_path(version.blob_path)
    if settings.enable_dynamic_watermark:
        data = watermark_pdf(path.read_bytes(), user.email)
        return StreamingResponse(
            iter([data]),
            media_type="application/pdf",
            headers={"Content-Disposition": f'inline; filename="{version.filename}"', "Cache-Control": "no-store"},
        )
    return FileResponse(path, media_type="application/pdf", filename=version.filename)
