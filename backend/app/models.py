from __future__ import annotations

import uuid
from datetime import UTC, date, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utcnow() -> datetime:
    return datetime.now(UTC)


def uuid4str() -> str:
    return str(uuid.uuid4())


class User(Base):
    __tablename__ = "users"

    # entra_object_id is unique only among rows that actually have one. A plain
    # UNIQUE constraint cannot express that on SQL Server, which treats NULLs as
    # equal and so permits exactly one NULL — seeding 100 users with no Entra
    # object id yet fails on the second row. SQLite and Postgres allow many NULLs,
    # so this only shows up against Azure SQL.
    __table_args__ = (
        Index(
            "uq_users_entra_object_id",
            "entra_object_id",
            unique=True,
            mssql_where=text("entra_object_id IS NOT NULL"),
            sqlite_where=text("entra_object_id IS NOT NULL"),
            postgresql_where=text("entra_object_id IS NOT NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    entra_object_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    display_name: Mapped[str] = mapped_column(String(200))
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    role: Mapped[str] = mapped_column(String(40), index=True)
    department: Mapped[str | None] = mapped_column(String(100), index=True)
    manager_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    hire_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    manager: Mapped[User | None] = relationship(remote_side=[id], backref="direct_reports")

    @property
    def manager_name(self) -> str | None:
        return self.manager.display_name if self.manager else None


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4str)
    external_document_id: Mapped[str | None] = mapped_column(String(100), index=True)
    filename: Mapped[str] = mapped_column(String(255))
    title: Mapped[str] = mapped_column(String(300))
    blob_path: Mapped[str] = mapped_column(String(700))
    watermarked_blob_path: Mapped[str | None] = mapped_column(String(700), nullable=True)
    category: Mapped[str | None] = mapped_column(String(100), index=True)
    status: Mapped[str] = mapped_column(String(40), index=True, default="pending_review")
    allowed_roles: Mapped[list[str]] = mapped_column(JSON, default=list)
    uploaded_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    approved_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rejected_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    rejected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rejection_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    ai_suggested_category: Mapped[str | None] = mapped_column(String(100), nullable=True)
    ai_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    indexed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    version: Mapped[str | None] = mapped_column(String(50), nullable=True)
    effective_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    source_url: Mapped[str | None] = mapped_column(String(800), nullable=True)


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4str)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_message_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)

    messages: Mapped[list[Message]] = relationship(back_populates="conversation", cascade="all, delete-orphan")


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4str)
    conversation_id: Mapped[str] = mapped_column(ForeignKey("conversations.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(20))
    content: Mapped[str] = mapped_column(Text)
    citations: Mapped[list[dict]] = mapped_column(JSON, default=list)
    confidence_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    escalated: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    conversation: Mapped[Conversation] = relationship(back_populates="messages")


class EmployeeRequest(Base):
    __tablename__ = "requests"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4str)
    employee_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    type: Mapped[str] = mapped_column(String(80), index=True)
    category: Mapped[str | None] = mapped_column(String(100), nullable=True)
    amount: Mapped[float | None] = mapped_column(Float, nullable=True)
    message: Mapped[str] = mapped_column(Text)
    attachment_blob_path: Mapped[str | None] = mapped_column(String(700), nullable=True)
    status: Mapped[str] = mapped_column(String(40), index=True, default="Pending")
    priority: Mapped[int] = mapped_column(Integer, default=3, index=True)
    assigned_manager_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    manager_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    decided_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class NotificationLog(Base):
    __tablename__ = "notification_log"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4str)
    recipient: Mapped[str] = mapped_column(String(320))
    subject: Mapped[str] = mapped_column(String(300))
    status: Mapped[str] = mapped_column(String(40))
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class PurgeLog(Base):
    __tablename__ = "purge_log"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4str)
    run_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    conversations_deleted: Mapped[int] = mapped_column(Integer, default=0)
    messages_deleted: Mapped[int] = mapped_column(Integer, default=0)
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    triggered_by: Mapped[str] = mapped_column(String(80), default="timer")


class SearchChunk(Base):
    __tablename__ = "search_chunks"

    id: Mapped[str] = mapped_column(String(120), primary_key=True)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    external_document_id: Mapped[str | None] = mapped_column(String(100), index=True)
    chunk_index: Mapped[int] = mapped_column(Integer)
    content: Mapped[str] = mapped_column(Text)
    section_heading: Mapped[str | None] = mapped_column(String(300), nullable=True)
    page_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    title: Mapped[str] = mapped_column(String(300))
    category: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    allowed_roles: Mapped[list[str]] = mapped_column(JSON, default=list)
    version: Mapped[str | None] = mapped_column(String(50), nullable=True)
    effective_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    source_url: Mapped[str | None] = mapped_column(String(800), nullable=True)


# ---------------------------------------------------------------------------
# Tables added for the revised build plan. No routers use these yet — the schema
# lands first so the API work isn't blocked waiting on migrations.
# ---------------------------------------------------------------------------


class NewsAnnouncement(Base):
    """Live Company News banner."""

    __tablename__ = "news_announcements"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4str)
    title: Mapped[str] = mapped_column(String(300))
    body: Mapped[str] = mapped_column(Text)
    # Empty means visible to everyone; otherwise same role vocabulary as documents.
    allowed_roles: Mapped[list[str]] = mapped_column(JSON, default=list)
    department: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    published: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Stored rather than computed, so a banner can be expired without a code change.
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class DocumentVersion(Base):
    """History for a policy document, so an updated policy can be diffed and summarised."""

    __tablename__ = "document_versions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4str)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    version_number: Mapped[int] = mapped_column(Integer, index=True)
    blob_path: Mapped[str] = mapped_column(String(700))
    filename: Mapped[str] = mapped_column(String(255))
    title: Mapped[str] = mapped_column(String(300))
    effective_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    # Plain-language diff of this version against the previous one.
    change_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_current: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    uploaded_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class WatermarkSettings(Base):
    """Secure viewer watermark configuration. Single-row table in practice."""

    __tablename__ = "watermark_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    static_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    static_text: Mapped[str] = mapped_column(String(200), default="BluePeak — Confidential")
    # Per-user overlay (name/email/timestamp). First item on the cut list, so it is
    # a flag rather than a code path that has to be removed.
    dynamic_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    opacity: Mapped[float] = mapped_column(Float, default=0.15)
    font_size: Mapped[int] = mapped_column(Integer, default=36)
    rotation_degrees: Mapped[int] = mapped_column(Integer, default=45)
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class Favorite(Base):
    """Favourites and recently-viewed. `kind` distinguishes the two."""

    __tablename__ = "favorites"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4str)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(20), default="favorite", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_viewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class HRForm(Base):
    """Fillable HR forms, listed separately from policies in Resources.

    A form is not a Document: it is never chunked, never indexed, and never cited
    in an answer. Keeping it in its own table means the search corpus cannot pick
    up a blank leave-request form and offer it as a policy source.

    `blob_path` is nullable because the seed knows which forms HR publishes before
    anyone has uploaded the files; the download endpoint 404s until one is.
    """

    __tablename__ = "hr_forms"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4str)
    title: Mapped[str] = mapped_column(String(300))
    filename: Mapped[str] = mapped_column(String(255))
    blob_path: Mapped[str | None] = mapped_column(String(700), nullable=True)
    category: Mapped[str | None] = mapped_column(String(100), nullable=True)
    allowed_roles: Mapped[list[str]] = mapped_column(JSON, default=list)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, index=True)
    uploaded_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class FormFavorite(Base):
    """Favourited HR forms.

    Separate from Favorite because that table foreign-keys to documents, and a form
    is not a document. Adding a nullable form_id column to Favorite would have been
    tidier, but the app creates tables with Base.metadata.create_all and has no
    migration step — create_all adds missing tables and never alters existing ones,
    so a new column would silently not appear on a database that has already booted.
    """

    __tablename__ = "form_favorites"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4str)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    form_id: Mapped[str] = mapped_column(ForeignKey("hr_forms.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class MissingPolicyFlag(Base):
    """Questions the corpus could not answer, grouped so repeat topics surface to HR."""

    __tablename__ = "missing_policy_flags"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4str)
    topic: Mapped[str] = mapped_column(String(300), index=True)
    # Normalised form of `topic`, so near-identical questions group together.
    topic_key: Mapped[str] = mapped_column(String(200), index=True)
    sample_question: Mapped[str] = mapped_column(Text)
    ask_count: Mapped[int] = mapped_column(Integer, default=1)
    distinct_user_count: Mapped[int] = mapped_column(Integer, default=1)
    first_asked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_asked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    # Set once the HR notification fires, so the same topic isn't emailed repeatedly.
    notified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
