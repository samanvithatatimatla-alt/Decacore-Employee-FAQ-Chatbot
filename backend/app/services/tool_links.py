"""Where to actually do the thing the answer just described.

The bot can say which form to fill in, but the form still has to be submitted
somewhere. These are the internal systems that accept it.

Deliberately a short explicit list rather than the embedding match used for forms.
There are two systems, not thirty, and on a question an employee is about to act on,
a predictable pointer beats a clever one — a wrong link here sends someone into the
wrong system, which is worse than showing nothing.
"""

from __future__ import annotations

from ..models import HRForm

TICKETGENIE = {
    "name": "TicketGenie",
    "url": "http://webapp-prod-frontend-ticketgenie.azurewebsites.net",
    "blurb": "raise and track the request",
}

# Forms TicketGenie handles. Everything the employee submits to HR, IT or payroll
# goes through it; the two company-information forms do not belong to a workflow.
TICKETED_FORMS = {
    "01_Leave_Request_Form.pdf",
    "02_Expense_Reimbursement_Form.pdf",
    "03_Benefits_Enrollment_Change_Form.pdf",
    "05_Direct_Deposit_Authorization_Form.pdf",
    "06_Personal_Information_Emergency_Contact_Change_Form.pdf",
    "07_Timekeeping_Payroll_Correction_Form.pdf",
    "08_Equipment_Access_Request_Form.pdf",
    "09_Remote_Work_Work_Away_Request_Form.pdf",
    "10_Learning_Development_Funding_Request_LND-301.pdf",
}


def suggest_tool(form: HRForm | None) -> dict | None:
    """The system to submit through, when the answer already points at a form.

    Tied to the form suggestion rather than matched separately: a form is offered only
    when the question is asking to *do* something, which is exactly when a link to the
    submission system helps. It also means the two never disagree — no answer offers a
    form for one task and a system for another.
    """
    if form is None or form.filename not in TICKETED_FORMS:
        return None
    return {"name": TICKETGENIE["name"], "url": TICKETGENIE["url"], "blurb": TICKETGENIE["blurb"]}
