# App Service settings, mirroring decacore_backend/.env.example exactly.
# Pydantic BaseSettings maps each field to the upper-cased env var of the same name,
# so these names must match app/config.py character for character.
#
# The backend has independent adapter switches — auth / storage / search / llm /
# notifications each flip local->azure on their own. Everything starts in the mode
# that is known to work, and gets promoted only once its dependency is verified.

locals {
  # Secrets are declared here as "" so Terraform creates the key, then are populated
  # out-of-band. See the lifecycle ignore_changes blocks in main.tf.
  app_settings = {
    APP_NAME  = "DecaCore Employee FAQ Backend"
    ENV       = "prod"
    LOG_LEVEL = "INFO"

    # entra since 2026-08-15. The registration exposes api://<client-id>, defines the
    # four app roles, and has the SPA redirect URIs registered; the full sign-in flow
    # was verified against a locally run backend first. See docs/ENTRA_SETUP.md.
    #
    # Deploy the frontend BEFORE applying this. In between, a dev-mode backend simply
    # ignores the bearer token and falls back to DEV_USER_EMAIL — degraded but usable.
    # The other order breaks the app outright: an entra-mode backend rejects the dev
    # header that an undeployed frontend is still sending.
    AUTH_MODE      = "entra"
    DEV_USER_EMAIL = "marietta.baudone@gmail.com"
    AUTO_SEED      = "true"
    RETENTION_DAYS = "7"

    ENABLE_DYNAMIC_WATERMARK = "false"

    # Azure SQL via pymssql, which ships a manylinux wheel with FreeTDS bundled —
    # so no ODBC system driver is needed and the app can stay a zip deploy rather
    # than being containerised just to satisfy pyodbc.
    # The password is URL-encoded inside the secret; '@' and '!' would otherwise
    # break URL parsing.
    DATABASE_URL = "@Microsoft.KeyVault(SecretUri=${local.kv_secret_uri.database_url})"

    # Local dev ports plus the deployed frontend. The frontend is a separate origin
    # now, so a missing entry here shows up as a browser CORS error, not a 500.
    CORS_ORIGINS = join(",", concat(
      var.cors_origins,
      ["https://${azurerm_static_web_app.frontend.default_host_name}"],
    ))

    ENTRA_TENANT_ID = var.entra_tenant_id
    ENTRA_CLIENT_ID = var.entra_client_id
    ENTRA_OBJECT_ID = var.entra_object_id
    ENTRA_AUDIENCE  = "api://${var.entra_client_id}"

    # Azure from the start — App Service local disk is the wrong place for uploads.
    STORAGE_BACKEND                   = "azure"
    AZURE_STORAGE_ACCOUNT_URL         = azurerm_storage_account.policy_docs.primary_blob_endpoint
    AZURE_STORAGE_DOCUMENTS_CONTAINER = "documents"
    AZURE_STORAGE_RECEIPTS_CONTAINER  = "receipts"

    # Index created and populated: 175 chunks, 1536-dim vectors.
    SEARCH_BACKEND        = "azure"
    AZURE_SEARCH_ENDPOINT = var.azure_search_endpoint
    AZURE_SEARCH_INDEX    = "decacore-hr-policies"
    AZURE_SEARCH_API_KEY  = "@Microsoft.KeyVault(SecretUri=${local.kv_secret_uri.search_key})"

    # Foundry endpoint verified reachable; gpt-5 and text-embedding-3-large confirmed.
    LLM_BACKEND           = "azure"
    AZURE_OPENAI_ENDPOINT = var.azure_openai_endpoint
    AZURE_OPENAI_API_KEY  = "@Microsoft.KeyVault(SecretUri=${local.kv_secret_uri.openai_key})"
    # Deployment names, discovered by probing the endpoint — Azure serves models under
    # a deployment name chosen at deploy time, which need not match the model name.
    AZURE_OPENAI_CHAT_DEPLOYMENT      = "gpt-5"
    AZURE_OPENAI_EMBEDDING_DEPLOYMENT = "text-embedding-3-large"

    # 3-large natively produces 3072, but supports requesting a shorter vector.
    # 1536 keeps the index schema in the build plan's Appendix C valid.
    AZURE_OPENAI_EMBEDDING_DIMENSIONS = "1536"

    # log until Graph admin consent lands. Notification failures must never break
    # a request flow during the demo.
    NOTIFICATION_BACKEND  = "log"
    GRAPH_TENANT_ID       = var.entra_tenant_id
    GRAPH_CLIENT_ID       = var.entra_client_id
    GRAPH_CLIENT_SECRET   = ""
    GRAPH_SENDER_USER     = ""
    HR_NOTIFICATION_EMAIL = ""

    LOCAL_SEARCH_TOP_K = "5"
    LOCAL_MIN_SCORE    = "0.08"

    # Tuned to 0.04 against real traffic and set by hand in the portal, which left it
    # undeclared here — the next apply would have deleted it and snapped the relevance
    # floor back to the code default of 0.08, sending noticeably more answerable
    # questions to HR instead. Declared so that cannot happen again. Every chat logs
    # its relevance score, so change this from the log stream, then change it here.
    AZURE_MIN_SCORE = "0.04"

    # Company news ticker. Quadrant's public WordPress feed — the LinkedIn company
    # page cannot be read without Community Management API approval from a super
    # admin of that page. See backend/app/services/news_feed.py.
    NEWS_FEED_URL       = "https://www.quadranttechnologies.com/blog/feed"
    NEWS_FEED_SOURCE    = "blog"
    NEWS_FEED_MAX_ITEMS = "6"

    # Presented by the nightly GitHub Actions job, which has no user identity to
    # authenticate as. If this reference fails to resolve, App Service passes the
    # literal "@Microsoft.KeyVault(...)" string through — which is public in this
    # repo, so the backend explicitly refuses to accept an unresolved reference as
    # a valid secret rather than trusting whatever it is handed.
    NEWS_REFRESH_TOKEN = "@Microsoft.KeyVault(SecretUri=${local.kv_secret_uri.news_refresh})"

    # Makes App Service install requirements.txt on deploy.
    SCM_DO_BUILD_DURING_DEPLOYMENT = "true"
  }
}
