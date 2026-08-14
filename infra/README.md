# Infrastructure

Azure resources for the Employee FAQ Chatbot. Subscription `Quadrant Internship`
(`7981312c-4577-455a-8bae-10269b74a97b`), resource group **`DecaCore`**.

**Terraform is the source of truth** — see `terraform/`. `provision.sh` is kept only as a
record of how the first resources were created by hand; don't run it against live
infrastructure or it will fight Terraform.

```bash
cd terraform && terraform init && terraform plan
```

## Resources

| Resource | Name | Region | Notes |
|---|---|---|---|
| App Service plan | `qthr-faq-plan` | westus | **S1** |
| Web app | `qthr-faq-api` | westus | Python 3.12, HTTPS-only, always-on |
| Static Web App | `qthr-faq-web` | westus2 | Frontend, Free tier |
| Storage | `qthrpolicypdfs` | eastus | Containers `documents`, `receipts`, `watermarked` — all private |
| Storage | `qthrtfstate` | eastus | Terraform state only — **not** Terraform-managed |
| Key Vault | `qthr-decacore-kv` | westus | Our secrets, RBAC mode |
| SQL Server | `decacore-sql-server` | westus2 | Referenced, not managed (see `sql.tf`) |
| SQL Database | `decacore-db` | westus2 | S0 |
| Azure OpenAI / AI Search | *external* | westus | Manager's — `sharedfoundry`, `internaisearch` |

| | URL |
|---|---|
| Backend | https://qthr-faq-api.azurewebsites.net |
| Frontend | https://delightful-tree-02eef901e.7.azurestaticapps.net |

## Regions

Compute is **westus** to sit alongside the manager's AI services — `internaisearch` and
`sharedfoundry` both resolve there, and a chat request is embed → search → completion, so
cross-region compute costs a round trip per hop. A resource group's own region does not
constrain what lives inside it, which is why an eastus group holds westus resources.
Storage stays in eastus; it isn't on the per-request path.

## Access model

We hold **Contributor + User Access Administrator on the `DecaCore` resource group only**,
not at subscription scope. So: no creating resource groups, no visibility outside the
group, and Terraform must treat the resource group as a `data` source.

The web app has a system-assigned managed identity, principal
`a1ca8540-54a3-454d-a0be-057c46743a96`. It holds `Storage Blob Data Contributor` on
`qthrpolicypdfs` (Contributor, not Reader — the upload endpoints write) and
`Key Vault Secrets User` on `qthr-decacore-kv`.

Note that a deployment slot would get its **own** identity rather than inheriting this
one, so every grant would need making twice. That caught us once already.

## Terraform state

State lives in `qthrtfstate`, container `tfstate`, authenticated with your Entra identity
(`use_azuread_auth`). That account is deliberately **not** Terraform-managed — otherwise a
`destroy` would delete the account holding its own state.

If an apply is interrupted, the blob lease survives and later runs fail with
`state blob is already locked`. Break it:

```bash
TOKEN=$(az account get-access-token --resource https://storage.azure.com/ --query accessToken -o tsv)
curl -X PUT "https://qthrtfstate.blob.core.windows.net/tfstate/decacore.tfstate?comp=lease" \
  -H "Authorization: Bearer $TOKEN" -H "x-ms-version: 2021-08-06" \
  -H "x-ms-lease-action: break" -H "Content-Length: 0"
```

`dev.auto.tfvars` holds per-developer values (SQL firewall IPs, DevOps federation) and is
gitignored. It is named `.auto.` so Terraform loads it without a `-var-file` flag —
otherwise an apply without the flag would delete your firewall rule. Copy
`dev.auto.tfvars.example` to start.

## Secrets

Secrets live in `qthr-decacore-kv` and are referenced from app settings:

```
AZURE_OPENAI_API_KEY = @Microsoft.KeyVault(SecretUri=https://qthr-decacore-kv.vault.azure.net/secrets/azure-openai-api-key)
```

| Secret | Contents |
|---|---|
| `azure-openai-api-key` | Team 8's key, copied from the manager's `group7-8` vault |
| `azure-search-api-key` | Copied from `group7-8` |
| `database-url` | Full SQLAlchemy URL, password URL-encoded |

**Why references and not literal values:** a literal secret in `app_settings` lands in
Terraform state even with `lifecycle { ignore_changes }` — that setting stops Terraform
*overwriting* a value, but refresh still reads the live value in. A reference puts only a
URI in state. Verified: no key or password appears in `terraform show -json`.

**Never write secret values through Terraform.** Use:

```bash
az keyvault secret set --vault-name qthr-decacore-kv --name azure-openai-api-key --value <value>
```

Watch for trailing newlines when writing from a file — a newline inside `database-url`
corrupts the connection string in a way that is awkward to debug.

Rotation is a vault update: no redeploy needed.

Bootstrapping from scratch takes **two applies** — the vault and its role assignments must
exist before app settings can reference them, and the role assignment depends on the app's
identity, so one apply would be a dependency cycle.

The manager's `group7-8` vault can't be referenced directly: our identities have no access
to it and we can't grant it. If the manager ever grants `Cognitive Services OpenAI User`
and `Search Index Data Reader` on their resources, the copied keys can be dropped.

## Config

App settings mirror `backend/.env.example` exactly — pydantic maps each field to the
upper-cased env var, so names must match `app/config.py` character for character.

The backend has independent adapter switches. Everything starts in the mode known to work
and is promoted only once its dependency is verified:

| Switch | Now | Promote when |
|---|---|---|
| `AUTH_MODE` | `dev` | Entra app roles + "Expose an API" are configured |
| `STORAGE_BACKEND` | `azure` | — already on |

Seed PDFs must be uploaded to the `documents` container as well as seeded into SQL.
Running the seed with `STORAGE_BACKEND=local` writes them to a laptop instead, and every
Resources download then 404s while the metadata looks perfectly fine.
| `SEARCH_BACKEND` | `azure` | — index created, 175 chunks loaded |
| `LLM_BACKEND` | `azure` | — verified against `gpt-5` |
| `NOTIFICATION_BACKEND` | `log` | Graph `Mail.Send` admin consent lands |

Deployment names are `gpt-5` (chat) and `text-embedding-3-large` (embeddings) — discovered
by probing the endpoint, since Azure serves models under a deployment name chosen at deploy
time that need not match the model name.

`AZURE_OPENAI_EMBEDDING_DIMENSIONS` is **1536**. `3-large` natively produces 3072 but
supports requesting a shorter vector, which keeps the planned index schema valid without a
second model deployment.

`AZURE_OPENAI_ENDPOINT` is the **base** URL, not the `/openai/v1/responses` path stored in
the manager's vault — the client appends its own paths and also calls `/embeddings`.

## Database

Azure SQL via **`pymssql`**, not `pyodbc`. `pymssql` ships a manylinux wheel with FreeTDS
bundled, so no ODBC system driver is needed and the app stays a zip deploy instead of being
containerised purely to satisfy a driver.

The server is **referenced, not managed**: `azurerm_mssql_server` requires
`administrator_login_password`, which Azure never returns, so managing it would mean putting
a placeholder in config that Terraform then applies — silently resetting the SQL admin
password. The database and firewall rules carry the settings we actually control.

Tables are created at startup by `Base.metadata.create_all`; there is no migration step.

## Known toolchain issue

Homebrew Python 3.14 on macOS has a broken `libexpat` link, so any `az` command that parses
XML fails with `Symbol not found: _XML_SetAllocTrackerActivationThreshold`. `pip install`
fails too.

The dangerous case: `az webapp create` hits this **after** creating the resource, so the
resource exists despite the error — verify with `az resource list` rather than re-running.
`az rest` uses JSON and is unaffected. `uv` works for Python packaging. Fix with
`brew reinstall python@3.14`.

## Open items

- Entra: app roles (`Employee`, `Manager`, `Executive`, `HRAdmin`), "Expose an API"
  application ID URI, and redirect URIs — all still unset on `DecaCore-HR-Chatbot`.
  The application code is finished and shipped behind a flag; only the registration
  work is left, and it needs an owner of that registration plus a tenant admin for
  role assignment. Step-by-step in `docs/ENTRA_SETUP.md`.
  **Until this lands, `AUTH_MODE=dev` is live on a public URL, which means any caller
  can act as HR Admin by sending an `X-Dev-User-Email` header.**
- Graph `Mail.Send` admin consent — needs a tenant admin.
- Azure DevOps parallel jobs grant, if it reads 0.
- Rotate the SQL password before handover.

## Pipelines

Two pipelines, split by what they deploy:

| | Built by | Deploys to |
|---|---|---|
| `backend/` | Azure Pipelines — `azure-pipelines.yml` | App Service **production** |
| `frontend/` | GitHub Actions — `.github/workflows/frontend.yml` | Static Web App |

Both filter on paths, so a frontend push doesn't trigger a backend deploy.

**CI deploys straight to production.** The dev slot and swap step were removed — with
one team and one environment the extra hop only meant every change needed a manual
swap before anyone could see it. The tradeoff is real: a bad deploy now reaches
production directly, and the pipeline's `/health` smoke test is the only gate. Tests
run before the deploy stage, so a failing test never reaches the deploy.

### Backend — Azure DevOps setup

Terraform created the Entra identity; the service connection has to be made in the
DevOps UI, and completing it is a two-way handshake because DevOps generates the
federated subject.

1. **Pipelines → New pipeline → GitHub** → pick the repo → *Existing Azure Pipelines YAML file* → `/azure-pipelines.yml`. This creates the GitHub service connection.
2. **Project Settings → Service connections → New → Azure Resource Manager → Workload Identity federation (manual)**. Name it **`decacore-azure`** — `azure-pipelines.yml` refers to it by that name.
   - Subscription ID `7981312c-4577-455a-8bae-10269b74a97b`
   - Application (client) ID `9b86a35e-8b25-428a-bc81-c27d926663e1`
   - Tenant ID `0eadb77e-42dc-47f8-bbe3-ec2395e0712c`
3. DevOps then shows an **Issuer** and **Subject Identifier**. Put them in `dev.auto.tfvars` and apply:

   ```hcl
   devops_federation = {
     devops = {
       issuer  = "https://vstoken.dev.azure.com/<org-guid>"
       subject = "sc://Intern2026/DecaCore/decacore-azure"
     }
   }
   ```

The service principal holds **Contributor on the `DecaCore` resource group only** — not
the subscription — so a compromised pipeline cannot reach anything else. This is also why
DevOps' "automatic" service connection option fails: it tries to assign a role at
subscription scope, which we don't have rights to do.

Microsoft-hosted agents need the free parallelism grant on private projects
(Project Settings → Parallel jobs). If it reads 0, request it — jobs queue forever otherwise.

### Frontend — GitHub Actions setup

One repo secret, `AZURE_STATIC_WEB_APPS_API_TOKEN`:

```bash
az staticwebapp secrets list --name qthr-faq-web -g DecaCore --query "properties.apiKey" -o tsv
```

Add it under **Settings → Secrets and variables → Actions**.

`frontend/config.js` is generated at deploy time from the workflow's `API_BASE` and is
gitignored — the same source can target the dev slot or production without a code change.
Locally, `app.js` falls back to `http://localhost:8000` when `config.js` is absent.
