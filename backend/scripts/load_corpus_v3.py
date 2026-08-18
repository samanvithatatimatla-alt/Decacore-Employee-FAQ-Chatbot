"""Load the BluePeak v3 corpus: 31 policies and 10 fillable forms.

Every field written here comes from the metadata block printed on page 1 of each
PDF (document id, version, effective date, category, status, source, supersession
and change summary), extracted into data/seed_v3/manifest_v3.json. Nothing is
inferred by a classifier, which is the whole reason this exists rather than 41
uploads through POST /api/documents: that endpoint cannot set an external
document id, a version, an effective date or a source url, and it hands the
category to the LLM.

Storage: the 34 policy PDFs are ALREADY in the documents container (verified
byte-identical by MD5), so nothing is re-uploaded. `blob_path` is simply
"documents/<filename>", which resolves the same way on both storage backends.
Only the 10 form PDFs are new bytes.

Run against a local SQLite database first (the default backends) to dry-run the
whole thing for free, then point it at production.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import UTC, date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import select  # noqa: E402

from app.config import settings  # noqa: E402
from app.database import Base, SessionLocal, engine  # noqa: E402
from app.models import Document, DocumentVersion, HRForm, User  # noqa: E402
from app.services.categories import add_category  # noqa: E402
from app.services.search import search_service  # noqa: E402

SEED_V3 = ROOT / "data" / "seed_v3"

# The corpus files a metadata `Category` that these two documents lack or state
# awkwardly. Recorded here rather than edited into the manifest so the manifest
# stays a faithful transcript of the PDFs.
CATEGORY_OVERRIDES = {
    # Self-files as "Payroll", which would sit beside "Payroll and Compensation".
    "BPT-HR-ONB-012": "Employee Handbook and Company Information",
    # Vendor contract: no Category printed at all.
    "BPT-LEGAL-VND-018": "Employee Handbook and Company Information",
}

# The 10 fillable forms, from BluePeak_Employee_Forms_Catalog.csv. Forms 201-203
# also exist as older, longer PDFs inside Final_HR_Documents; this newer
# self-service pack supersedes them, so those three files are not loaded.
FORMS = [
    ("BPT-HR-FRM-201", "Leave Request Form", "01_Leave_Request_Form.pdf", "Leave and Attendance"),
    ("BPT-FIN-FRM-202", "Expense Reimbursement Form", "02_Expense_Reimbursement_Form.pdf", "Reimbursements"),
    ("BPT-HR-FRM-203", "Benefits Enrollment / Change Form", "03_Benefits_Enrollment_Change_Form.pdf", "Benefits"),
    ("BPT-HR-FRM-204", "New Hire Employee Information Form", "04_New_Hire_Employee_Information_Form.pdf", "Employee Handbook and Company Information"),
    ("BPT-FIN-FRM-205", "Direct Deposit Authorization Form", "05_Direct_Deposit_Authorization_Form.pdf", "Payroll and Compensation"),
    ("BPT-HR-FRM-206", "Personal Information Change Form", "06_Personal_Information_Emergency_Contact_Change_Form.pdf", "Employee Handbook and Company Information"),
    ("BPT-FIN-FRM-207", "Timekeeping / Payroll Correction Form", "07_Timekeeping_Payroll_Correction_Form.pdf", "Payroll and Compensation"),
    ("BPT-IT-FRM-208", "Equipment & Access Request Form", "08_Equipment_Access_Request_Form.pdf", "IT and Security"),
    ("BPT-HR-FRM-209", "Remote Work / Work-Away Request", "09_Remote_Work_Work_Away_Request_Form.pdf", "Remote Work and Workplace"),
    ("BPT-HR-LND-301", "Learning & Development Funding Request", "10_Learning_Development_Funding_Request_LND-301.pdf", "Reimbursements"),
]


def parse_date(value: str | None) -> date | None:
    return date.fromisoformat(value[:10]) if value else None


def put_file(source: Path, filename: str) -> str:
    """Make `filename` readable through storage_service and return its blob_path.

    On azure the policy blobs are already there, so this only uploads when the
    blob is genuinely missing — which in practice is just the 10 forms.
    """
    blob_path = f"documents/{filename}"
    if settings.storage_backend == "local":
        dest = settings.local_documents_dir / filename
        if not dest.exists():
            dest.write_bytes(source.read_bytes())
        return blob_path

    from azure.identity import DefaultAzureCredential
    from azure.storage.blob import BlobServiceClient, ContentSettings

    client = BlobServiceClient(settings.azure_storage_account_url, credential=DefaultAzureCredential())
    blob = client.get_blob_client(settings.azure_storage_documents_container, filename)
    if blob.exists():
        return blob_path
    # Same content settings the upload endpoint uses, so a policy opens in the
    # browser tab instead of downloading as application/octet-stream.
    blob.upload_blob(
        source.read_bytes(),
        overwrite=True,
        content_settings=ContentSettings(
            content_type="application/pdf",
            content_disposition=f'inline; filename="{filename}"',
        ),
    )
    return blob_path


def clear_existing(db, index: bool) -> tuple[int, int]:
    docs = db.scalars(select(Document)).all()
    for doc in docs:
        # Drops the chunks from SQL and, on the azure backend, from the search
        # index too. Skipping this would leave the old corpus answerable.
        if index:
            search_service.delete_document(db, doc.id)
        db.delete(doc)
    forms = db.scalars(select(HRForm)).all()
    for form in forms:
        db.delete(form)
    db.commit()
    return len(docs), len(forms)


def load(policies_dir: Path, forms_dir: Path, replace: bool, index: bool, dry_run: bool) -> None:
    manifest = json.loads((SEED_V3 / "manifest_v3.json").read_text(encoding="utf-8"))
    print(f"backends: storage={settings.storage_backend} search={settings.search_backend} llm={settings.llm_backend}")
    print(f"database: {settings.database_url.split('@')[-1][:60]}")
    print(f"manifest: {len(manifest)} policies, {len(FORMS)} forms\n")
    if dry_run:
        print("DRY RUN — nothing will be written\n")

    # Only reach for DDL when something is genuinely absent. Against a remote
    # Azure SQL this is the first thing to touch the network, and reflecting the
    # whole schema on a cold connection looks like a hang.
    print("connecting...", flush=True)
    from sqlalchemy import inspect

    existing = set(inspect(engine).get_table_names())
    missing = [name for name in Base.metadata.tables if name not in existing]
    if missing:
        print(f"creating missing tables: {', '.join(missing)}", flush=True)
        Base.metadata.create_all(bind=engine)
    print(f"connected, {len(existing)} tables present\n", flush=True)

    with SessionLocal() as db:
        admin = db.scalar(select(User).where(User.email == "hr.admin@bluepeak.example"))
        if replace and not dry_run:
            docs, forms = clear_existing(db, index)
            print(f"removed {docs} documents and {forms} forms\n")

        for name in sorted({CATEGORY_OVERRIDES.get(p["document_id"], p["category_raw"]) for p in manifest}):
            if not dry_run:
                _, created = add_category(db, name)
                if created:
                    print(f"  + category {name}")

        to_index: list[Document] = []
        for entry in manifest:
            source = policies_dir / entry["filename"]
            if not source.exists():
                raise FileNotFoundError(source)
            category = CATEGORY_OVERRIDES.get(entry["document_id"], entry["category_raw"])
            if dry_run:
                print(f"  {entry['document_id']:18} {entry['version']:5} {category[:38]:40} {entry['title'][:40]}")
                continue
            blob_path = put_file(source, entry["filename"])
            effective = parse_date(entry["effective_date"])
            stamp = datetime.combine(effective, datetime.min.time()).replace(tzinfo=UTC) if effective else datetime.now(UTC)
            doc = Document(
                external_document_id=entry["document_id"],
                filename=entry["filename"],
                title=entry["title"],
                blob_path=blob_path,
                category=category,
                status="approved",
                allowed_roles=entry["allowed_roles"],
                uploaded_by=admin.id if admin else None,
                uploaded_at=stamp,
                approved_by=admin.id if admin else None,
                approved_at=stamp,
                version=entry["version"],
                effective_date=effective,
                source_url=entry["source_url"],
            )
            db.add(doc)
            db.flush()
            print(f"  [{len(to_index)+1:2}/{len(manifest)}] {entry['document_id']:18} {entry['version']:5} {entry['title'][:44]}", flush=True)

            # Version history. The prior PDFs are the superseded seed-corpus
            # documents named in each PDF's own `Supersedes` field, and their
            # blobs are already in the container.
            priors = entry.get("prior_versions") or []
            number = 0
            for prior in priors:
                number += 1
                db.add(DocumentVersion(
                    document_id=doc.id,
                    version_number=number,
                    blob_path=f"documents/{prior['filename']}",
                    filename=prior["filename"],
                    title=doc.title,
                    is_current=False,
                    uploaded_by=admin.id if admin else None,
                ))
            db.add(DocumentVersion(
                document_id=doc.id,
                version_number=number + 1,
                blob_path=blob_path,
                filename=doc.filename,
                title=doc.title,
                effective_date=effective,
                change_summary=entry["change_summary"] if priors else None,
                is_current=True,
                uploaded_by=admin.id if admin else None,
                uploaded_at=stamp,
            ))
            to_index.append(doc)
        if not dry_run:
            db.commit()
            print(f"\ncreated {len(to_index)} documents")

        for order, (form_id, title, filename, category) in enumerate(FORMS):
            source = forms_dir / filename
            if not source.exists():
                raise FileNotFoundError(source)
            if dry_run:
                print(f"  form {form_id:16} {category[:34]:36} {title}")
                continue
            db.add(HRForm(
                title=title,
                filename=filename,
                blob_path=put_file(source, filename),
                category=category,
                allowed_roles=[],
                sort_order=order,
                uploaded_by=admin.id if admin else None,
            ))
        if not dry_run:
            db.commit()
            print(f"created {len(FORMS)} forms")

        if index and not dry_run:
            print("\nindexing (embeds each chunk, ~1 call per document)")
            total = 0
            for n, doc in enumerate(to_index, start=1):
                count = search_service.index_document(db, doc)
                doc.indexed_at = datetime.now(UTC)
                db.commit()
                total += count
                print(f"  [{n:2}/{len(to_index)}] {count:3} chunks  {doc.title[:48]}", flush=True)
            print(f"indexed {len(to_index)} documents / {total} chunks")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    default_docs = ROOT.parent / "Documents"
    ap.add_argument("--policies-dir", type=Path, default=default_docs / "Final_HR_Documents 2")
    ap.add_argument("--forms-dir", type=Path, default=default_docs / "BluePeak_Employee_Forms")
    ap.add_argument("--replace", action="store_true", help="delete existing documents and forms first")
    ap.add_argument("--no-index", action="store_true", help="skip chunking and embedding")
    ap.add_argument("--dry-run", action="store_true", help="print the plan, write nothing")
    args = ap.parse_args()
    load(args.policies_dir, args.forms_dir, args.replace, not args.no_index, args.dry_run)
