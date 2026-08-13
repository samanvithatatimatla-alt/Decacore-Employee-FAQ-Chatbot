# Azure SQL, created by hand outside Terraform and adopted here.
#
# The *server* is referenced, not managed. azurerm_mssql_server requires
# administrator_login_password, which Azure never returns — managing it would mean
# putting a placeholder in config that Terraform then tries to apply, silently
# resetting the SQL admin password. The database and firewall rules carry the
# settings we actually need to control, so the server stays a data source.
data "azurerm_mssql_server" "main" {
  name                = "decacore-sql-server"
  resource_group_name = data.azurerm_resource_group.main.name
}

import {
  to = azurerm_mssql_database.main
  id = "${local.rg_id}/providers/Microsoft.Sql/servers/decacore-sql-server/databases/decacore-db"
}

resource "azurerm_mssql_database" "main" {
  name      = "decacore-db"
  server_id = data.azurerm_mssql_server.main.id

  # S0 = Standard tier, 10 DTU. The build plan called for Basic (~$5/mo vs ~$15);
  # downsize by changing this to "Basic" if the cost matters.
  sku_name     = "S0"
  max_size_gb  = 20
  collation    = "SQL_Latin1_General_CP1_CI_AS"
  license_type = null

  # Matches how the server was created. The provider defaults this to "Geo", which
  # would silently switch on geo-redundant backups and their cost.
  storage_account_type = "Local"

  # Guards against a `terraform destroy` taking the demo data with it.
  lifecycle {
    prevent_destroy = true
  }
}

# Lets Azure-hosted services (our App Service and its dev slot) reach the server.
# The 0.0.0.0-0.0.0.0 range is Azure's magic value for "allow Azure services",
# not a literal any-address rule.
resource "azurerm_mssql_firewall_rule" "azure_services" {
  name             = "AllowAzureServices"
  server_id        = data.azurerm_mssql_server.main.id
  start_ip_address = "0.0.0.0"
  end_ip_address   = "0.0.0.0"
}

# Developer machines, for local work against the shared database. Values live in
# dev.auto.tfvars, which .gitignore excludes — home IPs don't belong in the repo.
resource "azurerm_mssql_firewall_rule" "developers" {
  for_each = var.developer_ips

  name             = each.key
  server_id        = data.azurerm_mssql_server.main.id
  start_ip_address = each.value.start
  end_ip_address   = each.value.end
}
