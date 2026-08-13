from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, select

from .config import settings
from .database import Base, SessionLocal, engine
from .models import User
from .routers import admin, chat, conversations, dashboard, documents, me, requests
from .seed import seed_all

logging.basicConfig(level=getattr(logging, settings.log_level.upper(), logging.INFO))
logger = logging.getLogger("decacore")

@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    if settings.auto_seed:
        with SessionLocal() as db:
            if (db.scalar(select(func.count(User.id))) or 0) == 0:
                result = seed_all(db)
                logger.info("Seeded local demo data: %s", result)
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
    }
