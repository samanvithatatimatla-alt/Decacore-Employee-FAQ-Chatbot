# BluePeak Employee FAQ Dataset v2.0

Synthetic training data for a student Retrieval-Augmented Generation project using Azure AI Search. BluePeak Technologies, all policy content, all addresses, and all forms in this package are fictional.

## Corpus statistics

- PDFs: 15
- Total pages: 111
- Total extracted words: 48,988
- Estimated chunks at 800 tokens: 82 (using approximately 600 words per 800-token chunk)
- Initially indexed PDFs: 13
- Held back at start: documents 14 and 15

> The headline target says 108 pages, but the fixed per-document page targets sum to 111. This package honors the fixed targets and contains 111 pages, which is within the required 105-112 self-check range.

### Per-document verification

| Filename | Target pages | Actual pages | Extracted words |
|---|---:|---:|---:|
| `01_Paid_Time_Off_Policy.pdf` | 8 | 8 | 3,357 |
| `02_Sick_Leave_and_Medical_Absence_Policy.pdf` | 7 | 7 | 3,177 |
| `03_Family_and_Parental_Leave_Policy.pdf` | 9 | 9 | 4,134 |
| `04_Travel_and_Expense_Reimbursement_Policy.pdf` | 12 | 12 | 5,625 |
| `05_Hybrid_and_Remote_Work_Policy.pdf` | 8 | 8 | 3,287 |
| `06_Employee_Support_and_HR_Requests_Guide.pdf` | 6 | 6 | 2,416 |
| `07_Health_and_Welfare_Benefits_Guide.pdf` | 11 | 11 | 5,332 |
| `08_Retirement_and_Financial_Benefits_Policy.pdf` | 7 | 7 | 3,170 |
| `09_Compensation_and_Payroll_Guide.pdf` | 10 | 10 | 4,525 |
| `10_Learning_and_Development_Reimbursement_Policy.pdf` | 6 | 6 | 2,717 |
| `11_Information_Security_and_Acceptable_Use_Policy.pdf` | 9 | 9 | 3,697 |
| `12_Onboarding_and_Offboarding_Handbook.pdf` | 8 | 8 | 3,615 |
| `13_Paid_Time_Off_Policy_Update_v2.pdf` | 3 | 3 | 1,180 |
| `14_Bereavement_and_Compassionate_Leave_Policy.pdf` | 4 | 4 | 1,718 |
| `15_Travel_Policy_Draft_Revision_v1.1_DRAFT.pdf` | 3 | 3 | 1,038 |

## Predefined policy categories

- Benefits
- Leave
- Payroll
- Travel
- Insurance
- Reimbursements

## Ambiguous categorizations, intentional

- `05_Hybrid_and_Remote_Work_Policy.pdf` is filed under **Benefits**, although a dedicated work-arrangements category could also be reasonable.
- `11_Information_Security_and_Acceptable_Use_Policy.pdf` is filed under **Benefits**, which is deliberately a poor fit.
- `12_Onboarding_and_Offboarding_Handbook.pdf` is filed under **Payroll**, although it spans onboarding, leave, security, equipment, and final pay.

These assignments should be preserved when testing the document categorization feature. The categorizer may suggest another label, but the reviewer should be able to retain or edit the suggestion before approval.

## Suggested Azure AI Search index schema

| Field | Suggested purpose |
|---|---|
| `chunk_id` | Unique key for each indexed chunk |
| `document_id` | BluePeak document identifier |
| `document_name` | PDF title or filename |
| `section_title` | Section heading captured during chunking |
| `page_number` | Source page for citations and filtering |
| `content` | Searchable chunk text |
| `source_url` | Intranet source URL from the manifest |
| `effective_date` | Filterable policy effective date |
| `version` | Version used for recency and conflict handling |
| `policy_category` | One of the six predefined categories |
| `embedding` | Vector field generated from `content` |

Recommended retrieval behavior is hybrid keyword and vector search with metadata filtering, followed by answer generation that preserves document title, section, page, effective date, and version. The conflict cases in `conflicts.md` should be evaluated after retrieval rather than silently resolved by semantic similarity alone.

## Held-back documents and demo workflow

- **Document 14** starts as `Pending` and `indexed_at_start: false`. Ask a bereavement question before upload to demonstrate a not-found answer. Then upload the PDF, accept or edit the suggested **Leave** category, approve it, index it, and repeat the question to retrieve the newly available answer.
- **Document 15** starts as `Rejected` and `indexed_at_start: false`. It is visibly marked as an unfinished draft, includes placeholders, and proposes unapproved rate changes. Use it to demonstrate the reject path; it should never become searchable for employee answers.

## Evaluation set

`evaluation_questions.csv` contains 70 deliberately conversational queries. The distribution is 28 single-hop, 12 multi-hop, 8 distractor traps, 6 conflict questions, 8 unanswerable questions, 6 partial-answer questions, and 2 held-back questions. Distractor-trap summaries name the superficially matching document so retrieval errors can be scored directly.

## Fictional-use notice

This document is fictional and was created only as a training dataset for a student Employee FAQ Chatbot. It is not legal, HR, tax, medical, or employment advice.
