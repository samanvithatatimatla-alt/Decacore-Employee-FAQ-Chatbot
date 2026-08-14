from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import require_roles
from ..database import get_db
from ..models import Document, EmployeeRequest, Message, User

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("/metrics")
def metrics(db: Session = Depends(get_db), user: User = Depends(require_roles("HRAdmin"))):
    return {
        "chat_messages": db.scalar(select(func.count(Message.id)).where(Message.role == "user")) or 0,
        "escalated_messages": db.scalar(select(func.count(Message.id)).where(Message.escalated)) or 0,
        "pending_requests": db.scalar(select(func.count(EmployeeRequest.id)).where(EmployeeRequest.status == "Pending")) or 0,
        "approved_documents": db.scalar(select(func.count(Document.id)).where(Document.status == "approved")) or 0,
    }


@router.get("/charts")
def charts(db: Session = Depends(get_db), user: User = Depends(require_roles("HRAdmin"))):
    req_status = db.execute(select(EmployeeRequest.status, func.count(EmployeeRequest.id)).group_by(EmployeeRequest.status)).all()
    doc_categories = db.execute(select(Document.category, func.count(Document.id)).where(Document.status == "approved").group_by(Document.category)).all()
    questions = db.execute(select(Message.content, func.count(Message.id)).where(Message.role == "user").group_by(Message.content).order_by(func.count(Message.id).desc()).limit(10)).all()
    return {
        "requests_by_status": [{"label": x or "Unknown", "value": n} for x, n in req_status],
        "documents_by_category": [{"label": x or "Uncategorized", "value": n} for x, n in doc_categories],
        "top_questions": [{"label": x, "value": n} for x, n in questions],
        "most_referenced": most_referenced(db),
    }


def most_referenced(db: Session, limit: int = 5) -> list[dict]:
    """Documents ranked by how often the assistant has cited them.

    Counted from the citations stored on each assistant message rather than from a
    running tally, so the figure stays correct even if messages are purged by the
    7-day retention job — the number always reflects the conversations still held.
    """
    counts: dict[str, int] = {}
    titles: dict[str, str] = {}
    rows = db.scalars(select(Message.citations).where(Message.role == "assistant")).all()
    for citations in rows:
        # One citation per document per answer: a policy quoted three times in the
        # same reply is one reference, not three.
        seen = set()
        for c in citations or []:
            doc_id = c.get("document_id")
            if not doc_id or doc_id in seen:
                continue
            seen.add(doc_id)
            counts[doc_id] = counts.get(doc_id, 0) + 1
            titles.setdefault(doc_id, c.get("title") or "Untitled")

    ranked = sorted(counts.items(), key=lambda kv: (-kv[1], titles.get(kv[0], "")))[:limit]
    out = []
    for rank, (doc_id, count) in enumerate(ranked, start=1):
        doc = db.get(Document, doc_id)
        out.append({
            "document_id": doc_id,
            "rank": rank,
            "name": doc.filename if doc else titles.get(doc_id, "Untitled"),
            "title": titles.get(doc_id, ""),
            "citations": count,
        })
    return out
