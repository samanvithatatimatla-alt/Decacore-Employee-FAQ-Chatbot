"""Rebuild the evaluation set for the v3 corpus.

The v1 questions were written against 15 documents. The v3 corpus keeps the same
BPT-* identifiers but splits, merges and extends the content, so a question can
change in three ways:

  * re-key    - the fact still exists, in a different document (BPT-HR-BEN-007
                split into MED-111 / DV-112 / WELL-114 / LDI-115)
  * re-answer - the fact itself changed, or a gap the v1 corpus left open is now
                filled (every one of the eight "unanswerable" questions is
                answered by v3, including "can I buy extra vacation days" -> no)
  * retire    - the premise is gone (the planted $1,200 vs $2,000 certification
                conflict has no counterpart document any more)

Each edit below was verified by locating the fact in the v3 text, never by
looking at what retrieval happened to return - otherwise the eval would be
scoring itself. Questions not listed here are carried over unchanged.
"""

from __future__ import annotations

import csv
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "data" / "seed" / "evaluation_questions.csv"
OUT = ROOT / "data" / "seed_v3" / "evaluation_questions_v3.csv"

# question_id -> fields to overwrite. Every entry cites where the fact now lives.
EDITS: dict[str, dict[str, str]] = {
    # --- BPT-HR-BEN-007 split into four documents -------------------------
    "Q019": {"expected_document_id": "BPT-HR-MED-111", "expected_section": "Enrollment and Life Events"},
    "Q020": {"expected_document_id": "BPT-HR-MED-111", "expected_section": "Medical Plan Options"},
    "Q021": {"expected_document_id": "BPT-HR-WELL-114", "expected_section": "Employee Assistance Program"},
    "Q029": {"expected_document_id": "BPT-HR-LEAVE-003", "expected_section": "Phased Return"},
    "Q035": {"expected_document_id": "BPT-FIN-RET-008|BPT-HR-MED-111", "expected_section": "Eligibility"},
    "Q040": {"expected_document_id": "BPT-HR-LEAVE-003|BPT-HR-MED-111", "expected_section": "Adoption and Notice"},
    "Q042": {"expected_document_id": "BPT-HR-WELL-114", "expected_section": "Wellness Reimbursement"},
    # Previously "partial": v3 states the figures outright.
    "Q063": {"expected_document_id": "BPT-HR-DV-112", "expected_status": "answered", "question_type": "single_hop",
             "expected_answer_summary": "Dental Standard is $50 individual / $150 family; Dental Enhanced is $25 individual / $75 family.",
             "expected_section": "11.1 How much is the dental deductible?"},
    "Q064": {"expected_document_id": "BPT-HR-DV-112", "expected_status": "answered", "question_type": "single_hop",
             "expected_answer_summary": "The routine exam copay is $10 and the materials copay is $25.",
             "expected_section": "11.2 What is the vision copay?"},
    "Q065": {"expected_document_id": "BPT-HR-MED-111", "expected_status": "answered", "question_type": "single_hop",
             "expected_answer_summary": "$468 per semi-monthly paycheck for the 2026 plan year.",
             "expected_section": "15.2 What is the Premier family premium?"},
    # Still genuinely partial: v3 gives the rate but never the maximum duration,
    # and names the EAP allowance but no contact number.
    "Q066": {"expected_document_id": "BPT-HR-LDI-115"},
    "Q068": {"expected_document_id": "BPT-HR-WELL-114"},

    # --- travel split out of BPT-FIN-EXP-004 into BPT-FIN-TRV-119 ---------
    # v3 separates travel standards (air class, lodging caps, approvals) from
    # expense processing; the change summaries on both documents say so.
    "Q012": {"expected_document_id": "BPT-FIN-TRV-119", "expected_section": "Air Travel Standards"},
    "Q031": {"expected_document_id": "BPT-FIN-TRV-119|BPT-FIN-EXP-004"},
    # Working from another location is now the Remote Work Policy's subject.
    "Q038": {"expected_document_id": "BPT-FIN-TRV-119|BPT-HR-REM-123"},
    "Q046": {"expected_document_id": "BPT-HR-REM-123", "expected_section": "Work-Away Requests"},
    # Account shutoff timing moved to the Password & Account Security Policy.
    "Q036": {"expected_document_id": "BPT-HR-ONB-012|BPT-IT-IAM-126"},

    # --- BPT-HR-GUIDE-006 retired ----------------------------------------
    "Q018": {"expected_document_id": "BPT-FIN-PAY-009", "expected_section": "3. Direct Deposit",
             "expected_answer_summary": "Direct deposit details are changed through the Direct Deposit Authorization Form (BPT-FIN-FRM-205); the payroll policy sets the administration rules."},
    "Q033": {"expected_document_id": "BPT-HR-HYB-005|BPT-HR-REM-123"},

    # --- planted conflicts, resolved by v3 --------------------------------
    # PTO v3.0 consolidates the v1/v2 carryover disagreement into one figure.
    "Q049": {"expected_document_id": "BPT-HR-PTO-001", "question_type": "single_hop",
             "expected_answer_summary": "Carryover is 10 days; excess carryover expires March 31.",
             "expected_section": "5. Carryover, Expiration, and Maximum Balance"},
    "Q050": {"expected_document_id": "BPT-HR-PTO-001", "question_type": "single_hop",
             "expected_answer_summary": "The maximum balance is 25 days; accrual pauses at the cap and resumes when the balance drops.",
             "expected_section": "5. Carryover, Expiration, and Maximum Balance"},
    # Both core-hours values now live in one document, which reconciles them.
    "Q051": {"expected_document_id": "BPT-HR-HYB-005",
             "expected_answer_summary": "Austin is 9:00 a.m.-4:00 p.m. local. The general 10:00-3:00 window does not replace the approved Austin schedule.",
             "expected_section": "Core Hours by Site"},
    "Q052": {"expected_document_id": "BPT-HR-HYB-005",
             "expected_answer_summary": "An Austin hybrid employee follows the site-specific 9:00 a.m.-4:00 p.m. local core window.",
             "expected_section": "Core Hours by Site"},
    # The $1,200 payroll appendix does not exist in v3, so this is no longer a conflict.
    "Q053": {"expected_document_id": "BPT-HR-LND-010", "question_type": "single_hop",
             "expected_answer_summary": "Professional certification reimbursement is up to $2,000 per calendar year.",
             "expected_section": "Annual Allowances"},
    "Q054": {"expected_document_id": "BPT-HR-LND-010", "question_type": "single_hop",
             "expected_answer_summary": "Up to $2,000 per calendar year for professional certification.",
             "expected_section": "Annual Allowances"},

    # --- v1 "unanswerable" questions that v3 answers ----------------------
    "Q055": {"expected_document_id": "BPT-HR-HBK-101", "expected_status": "answered", "question_type": "single_hop",
             "expected_answer_summary": "Jeans, sneakers and casual tops are acceptable when neat; customer meetings, conferences, lab or facilities work may require business attire or protective equipment."},
    "Q056": {"expected_document_id": "BPT-HR-WELL-114", "expected_status": "answered", "question_type": "single_hop",
             "expected_answer_summary": "Pet insurance is available as a voluntary group-rate program; premiums are employee-paid."},
    "Q057": {"expected_document_id": "BPT-HR-ATT-110", "expected_status": "answered", "question_type": "single_hop",
             "expected_answer_summary": "A 30-minute unpaid, duty-free meal period applies to U.S. non-exempt employees."},
    "Q058": {"expected_document_id": "BPT-HR-BON-118", "expected_status": "answered", "question_type": "single_hop",
             "expected_answer_summary": "Standard annual targets are 5 percent of eligible earnings for an individual contributor and 10 percent for a people manager."},
    "Q059": {"expected_document_id": "BPT-FIN-EXP-004", "expected_status": "answered", "question_type": "single_hop",
             "expected_answer_summary": "Ordinary commuting costs are not reimbursable."},
    "Q060": {"expected_document_id": "BPT-HR-PTO-001", "expected_status": "answered", "question_type": "single_hop",
             "expected_answer_summary": "No. BluePeak does not offer a PTO purchase, cash-out, sale, or donation program."},
    "Q061": {"expected_document_id": "BPT-FIN-EXP-004", "expected_status": "answered", "question_type": "single_hop",
             "expected_answer_summary": "Relocation expenses require a written agreement before the cost is incurred, and may be taxable or repayable."},
    "Q062": {"expected_document_id": "BPT-HR-WELL-114", "expected_status": "answered", "question_type": "single_hop",
             "expected_answer_summary": "There is no general cash childcare subsidy; U.S. employees may elect a dependent care FSA."},

    # --- the held-back pair -----------------------------------------------
    # v1 shipped the Bereavement policy as pending so these two tested the
    # "not approved yet" path. Every v3 document is Approved, so they become
    # ordinary questions; v3 states the same entitlements v1 promised.
    "Q069": {"expected_status": "answered", "question_type": "single_hop",
             "expected_answer_summary": "5 workdays of paid leave for the death of an immediate family member.",
             "expected_section": "13.1 How many days do I receive if my parent dies?"},
    "Q070": {"expected_status": "answered", "question_type": "single_hop",
             "expected_answer_summary": "Yes, up to 3 paid workdays of compassionate leave; a longer family-care or protected leave may also apply.",
             "expected_section": "13.4 Can I use compassionate leave for my spouse's serious illness?"},
}

# v3 closes every gap the v1 corpus left open, so the guardrail needs topics that
# are genuinely absent. Each was confirmed to appear in zero documents.
NEW_UNANSWERABLE = [
    ("Q071", "is there a sabbatical after five years", "does not describe a sabbatical program"),
    ("Q072", "does bluepeak help pay off student loans", "does not describe student loan repayment assistance"),
    ("Q073", "do i get a sign on bonus", "does not state a sign-on or signing bonus"),
]


def main() -> int:
    rows = list(csv.DictReader(SRC.open(encoding="utf-8-sig")))
    fields = list(rows[0].keys())
    changed = 0
    for row in rows:
        edit = EDITS.get(row["question_id"])
        if not edit:
            continue
        unknown = set(edit) - set(fields)
        if unknown:
            raise KeyError(f"{row['question_id']}: unknown columns {unknown}")
        row.update(edit)
        changed += 1

    for qid, question, summary in NEW_UNANSWERABLE:
        rows.append({
            "question_id": qid,
            "question": question,
            "expected_status": "not_found",
            "expected_answer_summary": f"The provided documents {summary}.",
            "expected_document_id": "",
            "expected_section": "",
            "difficulty": "medium",
            "question_type": "unanswerable",
        })

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)

    from collections import Counter
    print(f"wrote {OUT.relative_to(ROOT)}")
    print(f"  {len(rows)} questions ({changed} edited, {len(NEW_UNANSWERABLE)} added, {len(rows)-changed-len(NEW_UNANSWERABLE)} unchanged)")
    for kind, n in sorted(Counter(r["question_type"] for r in rows).items()):
        print(f"  {kind:16} {n}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
