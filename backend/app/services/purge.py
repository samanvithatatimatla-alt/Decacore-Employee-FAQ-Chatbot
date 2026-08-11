from __future__ import annotations

import time
from datetime import datetime, timezone

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from ..models import Conversation, Message, PurgeLog


def purge_expired(db: Session, triggered_by: str = "timer", batch_size: int = 500) -> PurgeLog:
    started = time.perf_counter()
    total_conversations = 0
    total_messages = 0
    now = datetime.now(timezone.utc)
    while True:
        ids = list(db.scalars(select(Conversation.id).where(Conversation.expires_at < now).limit(batch_size)))
        if not ids:
            break
        total_messages += db.scalar(select(func.count(Message.id)).where(Message.conversation_id.in_(ids))) or 0
        db.execute(delete(Message).where(Message.conversation_id.in_(ids)))
        db.execute(delete(Conversation).where(Conversation.id.in_(ids)))
        db.commit()
        total_conversations += len(ids)
        if len(ids) < batch_size:
            break
    log = PurgeLog(
        conversations_deleted=total_conversations,
        messages_deleted=total_messages,
        duration_ms=int((time.perf_counter() - started) * 1000),
        triggered_by=triggered_by,
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return log
