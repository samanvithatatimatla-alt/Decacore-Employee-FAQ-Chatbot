from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from datetime import datetime, timezone

from sqlalchemy import select

from app.database import SessionLocal
from app.models import Document
from app.services.search import search_service

with SessionLocal() as db:
    docs = db.scalars(select(Document).where(Document.status == "approved")).all()
    total = 0
    for doc in docs:
        count = search_service.index_document(db, doc)
        doc.indexed_at = datetime.now(timezone.utc)
        db.commit()
        total += count
        print(f"{doc.title}: {count} chunks")
    print(f"Indexed {len(docs)} documents / {total} chunks")
