# DecaCore Employee FAQ Chatbot

An internal HR assistant. Employees sign in with their company account and ask
questions in plain language; answers are generated only from approved company
policy documents and carry citations back to the source. HR administrators use
the same app with extra tools for managing the document set behind it.

Answers are produced with retrieval-augmented generation, so the model can only
speak from documents HR has uploaded — and only from the subset the asking
employee is cleared to see. Uploading a policy publishes and indexes it in one
step, so it is answerable straight away.

## Repository layout

| Path | What it is |
|---|---|
| `backend/` | FastAPI service — the API, RAG pipeline, and all business logic |
| `frontend/` | QBot web client — plain ES modules, no build step |
| `infra/` | Terraform for App Service, SQL, Key Vault, and the static site |
| `.github/workflows/` | GitHub checks: backend lint/test, frontend deploy |
| `azure-pipelines.yml` | Azure DevOps: backend test and deploy to production |

## Running it

The backend runs with no Azure resources at all. Storage, search, generation,
and notifications each have a local implementation, so a new team member can
clone the repo and have a working chatbot in a couple of minutes.

```bash
cd backend
./run-local.sh          # Linux/macOS
.\run-local.ps1         # Windows
```

Then open <http://localhost:8000/docs>. Seed data loads on first boot: 100
employees and 15 HR policy documents.

Requires Python 3.12 — `app/services/search.py` uses syntax that will not parse
on 3.11.

## Local mode and Azure mode

Each capability is an adapter chosen by environment variable, and each one flips
independently. Nothing is all-or-nothing, so the team can move to Azure one
service at a time.

| Capability | Local | Azure | Variable |
|---|---|---|---|
| Auth | dev header | Entra ID | `AUTH_MODE` |
| Database | SQLite | Azure SQL | `DATABASE_URL` |
| Documents | local disk | Blob Storage | `STORAGE_BACKEND` |
| Retrieval | local index | AI Search | `SEARCH_BACKEND` |
| Generation | offline stub | Azure OpenAI | `LLM_BACKEND` |
| Email | log line | Graph API | `NOTIFICATION_BACKEND` |

`GET /health` reports which mode each adapter is in — the quickest way to tell
what a running instance is actually doing.

Values still needed to go live are listed in `backend/AZURE_TODO.md`.

## Development

```bash
cd backend
python -m pytest        # 12 tests, no network or credentials needed
ruff check .            # lint, config in pyproject.toml
```

Tests run every adapter in local mode and assert it, so a stray credential in
your shell fails the suite rather than writing to shared Azure resources.

## Docs

- `backend/README.md` — implemented features, endpoints, setup detail
- `backend/FRONTEND_HANDOFF.md` — API integration flow and SSE example
- `backend/AZURE_TODO.md` — remaining Azure configuration
- `infra/README.md` — provisioning and pipeline setup
- `backend/openapi.json` — generated API contract
