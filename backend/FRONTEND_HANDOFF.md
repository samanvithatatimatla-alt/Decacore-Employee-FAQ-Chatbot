# DecaCore Frontend Integration Handoff

> **Status:** the integration described here is done. The frontend is a Vite + React +
> TypeScript app in the repo's top-level `frontend/`, deployed separately to Azure Static
> Web Apps — FastAPI is API-only and does not serve it, so CORS is required and
> `CORS_ORIGINS` must list the frontend origin. This document is kept as the API contract
> and for the SSE example; `frontend/README.md` describes the client as it now stands.

This document is the quickest path for connecting the DecaCore frontend to the FastAPI backend.

## 1. Local backend

Start the backend:

```powershell
.\run-local.ps1
```

Backend URLs:

```text
API base:  http://localhost:8000
Swagger:   http://localhost:8000/docs
Health:    http://localhost:8000/health
```

The backend works locally without Azure. Local development currently uses SQLite, local document storage, local retrieval, and offline answer generation.

CORS is already enabled for:

```text
http://localhost:3000
http://localhost:5173
```

If the frontend runs on another port, tell the backend developer so it can be added to `CORS_ORIGINS`.

## 2. Development authentication

While the backend uses `AUTH_MODE=dev`, send this header on every protected API request:

```text
X-Dev-User-Email: marietta.baudone@gmail.com
```

Useful test users:

| Portal | Test identity |
|---|---|
| Employee | `marietta.baudone@gmail.com` |
| Manager | `alejandra.farryann@gmail.com` |
| HR Admin | `hr.admin@bluepeak.example` |

For quick UI testing, the optional header below can override the current role for one request:

```text
X-Dev-Role: Employee
X-Dev-Role: Manager
X-Dev-Role: HRAdmin
X-Dev-Role: Executive
```

When Microsoft Entra ID is enabled, remove the dev headers and send:

```text
Authorization: Bearer <API access token>
```

## 3. Recommended frontend API helper

Use one shared API helper instead of repeating headers throughout the UI.

```js
const API_BASE = "http://localhost:8000";
const DEV_EMAIL = "marietta.baudone@gmail.com";

export async function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("X-Dev-User-Email", DEV_EMAIL);

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || `Request failed: ${response.status}`);
  }

  return response;
}
```

Do not manually set `Content-Type` for `FormData`. The browser will add the multipart boundary automatically.

## 4. Screen to endpoint map

### App startup / role routing

```http
GET /api/me
```

Use the returned `role` to route the user to Employee, Manager, or HR Admin screens.

Important fields:

```json
{
  "id": 2,
  "display_name": "Marietta Baudone",
  "email": "marietta.baudone@gmail.com",
  "role": "Employee",
  "department": "HR",
  "manager_id": 1
}
```

### Employee portal

| UI feature | Backend endpoint |
|---|---|
| Chat | `POST /api/chat` |
| Top 3 FAQ | `GET /api/faq/top` |
| Chat history | `GET /api/conversations` |
| Open conversation | `GET /api/conversations/{id}` |
| Delete conversation | `DELETE /api/conversations/{id}` |
| Resources | `GET /api/documents` |
| Open policy | `GET /api/documents/{id}/url` |
| Submit leave/reimbursement/etc. | `POST /api/requests` |
| My requests/status | `GET /api/requests` |
| Escalate chatbot answer to HR | `POST /api/chat/escalate` |

### Manager portal

| UI feature | Backend endpoint |
|---|---|
| Request board | `GET /api/requests` |
| Pending filter | `GET /api/requests?status=Pending` |
| Request details | `GET /api/requests/{id}` |
| Receipt/attachment | `GET /api/requests/{id}/attachment` |
| Approve | `POST /api/requests/{id}/approve` |
| Deny | `POST /api/requests/{id}/deny` |

The backend automatically scopes manager results to requests assigned to that manager. A manager cannot approve or deny their own request.

### HR Admin portal

| UI feature | Backend endpoint |
|---|---|
| Dashboard cards | `GET /api/dashboard/metrics` |
| Dashboard charts | `GET /api/dashboard/charts` |
| All requests / HR inbox | `GET /api/requests` |
| Upload policy | `POST /api/documents` |
| Pending approval list | `GET /api/documents/pending` |
| Change category | `PATCH /api/documents/{id}/category` |
| Approve/index document | `POST /api/documents/{id}/approve` |
| Reject document | `POST /api/documents/{id}/reject` |
| All documents | `GET /api/documents` |

## 5. Chat streaming

`POST /api/chat` returns Server-Sent Events over a POST request. Use `fetch`, not browser `EventSource`.

Start a new conversation:

```json
{
  "message": "How many vacation days do employees receive?"
}
```

Continue an existing conversation:

```json
{
  "message": "Can unused days carry over?",
  "conversation_id": "<conversation-id>"
}
```

Example stream:

```text
event: meta
data: {"conversation_id":"...","message_id":"..."}

event: delta
data: {"text":"Full-time "}

event: delta
data: {"text":"employees "}

event: done
data: {"conversation_id":"...","message_id":"...","citations":[],"confidence":0.9,"escalation_offered":false}
```

Frontend behavior:

1. On `meta`, save `conversation_id` and `message_id`.
2. On each `delta`, append `data.text` to the current assistant bubble.
3. On `done`, stop the typing state, render citations, and show the HR escalation button when `escalation_offered` is `true`.

Recommended parser:

```js
export async function streamChat({ message, conversationId, onMeta, onDelta, onDone }) {
  const response = await fetch("http://localhost:8000/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Dev-User-Email": "marietta.baudone@gmail.com",
    },
    body: JSON.stringify({
      message,
      ...(conversationId ? { conversation_id: conversationId } : {}),
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || `Chat failed: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() || "";

    for (const block of blocks) {
      const event = block.match(/^event: (.+)$/m)?.[1];
      const raw = block.match(/^data: (.+)$/m)?.[1];
      if (!event || !raw) continue;

      const data = JSON.parse(raw);
      if (event === "meta") onMeta?.(data);
      if (event === "delta") onDelta?.(data.text);
      if (event === "done") onDone?.(data);
    }
  }
}
```

## 6. Citations

The `done` event returns structured citations. Do not parse citations out of assistant text.

A citation can contain:

```json
{
  "document_id": "...",
  "external_document_id": "BPT-HR-PTO-001",
  "title": "Paid Time Off Policy",
  "section": "Vacation",
  "page": 3,
  "version": "2",
  "effective_date": "2026-01-01",
  "source_url": null
}
```

Recommended UI: render each citation as a clickable source chip. Use `document_id` with `/api/documents/{document_id}/url` when the user opens the source.

## 7. Connect to HR

If chat completion returns:

```json
{
  "escalation_offered": true
}
```

show a `Connect to HR` action.

Submit:

```http
POST /api/chat/escalate
Content-Type: application/json
```

```json
{
  "conversation_id": "...",
  "assistant_message_id": "...",
  "note": "Optional employee note"
}
```

Success response:

```json
{
  "request_id": "...",
  "status": "Pending",
  "message": "Question sent to HR."
}
```

## 8. Employee request form

Use `FormData` for leave, reimbursement, insurance, travel, etc.

```js
const form = new FormData();
form.append("type", "Reimbursement");
form.append("category", "Travel");
form.append("amount", "125.50");
form.append("message", "Taxi from airport to hotel");
if (file) form.append("attachment", file);

await apiFetch("/api/requests", {
  method: "POST",
  body: form,
});
```

The backend automatically assigns the employee's manager when one exists.

Manager approval:

```http
POST /api/requests/{id}/approve
Content-Type: application/json
```

```json
{
  "comment": "Approved"
}
```

Manager denial requires a comment:

```http
POST /api/requests/{id}/deny
Content-Type: application/json
```

```json
{
  "comment": "Please attach the missing receipt."
}
```

## 9. HR document upload and approval

Upload is multipart and requires an HR Admin identity.

```js
const form = new FormData();
form.append("file", pdfFile);
form.append("permissions", "Employee,Manager,Executive");
form.append("title", "Updated Travel Policy");

await apiFetch("/api/documents", {
  method: "POST",
  headers: {
    "X-Dev-User-Email": "hr.admin@bluepeak.example",
  },
  body: form,
});
```

Document workflow:

```text
Upload
  -> pending_approval
  -> HR optionally edits category
  -> approve
  -> backend indexes document
  -> indexed_at is populated
  -> policy is visible to permitted roles
```

Only PDF files are accepted. Current backend upload limit is 20 MB.

## 10. Chat history

List conversations:

```http
GET /api/conversations
```

Open one conversation:

```http
GET /api/conversations/{conversation_id}
```

The detail response contains a `messages` array already ordered for chat rendering.

The backend stores an `expires_at` timestamp for the 7-day retention policy. The frontend can display this as a small retention notice if desired.

## 11. Dashboard response shapes

HR metrics:

```http
GET /api/dashboard/metrics
```

Returns:

```json
{
  "chat_messages": 0,
  "escalated_messages": 0,
  "pending_requests": 0,
  "approved_documents": 0
}
```

Chart endpoint:

```http
GET /api/dashboard/charts
```

Returns:

```json
{
  "requests_by_status": [{ "label": "Pending", "value": 2 }],
  "documents_by_category": [{ "label": "Leave", "value": 3 }],
  "top_questions": [{ "label": "How much PTO do I get?", "value": 5 }]
}
```

## 12. Common integration errors

### `404 Conversation not found`

Do not send Swagger's placeholder value:

```json
{
  "conversation_id": "string"
}
```

For a new chat, omit `conversation_id` completely.

### `401 Dev user not found`

Make sure the `X-Dev-User-Email` matches one of the seeded users.

### `403 Requires one of these roles...`

The current user does not have permission for that HR-only action.

### Browser CORS error

The backend currently allows frontend origins on ports `3000` and `5173`. If your frontend uses a different local URL, send it to the backend developer.

### Multipart upload fails

Do not manually set `Content-Type: multipart/form-data`. Let the browser set it when using `FormData`.

## 13. Integration order

Recommended order for the frontend team:

1. `GET /api/me` and role-based routing
2. Employee chat streaming
3. Citation chips and conversation history
4. Employee Resources
5. Employee request submission/status
6. Manager request board and approve/deny
7. HR document upload/approval
8. HR dashboard
9. Connect to HR escalation
10. Replace dev auth with Entra access tokens when cloud configuration is ready

## 14. Definition of done for frontend/backend integration

Before calling integration complete, confirm:

- Employee can load `/api/me`
- Employee chat streams into one assistant bubble
- Citations render as clickable sources
- Conversation history reloads correctly
- Employee can submit a request
- Manager sees only assigned requests
- Deny is blocked without a comment
- HR can upload and approve a PDF
- Approved PDF becomes visible to permitted employees
- HR dashboard loads metrics and charts
- Escalation creates an HR-visible request
- UI handles loading, empty, and API error states

## API contract

- Swagger UI: `http://localhost:8000/docs`
- OpenAPI JSON: `openapi.json` in this backend package
- Health check: `GET /health`
