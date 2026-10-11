#include "http-client.hpp"

#include <windows.h>
#include <winhttp.h>

#include <cctype>
#include <memory>
#include <vector>

namespace printer_overlay {

namespace {

std::wstring widen(const std::string &s)
{
	if (s.empty())
		return {};
	int len = MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), nullptr, 0);
	std::wstring out(len, L'\0');
	MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), out.data(), len);
	return out;
}

struct HInternetDeleter {
	void operator()(HINTERNET h) const
	{
		if (h)
			WinHttpCloseHandle(h);
	}
};
using HInternet = std::unique_ptr<void, HInternetDeleter>;

} // namespace

bool http_get(const std::string &url, std::string &body, int timeout_ms)
{
	body.clear();
	std::wstring wurl = widen(url);

	URL_COMPONENTS parts = {};
	parts.dwStructSize = sizeof(parts);
	wchar_t host[256] = {};
	wchar_t path[2048] = {};
	parts.lpszHostName = host;
	parts.dwHostNameLength = _countof(host);
	parts.lpszUrlPath = path;
	parts.dwUrlPathLength = _countof(path);
	wchar_t extra[2048] = {};
	parts.lpszExtraInfo = extra;
	parts.dwExtraInfoLength = _countof(extra);
	if (!WinHttpCrackUrl(wurl.c_str(), 0, 0, &parts))
		return false;

	HInternet session(WinHttpOpen(L"PrinterOverlay-OBS",WINHTTP_ACCESS_TYPE_NO_PROXY,
				      WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0));
	if (!session)
		return false;
	WinHttpSetTimeouts(session.get(), timeout_ms, timeout_ms, timeout_ms, timeout_ms);

	HInternet connection(WinHttpConnect(session.get(), host, parts.nPort, 0));
	if (!connection)
		return false;

	std::wstring object = std::wstring(path) + extra;
	DWORD flags = parts.nScheme == INTERNET_SCHEME_HTTPS ? WINHTTP_FLAG_SECURE : 0;
	HInternet request(WinHttpOpenRequest(connection.get(), L"GET", object.c_str(), nullptr, WINHTTP_NO_REFERER,
					     WINHTTP_DEFAULT_ACCEPT_TYPES, flags));
	if (!request)
		return false;

	if (!WinHttpSendRequest(request.get(), WINHTTP_NO_ADDITIONAL_HEADERS, 0, WINHTTP_NO_REQUEST_DATA, 0, 0, 0) ||
	    !WinHttpReceiveResponse(request.get(), nullptr))
		return false;

	DWORD status = 0;
	DWORD size = sizeof(status);
	WinHttpQueryHeaders(request.get(), WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, WINHTTP_HEADER_NAME_BY_INDEX,
			    &status, &size, WINHTTP_NO_HEADER_INDEX);

	for (;;) {
		DWORD available = 0;
		if (!WinHttpQueryDataAvailable(request.get(), &available) || available == 0)
			break;
		std::vector<char> chunk(available);
		DWORD read = 0;
		if (!WinHttpReadData(request.get(), chunk.data(), available, &read) || read == 0)
			break;
		body.append(chunk.data(), read);
		if (body.size() > 4 * 1024 * 1024)
			return false;
	}
	return status == 200;
}

std::string url_encode(const std::string &value)
{
	static const char hex[] = "0123456789ABCDEF";
	std::string out;
	for (unsigned char c : value) {
		if (isalnum(c) || c == '-' || c == '_' || c == '.' || c == '~') {
			out += (char)c;
		} else {
			out += '%';
			out += hex[c >> 4];
			out += hex[c & 15];
		}
	}
	return out;
}

} // namespace printer_overlay
