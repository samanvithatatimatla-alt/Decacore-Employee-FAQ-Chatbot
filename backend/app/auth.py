from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from functools import lru_cache

import jwt
from fastapi import Depends, Header, HTTPException, status
from jwt import PyJWKClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import settings
from .database import get_db
from .models import User

ROLE_ORDER = ["HRAdmin", "Manager", "Executive", "Employee"]


@dataclass
class TokenIdentity:
    object_id: str | None
    email: str | None
    display_name: str | None
    roles: list[str]


def _best_role(roles: Iterable[str]) -> str:
    role_set = set(roles)
    for role in ROLE_ORDER:
        if role in role_set:
            return role
    return "Employee"


@lru_cache(maxsize=1)
def _jwk_client() -> PyJWKClient:
    """One client for the process, so Microsoft's signing keys are fetched once, not per request.

    PyJWKClient caches keys internally, but only for the lifetime of the instance —
    building a new one per request threw that away and put an HTTPS round trip to
    login.microsoftonline.com in front of every authenticated call.
    """
    tenant = settings.entra_tenant_id
    return PyJWKClient(
        f"https://login.microsoftonline.com/{tenant}/discovery/v2.0/keys",
        cache_keys=True,
        lifespan=3600,
    )


def _decode_entra_token(token: str) -> TokenIdentity:
    tenant = settings.entra_tenant_id
    try:
        signing_key = _jwk_client().get_signing_key_from_jwt(token).key
    except Exception as exc:
        # A malformed token fails here rather than in jwt.decode below, and an
        # uncaught error surfaces as a 500. A bad token is the client's problem:
        # it must read as 401 so the frontend re-authenticates instead of treating
        # it as a server outage.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not verify the access token's signing key",
        ) from exc
    audiences = [a for a in {settings.entra_audience, settings.entra_client_id} if a]
    issuers = [f"https://login.microsoftonline.com/{tenant}/v2.0", f"https://sts.windows.net/{tenant}/"]
    last_error: Exception | None = None
    claims = None
    for issuer in issuers:
        try:
            claims = jwt.decode(
                token,
                signing_key,
                algorithms=["RS256"],
                audience=audiences,
                issuer=issuer,
                options={"require": ["exp", "aud", "iss"]},
            )
            break
        except Exception as exc:  # try the alternate Entra issuer format
            last_error = exc
    if claims is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=f"Invalid access token: {last_error}")
    if claims.get("tid") and claims.get("tid") != tenant:
        raise HTTPException(status_code=401, detail="Token tenant does not match configured tenant")
    return TokenIdentity(
        object_id=claims.get("oid"),
        email=claims.get("preferred_username") or claims.get("upn") or claims.get("email"),
        display_name=claims.get("name"),
        roles=list(claims.get("roles") or []),
    )


def _load_or_create_user(db: Session, ident: TokenIdentity) -> User:
    user = None
    if ident.object_id:
        user = db.scalar(select(User).where(User.entra_object_id == ident.object_id))
    if user is None and ident.email:
        user = db.scalar(select(User).where(User.email == ident.email.lower()))
    if user is None:
        if not ident.email:
            raise HTTPException(status_code=403, detail="Token has no usable user identity claim")
        next_id = (db.scalar(select(User.id).order_by(User.id.desc()).limit(1)) or 1000) + 1
        user = User(
            id=next_id,
            entra_object_id=ident.object_id,
            display_name=ident.display_name or ident.email.split("@")[0],
            email=ident.email.lower(),
            role=_best_role(ident.roles),
            department=None,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    else:
        changed = False
        if ident.object_id and not user.entra_object_id:
            user.entra_object_id = ident.object_id
            changed = True
        if ident.roles:
            token_role = _best_role(ident.roles)
            if token_role != user.role:
                user.role = token_role
                changed = True
        if changed:
            db.commit()
            db.refresh(user)
    return user


def get_current_user(
    authorization: str | None = Header(default=None),
    x_dev_user_email: str | None = Header(default=None, alias="X-Dev-User-Email"),
    x_dev_role: str | None = Header(default=None, alias="X-Dev-Role"),
    db: Session = Depends(get_db),
) -> User:
    if settings.auth_mode == "dev":
        email = (x_dev_user_email or settings.dev_user_email).lower()
        user = db.scalar(select(User).where(User.email == email))
        if not user:
            raise HTTPException(status_code=401, detail=f"Dev user not found: {email}. Run the seed script.")
        if x_dev_role:
            if x_dev_role not in ROLE_ORDER:
                raise HTTPException(status_code=400, detail=f"Invalid X-Dev-Role. Use one of {ROLE_ORDER}")
            # Return an in-memory copy-like object is unnecessary for demo; override only for this request.
            user.role = x_dev_role
        return user

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer access token")
    ident = _decode_entra_token(authorization.split(" ", 1)[1])
    return _load_or_create_user(db, ident)


def require_roles(*allowed: str):
    def dependency(user: User = Depends(get_current_user)) -> User:
        if user.role not in allowed:
            raise HTTPException(status_code=403, detail=f"Requires one of these roles: {', '.join(allowed)}")
        return user

    return dependency
