// Einstieg des OBS-Plugins: Quelle registrieren, Server starten, Menuepunkt anlegen.
#include <obs-module.h>
#include <obs-frontend-api.h>

#include "overlay-source.hpp"
#include "server-manager.hpp"

OBS_DECLARE_MODULE()
OBS_MODULE_USE_DEFAULT_LOCALE("printer-overlay", "en-US")

MODULE_EXPORT const char *obs_module_name(void)
{
	return "Printer Overlay";
}

MODULE_EXPORT const char *obs_module_description(void)
{
	return obs_module_text("Description");
}

bool obs_module_load(void)
{
	printer_overlay::ServerManager::instance().start();
	printer_overlay::register_overlay_source();
	obs_frontend_add_tools_menu_item(
		obs_module_text("ToolsMenu"), [](void *) { printer_overlay::open_dashboard(); }, nullptr);
	blog(LOG_INFO, "[printer-overlay] Plugin geladen (Version %s)", PLUGIN_VERSION);
	return true;
}

void obs_module_unload(void)
{
	printer_overlay::ServerManager::instance().stop();
}
