from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, RedirectResponse
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..auth import get_current_user, require_roles
from ..database import get_db
from ..models import FormFavorite, HRForm, User
from ..schemas import HRFormOut
from ..services.storage import storage_service

router = APIRouter(prefix="/api/forms", tags=["forms"])


def form_out(f: HRForm) -> HRFormOut:
    data = HRFormOut.model_validate(f)
    # `available` tells the client whether the download link will resolve, so it can
    # show the row either way — HR publishes the list before the files land.
    data.available = bool(f.blob_path)
    return data


def readable(f: HRForm, user: User) -> bool:
    return user.role == "HRAdmin" or not f.allowed_roles or user.role in f.allowed_roles


@router.get("")
def list_forms(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = db.scalars(select(HRForm).order_by(HRForm.sort_order, HRForm.title)).all()
    items = [form_out(f) for f in rows if readable(f, user)]
    return {"items": items, "total": len(items)}


@router.post("", response_model=HRFormOut, status_code=201)
def upload_form(
    file: UploadFile = File(...),
    title: str | None = Form(default=None),
    category: str | None = Form(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("HRAdmin")),
):
    if file.content_type != "application/pdf" and not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=415, detail="Only PDF forms are supported")
    blob_path = storage_service.save_upload(file, "documents")
    filename = file.filename or "form.pdf"
    existing = db.scalar(select(HRForm).where(HRForm.filename == filename))
    if existing:
        # Re-uploading a seeded form fills in the file rather than duplicating the row.
        existing.blob_path = blob_path
        existing.uploaded_by = user.id
        if title:
            existing.title = title
        db.commit()
        db.refresh(existing)
        return form_out(existing)
    item = HRForm(
        title=title or filename.rsplit(".", 1)[0].replace("_", " "),
        filename=filename,
        blob_path=blob_path,
        category=category,
        allowed_roles=[],
        uploaded_by=user.id,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return form_out(item)


@router.delete("/{form_id}", status_code=204)
def delete_form(form_id: str, db: Session = Depends(get_db), user: User = Depends(require_roles("HRAdmin"))):
    """Remove a form from Resources.

    Only the row goes. The blob stays, exactly as deleting a policy document leaves
    its PDF in storage — nothing in this app deletes blobs, so a wrong click is
    recoverable by re-uploading rather than being the end of the file.

    Favourites are cleared explicitly. The foreign key does say ON DELETE CASCADE,
    but SQLite only honours that with `PRAGMA foreign_keys=ON`, which is off by
    default — so relying on it would orphan rows in local development and pass every
    test while doing so.
    """
    form = db.get(HRForm, form_id)
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")
    db.execute(delete(FormFavorite).where(FormFavorite.form_id == form_id))
    db.delete(form)
    db.commit()


@router.get("/{form_id}/url")
def form_url(form_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Where to open this form.

    Mirrors the document equivalent. The browser cannot attach a bearer token to a
    `window.open`, so the client asks here first: with Azure storage it gets a
    short-lived SAS URL it can open directly, and otherwise the relative content
    path, which it fetches with credentials and opens as a blob.
    """
    f = db.get(HRForm, form_id)
    if not f or not readable(f, user):
        raise HTTPException(status_code=404, detail="Form not found")
    if not f.blob_path:
        raise HTTPException(status_code=404, detail="This form has not been uploaded yet")
    url = storage_service.get_read_url(f.blob_path, f.filename)
    return {"url": url or f"/api/forms/{f.id}/content", "expires_in_seconds": 1200 if url else None}


@router.get("/{form_id}/content")
def form_content(form_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    f = db.get(HRForm, form_id)
    if not f or not readable(f, user):
        raise HTTPException(status_code=404, detail="Form not found")
    if not f.blob_path:
        raise HTTPException(status_code=404, detail="This form has not been uploaded yet")
    url = storage_service.get_read_url(f.blob_path, f.filename)
    if url:
        return RedirectResponse(url)
    return FileResponse(storage_service.local_path(f.blob_path), media_type="application/pdf", filename=f.filename)


# ---------------------------------------------------------------------------
# Favourites
# ---------------------------------------------------------------------------


def _fav(db: Session, user: User, form_id: str) -> FormFavorite | None:
    return db.scalar(
        select(FormFavorite).where(FormFavorite.user_id == user.id, FormFavorite.form_id == form_id)
    )


@router.get("/favorites")
def list_form_favorites(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = db.scalars(select(FormFavorite).where(FormFavorite.user_id == user.id)).all()
    return {"items": [r.form_id for r in rows], "total": len(rows)}


@router.put("/{form_id}/favorite", status_code=204)
def add_form_favorite(form_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    f = db.get(HRForm, form_id)
    if not f or not readable(f, user):
        raise HTTPException(status_code=404, detail="Form not found")
    if not _fav(db, user, form_id):
        db.add(FormFavorite(user_id=user.id, form_id=form_id))
        db.commit()


@router.delete("/{form_id}/favorite", status_code=204)
def remove_form_favorite(form_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = _fav(db, user, form_id)
    if row:
        db.delete(row)
        db.commit()
