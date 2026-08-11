# Identity that the Azure DevOps backend pipeline authenticates as.
#
# The service connection itself can't be created here — that needs an Azure DevOps
# PAT and the azuredevops provider. What Terraform owns is the Entra side: the app
# registration, its service principal, and a role assignment scoped to this resource
# group only, so a compromised pipeline cannot reach anything else in the subscription.
#
# Completing the link is a two-way handshake, because Azure DevOps generates the
# federated subject: create the service connection in DevOps first, then feed the
# Issuer and Subject Identifier it shows back in via var.devops_federation.
# See infra/README.md.

resource "azuread_application" "pipeline" {
  display_name = "decacore-pipeline-deploy"
  owners       = [data.azurerm_client_config.current.object_id]
}

resource "azuread_service_principal" "pipeline" {
  client_id = azuread_application.pipeline.client_id
  owners    = [data.azurerm_client_config.current.object_id]
}

# Contributor on the resource group, not the subscription. Enough to deploy to the
# App Service and its slots; nothing beyond DecaCore.
resource "azurerm_role_assignment" "pipeline_deploy" {
  scope                = data.azurerm_resource_group.main.id
  role_definition_name = "Contributor"
  principal_id         = azuread_service_principal.pipeline.object_id
  principal_type       = "ServicePrincipal"
}

# Federated credentials — no client secret to store or rotate. Empty until the
# DevOps service connection exists and its issuer/subject are known.
resource "azuread_application_federated_identity_credential" "devops" {
  for_each = var.devops_federation

  application_id = azuread_application.pipeline.id
  display_name   = each.key
  audiences      = ["api://AzureADTokenExchange"]
  issuer         = each.value.issuer
  subject        = each.value.subject
}
