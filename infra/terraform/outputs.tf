output "backend_url" {
  description = "FastAPI backend. Deploy target for the Azure Pipelines backend pipeline."
  value       = "https://${azurerm_linux_web_app.backend.default_hostname}"
}

output "backend_principal_id" {
  description = "Managed identity of the backend. Grant this role assignments on external resources."
  value       = azurerm_linux_web_app.backend.identity[0].principal_id
}

output "blob_containers" {
  description = "Private containers the API reads and writes via managed identity."
  value       = [for c in azurerm_storage_container.app : c.name]
}

output "frontend_url" {
  description = "Static Web App. Deployed by GitHub Actions from frontend/."
  value       = "https://${azurerm_static_web_app.frontend.default_host_name}"
}

output "pipeline_client_id" {
  description = "Application (client) ID for the Azure DevOps service connection."
  value       = azuread_application.pipeline.client_id
}
