from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..config import settings
from ..database import SessionLocal, get_db
from ..models import Conversation, EmployeeRequest, Message, User
from ..schemas import ChatIn, EscalationIn
from ..services.cache import dashboard_cache
from ..services.notifications import notification_service
from ..services.rag import rag_service
from ..services.rate_limit import chat_rate_limiter

router = APIRouter(prefix="/api", tags=["chat"])


def sse(event: str, data: dict | str) -> str:
    payload = data if isinstance(data, str) else json.dumps(data, default=str)
    return f"event: {event}\ndata: {payload}\n\n"


@router.post("/chat")
def chat(payload: ChatIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    chat_rate_limiter.check(str(user.id))
    now = datetime.now(UTC)
    if payload.conversation_id:
        conv = db.scalar(select(Conversation).where(Conversation.id == payload.conversation_id, Conversation.user_id == user.id))
        if not conv:
            raise HTTPException(status_code=404, detail="Conversation not found")
    else:
        conv = Conversation(
            user_id=user.id,
            title=payload.message[:80],
            created_at=now,
            last_message_at=now,
            expires_at=now + timedelta(days=settings.retention_days),
        )
        db.add(conv)
        db.flush()
    db.add(Message(conversation_id=conv.id, role="user", content=payload.message, citations=[]))
    conv.last_message_at = now
    db.commit()
    # Copied out while the request session is still open — the generator below
    # runs after it closes, so touching ORM attributes there would raise.
    conversation_id = conv.id
    user_role = user.role
    question = payload.message

    def generate():
        with SessionLocal() as worker_db:
            result = rag_service.answer(worker_db, question, user_role)
            assistant = Message(
                conversation_id=conversation_id,
                role="assistant",
                content=result.answer,
                citations=result.citations,
                confidence_score=result.confidence,
                escalated=False,
            )
            worker_db.add(assistant)
            conv2 = worker_db.get(Conversation, conversation_id)
            if conv2:
                conv2.last_message_at = datetime.now(UTC)
            worker_db.commit()
            worker_db.refresh(assistant)

            yield sse("meta", {"conversation_id": conversation_id, "message_id": assistant.id})
            words = result.answer.split(" ")
            for i, word in enumerate(words):
                yield sse("delta", {"text": word + (" " if i < len(words) - 1 else "")})
            yield sse("done", {
                "conversation_id": conversation_id,
                "message_id": assistant.id,
                "citations": result.citations,
                "confidence": result.confidence,
                "escalation_offered": result.should_escalate,
            })

    return StreamingResponse(generate(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# Chatter that is not a question. Grouping raw message text put "hi" in the top
# three, which the home screen presents to every employee as a frequently asked
# question.
FAQ_MIN_CHARS = 12
FAQ_MIN_WORDS = 3
FAQ_STOPWORDS = {"hi", "hey", "hello", "thanks", "thank you", "test", "testing", "ok", "okay", "yes", "no"}


def is_faq_candidate(text: str) -> bool:
    stripped = text.strip().lower().rstrip("?.!")
    if stripped in FAQ_STOPWORDS:
        return False
    return len(text) >= FAQ_MIN_CHARS and len(text.split()) >= FAQ_MIN_WORDS


@router.get("/faq/top")
def top_faq(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    # Cached: every employee hits this on the home screen and the answer is the same
    # global top three for all of them, so without a cache the busiest endpoint in the
    # app runs a full GROUP BY over every message once per page load.
    def compute():
        # Group in SQL over a wider window, then merge and filter in Python: the same
        # question asked with different capitalisation or trailing punctuation is one
        # question, and SQL grouping alone would count them separately.
        rows = db.execute(
            select(Message.content, func.count(Message.id).label("count"))
            .join(Conversation, Conversation.id == Message.conversation_id)
            .where(Message.role == "user")
            .group_by(Message.content)
            .order_by(func.count(Message.id).desc())
            .limit(100)
        ).all()

        merged: dict[str, tuple[str, int]] = {}
        for content, count in rows:
            text = " ".join((content or "").split())
            if not is_faq_candidate(text):
                continue
            key = text.lower().rstrip("?.! ")
            if key in merged:
                kept, total = merged[key]
                # Keep the most-asked phrasing as the label.
                merged[key] = (kept, total + count)
            else:
                merged[key] = (text, count)

        top = sorted(merged.values(), key=lambda pair: -pair[1])[:3]
        items = [{"question": text, "count": count} for text, count in top]
        return {"items": items, "total": len(items)}

    return dashboard_cache.get_or_set("faq:top", compute)


@router.post("/chat/escalate")
def escalate_chat(payload: EscalationIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    conv = db.scalar(select(Conversation).where(Conversation.id == payload.conversation_id, Conversation.user_id == user.id))
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    assistant = None
    if payload.assistant_message_id:
        assistant = db.scalar(select(Message).where(Message.id == payload.assistant_message_id, Message.conversation_id == conv.id, Message.role == "assistant"))
        if not assistant:
            raise HTTPException(status_code=404, detail="Assistant message not found")
    if assistant is None:
        assistant = db.scalar(select(Message).where(Message.conversation_id == conv.id, Message.role == "assistant").order_by(Message.created_at.desc()).limit(1))
    user_message = db.scalar(select(Message).where(Message.conversation_id == conv.id, Message.role == "user").order_by(Message.created_at.desc()).limit(1))
    question = user_message.content if user_message else conv.title
    req = EmployeeRequest(
        employee_id=user.id,
        type="HR Question",
        category="Chat Escalation",
        message=f"Question: {question}\n\nEmployee note: {payload.note or '(none)'}\n\nChatbot response: {assistant.content if assistant else '(no assistant response)'}",
        status="Pending",
        priority={"Executive": 1, "Manager": 2, "Employee": 3}.get(user.role, 3),
        assigned_manager_id=None,
    )
    db.add(req)
    if assistant:
        assistant.escalated = True
    db.commit()
    db.refresh(req)
    if settings.hr_notification_email:
        notification_service.send(db, settings.hr_notification_email, "Chat question escalated to HR", f"{user.display_name} escalated request {req.id}: {question}")
    return {"request_id": req.id, "status": req.status, "message": "Question sent to HR."}
