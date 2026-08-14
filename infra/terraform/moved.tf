# The dev slot's removal collapsed these from for_each maps to single resources.
# Without these blocks Terraform would destroy and recreate the production grants,
# briefly leaving the live app unable to read Key Vault or Blob. A moved block
# renames the state address only — Azure is never touched.
moved {
  from = azurerm_role_assignment.blob_contributor["prod"]
  to   = azurerm_role_assignment.blob_contributor
}

moved {
  from = azurerm_role_assignment.kv_reader["prod"]
  to   = azurerm_role_assignment.kv_reader
}
