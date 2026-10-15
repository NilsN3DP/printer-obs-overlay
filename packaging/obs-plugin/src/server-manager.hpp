#pragma once
#include <atomic>
#include <condition_variable>
#include <mutex>
#include <string>
#include <thread>

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

	static constexpr int kPort = 4217; // eigener Server des Plugins

private:
	ServerManager() = default;
	std::string base_url_ = "http://127.0.0.1:4217";
	void ensure_running_locked();
	void spawn_locked();

	void *job_ = nullptr;
	void *process_ = nullptr;
	std::atomic<bool> ready_ = false;
	std::atomic<bool> stopping_ = false;
	std::mutex mutex_;
	std::condition_variable wake_;
	std::thread watchdog_;
};

} // namespace printer_overlay
