from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import get_current_user, require_roles
from ..config import settings
from ..database import get_db
from ..models import EmployeeRequest, User
from ..schemas import DecisionBody, HRResponseBody, InboxStatusBody, RequestOut
from ..services.notifications import notification_service
from ..services.storage import storage_service

router = APIRouter(prefix="/api/requests", tags=["requests"])



def request_out(req: EmployeeRequest, db: Session) -> dict:
    employee = db.get(User, req.employee_id)
    manager = db.get(User, req.assigned_manager_id) if req.assigned_manager_id else None
    decider = db.get(User, req.decided_by) if req.decided_by else None
    data = RequestOut.model_validate(req).model_dump()
    data.update({
        "employee_name": employee.display_name if employee else None,
        "employee_department": employee.department if employee else None,
        "assigned_manager_name": manager.display_name if manager else None,
        "decided_by_name": decider.display_name if decider else None,
    })
    return data

def priority_for(role: str) -> int:
    return {"Executive": 1, "Manager": 2, "Employee": 3}.get(role, 3)


def request_visible(req: EmployeeRequest, user: User) -> bool:
    if user.role == "HRAdmin":
        return True
    if req.employee_id == user.id:
        return True
    if user.role == "Manager" and req.assigned_manager_id == user.id and req.employee_id != user.id:
        return True
    return False


def can_decide(req: EmployeeRequest, user: User) -> bool:
    if req.employee_id == user.id:
        return False
    return user.role == "HRAdmin" or (user.role == "Manager" and req.assigned_manager_id == user.id)


@router.post("", response_model=RequestOut)
def create_request(
    type: str = Form(...),
    message: str = Form(...),
    category: str | None = Form(default=None),
    amount: float | None = Form(default=None),
    attachment: UploadFile | None = File(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    attachment_path = storage_service.save_upload(attachment, "receipts") if attachment else None
    assigned_manager_id = user.manager_id if user.manager_id != user.id else None
    req = EmployeeRequest(
        employee_id=user.id,
        type=type,
        category=category,
        amount=amount,
        message=message,
        attachment_blob_path=attachment_path,
        status="Pending",
        priority=priority_for(user.role),
        assigned_manager_id=assigned_manager_id,
    )
    db.add(req)
    db.commit()
    db.refresh(req)
    if assigned_manager_id:
        manager = db.get(User, assigned_manager_id)
        if manager:
            notification_service.send(db, manager.email, f"New {type} request", f"{user.display_name} submitted a request requiring your review.")
    if settings.hr_notification_email:
        notification_service.send(db, settings.hr_notification_email, f"New employee request: {type}", f"Request {req.id} was submitted by {user.display_name}.")
    return request_out(req, db)


@router.get("")
def list_requests(status: str | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    reqs = db.scalars(select(EmployeeRequest).order_by(EmployeeRequest.priority, EmployeeRequest.created_at.desc())).all()
    reqs = [r for r in reqs if request_visible(r, user)]
    if status:
        reqs = [r for r in reqs if r.status.lower() == status.lower()]
    return {"items": [request_out(r, db) for r in reqs], "total": len(reqs)}


# ---------------------------------------------------------------------------
# HR inbox
#
# Escalations are ordinary EmployeeRequest rows tagged with ESCALATION_CATEGORY.
# The inbox tracks them through New -> In Progress -> Resolved, which are stored
# straight into the existing free-text `status` column, and keeps HR's reply in
# `manager_comment`. Both columns already exist, so none of this needs a schema
# migration — which matters because the app has no migration step and creates
# tables with Base.metadata.create_all at startup.
# ---------------------------------------------------------------------------

ESCALATION_CATEGORY = "Chat Escalation"
INBOX_STATUSES = ("New", "In Progress", "Resolved")


def inbox_status(req: EmployeeRequest) -> str:
    """Escalations are created as Pending by the chat endpoint; show that as New."""
    return "New" if req.status == "Pending" else req.status


def inbox_out(req: EmployeeRequest, db: Session) -> dict:
    data = request_out(req, db)
    data["status"] = inbox_status(req)
    data["hr_response"] = req.manager_comment
    # The chat escalation packs question, note and AI answer into one message body;
    # split it back out so the Request Context modal can show them separately.
    data.update(_split_escalation(req.message))
    return data


def _split_escalation(message: str) -> dict:
    parts = {"question": "", "employee_note": "", "ai_response": ""}
    current = None
    for line in message.splitlines():
        if line.startswith("Question:"):
            current, line = "question", line[len("Question:") :]
        elif line.startswith("Employee note:"):
            current, line = "employee_note", line[len("Employee note:") :]
        elif line.startswith("Chatbot response:"):
            current, line = "ai_response", line[len("Chatbot response:") :]
        elif current is None:
            continue
        parts[current] = (parts[current] + "\n" + line).strip() if parts[current] else line.strip()
    if parts["employee_note"] == "(none)":
        parts["employee_note"] = ""
    return parts


@router.get("/inbox")
def inbox(
    status: str | None = None,
    q: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("HRAdmin")),
):
    reqs = db.scalars(
        select(EmployeeRequest)
        .where(EmployeeRequest.category == ESCALATION_CATEGORY)
        .order_by(EmployeeRequest.created_at.desc())
    ).all()
    items = [inbox_out(r, db) for r in reqs]
    if status and status.lower() != "all":
        items = [r for r in items if r["status"].lower() == status.lower()]
    if q and q.strip():
        needle = q.strip().lower()
        items = [
            r
            for r in items
            if needle in (r.get("employee_name") or "").lower() or needle in (r.get("question") or "").lower()
        ]
    return {"items": items, "total": len(items)}


@router.get("/mine")
def my_escalations(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """The caller's own escalated questions, with HR's reply once there is one.

    HR's answer was only ever readable through /inbox, which is HRAdmin-only — so an
    employee who pressed "Send to HR" had no way to see the response inside the app.
    Declared above /{request_id} so the literal path wins the route match.
    """
    reqs = db.scalars(
        select(EmployeeRequest)
        .where(
            EmployeeRequest.employee_id == user.id,
            EmployeeRequest.category == ESCALATION_CATEGORY,
        )
        .order_by(EmployeeRequest.created_at.desc())
    ).all()
    return {"items": [inbox_out(r, db) for r in reqs], "total": len(reqs)}


@router.post("/{request_id}/status")
def set_inbox_status(
    request_id: str,
    body: InboxStatusBody,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("HRAdmin")),
):
    req = db.get(EmployeeRequest, request_id)
    if not req or req.category != ESCALATION_CATEGORY:
        raise HTTPException(status_code=404, detail="Escalation not found")
    req.status = body.status
    if body.status == "Resolved":
        req.decided_by = user.id
        req.decided_at = datetime.now(UTC)
    db.commit()
    db.refresh(req)
    return inbox_out(req, db)


@router.post("/{request_id}/respond")
def respond_to_escalation(
    request_id: str,
    body: HRResponseBody,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("HRAdmin")),
):
    req = db.get(EmployeeRequest, request_id)
    if not req or req.category != ESCALATION_CATEGORY:
        raise HTTPException(status_code=404, detail="Escalation not found")
    req.manager_comment = body.response.strip()
    req.status = "Resolved" if body.resolve else "In Progress"
    if body.resolve:
        req.decided_by = user.id
        req.decided_at = datetime.now(UTC)
    db.commit()
    db.refresh(req)

    employee = db.get(User, req.employee_id)
    if employee:
        # Delivery failures are logged, never raised — HR's reply is already saved
        # and the request must not roll back because a mailbox was unreachable.
        notification_service.send(
            db,
            employee.email,
            "HR responded to your question",
            req.manager_comment,
        )
    return inbox_out(req, db)


@router.get("/{request_id}", response_model=RequestOut)
def get_request(request_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    req = db.get(EmployeeRequest, request_id)
    if not req or not request_visible(req, user):
        raise HTTPException(status_code=404, detail="Request not found")
    return request_out(req, db)


@router.get("/{request_id}/attachment")
def get_attachment(request_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    req = db.get(EmployeeRequest, request_id)
    if not req or not request_visible(req, user) or not req.attachment_blob_path:
        raise HTTPException(status_code=404, detail="Attachment not found")
    url = storage_service.get_read_url(req.attachment_blob_path)
    if url:
        return RedirectResponse(url)
    path = storage_service.local_path(req.attachment_blob_path)
    return FileResponse(path, filename=path.name)


@router.post("/{request_id}/approve", response_model=RequestOut)
def approve_request(request_id: str, body: DecisionBody | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    req = db.get(EmployeeRequest, request_id)
    if not req or not can_decide(req, user):
        raise HTTPException(status_code=404, detail="Request not found")
    if req.status != "Pending":
        raise HTTPException(status_code=409, detail="Only pending requests can be decided")
    req.status = "Approved"
    req.manager_comment = body.comment if body else None
    req.decided_by = user.id
    req.decided_at = datetime.now(UTC)
    db.commit()
    db.refresh(req)
    employee = db.get(User, req.employee_id)
    if employee:
        notification_service.send(db, employee.email, f"Request approved: {req.type}", f"Your request {req.id} was approved.")
    return request_out(req, db)


@router.post("/{request_id}/deny", response_model=RequestOut)
def deny_request(request_id: str, body: DecisionBody, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    req = db.get(EmployeeRequest, request_id)
    if not req or not can_decide(req, user):
        raise HTTPException(status_code=404, detail="Request not found")
    if req.status != "Pending":
        raise HTTPException(status_code=409, detail="Only pending requests can be decided")
    if not body.comment or not body.comment.strip():
        raise HTTPException(status_code=422, detail="A comment is required when denying a request")
    req.status = "Denied"
    req.manager_comment = body.comment.strip()
    req.decided_by = user.id
    req.decided_at = datetime.now(UTC)
    db.commit()
    db.refresh(req)
    employee = db.get(User, req.employee_id)
    if employee:
        notification_service.send(db, employee.email, f"Request denied: {req.type}", f"Your request {req.id} was denied. Comment: {req.manager_comment}")
    return request_out(req, db)
