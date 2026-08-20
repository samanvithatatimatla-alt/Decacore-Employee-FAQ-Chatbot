from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from functools import lru_cache
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .database import Base, SessionLocal, engine
from .migrations import ensure_columns
from .routers import (
    admin,
    announcements,
    chat,
    conversations,
    dashboard,
    documents,
    favorites,
    forms,
    me,
    requests,
)
from .seed import seed_all
from .services.storage import storage_service

logging.basicConfig(level=getattr(logging, settings.log_level.upper(), logging.INFO))


@lru_cache(maxsize=1)
def build_sha() -> str:
    """Short commit the running code was built from, or "unknown" locally.

    Deploys go GitHub push -> Azure DevOps queue -> zip deploy -> server-side pip
    install, which can take several minutes with no signal at the front end. Twice now
    a change has looked broken in production when the old build was simply still
    running. /health reporting the commit makes that a five-second check.
    """
    env = os.environ.get("BUILD_SHA", "").strip()
    if env:
        return env[:7]
    stamped = Path(__file__).with_name("BUILD_SHA")
    if stamped.exists():
        return stamped.read_text().strip()[:7] or "unknown"
    return "unknown"


logger = logging.getLogger("decacore")


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    # create_all adds missing tables but never missing columns, so a database that
    # booted before a model gained a field keeps the old shape forever. See
    # migrations.py — it is add-only and a no-op once applied.
    added = ensure_columns(engine)
    if added:
        logger.info("Added missing columns: %s", ", ".join(added))
    if settings.auto_seed:
        with SessionLocal() as db:
            # Run every seeder on each boot, not just on an empty database. Each one
            # guards on its own table's row count and returns 0 if it has nothing to
            # do, so this is idempotent — and it means tables added after a database
            # was first created still get populated. Gating the whole thing on "no
            # users yet" left announcements, forms and version history permanently
            # empty on any environment that had already booted once.
            result = seed_all(db)
            if any(result.values()):
                logger.info("Seeded demo data: %s", result)
    # Sign a throwaway link so the credential and the delegation key are already in
    # hand when someone opens a document. Cold, that pair costs about 2.5 seconds,
    # which the employee spends looking at an empty tab; warm, it is instant. Failure
    # here is not worth blocking startup for — the first real open just pays the cost.
    if settings.storage_backend == "azure":
        try:
            storage_service.get_read_url("warmup/none.pdf")
        except Exception:
            logger.info("Storage warm-up skipped", exc_info=True)
    yield


app = FastAPI(title=settings.app_name, version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(me.router)
app.include_router(chat.router)
app.include_router(conversations.router)
app.include_router(documents.router)
app.include_router(requests.router)
app.include_router(dashboard.router)
app.include_router(admin.router)
app.include_router(announcements.router)
app.include_router(forms.router)
app.include_router(favorites.router)


# The frontend used to be served from here. It now lives in the repo's top-level
# frontend/ folder and deploys separately to Azure Static Web Apps, so this app is
# API-only. Cross-origin calls from the frontend are handled by CORS_ORIGINS above.
@app.get("/", include_in_schema=False)
def root():
    return {"service": settings.app_name, "docs": "/docs", "health": "/health"}


@app.get("/health")
def health():
    return {
        "status": "ok",
        "auth_mode": settings.auth_mode,
        "storage_backend": settings.storage_backend,
        "search_backend": settings.search_backend,
        "llm_backend": settings.llm_backend,
        "notification_backend": settings.notification_backend,
        "build": build_sha(),
    }
