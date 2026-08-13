import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# Reuse environment initialized by test_api when suite runs together. This file is safe standalone too.
os.environ.setdefault("DATABASE_URL", f"sqlite:///{(ROOT / 'tests' / 'test_lifecycle.db').as_posix()}")
os.environ.setdefault("AUTH_MODE", "dev")
os.environ.setdefault("AUTO_SEED", "true")
os.environ.setdefault("STORAGE_BACKEND", "local")
os.environ.setdefault("SEARCH_BACKEND", "local")
os.environ.setdefault("LLM_BACKEND", "offline")

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.database import SessionLocal
from app.main import app
from app.models import Document


def test_held_back_document_becomes_searchable_after_approval():
    with TestClient(app) as client:
        with SessionLocal() as db:
            doc = db.scalar(select(Document).where(Document.external_document_id == "BPT-HR-BER-013"))
            assert doc is not None
            doc_id = doc.id
            assert doc.status == "pending_approval"

        before = client.post(
            "/api/chat",
            json={"message": "How many days off if my parent dies?"},
            headers={"X-Dev-User-Email": "marietta.baudone@gmail.com"},
        )
        assert before.status_code == 200
        assert "BPT-HR-BER-013" not in before.text

        approved = client.post(
            f"/api/documents/{doc_id}/approve",
            headers={"X-Dev-User-Email": "hr.admin@bluepeak.example"},
        )
        assert approved.status_code == 200
        assert approved.json()["indexed_at"] is not None

        after = client.post(
            "/api/chat",
            json={"message": "How many days off if my parent dies?"},
            headers={"X-Dev-User-Email": "marietta.baudone@gmail.com"},
        )
        assert after.status_code == 200
        assert "BPT-HR-BER-013" in after.text
