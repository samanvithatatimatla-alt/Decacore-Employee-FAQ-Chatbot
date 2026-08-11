#!/usr/bin/env bash
# Provisions the App Service infrastructure for the Employee FAQ Chatbot.
# Idempotent-ish: re-running create commands on existing resources is a no-op or errors harmlessly.
#
# Not provisioned here (owned elsewhere):
#   - Azure OpenAI + Azure AI Search : provided by the manager, endpoints/keys supplied as app settings
#   - Storage account qthrpolicypdfs : created by Nihitha
set -euo pipefail

SUBSCRIPTION="7981312c-4577-455a-8bae-10269b74a97b"
RG="DecaCore"
LOCATION="eastus"
PLAN="qthr-faq-plan"
APP="qthr-faq-api"
STORAGE="qthrpolicypdfs"
CONTAINER="policies"

az account set --subscription "$SUBSCRIPTION"

# 1. App Service plan.
# F1 (free) is deliberate: this workload is I/O-bound on Azure OpenAI, not CPU-bound,
# so a larger tier buys no meaningful latency. Upgrade in place before the demo with:
#   az appservice plan update -g $RG -n $PLAN --sku B1
# F1 limits: no always-on (cold starts after ~20 min idle), 60 min/day CPU quota, no slots.
az appservice plan create -g "$RG" -n "$PLAN" --is-linux --sku F1 -l "$LOCATION"

# 2. Web app.
az webapp create -g "$RG" -p "$PLAN" -n "$APP" --runtime "PYTHON|3.12"

# 3. System-assigned managed identity.
az webapp identity assign -g "$RG" -n "$APP"
PRINCIPAL_ID=$(az webapp identity show -g "$RG" -n "$APP" --query principalId -o tsv)

# 4. Let the app read policy PDFs from Blob without a connection string.
STORAGE_ID=$(az storage account show -g "$RG" -n "$STORAGE" --query id -o tsv)
az role assignment create \
  --assignee-object-id "$PRINCIPAL_ID" \
  --assignee-principal-type ServicePrincipal \
  --role "Storage Blob Data Reader" \
  --scope "$STORAGE_ID"

# 5. Config contract. Empty values are pending from the manager; empty strings are
# falsy in Python, so application code can check for "not configured" cleanly.
az webapp config appsettings set -g "$RG" -n "$APP" --settings \
  AZURE_OPENAI_ENDPOINT="" \
  AZURE_OPENAI_KEY="" \
  AZURE_OPENAI_CHAT_DEPLOYMENT="" \
  AZURE_OPENAI_EMBEDDING_DEPLOYMENT="" \
  AZURE_OPENAI_API_VERSION="2024-10-21" \
  AZURE_SEARCH_ENDPOINT="" \
  AZURE_SEARCH_KEY="" \
  AZURE_SEARCH_INDEX="" \
  AZURE_STORAGE_ACCOUNT="$STORAGE" \
  AZURE_STORAGE_CONTAINER="$CONTAINER" \
  SCM_DO_BUILD_DURING_DEPLOYMENT="true"

# 6. Hardening + startup.
az webapp update -g "$RG" -n "$APP" --https-only true

# NOTE: `az webapp config set --startup-file` silently no-opped on azure-cli 2.88.0,
# so the startup command is set via the REST API instead. Verify after running.
# The module path must match the backend layout (currently assumes app/main.py exposing `app`).
az rest --method patch \
  --url "https://management.azure.com/subscriptions/$SUBSCRIPTION/resourceGroups/$RG/providers/Microsoft.Web/sites/$APP/config/web?api-version=2023-01-01" \
  --body '{"properties":{"appCommandLine":"gunicorn -w 2 -k uvicorn.workers.UvicornWorker --timeout 120 app.main:app"}}'

echo "Done. App: https://$(az webapp show -g "$RG" -n "$APP" --query defaultHostName -o tsv)"
