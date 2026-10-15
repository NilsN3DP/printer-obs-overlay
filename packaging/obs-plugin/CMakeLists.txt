# Natives OBS-Plugin "Printer Overlay" (Windows x64).
# Baut gegen die libobs-Header der installierten OBS-Version; Import-Bibliotheken werden
# von build.ps1 aus den installierten DLLs erzeugt (kein kompletter OBS-Build noetig).
cmake_minimum_required(VERSION 3.24)
project(printer-overlay VERSION 2.0.0 LANGUAGES CXX)

set(OBS_SOURCE_DIR "" CACHE PATH "obs-studio Quellordner (libobs + frontend/api)")
set(OBS_IMPORT_DIR "" CACHE PATH "Ordner mit obs.lib und obs-frontend-api.lib")
set(OBS_CONFIG_DIR "" CACHE PATH "Ordner mit generiertem obsconfig.h")

if(NOT OBS_SOURCE_DIR OR NOT OBS_IMPORT_DIR OR NOT OBS_CONFIG_DIR)
  message(FATAL_ERROR "Bitte ueber packaging/obs-plugin/build.ps1 bauen.")
endif()

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

add_library(printer-overlay MODULE
  src/plugin-main.cpp
  src/overlay-source.cpp
  src/server-manager.cpp
  src/http-client.cpp
  src/plugin.rc
)

target_include_directories(printer-overlay PRIVATE
  "${OBS_CONFIG_DIR}"
  "${OBS_SOURCE_DIR}/libobs"
  "${OBS_SOURCE_DIR}/frontend/api"
)

target_compile_definitions(printer-overlay PRIVATE
  UNICODE _UNICODE NOMINMAX WIN32_LEAN_AND_MEAN
  PLUGIN_VERSION="${PROJECT_VERSION}"
)

target_compile_options(printer-overlay PRIVATE /W3 /utf-8 /wd4996)

target_link_libraries(printer-overlay PRIVATE
  "${OBS_IMPORT_DIR}/obs.lib"
  "${OBS_IMPORT_DIR}/obs-frontend-api.lib"
  winhttp
  shell32
)

set_target_properties(printer-overlay PROPERTIES PREFIX "" OUTPUT_NAME "printer-overlay")
