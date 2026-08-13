import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

TEST_DB = Path(__file__).resolve().parent / "test_decacore.db"
if TEST_DB.exists():
    TEST_DB.unlink()
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB.as_posix()}"
os.environ["AUTH_MODE"] = "dev"
os.environ["AUTO_SEED"] = "true"
os.environ["STORAGE_BACKEND"] = "local"
os.environ["SEARCH_BACKEND"] = "local"
os.environ["LLM_BACKEND"] = "offline"
os.environ["NOTIFICATION_BACKEND"] = "log"

from fastapi.testclient import TestClient

from app.main import app


def headers(email: str, role: str | None = None):
    h = {"X-Dev-User-Email": email}
    if role:
        h["X-Dev-Role"] = role
    return h


def test_health_and_seed():
    with TestClient(app) as client:
        r = client.get("/health")
        assert r.status_code == 200
        r = client.get("/api/me", headers=headers("marietta.baudone@gmail.com"))
        assert r.status_code == 200
        assert r.json()["role"] == "Employee"


def test_role_filtered_documents():
    with TestClient(app) as client:
        employee = client.get("/api/documents", headers=headers("marietta.baudone@gmail.com")).json()
        titles = {x["title"] for x in employee["items"]}
        assert "Compensation and Payroll Guide" not in titles
        manager = client.get("/api/documents", headers=headers("alejandra.farryann@gmail.com")).json()
        manager_titles = {x["title"] for x in manager["items"]}
        assert "Compensation and Payroll Guide" in manager_titles


def test_chat_sse():
    with TestClient(app) as client:
        r = client.post("/api/chat", json={"message": "How many vacation days can I carry over?"}, headers=headers("marietta.baudone@gmail.com"))
        assert r.status_code == 200
        assert "event: done" in r.text
        assert "citations" in r.text


def test_request_manager_routing_and_deny_requires_comment():
    with TestClient(app) as client:
        created = client.post(
            "/api/requests",
            data={"type": "Leave Application", "message": "Need a day off"},
            headers=headers("marietta.baudone@gmail.com"),
        )
        assert created.status_code == 200
        req = created.json()
        assert req["assigned_manager_id"] == 1
        req_id = req["id"]
        bad = client.post(f"/api/requests/{req_id}/deny", json={}, headers=headers("alejandra.farryann@gmail.com"))
        assert bad.status_code == 422
        good = client.post(f"/api/requests/{req_id}/deny", json={"comment": "Please add the dates."}, headers=headers("alejandra.farryann@gmail.com"))
        assert good.status_code == 200
        assert good.json()["status"] == "Denied"


def test_hr_can_see_pending_seed_document():
    with TestClient(app) as client:
        r = client.get("/api/documents/pending", headers=headers("hr.admin@bluepeak.example"))
        assert r.status_code == 200
        assert any("Bereavement" in x["title"] for x in r.json()["items"])


def test_escalation_marks_message_and_creates_hr_request():
    with TestClient(app) as client:
        chat = client.post("/api/chat", json={"message": "What is the office dress code?"}, headers=headers("marietta.baudone@gmail.com"))
        assert chat.status_code == 200
        import json
        import re
        meta_match = re.search(r"event: meta\ndata: (\{.*?\})", chat.text)
        assert meta_match
        meta = json.loads(meta_match.group(1))
        r = client.post(
            "/api/chat/escalate",
            json={"conversation_id": meta["conversation_id"], "assistant_message_id": meta["message_id"], "note": "Please confirm."},
            headers=headers("marietta.baudone@gmail.com"),
        )
        assert r.status_code == 200
        inbox = client.get("/api/requests", headers=headers("hr.admin@bluepeak.example")).json()
        assert any(x["id"] == r.json()["request_id"] for x in inbox["items"])
