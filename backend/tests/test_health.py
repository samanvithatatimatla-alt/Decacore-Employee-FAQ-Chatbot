"""Smoke tests for the service surface itself, as opposed to HR workflows.

These are the checks that catch a broken deployment before anyone opens the app:
does the process boot, does the router table load, and is the instance actually
in the mode its environment claims. Cheap to run and they fail loudly.
"""

from __future__ import annotations

import os

os.environ.setdefault("AUTH_MODE", "dev")
os.environ.setdefault("DATABASE_URL", "sqlite:///./data/test_health.db")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


def test_health_reports_ok():
    with TestClient(app) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_health_reports_every_adapter():
    """The health payload is how we tell a local instance from a live one.

    A missing key here means an adapter was added without being surfaced, and
    the dev slot would look healthy while silently running the wrong backend.
    """
    with TestClient(app) as client:
        body = client.get("/health").json()

    for adapter in (
        "auth_mode",
        "storage_backend",
        "search_backend",
        "llm_backend",
        "notification_backend",
    ):
        assert adapter in body, f"/health stopped reporting {adapter}"
        assert body[adapter], f"{adapter} is empty"


def test_tests_run_fully_offline():
    """Guard against a test run quietly hitting Azure and costing money.

    If someone exports real credentials into their shell, the suite should fail
    rather than index documents into the shared search service.
    """
    with TestClient(app) as client:
        body = client.get("/health").json()

    assert body["llm_backend"] == "offline"
    assert body["search_backend"] == "local"
    assert body["storage_backend"] == "local"


def test_root_points_at_docs():
    with TestClient(app) as client:
        body = client.get("/").json()

    assert body["docs"] == "/docs"
    assert body["health"] == "/health"


def test_every_router_is_mounted():
    """Catches a router that was written but never included in main.py.

    Reads the generated schema rather than app.routes: this FastAPI version wraps
    included routers in _IncludedRouter objects that expose no .path.
    """
    paths = set(app.openapi()["paths"])

    # One representative endpoint per router in main.py's include list.
    for expected in (
        "/api/me",                    # me
        "/api/chat",                  # chat
        "/api/conversations",         # conversations
        "/api/documents",             # documents
        "/api/requests",              # requests
        "/api/dashboard/metrics",     # dashboard
        "/api/admin/purge",           # admin
    ):
        assert expected in paths, f"{expected} is not mounted"
