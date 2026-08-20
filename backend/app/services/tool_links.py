"""Where to actually do the thing the answer just described.

The bot can say which form to fill in, but the form still has to be submitted
somewhere. These are the internal systems that accept it.

Deliberately a short explicit list rather than the embedding match used for forms.
There are two systems, not thirty, and on a question an employee is about to act on,
a predictable pointer beats a clever one — a wrong link here sends someone into the
wrong system, which is worse than showing nothing.
"""

from __future__ import annotations

import re

from ..models import HRForm

POLICY_GENERATOR = {
    "name": "the AI Policy Generator",
    "url": "https://gray-sky-0be5fb50f.7.azurestaticapps.net/",
    "blurb": "draft it",
}

# Writing or revising a policy, rather than asking what one says. Restricted to HR
# admins: an employee asking "what is the leave policy" wants the answer, and pointing
# them at a tool for authoring policies would be nonsense.
DRAFTING_A_POLICY = re.compile(
    r"\b(?:write|draft|create|author|generate|update|revise|amend|rewrite)\b[^.?]{0,40}"
    r"\b(?:policy|policies|handbook|guideline|guidelines|procedure)\b"
    r"|\b(?:new|another) (?:policy|handbook|guideline|procedure)\b"
    r"|\bpolicy (?:template|draft|generator)\b",
    re.I,
)

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


def suggest_tool(form: HRForm | None, question: str = "", role: str = "") -> dict | None:
    """The one system this answer should point at, if any.

    Submitting comes first and is tied to the form suggestion rather than matched
    separately: a form is offered only when the question is asking to *do* something,
    which is exactly when a link to the submission system helps, and tying them means
    the two can never disagree.

    Authoring is the HR-side counterpart and only applies when nothing is being
    submitted — an answer should point at one place to go, not two.
    """
    # Authoring is checked first. "How do I write a new remote work policy" suggests the
    # work-away request form on the strength of the words in it, which would have sent
    # an HR admin drafting a policy to the form an employee files to work elsewhere.
    if role == "HRAdmin" and DRAFTING_A_POLICY.search(question or ""):
        return dict(POLICY_GENERATOR)
    if form is not None and form.filename in TICKETED_FORMS:
        return dict(TICKETGENIE)
    return None
