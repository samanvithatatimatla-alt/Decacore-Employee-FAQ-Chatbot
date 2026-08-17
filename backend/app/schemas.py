from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class UserOut(ORMModel):
    id: int
    entra_object_id: str | None = None
    display_name: str
    email: str
    role: str
    department: str | None = None
    manager_id: int | None = None
    manager_name: str | None = None


class Citation(BaseModel):
    document_id: str
    external_document_id: str | None = None
    title: str
    section: str | None = None
    page: int | None = None
    version: str | None = None
    effective_date: date | None = None
    source_url: str | None = None


class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=5000)
    conversation_id: str | None = None


class EscalationIn(BaseModel):
    conversation_id: str
    assistant_message_id: str | None = None
    note: str | None = Field(default=None, max_length=3000)


class ConversationOut(ORMModel):
    id: str
    title: str
    created_at: datetime
    last_message_at: datetime
    expires_at: datetime


class MessageOut(ORMModel):
    id: str
    role: str
    content: str
    citations: list[dict[str, Any]]
    confidence_score: float | None = None
    escalated: bool
    created_at: datetime


class ConversationDetail(ConversationOut):
    messages: list[MessageOut]


class DocumentOut(ORMModel):
    id: str
    external_document_id: str | None = None
    filename: str
    title: str
    category: str | None = None
    status: str
    allowed_roles: list[str]
    uploaded_at: datetime
    approved_at: datetime | None = None
    ai_suggested_category: str | None = None
    ai_confidence: float | None = None
    indexed_at: datetime | None = None
    version: str | None = None
    effective_date: date | None = None
    source_url: str | None = None
    rejection_comment: str | None = None


class CategoryPatch(BaseModel):
    category: str


class RejectBody(BaseModel):
    comment: str = Field(min_length=1, max_length=2000)


class RequestOut(ORMModel):
    id: str
    employee_id: int
    type: str
    category: str | None = None
    amount: float | None = None
    message: str
    attachment_blob_path: str | None = None
    status: str
    priority: int
    assigned_manager_id: int | None = None
    manager_comment: str | None = None
    decided_by: int | None = None
    decided_at: datetime | None = None
    created_at: datetime
    employee_name: str | None = None
    employee_department: str | None = None
    assigned_manager_name: str | None = None
    decided_by_name: str | None = None


class CategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class DecisionBody(BaseModel):
    comment: str | None = Field(default=None, max_length=2000)


class ListEnvelope(BaseModel):
    items: list[Any]
    total: int


# ---------------------------------------------------------------------------
# News ticker
# ---------------------------------------------------------------------------


class AnnouncementOut(ORMModel):
    id: str
    title: str
    body: str
    allowed_roles: list[str]
    department: str | None = None
    published_at: datetime | None = None
    expires_at: datetime | None = None


class AnnouncementIn(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    body: str = Field(min_length=1, max_length=2000)
    allowed_roles: list[str] = Field(default_factory=list)
    department: str | None = None
    expires_at: datetime | None = None
    published: bool = True


# ---------------------------------------------------------------------------
# Document versions
# ---------------------------------------------------------------------------


class DocumentVersionOut(ORMModel):
    id: str
    document_id: str
    version_number: int
    filename: str
    title: str
    change_summary: str | None = None
    is_current: bool
    effective_date: date | None = None
    uploaded_at: datetime
    uploaded_by_name: str | None = None


# ---------------------------------------------------------------------------
# HR forms
# ---------------------------------------------------------------------------


class HRFormOut(ORMModel):
    id: str
    title: str
    filename: str
    category: str | None = None
    allowed_roles: list[str]
    available: bool = False


# ---------------------------------------------------------------------------
# Favourites and recently viewed
# ---------------------------------------------------------------------------


class FavoriteOut(BaseModel):
    document_id: str
    title: str
    filename: str
    kind: str
    last_viewed_at: datetime | None = None


# ---------------------------------------------------------------------------
# HR inbox
# ---------------------------------------------------------------------------


class InboxStatusBody(BaseModel):
    # Free-form on the column, but only these three are reachable through the API.
    status: Literal["New", "In Progress", "Resolved"]


class HRResponseBody(BaseModel):
    response: str = Field(min_length=1, max_length=4000)
    resolve: bool = False
