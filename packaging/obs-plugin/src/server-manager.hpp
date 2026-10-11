#pragma once
#include <string>

namespace printer_overlay {

/**
 * Startet den mitgelieferten Overlay-Server (printer-overlay.exe) unsichtbar im
 * Hintergrund und beendet ihn zusammen mit OBS (Job-Objekt).
 */
class ServerManager {
public:
	static ServerManager &instance();

	void start();
	void stop();

	/** Wartet maximal timeout_ms, bis der Server antwortet. */
	bool wait_ready(int timeout_ms);
	bool is_ready();

	std::string base_url() const;

	static constexpr int kPort = 4217;    // eigener Server des Plugins
	static constexpr int kAppPort = 4200; // Windows-App / Docker auf diesem PC

private:
	ServerManager() = default;
	std::string base_url_ = "http://127.0.0.1:4217";
	void *job_ = nullptr;
	void *process_ = nullptr;
	bool ready_ = false;
};

} // namespace printer_overlay
