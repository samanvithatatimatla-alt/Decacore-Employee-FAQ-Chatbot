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
        "escalated_messages": db.scalar(select(func.count(Message.id)).where(Message.escalated.is_(True))) or 0,
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
    }
