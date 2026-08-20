"""Blob read URLs have to survive the filenames the corpus actually uses.

Every policy PDF is named like "Attendance & Timekeeping Policy.pdf" — spaces, "&",
parentheses. Interpolating that into a URL unencoded produced a URL the browser
rejected outright, so Resources could not open a single policy. The forms are named
"01_Leave_Request_Form.pdf" and worked fine throughout, which is what made the bug look
like a permissions problem rather than a string-handling one.

No network here: the SAS generator and the credential are stubbed, because what is
being tested is how the URL is assembled, not that Azure signs it.
"""

from __future__ import annotations

import os
from datetime import UTC, datetime, timedelta
from urllib.parse import urlsplit

os.environ.setdefault("AUTH_MODE", "dev")
os.environ.setdefault("DATABASE_URL", "sqlite:///./data/test_storage_urls.db")

import pytest  # noqa: E402

from app.config import settings  # noqa: E402
from app.services.storage import storage_service  # noqa: E402

ACCOUNT = "https://qthrpolicypdfs.blob.core.windows.net"

# Real names from the deployed corpus.
POLICY_NAMES = [
    "Acceptable Use of Company Devices.pdf",
    "Attendance & Timekeeping Policy.pdf",
    "Retirement (401k) Plan Guide.pdf",
    "Paid Time Off (PTO) Policy.pdf",
]
FORM_NAME = "01_Leave_Request_Form.pdf"


@pytest.fixture
def azure_mode(monkeypatch):
    monkeypatch.setattr(settings, "storage_backend", "azure")
    monkeypatch.setattr(settings, "azure_storage_account_url", ACCOUNT)

    class FakeService:
        account_name = "qthrpolicypdfs"

    monkeypatch.setattr(storage_service, "_service", lambda: FakeService())
    monkeypatch.setattr(
        storage_service,
        "_delegation_key",
        lambda service: ("delegation-key", datetime.now(UTC) + timedelta(hours=1)),
    )

    import azure.storage.blob as blob

    signed: dict[str, str] = {}

    def fake_sas(**kwargs):
        # Captured so the test can assert the *decoded* name was signed.
        signed["blob_name"] = kwargs["blob_name"]
        return "sv=2024-11-04&sig=STUB"

    monkeypatch.setattr(blob, "generate_blob_sas", fake_sas)
    return signed


@pytest.mark.parametrize("name", POLICY_NAMES)
def test_policy_urls_are_percent_encoded(azure_mode, name):
    url = storage_service.get_read_url(f"documents/{name}", name)

    path = urlsplit(url).path
    assert " " not in path, f"a space in the path makes the URL invalid: {path}"
    assert "&" not in path, f"a raw & next to a SAS query is ambiguous: {path}"
    assert "%20" in path or " " not in name


def test_signature_is_generated_from_the_decoded_name(azure_mode):
    """Encoding before signing would sign a blob that does not exist.

    Azure canonicalises to the decoded name when it verifies the SAS, so the encoding
    must happen only on the way into the URL.
    """
    name = "Attendance & Timekeeping Policy.pdf"
    storage_service.get_read_url(f"documents/{name}", name)

    assert azure_mode["blob_name"] == name
    assert "%20" not in azure_mode["blob_name"]


def test_query_string_still_starts_at_the_real_separator(azure_mode):
    name = "Attendance & Timekeeping Policy.pdf"
    url = storage_service.get_read_url(f"documents/{name}", name)

    parts = urlsplit(url)
    # The "&" in the filename must not read as a query parameter separator.
    assert parts.query.startswith("sv=")
    assert "Timekeeping" not in parts.query


def test_form_names_are_unaffected(azure_mode):
    """The names that already worked must round-trip byte-identically."""
    url = storage_service.get_read_url(f"documents/{FORM_NAME}", FORM_NAME)

    assert urlsplit(url).path == f"/documents/{FORM_NAME}"


def test_local_backend_returns_none(monkeypatch):
    """Local mode has no SAS; the router falls back to its own /content route."""
    monkeypatch.setattr(settings, "storage_backend", "local")

    assert storage_service.get_read_url("documents/Anything At All.pdf", "x.pdf") is None
