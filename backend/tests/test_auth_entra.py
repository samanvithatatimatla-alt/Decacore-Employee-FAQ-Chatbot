"""Entra token validation.

Exercises `_decode_entra_token` directly rather than through the app, so it does not
depend on AUTH_MODE — `settings` is a process-wide singleton built from the environment
at import, and the rest of the suite has already pinned it to dev mode.

No network: every token here fails before any signing key could be used.
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import pytest
from fastapi import HTTPException

from app.auth import ROLE_ORDER, _best_role, _decode_entra_token, _jwk_client


@pytest.mark.parametrize(
    "token",
    [
        "not.a.real.token",
        "",
        "onlyonesegment",
        "a.b",
        "eyJhbGciOiJIUzI1NiJ9.!!!not-base64!!!.sig",
    ],
)
def test_malformed_token_is_401_not_500(token):
    """A bad token must read as 401.

    These fail inside the signing-key lookup, which sits before `jwt.decode`. That
    used to escape as an unhandled exception, so a client sending a stale or corrupt
    token got a 500 — indistinguishable from the API being down, and the frontend
    would surface an outage instead of re-authenticating.
    """
    with pytest.raises(HTTPException) as exc:
        _decode_entra_token(token)
    assert exc.value.status_code == 401


def test_jwk_client_is_reused_across_requests():
    # Rebuilding it per call discards PyJWKClient's key cache and puts an HTTPS round
    # trip to login.microsoftonline.com in front of every authenticated request.
    assert _jwk_client() is _jwk_client()


def test_best_role_prefers_the_most_privileged():
    assert _best_role(["Employee", "HRAdmin"]) == "HRAdmin"
    assert _best_role(["Employee", "Manager"]) == "Manager"
    assert _best_role(["Manager", "Executive"]) == "Manager"
    assert _best_role([]) == "Employee"
    assert _best_role(["SomethingUnknown"]) == "Employee"


def test_role_order_matches_the_app_roles_defined_in_entra():
    # These four values are the `value` fields of the app roles on the
    # DecaCore-HR-Chatbot registration. If they drift apart, tokens carry a role the
    # backend silently downgrades to Employee.
    assert set(ROLE_ORDER) == {"HRAdmin", "Manager", "Executive", "Employee"}
