from __future__ import annotations

import csv
import json
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .config import settings
from .models import Document, DocumentVersion, HRForm, NewsAnnouncement, User
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
        doc.indexed_at = datetime.now(UTC)
        db.commit()
    return count


def seed_announcements(db: Session) -> int:
    """Company news for the ticker.

    Dates are relative to first boot rather than fixed, so a demo run months from
    now does not open on stale headlines.
    """
    if (db.scalar(select(func.count(NewsAnnouncement.id))) or 0) > 0:
        return 0
    admin = db.scalar(select(User).where(User.email == "hr.admin@bluepeak.example"))
    now = datetime.now(UTC)
    items = [
        (0, "Open enrollment closes soon.", "Review your benefits elections in Workday before the deadline."),
        (6, "Updated Remote Work Policy published.", "Two remote days per week now require manager approval each quarter."),
        (13, "Payroll calendar for Q4 is available.", "Pay dates shift by one business day in November."),
    ]
    for days_ago, title, body in items:
        db.add(NewsAnnouncement(
            title=title,
            body=body,
            allowed_roles=[],
            published=True,
            published_at=now - timedelta(days=days_ago),
            created_by=admin.id if admin else None,
        ))
    db.commit()
    return len(items)


def seed_forms(db: Session) -> int:
    """The fillable forms Resources lists.

    blob_path stays NULL: the PDFs are not part of the committed seed corpus, so
    HR uploads them through POST /api/forms and the rows fill in. Until then the
    list renders with the download marked unavailable.
    """
    if (db.scalar(select(func.count(HRForm.id))) or 0) > 0:
        return 0
    items = [
        ("Leave Request Form", "Leave_Request_Form.pdf", "Leave"),
        ("Benefits Enrollment Form", "Benefits_Enrollment_Form.pdf", "Benefits"),
        ("Expense Reimbursement Form", "Expense_Reimbursement_Form.pdf", "Reimbursements"),
    ]
    for order, (title, filename, category) in enumerate(items):
        db.add(HRForm(title=title, filename=filename, category=category, allowed_roles=[], sort_order=order))
    db.commit()
    return len(items)


def seed_document_versions(db: Session) -> int:
    """Version history for the one policy the corpus ships twice.

    manifest.json gives 01_Paid_Time_Off_Policy.pdf and
    13_Paid_Time_Off_Policy_Update_v2.pdf the same external id, BPT-HR-PTO-001 —
    they are genuinely v1 and v2 of one policy. Linking them means the version
    history pane and the employee-facing "compare versions" view open on two real,
    different PDFs instead of placeholder text. Other documents get their history
    the moment HR uploads a new version.
    """
    if (db.scalar(select(func.count(DocumentVersion.id))) or 0) > 0:
        return 0
    v1 = db.scalar(select(Document).where(Document.filename == "01_Paid_Time_Off_Policy.pdf"))
    v2 = db.scalar(select(Document).where(Document.filename == "13_Paid_Time_Off_Policy_Update_v2.pdf"))
    if not v1 or not v2:
        return 0
    admin = db.scalar(select(User).where(User.email == "hr.admin@bluepeak.example"))
    db.add(DocumentVersion(
        document_id=v2.id,
        version_number=1,
        blob_path=v1.blob_path,
        filename=v1.filename,
        title=v1.title,
        effective_date=v1.effective_date,
        is_current=False,
        uploaded_by=admin.id if admin else None,
        uploaded_at=v1.uploaded_at,
    ))
    db.add(DocumentVersion(
        document_id=v2.id,
        version_number=2,
        blob_path=v2.blob_path,
        filename=v2.filename,
        title=v2.title,
        effective_date=v2.effective_date,
        change_summary=(
            "Accrual moves to a monthly schedule and the year-end carryover cap rises, "
            "replacing the single annual grant described in v1."
        ),
        is_current=True,
        uploaded_by=admin.id if admin else None,
        uploaded_at=v2.uploaded_at,
    ))
    db.commit()
    return 2


def seed_all(db: Session) -> dict:
    users = seed_users(db)
    documents = seed_documents(db)
    return {
        "users": users,
        "documents": documents,
        "announcements": seed_announcements(db),
        "forms": seed_forms(db),
        # Depends on documents already existing, so it runs last.
        "document_versions": seed_document_versions(db),
    }
