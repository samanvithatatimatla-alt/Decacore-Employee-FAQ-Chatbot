# Azure values still needed to turn local mode into live Azure mode

The backend is runnable without these values. Fill them when the resources are ready.

## Azure OpenAI / Microsoft Foundry

- `AZURE_OPENAI_ENDPOINT`
- `AZURE_OPENAI_CHAT_DEPLOYMENT`
- `AZURE_OPENAI_EMBEDDING_DEPLOYMENT`
- Confirm embedding dimensions (`1536` is the current project default)
- Prefer managed identity in App Service; otherwise provide an API key through Key Vault/App Service settings

## Azure AI Search

- `AZURE_SEARCH_ENDPOINT`
- Search service must permit the App Service managed identity (or temporarily use an admin/query key locally)
- Index name can stay `decacore-hr-policies`

Run:

```powershell
python scripts/create_search_index.py
python scripts/reindex_approved.py
```

## Blob Storage

- `AZURE_STORAGE_ACCOUNT_URL`
- Grant the backend identity Blob Data Contributor access
- Containers: `documents` and `receipts`

## Microsoft Graph

- Confirm `Mail.Send` admin consent
- `GRAPH_SENDER_USER`, e.g. an HR/shared mailbox
- `HR_NOTIFICATION_EMAIL`
- Prefer managed identity/app-only auth in Azure. If testing app-only locally, use `GRAPH_CLIENT_SECRET` only in `.env`/Key Vault and never commit it.

## Entra authentication

Current IDs are already in `.env.example`.

Need to confirm in the portal:

- Application ID URI under **Expose an API**, normally `api://efccb481-74ba-45b8-940a-fed5dfbec74e`
- App-role values exactly: `Employee`, `Manager`, `Executive`, `HRAdmin`
- Test users assigned to roles
- Frontend redirect URIs configured
- Frontend requests an access token for this API, not a Microsoft Graph token

## Azure SQL / App Service

- SQL server/database name or final `DATABASE_URL`
- App Service URL, needed for the final CORS origin
- Decide whether the team will use SQL credentials for the demo or managed identity for Azure SQL
