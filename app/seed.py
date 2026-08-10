from __future__ import annotations

import csv
import json
from datetime import date, datetime, timezone
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .config import settings
from .models import Document, User
from .services.search import search_service
from .services.storage import storage_service


def _parse_date(value: str | None):
    if not value or value.lower() == "nan":
        return None
    return date.fromisoformat(value[:10])


def seed_users(db: Session) -> int:
    if (db.scalar(select(func.count(User.id))) or 0) > 0:
        return 0
    path = settings.seed_dir / "Employees_final.csv"
    rows = list(csv.DictReader(path.open(encoding="utf-8-sig")))
    for row in rows:
        manager_id = int(float(row["manager_id"])) if row.get("manager_id") else None
        db.add(User(
            id=int(row["employee_id"]),
            display_name=row["full_name"],
            email=row["email"].lower(),
            role=row["role"],
            department=row["department"],
            manager_id=manager_id,
            hire_date=_parse_date(row.get("hire_date")),
        ))
    # Separate HR admin identity used in local/demo mode. Real Entra app-role users map automatically at sign-in.
    db.add(User(id=1001, display_name="BluePeak HR Admin", email="hr.admin@bluepeak.example", role="HRAdmin", department="HR"))
    db.commit()
    return len(rows) + 1


def seed_documents(db: Session, force_reindex: bool = False) -> int:
    if (db.scalar(select(func.count(Document.id))) or 0) > 0 and not force_reindex:
        return 0
    if force_reindex:
        for doc in db.scalars(select(Document)).all():
            db.delete(doc)
        db.commit()
    manifest = json.loads((settings.seed_dir / "manifest.json").read_text(encoding="utf-8"))
    seed_rows = list(csv.DictReader((settings.seed_dir / "documents_seed.csv").open(encoding="utf-8-sig")))
    by_filename = {Path(row["blob_path"]).name: row for row in seed_rows}
    admin = db.scalar(select(User).where(User.email == "hr.admin@bluepeak.example"))
    count = 0
    to_index = []
    for meta in manifest:
        row = by_filename[meta["filename"]]
        source = settings.seed_dir / "policies" / meta["filename"]
        blob_path = storage_service.copy_seed_document(source, meta["filename"])
        status_raw = row["status"].strip().lower()
        status = {"approved": "approved", "pending": "pending_approval", "rejected": "rejected"}.get(status_raw, status_raw)
        roles = [x.strip() for x in (row.get("access_roles") or "").split(";") if x.strip()]
        doc = Document(
            external_document_id=meta.get("document_id"),
            filename=meta["filename"],
            title=meta.get("title") or row["document_name"],
            blob_path=blob_path,
            category=meta.get("policy_category") or row.get("policy_category"),
            status=status,
            allowed_roles=roles,
            uploaded_by=admin.id if admin else None,
            uploaded_at=datetime.fromisoformat((row.get("uploaded_date") or meta.get("effective_date") or "2026-01-01") + "T00:00:00+00:00"),
            approved_by=admin.id if admin and status == "approved" else None,
            approved_at=datetime.fromisoformat((row.get("approved_date") or meta.get("effective_date") or "2026-01-01") + "T00:00:00+00:00") if status == "approved" else None,
            rejection_comment="Seeded as an unfinished draft; not approved for employee search." if status == "rejected" else None,
            version=meta.get("version"),
            effective_date=_parse_date(meta.get("effective_date")),
            source_url=meta.get("source_url"),
        )
        db.add(doc)
        db.flush()
        count += 1
        if status == "approved" and meta.get("indexed_at_start", False):
            to_index.append(doc)
    db.commit()
    for doc in to_index:
        search_service.index_document(db, doc)
        doc.indexed_at = datetime.now(timezone.utc)
        db.commit()
    return count


def seed_all(db: Session) -> dict:
    return {"users": seed_users(db), "documents": seed_documents(db)}
