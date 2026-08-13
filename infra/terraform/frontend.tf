# Static hosting for the frontend, deployed by GitHub Actions.
#
# Static Web Apps rather than a second App Service: it is free, needs no compute to
# serve static files, and handles SPA fallback routing. It also can't be GitHub Pages —
# the repo is private, and Pages does not publish private repos on the Free plan.
#
# Static Web Apps is only offered in a handful of regions; westus2 is the closest to
# the westus compute and the westus AI services.
resource "azurerm_static_web_app" "frontend" {
  name                = "${var.prefix}-faq-web"
  resource_group_name = data.azurerm_resource_group.main.name
  location            = "westus2"

  sku_tier = "Free"
  sku_size = "Free"
}
