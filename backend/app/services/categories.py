"""The controlled vocabulary documents are filed under.

Lives in the database rather than in code so HR can add a category without a
redeploy. Two rules keep the list from rotting:

  * the classifier may only choose a name that already exists — it never invents one
  * adding a name that normalises to an existing one returns that one instead of
    creating a near-duplicate

The second rule is deliberately narrow. It catches case and punctuation differences
and simple plurals ("Leaves" -> "Leave"), which is what people actually type twice.
It does not attempt to catch synonyms: "Time Off" and "Leave" are different strings
by any mechanical test, and guessing that they mean the same thing is how you end up
merging two categories that HR meant to keep apart. That call stays with a human.
"""

from __future__ import annotations

import re

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import DocumentCategory

# Seeded on first boot. After that the table is the source of truth, and this list
# is only a starting point — not a limit on what HR can add.
DEFAULT_CATEGORIES = ["Benefits", "Leave", "Payroll", "Travel", "Insurance", "Reimbursements"]

_NON_ALNUM = re.compile(r"[^a-z0-9]+")


def normalize_key(name: str) -> str:
    """Fold a display name to its de-duplication key.

    "Company Info", "company info" and "Company  Info!" all collapse to the same
    key; so do "Leave" and "Leaves".
    """
    key = _NON_ALNUM.sub(" ", name.strip().lower()).strip()
    words = [w[:-1] if len(w) > 3 and w.endswith("s") else w for w in key.split()]
    return " ".join(words)


def list_categories(db: Session) -> list[DocumentCategory]:
    return list(db.scalars(select(DocumentCategory).order_by(DocumentCategory.name)))


def category_names(db: Session) -> list[str]:
    """Just the display names, for the classifier and for validation."""
    return [c.name for c in list_categories(db)]


def find_category(db: Session, name: str) -> DocumentCategory | None:
    """Match on the normalised key, so lookups tolerate case and plurals."""
    return db.scalar(select(DocumentCategory).where(DocumentCategory.key == normalize_key(name)))


def add_category(db: Session, name: str, created_by: int | None = None) -> tuple[DocumentCategory, bool]:
    """Add a category, or return the existing near-match.

    Returns (category, created). `created` is False when an equivalent name was
    already there — the caller can then tell HR "that already exists as X" rather
    than silently doing nothing.
    """
    display = " ".join(name.split())
    existing = find_category(db, display)
    if existing is not None:
        return existing, False
    category = DocumentCategory(name=display, key=normalize_key(display), created_by=created_by)
    db.add(category)
    db.commit()
    db.refresh(category)
    return category, True


def delete_category(db: Session, category: DocumentCategory) -> None:
    db.delete(category)
    db.commit()


def documents_using(db: Session, name: str) -> int:
    """How many documents are filed under this category name."""
    from ..models import Document

    return db.scalar(select(func.count(Document.id)).where(Document.category == name)) or 0


def seed_categories(db: Session) -> int:
    """Fill the table on first boot. Idempotent, like every other seeder."""
    added = 0
    for name in DEFAULT_CATEGORIES:
        if find_category(db, name) is None:
            db.add(DocumentCategory(name=name, key=normalize_key(name)))
            added += 1
    if added:
        db.commit()
    return added
