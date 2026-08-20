# Azure configuration

Every adapter except notifications is live in Azure. `GET /health` on the deployed app
reports the current mode of each one, and is the authority if this file drifts.

| Adapter | Deployed mode |
|---|---|
| `AUTH_MODE` | `entra` |
| `STORAGE_BACKEND` | `azure` |
| `SEARCH_BACKEND` | `azure` |
| `LLM_BACKEND` | `azure` |
| `NOTIFICATION_BACKEND` | `log` — the one item outstanding |

Local development leaves all of them in local mode and needs no Azure values at all.

## Outstanding: Microsoft Graph

`Mail.Send` application permission still needs **admin consent from a tenant admin**.
Until it lands, HR replies and escalation notices are written to the `notification_log`
table instead of being emailed — submission and approval never fail on a notification
error, so the app works, it just does not send mail.

When consent is granted, set:

```env
NOTIFICATION_BACKEND=graph
GRAPH_SENDER_USER=          # an HR or shared mailbox
HR_NOTIFICATION_EMAIL=
```

Prefer managed identity / app-only auth in App Service. If testing app-only locally, use
`GRAPH_CLIENT_SECRET` only in `.env` or Key Vault, and never commit it.

## Settled values, for reference

Everything below is configured on the deployed app. Terraform holds it in
`infra/terraform/settings.tf`; secrets are Key Vault references, never literals.

**Azure OpenAI** — the endpoint is the *base* URL, not the `/openai/v1/responses` path.
Deployment names are `gpt-5` (chat) and `text-embedding-3-large` (embeddings).
`AZURE_OPENAI_EMBEDDING_DIMENSIONS=1536`: `3-large` natively produces 3072 but supports a
shorter vector, which keeps the index schema valid without a second deployment.

**Azure AI Search** — index `decacore-hr-policies`. Changing the embedding model or
dimensions means rebuilding the index; documents and queries must use the same model.

```bash
python scripts/create_search_index.py
python scripts/reindex_approved.py
```

**Blob Storage** — account `qthrpolicypdfs`, containers `documents` and `receipts`. The
App Service managed identity holds Blob Data Contributor (not Reader — the upload
endpoints write).

**Entra** — done and live; see `docs/ENTRA_SETUP.md` for the registration detail and the
rollback path.

**Azure SQL** — `decacore-db`, reached through `pymssql`. The full URL lives in the
`database-url` Key Vault secret. The SQL password should be rotated before handover.
