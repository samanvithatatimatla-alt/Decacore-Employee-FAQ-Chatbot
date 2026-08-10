# DecaCore Employee FAQ Chatbot - Backend

FastAPI backend for the BluePeak/DecaCore employee FAQ project. It is intentionally split into adapters so the team can run the complete workflow locally first and switch individual capabilities to Azure later.

## What is implemented

- Microsoft Entra ID bearer-token validation with app-role extraction (`Employee`, `Manager`, `Executive`, `HRAdmin`)
- Local dev auth using `X-Dev-User-Email`
- Employee/manager hierarchy seeded from `Employees_final.csv`
- Conversation + message persistence and 7-day expiry timestamps
- SSE chatbot endpoint with structured citations
- Role-filtered RAG retrieval
- PDF ingestion/chunking and local searchable chunk store
- Azure AI Search adapter with hybrid vector + keyword search and pre-filtered role authorization
- Azure OpenAI/Foundry v1 adapter for embeddings, categorization, and grounded answers
- HR document upload, AI categorization, category override, approval, rejection, indexing, secure read URLs, and optional per-user dynamic PDF watermarking
- Employee request submission with receipt upload, manager routing, priority, approve/deny, self-approval block, required denial comment
- HR dashboard metrics/charts
- Top 3 FAQs
- Notification logging plus Microsoft Graph `sendMail` adapter
- 7-day purge service, audit log, manual API endpoint, and Azure Function timer/HTTP entry points
- Seed data includes the supplied 100 employees and 15 policy PDFs. Approved documents are indexed; Bereavement starts pending; Travel Draft starts rejected.


## Handoff files

- `FRONTEND_HANDOFF.md` - exact frontend integration flow and SSE example
- `AZURE_TODO.md` - the Azure values/portal checks still needed
- `openapi.json` - generated API contract
- `run-local.ps1` - Windows local startup helper

## 1. Run locally

```powershell
cd C:\path\to\decacore_backend
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
uvicorn app.main:app --reload --port 8000
```

Open Swagger at `http://localhost:8000/docs`.

Local mode requires no Azure keys. On first startup it seeds the database and indexes the approved PDF corpus into SQLite.

### Dev users

Use a header while testing:

```text
X-Dev-User-Email: marietta.baudone@gmail.com   # Employee
X-Dev-User-Email: alejandra.farryann@gmail.com # Manager
X-Dev-User-Email: hr.admin@bluepeak.example    # HRAdmin
```

The frontend can use `X-Dev-Role` temporarily during development, but do not use that header when `AUTH_MODE=entra`.

## 2. Frontend contract

Primary endpoints:

```text
GET    /api/me
POST   /api/chat                         -> SSE events: meta, delta, done
POST   /api/chat/escalate                { conversation_id, assistant_message_id?, note? }
GET    /api/conversations
GET    /api/conversations/{id}
DELETE /api/conversations/{id}
GET    /api/faq/top

POST   /api/documents                    multipart: file, permissions, title?
GET    /api/documents
GET    /api/documents/pending
GET    /api/documents/{id}/url
PATCH  /api/documents/{id}/category      { "category": "Leave" }
POST   /api/documents/{id}/approve
POST   /api/documents/{id}/reject        { "comment": "..." }

POST   /api/requests                     multipart: type, category?, amount?, message, attachment?
GET    /api/requests
GET    /api/requests/{id}
GET    /api/requests/{id}/attachment
POST   /api/requests/{id}/approve        { "comment": "..." }
POST   /api/requests/{id}/deny           { "comment": "required" }

GET    /api/dashboard/metrics
GET    /api/dashboard/charts
POST   /api/admin/purge
```

List endpoints return `{ "items": [...], "total": n }`.

### SSE shape

```text
event: meta
data: {"conversation_id":"...","message_id":"..."}

event: delta
data: {"text":"Employees "}

event: done
data: {"citations":[...],"confidence":0.23,"escalation_offered":false}
```

## 3. Entra ID setup

The supplied registration values are already in `.env.example`:

- Application/client ID: `efccb481-74ba-45b8-940a-fed5dfbec74e`
- Directory/tenant ID: `0eadb77e-42dc-47f8-bbe3-ec2395e0712c`
- Object ID: `2680dbf6-06a6-44b1-abd5-77f56f5b5fd1`

In Entra:

1. Under **Expose an API**, create an Application ID URI, normally `api://efccb481-74ba-45b8-940a-fed5dfbec74e`.
2. Create app roles with exact values: `Employee`, `Manager`, `Executive`, `HRAdmin`.
3. Assign test users to the roles.
4. Configure frontend redirect URIs.
5. Have the frontend request an access token for this API and send it as `Authorization: Bearer <token>`.
6. Set `AUTH_MODE=entra` in the backend.

The backend validates token signature, issuer, tenant, audience, and the `roles` claim. Department and manager relationships are looked up from the employee database instead of assuming Entra always emits a department claim.

## 4. Switch to Azure OpenAI + Azure AI Search

Fill these values:

```env
LLM_BACKEND=azure
AZURE_OPENAI_ENDPOINT=https://YOUR-RESOURCE.openai.azure.com
AZURE_OPENAI_CHAT_DEPLOYMENT=YOUR_CHAT_DEPLOYMENT
AZURE_OPENAI_EMBEDDING_DEPLOYMENT=YOUR_EMBEDDING_DEPLOYMENT
AZURE_OPENAI_EMBEDDING_DIMENSIONS=1536
# Prefer managed identity in Azure. For local-only testing you can set AZURE_OPENAI_API_KEY.

SEARCH_BACKEND=azure
AZURE_SEARCH_ENDPOINT=https://YOUR-SEARCH.search.windows.net
AZURE_SEARCH_INDEX=decacore-hr-policies
# Prefer managed identity in Azure. For local-only testing you can set AZURE_SEARCH_API_KEY.
```

Create the index and re-index approved documents:

```powershell
python scripts/create_search_index.py
python scripts/reindex_approved.py
```

The Azure search query applies `allowed_roles` as a **pre-filter inside Search**, not after retrieval.

## 5. Switch Blob Storage on

```env
STORAGE_BACKEND=azure
AZURE_STORAGE_ACCOUNT_URL=https://YOURACCOUNT.blob.core.windows.net
```

The code uses `DefaultAzureCredential`. Give the App Service managed identity Blob Data Contributor access. Secure document URLs use a short-lived user-delegation SAS.

## 6. Graph notifications

```env
NOTIFICATION_BACKEND=graph
GRAPH_SENDER_USER=hr@yourtenant.com
HR_NOTIFICATION_EMAIL=hr@yourtenant.com
```

For App Service, prefer managed identity or an application identity with `Mail.Send` admin consent. If local app-only authentication is necessary, `GRAPH_CLIENT_SECRET` is supported, but keep it in Key Vault or a local `.env` that is never committed.

Notification failures are logged to `notification_log` and never break request approval/submission.

## 7. Azure SQL

Local development uses SQLite. For Azure SQL, install Microsoft ODBC Driver 18, then install the optional driver dependency with `pip install -r requirements-azure-sql.txt` and set the SQLAlchemy URL, for example:

```env
DATABASE_URL=mssql+pyodbc://USER:PASSWORD@SERVER.database.windows.net/DB?driver=ODBC+Driver+18+for+SQL+Server&Encrypt=yes&TrustServerCertificate=no
```

For production, replace username/password with managed-identity token authentication or retrieve the secret from Key Vault.

## 8. 7-day retention

Every conversation stores `expires_at` when it is created. `POST /api/admin/purge` deletes expired messages/conversations in batches and writes a row to `purge_log`.

`functions/purge/function_app.py` contains both:

- timer trigger: daily at 02:00 UTC
- HTTP trigger: Function-key protected manual run for the demo

## 9. Tests

```powershell
pytest -q
```

The tests cover seed/auth, role-filtered policy access, SSE chat, Connect-to-HR escalation, request routing, required denial comments, and the held-back document workflow.

Run the supplied retrieval benchmark with:

```powershell
python scripts/evaluate_retrieval.py
```

## Important design notes

- The supplied policy dataset has two versions using the external ID `BPT-HR-PTO-001`. The database therefore uses a UUID as the true document primary key and stores the policy ID separately as `external_document_id`.
- `Compensation and Payroll Guide` and `Onboarding and Offboarding Handbook` are manager/executive-only in the supplied seed data, so employee search and Resources will not expose them.
- Document 14 (Bereavement) is intentionally pending and should not answer questions until HR approves it.
- Document 15 is intentionally rejected and is never indexed.

## Secure viewer note

Set `ENABLE_DYNAMIC_WATERMARK=true` to stamp the viewer email and UTC timestamp across locally served PDFs. Browser/OS screenshot or screen-sharing prevention cannot be guaranteed by a web backend; treat watermarking, authorization, short-lived URLs, and audit logging as the enforceable controls.
