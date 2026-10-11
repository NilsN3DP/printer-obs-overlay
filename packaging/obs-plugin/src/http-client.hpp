#pragma once
#include <string>

namespace printer_overlay {

/** Einfacher HTTP-GET (WinHTTP). Liefert true bei Status 200 und fuellt body. */
bool http_get(const std::string &url, std::string &body, int timeout_ms = 1500);

/** URL-Kodierung fuer Query-Parameter. */
std::string url_encode(const std::string &value);

} // namespace printer_overlay
