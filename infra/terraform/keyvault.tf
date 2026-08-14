# Our own Key Vault, so secrets stay out of Terraform state.
#
# App settings holding a literal secret end up in state: `ignore_changes` stops
# Terraform overwriting a value, but refresh still reads the live value in. A
# Key Vault *reference* is a URI, so state holds only the pointer.
#
# The manager's group7-8 vault can't be used for this — our app identities have no
# access to it and we can't grant it. This vault is in our own resource group where
# we hold Contributor + User Access Administrator.

data "azurerm_client_config" "current" {}

resource "azurerm_key_vault" "main" {
  name                = "qthr-decacore-kv"
  resource_group_name = data.azurerm_resource_group.main.name
  location            = var.app_location
  tenant_id           = data.azurerm_client_config.current.tenant_id
  sku_name            = "standard"

  # RBAC rather than access policies, so grants are ordinary role assignments.
  rbac_authorization_enabled = true

  # Off so the vault can actually be deleted if this project is torn down.
  purge_protection_enabled   = false
  soft_delete_retention_days = 7
}

# Humans who need to write secret values.
resource "azurerm_role_assignment" "kv_admin" {
  scope                = azurerm_key_vault.main.id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = data.azurerm_client_config.current.object_id
  principal_type       = "User"
}

# The app resolves Key Vault references at startup, so it needs read access.
resource "azurerm_role_assignment" "kv_reader" {
  scope                = azurerm_key_vault.main.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_linux_web_app.backend.identity[0].principal_id
  principal_type       = "ServicePrincipal"
}

# Secret *values* are written out of band with `az keyvault secret set`, never through
# Terraform — a value passed through Terraform lands in state, which is the whole
# problem this vault exists to solve.
locals {
  kv_secret_uri = {
    openai_key   = "${azurerm_key_vault.main.vault_uri}secrets/azure-openai-api-key"
    search_key   = "${azurerm_key_vault.main.vault_uri}secrets/azure-search-api-key"
    database_url = "${azurerm_key_vault.main.vault_uri}secrets/database-url"
  }
}
