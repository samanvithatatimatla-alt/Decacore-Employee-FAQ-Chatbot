variable "subscription_id" {
  description = "Quadrant Internship subscription."
  type        = string
  default     = "7981312c-4577-455a-8bae-10269b74a97b"
}

variable "resource_group_name" {
  description = "Pre-existing resource group. We cannot create resource groups — our rights are scoped to this one."
  type        = string
  default     = "DecaCore"
}

variable "location" {
  description = "Default region. The resource group itself is eastus, but a resource group's region does not constrain what lives inside it."
  type        = string
  default     = "eastus"
}

variable "app_location" {
  description = <<-EOT
    Region for compute. westus, to sit alongside the manager's AI services:
      internaisearch.search.windows.net   -> westus
      sharedfoundry.services.ai.azure.com -> westus
    Every chat request is embed -> search -> completion, so cross-region compute
    adds a round trip per hop.
  EOT
  type        = string
  default     = "westus"
}

variable "prefix" {
  description = "Naming prefix, matching the existing qthr* convention."
  type        = string
  default     = "qthr"
}

variable "cors_origins" {
  description = "Origins allowed to call the API. Local dev ports plus the deployed frontend."
  type        = list(string)
  default = [
    "http://localhost:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ]
}

# Entra values come from Nihitha's DecaCore-HR-Chatbot registration. Not secrets.
variable "entra_tenant_id" {
  type    = string
  default = "0eadb77e-42dc-47f8-bbe3-ec2395e0712c"
}

variable "entra_client_id" {
  type    = string
  default = "efccb481-74ba-45b8-940a-fed5dfbec74e"
}

variable "entra_object_id" {
  type    = string
  default = "2680dbf6-06a6-44b1-abd5-77f56f5b5fd1"
}

# Manager's shared services, read from the group7-8 vault. Endpoints are not secrets.
variable "azure_search_endpoint" {
  type    = string
  default = "https://internaisearch.search.windows.net"
}

variable "azure_openai_endpoint" {
  type    = string
  default = "https://sharedfoundry.services.ai.azure.com"
}

variable "developer_ips" {
  description = <<-EOT
    name => { start, end } public IP range for SQL firewall access during local
    development. A range rather than a single address because carrier-NAT / mobile
    connections move the client IP between sessions. Set in dev.auto.tfvars (gitignored).
  EOT
  type = map(object({
    start = string
    end   = string
  }))
  default = {}
}

variable "devops_federation" {
  description = <<-EOT
    Federated credentials for the Azure DevOps service connection. Azure DevOps
    generates these values when the connection is created, so they are filled in
    afterwards via dev.auto.tfvars. Shape:
      { devops = { issuer = "https://vstoken.dev.azure.com/<org-guid>",
                   subject = "sc://<org>/<project>/<connection-name>" } }
  EOT
  type = map(object({
    issuer  = string
    subject = string
  }))
  default = {}
}
