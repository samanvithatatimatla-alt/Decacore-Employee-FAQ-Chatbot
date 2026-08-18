from __future__ import annotations

import json
import logging
from datetime import UTC, datetime, timedelta
from time import perf_counter

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
from ..services.guardrails import UserProfile
from ..services.notifications import notification_service
from ..services.rag import rag_service
from ..services.rate_limit import chat_rate_limiter

router = APIRouter(prefix="/api", tags=["chat"])
logger = logging.getLogger("decacore")


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
    profile = UserProfile(
        display_name=user.display_name,
        role=user.role,
        email=user.email,
        department=user.department,
        manager_name=user.manager_name,
        hire_date=user.hire_date,
    )

    def generate():
        with SessionLocal() as worker_db:
            # Timed in three parts because they have completely different fixes:
            # retrieval is embedding + search, first-token is the model thinking before
            # it writes anything, and the rest is generation speed. Without the split,
            # "the bot is slow" has no actionable answer.
            started = perf_counter()

            # Retrieval runs here; the model has not written anything yet. Citations and
            # confidence are already final at this point, which is why the row can be
            # created — and `meta` sent — before a single token exists.
            prepared = rag_service.stream(worker_db, question, user_role, profile)
            retrieval_ms = int((perf_counter() - started) * 1000)
            assistant = Message(
                conversation_id=conversation_id,
                role="assistant",
                content="",
                citations=prepared.citations,
                confidence_score=prepared.confidence,
                escalated=False,
            )
            worker_db.add(assistant)
            conv2 = worker_db.get(Conversation, conversation_id)
            if conv2:
                conv2.last_message_at = datetime.now(UTC)
            worker_db.commit()
            worker_db.refresh(assistant)
            message_id = assistant.id

            yield sse("meta", {"conversation_id": conversation_id, "message_id": message_id})

            parts: list[str] = []
            first_token_ms: int | None = None
            try:
                for chunk in prepared.chunks:
                    if first_token_ms is None:
                        first_token_ms = int((perf_counter() - started) * 1000)
                    parts.append(chunk)
                    yield sse("delta", {"text": chunk})
            finally:
                # Persist whatever arrived even if the client hung up or the upstream
                # stream broke: the row was already committed with empty content, and
                # leaving it that way would put a blank bubble in the user's history.
                stored = worker_db.get(Message, message_id)
                if stored is not None:
                    stored.content = "".join(parts)
                    worker_db.commit()

            total_ms = int((perf_counter() - started) * 1000)
            timings = {
                "retrieval_ms": retrieval_ms,
                "first_token_ms": first_token_ms,
                "total_ms": total_ms,
            }
            # Relevance and raw score are logged next to the timings because that is
            # how AZURE_MIN_SCORE gets tuned: read what real questions actually score,
            # then set the threshold between the answered ones and the ones that should
            # have gone to HR.
            logger.info(
                "chat timing retrieval=%sms first_token=%sms total=%sms chars=%s "
                "relevance=%.3f raw_score=%.3f escalate=%s",
                retrieval_ms,
                first_token_ms,
                total_ms,
                len("".join(parts)),
                prepared.confidence,
                prepared.raw_score,
                prepared.should_escalate,
            )

            yield sse("done", {
                "conversation_id": conversation_id,
                "message_id": message_id,
                "citations": prepared.citations,
                "confidence": prepared.confidence,
                "escalation_offered": prepared.should_escalate,
                "timings": timings,
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
    # The question that produced *this* answer, which is the newest user message
    # before it — not the newest in the conversation. Those differ whenever someone
    # keeps chatting and then scrolls back to escalate an earlier reply, and the
    # difference filed the wrong text: pressing Send to HR on an earlier answer
    # after typing "yes forward it" opened an HR request titled "yes forward it".
    user_query = select(Message).where(Message.conversation_id == conv.id, Message.role == "user")
    if assistant is not None:
        user_query = user_query.where(Message.created_at <= assistant.created_at)
    user_message = db.scalar(user_query.order_by(Message.created_at.desc()).limit(1))
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
