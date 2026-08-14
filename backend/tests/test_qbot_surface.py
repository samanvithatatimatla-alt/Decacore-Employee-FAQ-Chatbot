"""Covers the endpoints added for the QBot final design.

Everything here runs against SQLite with every adapter in local mode, so the suite
needs no Azure credentials and cannot reach the shared database, storage account
or search index.
"""

import io
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

os.environ.setdefault("DATABASE_URL", f"sqlite:///{(ROOT / 'tests' / 'test_qbot.db').as_posix()}")
os.environ.setdefault("AUTH_MODE", "dev")
os.environ.setdefault("AUTO_SEED", "true")
os.environ.setdefault("STORAGE_BACKEND", "local")
os.environ.setdefault("SEARCH_BACKEND", "local")
os.environ.setdefault("LLM_BACKEND", "offline")
os.environ.setdefault("NOTIFICATION_BACKEND", "log")

import pytest
from fastapi.testclient import TestClient
from pypdf import PdfWriter

from app.main import app

HR = {"X-Dev-User-Email": "hr.admin@bluepeak.example"}
EMPLOYEE = {"X-Dev-User-Email": "marietta.baudone@gmail.com"}


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def _pdf_bytes(pages: int = 1) -> bytes:
    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=200, height=200)
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


def _upload(client, name: str, pages: int = 1):
    return client.post(
        "/api/documents",
        files={"file": (name, _pdf_bytes(pages), "application/pdf")},
        data={"permissions": "Employee,Manager,Executive"},
        headers=HR,
    )


# ---------------------------------------------------------------------------
# Upload now approves and indexes in one step
# ---------------------------------------------------------------------------


def test_upload_is_live_immediately(client):
    res = _upload(client, "Immediate_Policy.pdf")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "approved"
    # Indexed as part of the upload: without this an employee could never get an
    # answer from a freshly uploaded policy, which is what the design promises.
    assert body["indexed_at"] is not None

    visible = client.get("/api/documents", headers=EMPLOYEE).json()["items"]
    assert any(d["id"] == body["id"] for d in visible)


def test_upload_still_requires_hr_admin(client):
    res = client.post(
        "/api/documents",
        files={"file": ("Nope.pdf", _pdf_bytes(), "application/pdf")},
        data={"permissions": "Employee"},
        headers=EMPLOYEE,
    )
    assert res.status_code == 403


def test_upload_rejects_non_pdf(client):
    res = client.post(
        "/api/documents",
        files={"file": ("notes.txt", b"plain text", "text/plain")},
        data={"permissions": "Employee"},
        headers=HR,
    )
    assert res.status_code == 415


# ---------------------------------------------------------------------------
# Versions
# ---------------------------------------------------------------------------


def test_seeded_pto_policy_has_two_real_versions(client):
    docs = client.get("/api/documents", headers=HR).json()["items"]
    pto = next(d for d in docs if d["filename"] == "13_Paid_Time_Off_Policy_Update_v2.pdf")
    versions = client.get(f"/api/documents/{pto['id']}/versions", headers=HR).json()["items"]
    assert [v["version_number"] for v in versions] == [2, 1]
    assert versions[0]["is_current"] is True
    assert versions[0]["change_summary"]

    # Both versions serve their own file, which is what makes compare meaningful.
    for number in (1, 2):
        content = client.get(f"/api/documents/{pto['id']}/versions/{number}/content", headers=HR)
        assert content.status_code == 200
        assert content.content.startswith(b"%PDF")


def test_document_without_history_reports_a_synthetic_v1(client):
    doc_id = _upload(client, "Solo_Policy.pdf").json()["id"]
    versions = client.get(f"/api/documents/{doc_id}/versions", headers=HR).json()["items"]
    assert len(versions) == 1
    assert versions[0]["version_number"] == 1
    assert versions[0]["is_current"] is True


def test_new_version_supersedes_and_appears_in_updates(client):
    doc_id = _upload(client, "Evolving_Policy.pdf").json()["id"]

    res = client.post(
        f"/api/documents/{doc_id}/versions",
        files={"file": ("Evolving_Policy_v2.pdf", _pdf_bytes(2), "application/pdf")},
        data={"change_summary": "Carryover cap raised to ten days."},
        headers=HR,
    )
    assert res.status_code == 200
    assert res.json()["version"] == "v2"
    # Reindexed, so answers cite the new text rather than the superseded file.
    assert res.json()["indexed_at"] is not None

    versions = client.get(f"/api/documents/{doc_id}/versions", headers=HR).json()["items"]
    assert [v["version_number"] for v in versions] == [2, 1]
    assert sum(1 for v in versions if v["is_current"]) == 1

    updates = client.get("/api/documents/updates", headers=EMPLOYEE).json()["items"]
    entry = next(u for u in updates if u["document_id"] == doc_id)
    assert entry["summary"] == "Carryover cap raised to ten days."
    assert entry["previous_version_number"] == 1


def test_new_version_requires_hr_admin(client):
    doc_id = _upload(client, "Guarded_Policy.pdf").json()["id"]
    res = client.post(
        f"/api/documents/{doc_id}/versions",
        files={"file": ("v2.pdf", _pdf_bytes(), "application/pdf")},
        headers=EMPLOYEE,
    )
    assert res.status_code == 403


def test_delete_removes_document_and_its_chunks(client):
    doc_id = _upload(client, "Temporary_Policy.pdf").json()["id"]
    assert client.delete(f"/api/documents/{doc_id}", headers=HR).status_code == 204
    assert client.get(f"/api/documents/{doc_id}/content", headers=HR).status_code == 404
    remaining = client.get("/api/documents", headers=HR).json()["items"]
    assert all(d["id"] != doc_id for d in remaining)


# ---------------------------------------------------------------------------
# Announcements
# ---------------------------------------------------------------------------


def test_announcements_are_seeded_and_readable(client):
    items = client.get("/api/announcements", headers=EMPLOYEE).json()["items"]
    assert len(items) >= 3
    assert all(a["title"] and a["body"] for a in items)


def test_announcement_create_is_hr_only(client):
    body = {"title": "Office closed Friday", "body": "Building maintenance."}
    assert client.post("/api/announcements", json=body, headers=EMPLOYEE).status_code == 403

    res = client.post("/api/announcements", json=body, headers=HR)
    assert res.status_code == 201
    created = res.json()
    assert created["published_at"] is not None

    titles = [a["title"] for a in client.get("/api/announcements", headers=EMPLOYEE).json()["items"]]
    assert "Office closed Friday" in titles

    assert client.delete(f"/api/announcements/{created['id']}", headers=HR).status_code == 204


def test_role_scoped_announcement_hidden_from_employee(client):
    res = client.post(
        "/api/announcements",
        json={"title": "Manager briefing", "body": "Headcount planning.", "allowed_roles": ["Manager"]},
        headers=HR,
    )
    assert res.status_code == 201
    titles = [a["title"] for a in client.get("/api/announcements", headers=EMPLOYEE).json()["items"]]
    assert "Manager briefing" not in titles


# ---------------------------------------------------------------------------
# Forms
# ---------------------------------------------------------------------------


def test_forms_listed_before_files_exist(client):
    items = client.get("/api/forms", headers=EMPLOYEE).json()["items"]
    assert len(items) == 3
    # Seeded rows carry no file yet, and say so rather than pretending to download.
    assert all(f["available"] is False for f in items)
    first = items[0]
    assert client.get(f"/api/forms/{first['id']}/content", headers=EMPLOYEE).status_code == 404


def test_uploading_a_form_fills_in_the_seeded_row(client):
    before = client.get("/api/forms", headers=HR).json()["items"]
    target = next(f for f in before if f["filename"] == "Leave_Request_Form.pdf")

    res = client.post(
        "/api/forms",
        files={"file": ("Leave_Request_Form.pdf", _pdf_bytes(), "application/pdf")},
        headers=HR,
    )
    assert res.status_code == 201
    assert res.json()["id"] == target["id"], "re-upload should fill the row, not duplicate it"

    after = client.get("/api/forms", headers=EMPLOYEE).json()["items"]
    assert len(after) == len(before)
    filled = next(f for f in after if f["id"] == target["id"])
    assert filled["available"] is True

    content = client.get(f"/api/forms/{target['id']}/content", headers=EMPLOYEE)
    assert content.status_code == 200
    assert content.content.startswith(b"%PDF")


def test_form_upload_is_hr_only(client):
    res = client.post(
        "/api/forms",
        files={"file": ("Sneaky.pdf", _pdf_bytes(), "application/pdf")},
        headers=EMPLOYEE,
    )
    assert res.status_code == 403


# ---------------------------------------------------------------------------
# Favourites and recently viewed
# ---------------------------------------------------------------------------


def test_favorites_round_trip(client):
    doc = client.get("/api/documents", headers=EMPLOYEE).json()["items"][0]

    client.put(f"/api/favorites/{doc['id']}", headers=EMPLOYEE)
    ids = [f["document_id"] for f in client.get("/api/favorites", headers=EMPLOYEE).json()["items"]]
    assert doc["id"] in ids

    # Favouriting twice must not create a second row.
    client.put(f"/api/favorites/{doc['id']}", headers=EMPLOYEE)
    assert len(client.get("/api/favorites", headers=EMPLOYEE).json()["items"]) == len(ids)

    client.delete(f"/api/favorites/{doc['id']}", headers=EMPLOYEE)
    ids = [f["document_id"] for f in client.get("/api/favorites", headers=EMPLOYEE).json()["items"]]
    assert doc["id"] not in ids


def test_favorites_are_per_user(client):
    doc = client.get("/api/documents", headers=EMPLOYEE).json()["items"][0]
    client.put(f"/api/favorites/{doc['id']}", headers=EMPLOYEE)
    assert client.get("/api/favorites", headers=HR).json()["total"] == 0
    client.delete(f"/api/favorites/{doc['id']}", headers=EMPLOYEE)


def test_recently_viewed_keeps_only_the_last_three(client):
    docs = client.get("/api/documents", headers=EMPLOYEE).json()["items"][:4]
    assert len(docs) == 4
    for d in docs:
        assert client.post(f"/api/recently-viewed/{d['id']}", headers=EMPLOYEE).status_code == 204

    seen = client.get("/api/recently-viewed", headers=EMPLOYEE).json()["items"]
    assert len(seen) == 3
    # Most recent first, and the oldest of the four has fallen off.
    assert seen[0]["document_id"] == docs[-1]["id"]
    assert all(s["document_id"] != docs[0]["id"] for s in seen)


# ---------------------------------------------------------------------------
# HR inbox
# ---------------------------------------------------------------------------


def _escalate(client) -> str:
    chat = client.post("/api/chat", json={"message": "Can I expense a home espresso machine?"}, headers=EMPLOYEE)
    assert chat.status_code == 200
    conversation_id = chat.text.split('"conversation_id": "', 1)[1].split('"', 1)[0]
    res = client.post(
        "/api/chat/escalate",
        json={"conversation_id": conversation_id, "note": "Needed for a client demo."},
        headers=EMPLOYEE,
    )
    assert res.status_code == 200
    return res.json()["request_id"]


def test_escalation_reaches_the_inbox_and_is_parsed(client):
    request_id = _escalate(client)
    items = client.get("/api/requests/inbox", headers=HR).json()["items"]
    entry = next(r for r in items if r["id"] == request_id)

    assert entry["status"] == "New"
    assert entry["question"] == "Can I expense a home espresso machine?"
    assert entry["employee_note"] == "Needed for a client demo."
    assert entry["ai_response"]
    assert entry["employee_name"]


def test_inbox_is_hr_only(client):
    assert client.get("/api/requests/inbox", headers=EMPLOYEE).status_code == 403


def test_inbox_filters_and_search(client):
    request_id = _escalate(client)

    assert any(r["id"] == request_id for r in client.get("/api/requests/inbox?status=New", headers=HR).json()["items"])
    assert all(r["status"] == "Resolved" for r in client.get("/api/requests/inbox?status=Resolved", headers=HR).json()["items"])

    hits = client.get("/api/requests/inbox?q=espresso", headers=HR).json()["items"]
    assert any(r["id"] == request_id for r in hits)
    assert client.get("/api/requests/inbox?q=zzzznotathing", headers=HR).json()["total"] == 0


def test_inbox_status_transitions(client):
    request_id = _escalate(client)

    started = client.post(f"/api/requests/{request_id}/status", json={"status": "In Progress"}, headers=HR)
    assert started.status_code == 200
    assert started.json()["status"] == "In Progress"

    bad = client.post(f"/api/requests/{request_id}/status", json={"status": "Banana"}, headers=HR)
    assert bad.status_code == 422


def test_hr_response_is_recorded_and_resolves(client):
    request_id = _escalate(client)

    replied = client.post(
        f"/api/requests/{request_id}/respond",
        json={"response": "Espresso machines are not reimbursable."},
        headers=HR,
    )
    assert replied.status_code == 200
    assert replied.json()["hr_response"] == "Espresso machines are not reimbursable."
    assert replied.json()["status"] == "In Progress"

    resolved = client.post(
        f"/api/requests/{request_id}/respond",
        json={"response": "Confirmed with Finance: not reimbursable.", "resolve": True},
        headers=HR,
    )
    assert resolved.json()["status"] == "Resolved"

    # The employee can still read their own request after HR resolves it.
    mine = client.get(f"/api/requests/{request_id}", headers=EMPLOYEE)
    assert mine.status_code == 200


def test_respond_requires_hr_admin(client):
    request_id = _escalate(client)
    res = client.post(f"/api/requests/{request_id}/respond", json={"response": "nope"}, headers=EMPLOYEE)
    assert res.status_code == 403


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------


def test_most_referenced_counts_real_citations(client):
    # Ask something the corpus answers, so citations are actually recorded.
    client.post("/api/chat", json={"message": "How much paid time off do I get?"}, headers=EMPLOYEE)

    charts = client.get("/api/dashboard/charts", headers=HR).json()
    ranked = charts["most_referenced"]
    assert ranked, "expected at least one cited document"
    assert [r["rank"] for r in ranked] == list(range(1, len(ranked) + 1))
    assert all(r["citations"] >= 1 for r in ranked)
    # Sorted by citation count, descending.
    assert [r["citations"] for r in ranked] == sorted((r["citations"] for r in ranked), reverse=True)


def test_dashboard_is_hr_only(client):
    assert client.get("/api/dashboard/charts", headers=EMPLOYEE).status_code == 403
    assert client.get("/api/dashboard/metrics", headers=EMPLOYEE).status_code == 403


def test_form_favorites_round_trip(client):
    form = client.get("/api/forms", headers=EMPLOYEE).json()["items"][0]

    assert client.put(f"/api/forms/{form['id']}/favorite", headers=EMPLOYEE).status_code == 204
    assert form["id"] in client.get("/api/forms/favorites", headers=EMPLOYEE).json()["items"]

    # Favouriting twice must not create a second row.
    client.put(f"/api/forms/{form['id']}/favorite", headers=EMPLOYEE)
    assert client.get("/api/forms/favorites", headers=EMPLOYEE).json()["total"] == 1

    # Per user, like document favourites.
    assert client.get("/api/forms/favorites", headers=HR).json()["total"] == 0

    assert client.delete(f"/api/forms/{form['id']}/favorite", headers=EMPLOYEE).status_code == 204
    assert client.get("/api/forms/favorites", headers=EMPLOYEE).json()["total"] == 0


def test_favorites_path_is_not_shadowed_by_form_id(client):
    # /api/forms/favorites must resolve to the list, not be read as a form id.
    res = client.get("/api/forms/favorites", headers=EMPLOYEE)
    assert res.status_code == 200
    assert "items" in res.json()
