# BluePeak Corpus v2.0 - Planted Conflicts

This file documents the **exactly three** intended policy conflicts. Other differences in the corpus are category ambiguity, jurisdictional exceptions, draft material, or ordinary distinctions between policies rather than additional conflicts.

## Conflict A - PTO carryover, resolvable by recency

- **Documents:** BPT-HR-PTO-001 v1.0 and BPT-HR-PTO-001 v2.0
- **Sections:** v1.0 section 5, `Carryover and Maximum Balance`; v2.0 section 2, `Revised Carryover Provision`
- **Contradiction:** v1.0 caps carryover at **5 days**, expires excess carryover on **January 31**, and sets a **20-day** maximum balance. v2.0, effective **2026-07-01**, raises carryover to **10 days**, moves the excess-carryover expiry date to **March 31**, and raises the maximum balance to **25 days**.
- **Correct chatbot behavior:** Answer **10 days**, cite v2.0, state that the newer rule applies to balances carried into calendar year 2027 onward, and note that the earlier version stated 5 days. The chatbot should not hide the superseded value because both versions remain indexed.

## Conflict B - Core hours, jurisdictional and both correct

- **Documents:** BPT-HR-HYB-005 and BPT-FIN-PAY-009
- **Sections:** BPT-HR-HYB-005 section 4, `Core Hours and Availability`; BPT-FIN-PAY-009 Appendix B, `Site-Specific Working Hours`
- **Contradiction:** the hybrid policy states general core hours of **10:00 to 15:00 local time**, while the payroll appendix lists **09:00 to 16:00** for Austin.
- **Correct chatbot behavior:** Surface both entries, explain that the Austin site has different hours, and do not choose one value as universally correct. The answer should ask for or use the employee's site when that context is missing.

## Conflict C - Professional certification reimbursement, unresolvable

- **Documents:** BPT-HR-LND-010 and BPT-FIN-PAY-009
- **Sections:** BPT-HR-LND-010, `Annual Allowances`; BPT-FIN-PAY-009 Appendix C, `Professional Certification Reimbursement Schedule`
- **Contradiction:** the L&D policy caps professional certification reimbursement at **$2,000 per calendar year**, while the payroll appendix caps it at **$1,200 per calendar year per employee**. Both documents are v1.0, both are effective 2026-01-01, and the corpus contains no precedence clause.
- **Correct chatbot behavior:** Cite both figures, explicitly state that the documents disagree, and escalate to HR rather than selecting either amount.
