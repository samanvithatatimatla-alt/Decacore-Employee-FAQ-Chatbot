terraform {
  required_version = ">= 1.5"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
    azuread = {
      source  = "hashicorp/azuread"
      version = "~> 3.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # State lives in its own storage account, deliberately NOT managed by Terraform —
  # otherwise a destroy would delete the account holding its own state.
  # Created by hand; see infra/README.md.
  backend "azurerm" {
    resource_group_name  = "DecaCore"
    storage_account_name = "qthrtfstate"
    container_name       = "tfstate"
    key                  = "decacore.tfstate"
    use_azuread_auth     = true
  }
}

provider "azurerm" {
  features {}
  subscription_id = var.subscription_id
  # We hold Contributor on the DecaCore resource group only, not the subscription.
  # Provider registration requires subscription scope, so it must be skipped.
  resource_provider_registrations = "none"
}

provider "azuread" {}
