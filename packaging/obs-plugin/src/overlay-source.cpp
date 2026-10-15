// Quelle "Printer Overlay": kapselt eine private Browserquelle und baut deren URL aus
// Drucker und Variante; Daten kommen vom mitgelieferten Server des Plugins.
#include "overlay-source.hpp"
#include "http-client.hpp"
#include "server-manager.hpp"

#include <obs-module.h>

#include <windows.h>
#include <shellapi.h>

#include <string>

namespace printer_overlay {

namespace {

constexpr const char *kSourceId = "printer_overlay_source";

struct OverlaySource {
	obs_source_t *self = nullptr;
	obs_source_t *browser = nullptr;
	uint32_t width = 1920;
	uint32_t height = 1080;
	std::string url;
};

std::string overlay_url(obs_data_t *settings)
{
	std::string url = ServerManager::instance().base_url() + "/overlay.html";
	std::string query;
	const char *printer = obs_data_get_string(settings, "printer");
	const char *preset = obs_data_get_string(settings, "preset");
	if (*printer)
		query += "printer=" + url_encode(printer);
	if (*preset)
		query += std::string(query.empty() ? "" : "&") + "preset=" + url_encode(preset);
	return query.empty() ? url : url + "?" + query;
}

void open_url(const std::string &url)
{
	int len = MultiByteToWideChar(CP_UTF8, 0, url.c_str(), -1, nullptr, 0);
	std::wstring wide(len, L'\0');
	MultiByteToWideChar(CP_UTF8, 0, url.c_str(), -1, wide.data(), len);
	ShellExecuteW(nullptr, L"open", wide.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
}

void apply_browser_settings(OverlaySource *s, obs_data_t *settings)
{
	s->width = (uint32_t)obs_data_get_int(settings, "width");
	s->height = (uint32_t)obs_data_get_int(settings, "height");
	s->url = overlay_url(settings);

	obs_data_t *bs = obs_data_create();
	obs_data_set_bool(bs, "is_local_file", false);
	obs_data_set_string(bs, "url", s->url.c_str());
	obs_data_set_int(bs, "width", s->width);
	obs_data_set_int(bs, "height", s->height);
	obs_data_set_bool(bs, "reroute_audio", false);
	obs_data_set_bool(bs, "shutdown", false);
	obs_data_set_bool(bs, "restart_when_active", false);
	obs_data_set_string(bs, "css", "body { background-color: rgba(0, 0, 0, 0); margin: 0px auto; overflow: hidden; }");
	if (s->browser)
		obs_source_update(s->browser, bs);
	else
		s->browser = obs_source_create_private("browser_source", "printer-overlay-browser", bs);
	obs_data_release(bs);
}

void reload_browser(OverlaySource *s)
{
	if (!s->browser)
		return;
	obs_properties_t *props = obs_source_properties(s->browser);
	obs_property_t *button = props ? obs_properties_get(props, "refreshnocache") : nullptr;
	if (button)
		obs_property_button_clicked(button, s->browser);
	obs_properties_destroy(props);
}

// ---------- Eigenschaften ----------

/** Drucker- und Variantenliste vom Server holen und in die Auswahllisten eintragen. */
void fill_lists(obs_properties_t *props, obs_data_t *settings)
{
	obs_property_t *printers = obs_properties_get(props, "printer");
	obs_property_t *presets = obs_properties_get(props, "preset");
	obs_property_list_clear(printers);
	obs_property_list_clear(presets);
	obs_property_list_add_string(presets, obs_module_text("PresetFromPrinter"), "");

	std::string base = ServerManager::instance().base_url();
	ServerManager::instance().wait_ready(3000);

	std::string body;
	obs_data_t *options = nullptr;
	if (!base.empty() && http_get(base + "/api/obs/options", body, 2000))
		options = obs_data_create_from_json(body.c_str());

	const char *current_printer = obs_data_get_string(settings, "printer");
	const char *current_preset = obs_data_get_string(settings, "preset");
	bool printer_listed = false;
	bool preset_listed = !*current_preset;

	if (!options) {
		size_t idx = obs_property_list_add_string(printers, obs_module_text("ServerUnreachable"), "");
		obs_property_list_item_disable(printers, idx, true);
	} else {
		obs_data_array_t *list = obs_data_get_array(options, "printers");
		for (size_t i = 0, n = obs_data_array_count(list); i < n; i++) {
			obs_data_t *item = obs_data_array_item(list, i);
			const char *id = obs_data_get_string(item, "id");
			obs_property_list_add_string(printers, obs_data_get_string(item, "name"), id);
			printer_listed |= strcmp(id, current_printer) == 0;
			obs_data_release(item);
		}
		obs_data_array_release(list);

		list = obs_data_get_array(options, "presets");
		for (size_t i = 0, n = obs_data_array_count(list); i < n; i++) {
			obs_data_t *item = obs_data_array_item(list, i);
			const char *id = obs_data_get_string(item, "id");
			obs_property_list_add_string(presets, obs_data_get_string(item, "name"), id);
			preset_listed |= strcmp(id, current_preset) == 0;
			obs_data_release(item);
		}
		obs_data_array_release(list);
		obs_data_release(options);
	}
	// Gespeicherte Auswahl nicht verlieren, wenn der Server sie (noch) nicht kennt.
	if (*current_printer && !printer_listed)
		obs_property_list_add_string(printers, current_printer, current_printer);
	if (!preset_listed)
		obs_property_list_add_string(presets, current_preset, current_preset);
}

bool refresh_clicked(obs_properties_t *props, obs_property_t *, void *data)
{
	auto *s = static_cast<OverlaySource *>(data);
	obs_data_t *settings = obs_source_get_settings(s->self);
	fill_lists(props, settings);
	obs_data_release(settings);
	reload_browser(s);
	return true;
}

bool dashboard_clicked(obs_properties_t *, obs_property_t *, void *data)
{
	(void)data;
	open_dashboard();
	return false;
}

obs_properties_t *get_properties(void *data)
{
	obs_properties_t *props = obs_properties_create();

	obs_properties_add_list(props, "printer", obs_module_text("Printer"), OBS_COMBO_TYPE_LIST, OBS_COMBO_FORMAT_STRING);
	obs_properties_add_list(props, "preset", obs_module_text("Preset"), OBS_COMBO_TYPE_LIST, OBS_COMBO_FORMAT_STRING);

	obs_properties_add_int(props, "width", obs_module_text("Width"), 320, 7680, 1);
	obs_properties_add_int(props, "height", obs_module_text("Height"), 180, 4320, 1);

	obs_properties_add_button2(props, "refresh", obs_module_text("Refresh"), refresh_clicked, data);
	obs_properties_add_button2(props, "dashboard", obs_module_text("OpenDashboard"), dashboard_clicked, data);

	if (data) {
		obs_data_t *settings = obs_source_get_settings(static_cast<OverlaySource *>(data)->self);
		fill_lists(props, settings);
		obs_data_release(settings);
	}
	return props;
}

void get_defaults(obs_data_t *settings)
{
	obs_data_set_default_string(settings, "printer", "");
	obs_data_set_default_string(settings, "preset", "");
	obs_data_set_default_int(settings, "width", 1920);
	obs_data_set_default_int(settings, "height", 1080);
}

// ---------- Lebenszyklus ----------

void *create(obs_data_t *settings, obs_source_t *source)
{
	auto *s = new OverlaySource();
	s->self = source;
	// Beim OBS-Start kann der eingebaute Server noch hochfahren - kurz warten,
	// damit die Browserquelle nicht mit einer Fehlerseite startet.
	ServerManager::instance().wait_ready(5000);
	apply_browser_settings(s, settings);
	if (s->browser)
		obs_source_add_active_child(source, s->browser);
	return s;
}

void destroy(void *data)
{
	auto *s = static_cast<OverlaySource *>(data);
	if (s->browser) {
		obs_source_remove_active_child(s->self, s->browser);
		obs_source_release(s->browser);
	}
	delete s;
}

void update(void *data, obs_data_t *settings)
{
	apply_browser_settings(static_cast<OverlaySource *>(data), settings);
}

uint32_t get_width(void *data)
{
	return static_cast<OverlaySource *>(data)->width;
}

uint32_t get_height(void *data)
{
	return static_cast<OverlaySource *>(data)->height;
}

void video_render(void *data, gs_effect_t *)
{
	auto *s = static_cast<OverlaySource *>(data);
	if (s->browser)
		obs_source_video_render(s->browser);
}

void enum_sources(void *data, obs_source_enum_proc_t callback, void *param)
{
	auto *s = static_cast<OverlaySource *>(data);
	if (s->browser)
		callback(s->self, s->browser, param);
}

const char *get_name(void *)
{
	return obs_module_text("SourceName");
}

} // namespace

void register_overlay_source()
{
	obs_source_info info = {};
	info.id = kSourceId;
	info.type = OBS_SOURCE_TYPE_INPUT;
	info.output_flags = OBS_SOURCE_VIDEO | OBS_SOURCE_CUSTOM_DRAW | OBS_SOURCE_SRGB | OBS_SOURCE_DO_NOT_DUPLICATE;
	info.icon_type = OBS_ICON_TYPE_BROWSER;
	info.get_name = get_name;
	info.create = create;
	info.destroy = destroy;
	info.update = update;
	info.get_defaults = get_defaults;
	info.get_properties = get_properties;
	info.get_width = get_width;
	info.get_height = get_height;
	info.video_render = video_render;
	info.enum_active_sources = enum_sources;
	info.enum_all_sources = enum_sources;
	obs_register_source(&info);
}

void open_dashboard()
{
	ServerManager::instance().wait_ready(3000);
	open_url(ServerManager::instance().base_url() + "/");
}

} // namespace printer_overlay
