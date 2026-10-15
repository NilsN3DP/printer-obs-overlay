#include "server-manager.hpp"
#include "http-client.hpp"

#include <obs-module.h>
#include <util/platform.h>

#include <windows.h>

#include <chrono>
#include <mutex>
#include <cwchar>
#include <thread>

namespace printer_overlay {

namespace {

std::wstring widen(const char *s)
{
	wchar_t *w = nullptr;
	os_utf8_to_wcs_ptr(s, 0, &w);
	std::wstring out = w ? w : L"";
	bfree(w);
	return out;
}

/** Aktuelle Umgebung + PO_MODE=obs als Unicode-Umgebungsblock. */
std::wstring environment_block()
{
	std::wstring env;
	LPWCH current = GetEnvironmentStringsW();
	for (LPWCH p = current; p && *p; p += wcslen(p) + 1) {
		if (_wcsnicmp(p, L"PO_MODE=", 8) == 0 || _wcsnicmp(p, L"NODE_OPTIONS=", 13) == 0)
			continue;
		env.append(p);
		env.push_back(L'\0');
	}
	FreeEnvironmentStringsW(current);
	env.append(L"PO_MODE=obs");
	env.push_back(L'\0');
	env.push_back(L'\0');
	return env;
}

} // namespace

ServerManager &ServerManager::instance()
{
	static ServerManager manager;
	return manager;
}

std::string ServerManager::base_url() const
{
	return base_url_;
}

static bool answers(const std::string &base, int timeout_ms)
{
	std::string body;
	return http_get(base + "/api/health", body, timeout_ms) && body.find("printer-obs-overlay") != std::string::npos;
}

bool ServerManager::is_ready()
{
	if (!ready_)
		ready_ = answers(base_url_, 800);
	return ready_;
}

bool ServerManager::wait_ready(int timeout_ms)
{
	auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(timeout_ms);
	while (!is_ready()) {
		if (std::chrono::steady_clock::now() >= deadline)
			return false;
		std::this_thread::sleep_for(std::chrono::milliseconds(100));
	}
	return true;
}

void ServerManager::start()
{
	{
		std::lock_guard<std::mutex> lock(mutex_);
		ensure_running_locked();
	}
	// Waechter: startet den Server neu, falls er beendet wurde oder abstuerzt.
	stopping_ = false;
	watchdog_ = std::thread([this] {
		std::unique_lock<std::mutex> lock(mutex_);
		while (!wake_.wait_for(lock, std::chrono::seconds(5), [this] { return stopping_.load(); }))
			ensure_running_locked();
	});
}

void ServerManager::ensure_running_locked()
{
	if (process_ && WaitForSingleObject((HANDLE)process_, 0) == WAIT_TIMEOUT)
		return; // eigener Server laeuft
	if (process_) {
		blog(LOG_WARNING, "[printer-overlay] Server wurde beendet - starte neu");
		CloseHandle((HANDLE)process_);
		process_ = nullptr;
		ready_ = false;
	}
	// Zweite OBS-Instanz: deren Server auf demselben Port mitbenutzen.
	if (answers(base_url_, 600)) {
		ready_ = true;
		return;
	}
	ready_ = false;
	spawn_locked();
}

void ServerManager::spawn_locked()
{
	char *exe = obs_module_file("server/printer-overlay.exe");
	if (!exe) {
		blog(LOG_ERROR, "[printer-overlay] server/printer-overlay.exe fehlt im Plugin-Ordner");
		return;
	}
	std::wstring exe_w = widen(exe);
	bfree(exe);
	// Ohne --data-dir: gleicher Datenordner wie die Windows-App (%APPDATA%\PrinterOverlay).
	std::wstring command = L"\"" + exe_w + L"\" --background --port " + std::to_wstring(kPort);
	std::wstring env = environment_block();

	if (!job_) {
		// Job-Objekt: Server endet automatisch mit OBS, auch nach einem Absturz.
		HANDLE job = CreateJobObjectW(nullptr, nullptr);
		if (job) {
			JOBOBJECT_EXTENDED_LIMIT_INFORMATION info = {};
			info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
			SetInformationJobObject(job, JobObjectExtendedLimitInformation, &info, sizeof(info));
			job_ = job;
		}
	}

	STARTUPINFOW si = {};
	si.cb = sizeof(si);
	PROCESS_INFORMATION pi = {};
	BOOL ok = CreateProcessW(nullptr, command.data(), nullptr, nullptr, FALSE,
				 CREATE_NO_WINDOW | CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT, env.data(), nullptr, &si,
				 &pi);
	if (!ok) {
		blog(LOG_ERROR, "[printer-overlay] Server konnte nicht gestartet werden (Fehler %lu)", GetLastError());
		return;
	}
	if (job_)
		AssignProcessToJobObject((HANDLE)job_, pi.hProcess);
	ResumeThread(pi.hThread);
	CloseHandle(pi.hThread);
	process_ = pi.hProcess;
	blog(LOG_INFO, "[printer-overlay] Server gestartet (Port %d)", kPort);
}

void ServerManager::stop()
{
	{
		std::lock_guard<std::mutex> lock(mutex_);
		stopping_ = true;
	}
	wake_.notify_all();
	if (watchdog_.joinable())
		watchdog_.join();
	ready_ = false;
	if (process_) {
		TerminateProcess((HANDLE)process_, 0);
		WaitForSingleObject((HANDLE)process_, 2000);
		CloseHandle((HANDLE)process_);
		process_ = nullptr;
	}
	if (job_) {
		CloseHandle((HANDLE)job_);
		job_ = nullptr;
	}
}

} // namespace printer_overlay
