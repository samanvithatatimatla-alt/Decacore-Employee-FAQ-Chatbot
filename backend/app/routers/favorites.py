from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models import Document, Favorite, User
from ..schemas import FavoriteOut

router = APIRouter(prefix="/api", tags=["favorites"])

RECENTLY_VIEWED_LIMIT = 3


def _readable(doc: Document, user: User) -> bool:
    return user.role == "HRAdmin" or (doc.status == "approved" and user.role in (doc.allowed_roles or []))


def _row(fav: Favorite, doc: Document) -> FavoriteOut:
    return FavoriteOut(
        document_id=doc.id,
        title=doc.title,
        filename=doc.filename,
        kind=fav.kind,
        last_viewed_at=fav.last_viewed_at,
    )


def _get(db: Session, user: User, document_id: str, kind: str) -> Favorite | None:
    return db.scalar(
        select(Favorite).where(
            Favorite.user_id == user.id,
            Favorite.document_id == document_id,
            Favorite.kind == kind,
        )
    )


def _document_or_404(db: Session, user: User, document_id: str) -> Document:
    doc = db.get(Document, document_id)
    if not doc or not _readable(doc, user):
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


def _list(db: Session, user: User, kind: str, limit: int | None = None):
    rows = db.scalars(
        select(Favorite)
        .where(Favorite.user_id == user.id, Favorite.kind == kind)
        .order_by(func.coalesce(Favorite.last_viewed_at, Favorite.created_at).desc())
    ).all()
    items = []
    for fav in rows:
        doc = db.get(Document, fav.document_id)
        # A document can be removed after being favourited; skip rather than 500.
        if doc and _readable(doc, user):
            items.append(_row(fav, doc))
        if limit and len(items) >= limit:
            break
    return items


@router.get("/favorites")
def list_favorites(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    items = _list(db, user, "favorite")
    return {"items": items, "total": len(items)}


@router.put("/favorites/{document_id}", status_code=204)
def add_favorite(document_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _document_or_404(db, user, document_id)
    if not _get(db, user, document_id, "favorite"):
        db.add(Favorite(user_id=user.id, document_id=document_id, kind="favorite"))
        db.commit()


@router.delete("/favorites/{document_id}", status_code=204)
def remove_favorite(document_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    fav = _get(db, user, document_id, "favorite")
    if fav:
        db.delete(fav)
        db.commit()


@router.get("/recently-viewed")
def list_recently_viewed(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    items = _list(db, user, "recent", limit=RECENTLY_VIEWED_LIMIT)
    return {"items": items, "total": len(items)}


@router.post("/recently-viewed/{document_id}", status_code=204)
def note_viewed(document_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _document_or_404(db, user, document_id)
    now = datetime.now(UTC)
    existing = _get(db, user, document_id, "recent")
    if existing:
        existing.last_viewed_at = now
    else:
        db.add(Favorite(user_id=user.id, document_id=document_id, kind="recent", last_viewed_at=now))
    db.commit()

    # Keep only the most recent few per user, so the table does not grow without bound.
    stale = db.scalars(
        select(Favorite)
        .where(Favorite.user_id == user.id, Favorite.kind == "recent")
        .order_by(func.coalesce(Favorite.last_viewed_at, Favorite.created_at).desc())
        .offset(RECENTLY_VIEWED_LIMIT)
    ).all()
    for row in stale:
        db.delete(row)
    if stale:
        db.commit()
