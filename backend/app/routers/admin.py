from __future__ import annotations

import hmac
import logging

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from ..auth import get_current_user, require_roles
from ..config import settings
from ..database import get_db
from ..models import User
from ..services import news_feed
from ..services.purge import purge_expired

router = APIRouter(prefix="/api/admin", tags=["admin"])
logger = logging.getLogger("decacore")


@router.post("/purge")
def manual_purge(db: Session = Depends(get_db), user: User = Depends(require_roles("HRAdmin"))):
    log = purge_expired(db, triggered_by=f"manual:{user.email}")
    return {
        "run_at": log.run_at,
        "conversations_deleted": log.conversations_deleted,
        "messages_deleted": log.messages_deleted,
        "duration_ms": log.duration_ms,
        "triggered_by": log.triggered_by,
    }


def refresh_caller(
    x_refresh_token: str | None = Header(default=None, alias="X-Refresh-Token"),
    authorization: str | None = Header(default=None),
    x_dev_user_email: str | None = Header(default=None, alias="X-Dev-User-Email"),
    x_dev_role: str | None = Header(default=None, alias="X-Dev-Role"),
    db: Session = Depends(get_db),
) -> str:
    """Allow either an HRAdmin access token or the scheduler's shared secret.

    The nightly job runs in GitHub Actions with no user behind it, and minting an
    Entra token for a service identity is a heavier lift than this one endpoint
    justifies. So it presents a secret instead — compared with `compare_digest`, and
    inert unless NEWS_REFRESH_TOKEN is set, so an unconfigured deployment does not
    quietly accept an empty header as valid.

    Returns a label for the audit line rather than a user, because on the scheduled
    path there is no user to return.
    """
    expected = settings.news_refresh_token
    # An App Service Key Vault reference that fails to resolve is handed to the app as
    # the literal "@Microsoft.KeyVault(SecretUri=...)" string. That string is committed
    # in infra/terraform/settings.tf, so accepting it would leave the endpoint open to
    # anyone who has read the repo. Treat an unresolved reference as no secret at all.
    if expected.startswith("@Microsoft.KeyVault("):
        logger.error("NEWS_REFRESH_TOKEN is an unresolved Key Vault reference; scheduled refresh disabled")
        expected = ""
    if expected and x_refresh_token and hmac.compare_digest(x_refresh_token, expected):
        return "scheduler"

    if x_refresh_token:
        # A wrong secret is a failed attempt, not an invitation to try the user path.
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    user = get_current_user(
        authorization=authorization,
        x_dev_user_email=x_dev_user_email,
        x_dev_role=x_dev_role,
        db=db,
    )
    if user.role != "HRAdmin":
        raise HTTPException(status_code=403, detail="Requires one of these roles: HRAdmin")
    return f"manual:{user.email}"


@router.post("/news/refresh")
def refresh_news(db: Session = Depends(get_db), caller: str = Depends(refresh_caller)):
    """Pull the company news feed and update the ticker.

    Idempotent, so re-running after a failure is always safe. Only rows whose `source`
    matches the configured feed slug are touched — anything HR wrote by hand is left
    exactly as it is.
    """
    try:
        result = news_feed.refresh(db)
    except news_feed.FeedError as exc:
        # The feed being down is the upstream's problem, not a bug here, and the
        # ticker keeps showing whatever it already had. 502 so the scheduled job goes
        # red and someone finds out, instead of a silent success with nothing ingested.
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {"triggered_by": caller, "source": settings.news_feed_source, **result.as_dict()}
