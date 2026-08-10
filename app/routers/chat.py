from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..config import settings
from ..database import SessionLocal, get_db
from ..models import Conversation, EmployeeRequest, Message, User
from ..schemas import ChatIn, EscalationIn
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
    now = datetime.now(timezone.utc)
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
    conversation_id = conv.id
    user_id = user.id
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
                conv2.last_message_at = datetime.now(timezone.utc)
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


@router.get("/faq/top")
def top_faq(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = db.execute(
        select(Message.content, func.count(Message.id).label("count"))
        .join(Conversation, Conversation.id == Message.conversation_id)
        .where(Message.role == "user")
        .group_by(Message.content)
        .order_by(func.count(Message.id).desc())
        .limit(3)
    ).all()
    items = [{"question": content, "count": count} for content, count in rows]
    return {"items": items, "total": len(items)}


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
