"""Point an answer at the form it tells the employee to fill in.

A form is never a citation — it lives in its own table, is never chunked and never
indexed, so a blank leave-request PDF cannot turn up as the source of a policy
answer. This module is the other half of that separation: the answer still needs a
way to say "and here is the form", without the form pretending to be a source.

Two ways a form gets attached, in order of trust:

  * grounded — a policy the answer actually cited names the form ("Use Form LND-301
    Development Funding Request"). The suggestion then comes from the corpus rather
    than from guessing at the question.
  * intent — nobody cited a form, but the question is plainly asking for one
    ("how do I change my bank account"). Phrases come from the Example chatbot
    intents column of BluePeak_Employee_Forms_Catalog.csv.

Both match on `HRForm.filename`, which is stable and set by the loader.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import HRForm

# filename -> (phrases a policy uses to name the form, phrases an employee uses to ask for it)
FORM_HINTS: dict[str, tuple[tuple[str, ...], tuple[str, ...]]] = {
    "01_Leave_Request_Form.pdf": (
        ("leave request form",),
        ("request pto", "request time off", "need time off", "take time off", "book time off",
         "request leave", "apply for leave", "leave request", "request vacation", "book leave"),
    ),
    "02_Expense_Reimbursement_Form.pdf": (
        ("expense reimbursement form",),
        ("expense report", "expense claim", "claim expenses", "submit expenses", "get reimbursed",
         "reimbursement form", "mileage claim", "claim mileage"),
    ),
    "03_Benefits_Enrollment_Change_Form.pdf": (
        ("benefits enrollment form", "benefits enrollment / change form"),
        ("enroll in benefits", "change my benefits", "change benefits", "add a dependent",
         "add dependent", "open enrollment", "benefits enrollment", "elect benefits"),
    ),
    "04_New_Hire_Employee_Information_Form.pdf": (
        ("new hire employee information form", "new hire information form"),
        ("new hire form", "new hire paperwork", "onboarding form", "new employee information"),
    ),
    "05_Direct_Deposit_Authorization_Form.pdf": (
        ("direct deposit authorization form",),
        ("direct deposit", "change my bank", "change bank account", "update bank account",
         "payroll bank", "where my pay goes", "deposit my paycheck"),
    ),
    "06_Personal_Information_Emergency_Contact_Change_Form.pdf": (
        ("personal information change form", "emergency contact change form"),
        ("change my address", "update my address", "change my name", "update my phone",
         "emergency contact", "change my personal", "update my details"),
    ),
    "07_Timekeeping_Payroll_Correction_Form.pdf": (
        ("timekeeping correction form", "payroll correction form", "timekeeping / payroll correction"),
        ("missed punch", "fix my timesheet", "wrong timesheet", "fix my hours", "wrong hours",
         "payroll correction", "correct my time", "timesheet correction"),
    ),
    "08_Equipment_Access_Request_Form.pdf": (
        ("equipment and access request form", "equipment & access request form", "equipment request form"),
        ("need a laptop", "request a laptop", "request equipment", "new monitor", "request access",
         "software access", "return equipment", "return my laptop", "get my laptop"),
    ),
    "09_Remote_Work_Work_Away_Request_Form.pdf": (
        ("remote work request form", "work-away request form", "work away request"),
        ("work from another state", "work abroad", "work away", "remote work request",
         "work from another country", "temporarily relocate"),
    ),
    "10_Learning_Development_Funding_Request_LND-301.pdf": (
        ("lnd-301", "development funding request", "learning and development funding"),
        ("tuition reimbursement", "certification cost", "pay for my certification", "conference funding",
         "training reimbursement", "fund my course", "pay for a course"),
    ),
}


def suggest_form(db: Session | None, question: str, cited_hits: list[dict]) -> HRForm | None:
    """The form this answer should offer, or None.

    `cited_hits` are the excerpts actually behind the answer, not everything retrieval
    returned — a form mentioned in a chunk that did not support the answer has no
    business being suggested.
    """
    # No session means no form table to read — callers that stub retrieval (and the
    # tests that exercise citation rules) legitimately pass none.
    if db is None:
        return None
    forms = {f.filename: f for f in db.scalars(select(HRForm))}
    if not forms:
        return None

    cited_text = " ".join((hit.get("content") or "") for hit in cited_hits).lower()
    if cited_text:
        for filename, (aliases, _) in FORM_HINTS.items():
            form = forms.get(filename)
            if form is not None and any(alias in cited_text for alias in aliases):
                return form

    asked = question.lower()
    for filename, (_, intents) in FORM_HINTS.items():
        form = forms.get(filename)
        if form is not None and any(intent in asked for intent in intents):
            return form
    return None


def form_payload(form: HRForm | None) -> dict | None:
    """The shape the chat stream sends. `mode` mirrors the client's FormRef union."""
    if form is None:
        return None
    return {
        "mode": "resources",
        "form_id": form.id,
        "title": form.title,
        "available": bool(form.blob_path),
    }
