# The resource group pre-exists and we lack rights to create resource groups,
# so it is referenced, never managed.
data "azurerm_resource_group" "main" {
  name = var.resource_group_name
}

# --------------------------------------------------------------------------
# Resources originally created by hand and since adopted into Terraform. The
# import blocks that did the adoption have been removed now that everything is
# in state — leaving them in breaks `plan` as soon as a resource is renamed.
# --------------------------------------------------------------------------

# Created by Nihitha. Holds the HR policy PDFs.
resource "azurerm_storage_account" "policy_docs" {
  name                            = "${var.prefix}policypdfs"
  resource_group_name             = data.azurerm_resource_group.main.name
  location                        = var.location
  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  account_kind                    = "StorageV2"
  access_tier                     = "Hot"
  min_tls_version                 = "TLS1_2"
  https_traffic_only_enabled      = true
  allow_nested_items_to_be_public = false

  # Currently true. Once managed-identity access is proven end to end this should
  # flip to false, which blocks connection-string auth entirely.
  shared_access_key_enabled = true
}

resource "azurerm_service_plan" "main" {
  name                = "${var.prefix}-faq-plan"
  resource_group_name = data.azurerm_resource_group.main.name
  location            = var.app_location
  os_type             = "Linux"

  # S1 is the lowest tier with deployment slots, which the build plan requires
  # ("push to main -> dev slot, demo stays manual"). F1 and B1 have none.
  sku_name = "S1"
}

resource "azurerm_linux_web_app" "backend" {
  name                = "${var.prefix}-faq-api"
  resource_group_name = data.azurerm_resource_group.main.name
  location            = var.app_location
  service_plan_id     = azurerm_service_plan.main.id
  https_only          = true

  # The provider defaults these to true, which would re-enable basic-auth publishing
  # that Azure currently has switched off. Deployment goes through the pipeline's
  # identity, so these stay disabled.
  ftp_publish_basic_authentication_enabled       = false
  webdeploy_publish_basic_authentication_enabled = false

  # Stateless API — no need to pin a client to one instance.
  client_affinity_enabled = false

  site_config {
    # Nothing deploys over FTP; the pipeline pushes a package.
    ftps_state = "Disabled"

    # Must stay in sync with backend/app/main.py. See backend/README.md.
    app_command_line = "gunicorn -w 2 -k uvicorn.workers.UvicornWorker --timeout 120 app.main:app"

    application_stack {
      python_version = "3.12"
    }

    # S1 supports always_on — no cold start when the demo begins.
    always_on = true
  }

  identity {
    type = "SystemAssigned"
  }

  app_settings = local.app_settings

  lifecycle {
    # Secrets are Key Vault references, so the value in state is a URI rather than
    # a secret and Terraform can own them outright. Only the Graph secret is still
    # a literal, and it stays empty until admin consent lands.
    ignore_changes = [
      app_settings["GRAPH_CLIENT_SECRET"],
    ]
  }
}

# Contributor, not Reader — the document upload and receipt endpoints write blobs.
resource "azurerm_role_assignment" "blob_contributor" {
  scope                = azurerm_storage_account.policy_docs.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_linux_web_app.backend.identity[0].principal_id
  principal_type       = "ServicePrincipal"
}

# --------------------------------------------------------------------------
# New — the container Nihitha's storage account is still missing.
# --------------------------------------------------------------------------

# Container names come from the backend's config defaults
# (AZURE_STORAGE_DOCUMENTS_CONTAINER / _RECEIPTS_CONTAINER). All private —
# the API hands out SAS URLs, nothing is publicly readable.
resource "azurerm_storage_container" "app" {
  for_each              = toset(["documents", "receipts", "watermarked"])
  name                  = each.key
  storage_account_id    = azurerm_storage_account.policy_docs.id
  container_access_type = "private"
}

locals {
  rg_id = "/subscriptions/${var.subscription_id}/resourceGroups/${var.resource_group_name}"
}

# Developers need data-plane access to seed and inspect blobs. Resource-group
# Contributor does not grant it — the data plane is a separate permission surface
# from the management plane, which is a common and confusing gap.
resource "azurerm_role_assignment" "developer_blob_access" {
  scope                = azurerm_storage_account.policy_docs.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = data.azurerm_client_config.current.object_id
  principal_type       = "User"
}
