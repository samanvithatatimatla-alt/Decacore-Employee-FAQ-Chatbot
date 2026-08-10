# Frontend handoff

## Development auth

While `AUTH_MODE=dev`, add one header to every request:

```text
X-Dev-User-Email: marietta.baudone@gmail.com
```

Useful test identities:

```text
Employee: marietta.baudone@gmail.com
Manager:  alejandra.farryann@gmail.com
HRAdmin:  hr.admin@bluepeak.example
```

When Entra is ready, remove the dev header and send:

```text
Authorization: Bearer <API access token>
```

## SSE chat example

`POST /api/chat` is a POST stream, so use `fetch`, not browser `EventSource`.

```js
const response = await fetch("http://localhost:8000/api/chat", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Dev-User-Email": "marietta.baudone@gmail.com",
  },
  body: JSON.stringify({ message, conversation_id: conversationId ?? null }),
});

const reader = response.body.getReader();
const decoder = new TextDecoder();
let buffer = "";

while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  const events = buffer.split("\n\n");
  buffer = events.pop();

  for (const eventBlock of events) {
    const type = eventBlock.match(/^event: (.+)$/m)?.[1];
    const raw = eventBlock.match(/^data: (.+)$/m)?.[1];
    if (!raw) continue;
    const data = JSON.parse(raw);
    if (type === "delta") appendAssistantText(data.text);
    if (type === "done") renderCitations(data.citations);
  }
}
```

## Connect to HR

When the chat `done` event returns `escalation_offered: true`, show the UI action. Submit:

```http
POST /api/chat/escalate
Content-Type: application/json

{
  "conversation_id": "...",
  "assistant_message_id": "...",
  "note": "Optional employee note"
}
```

The backend marks the assistant message escalated and creates an HR-visible request.

## Document lifecycle

HR upload is multipart:

```text
POST /api/documents
file=<pdf>
permissions=Employee,Manager,Executive
title=Optional title
```

Then:

1. `GET /api/documents/pending`
2. optional `PATCH /api/documents/{id}/category`
3. `POST /api/documents/{id}/approve`
4. poll/refresh until `indexed_at` is non-null
5. employee can immediately ask a question about the newly approved document

## Manager request flow

Employee submits multipart to `POST /api/requests`. The backend calculates `assigned_manager_id` from the employee table. Managers get only requests assigned to them and cannot decide their own submission.

Denial requires:

```json
{ "comment": "Reason is required" }
```

## API contract

- Swagger: `/docs`
- Raw OpenAPI contract: `openapi.json` in this backend package
