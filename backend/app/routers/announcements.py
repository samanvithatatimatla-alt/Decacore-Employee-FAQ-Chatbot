from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..auth import get_current_user, require_roles
from ..database import get_db
from ..models import NewsAnnouncement, User
from ..schemas import AnnouncementIn, AnnouncementOut

router = APIRouter(prefix="/api/announcements", tags=["announcements"])


def visible_to(item: NewsAnnouncement, user: User) -> bool:
    """Empty allowed_roles means everyone; a department pins it to one team."""
    if item.allowed_roles and user.role not in item.allowed_roles:
        return False
    return not (item.department and item.department != user.department)


@router.get("")
def list_announcements(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    now = datetime.now(UTC)
    rows = db.scalars(
        select(NewsAnnouncement)
        .where(
            NewsAnnouncement.published,
            # Expiry is optional; a NULL means the item runs until it is unpublished.
            or_(NewsAnnouncement.expires_at.is_(None), NewsAnnouncement.expires_at > now),
        )
        .order_by(NewsAnnouncement.published_at.desc())
    ).all()
    items = [AnnouncementOut.model_validate(a) for a in rows if visible_to(a, user)]
    return {"items": items, "total": len(items)}


@router.post("", response_model=AnnouncementOut, status_code=201)
def create_announcement(
    body: AnnouncementIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("HRAdmin")),
):
    invalid = [r for r in body.allowed_roles if r not in {"Employee", "Manager", "Executive", "HRAdmin"}]
    if invalid:
        raise HTTPException(status_code=400, detail=f"Invalid roles: {invalid}")
    now = datetime.now(UTC)
    item = NewsAnnouncement(
        title=body.title,
        body=body.body,
        allowed_roles=body.allowed_roles,
        department=body.department,
        published=body.published,
        published_at=now if body.published else None,
        expires_at=body.expires_at,
        created_by=user.id,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/{announcement_id}", status_code=204)
def delete_announcement(
    announcement_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("HRAdmin")),
):
    item = db.get(NewsAnnouncement, announcement_id)
    if not item:
        raise HTTPException(status_code=404, detail="Announcement not found")
    db.delete(item)
    db.commit()
