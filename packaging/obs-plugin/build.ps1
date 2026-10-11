<#
  Baut das OBS-Plugin "Printer Overlay" fuer Windows x64.

  Voraussetzungen: Visual Studio 2022/2026 (C++), CMake, Git, installiertes OBS Studio.
  Es wird kein kompletter OBS-Build benoetigt: die libobs-Header passend zur installierten
  OBS-Version werden geladen und Import-Bibliotheken aus den installierten DLLs erzeugt.

  Ergebnis: dist\obs-plugin\printer-overlay\  (Ordnerstruktur fuer %ProgramData%\obs-studio\plugins)
#>
param(
  [string]$ObsDir = "$env:ProgramFiles\obs-studio",
  [string]$ObsTag = "",
  [string]$Config = "Release"
)

$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$root = Resolve-Path "$here\..\.."
$deps = Join-Path $here ".deps"
$build = Join-Path $here "build"
$stage = Join-Path $root "dist\obs-plugin\printer-overlay"

function Step($msg) { Write-Host "> $msg" -ForegroundColor Cyan }

# --- OBS-Installation und Version ---
$obsDll = Join-Path $ObsDir "bin\64bit\obs.dll"
$frontendDll = Join-Path $ObsDir "bin\64bit\obs-frontend-api.dll"
if (-not (Test-Path $obsDll)) { throw "OBS nicht gefunden unter $ObsDir (Parameter -ObsDir)" }
if (-not $ObsTag) {
  $ver = (Get-Item $obsDll).VersionInfo.ProductVersion
  if ($ver -notmatch '^(\d+\.\d+\.\d+)') { throw "OBS-Version nicht lesbar ($ver) - Parameter -ObsTag angeben" }
  $ObsTag = $Matches[1]
}
Step "OBS $ObsTag aus $ObsDir"

# --- Visual Studio Werkzeuge ---
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$vs = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vs) { throw "Visual Studio mit C++-Werkzeugen nicht gefunden" }
$msvc = Get-ChildItem "$vs\VC\Tools\MSVC" | Sort-Object Name -Descending | Select-Object -First 1
$bin = Join-Path $msvc.FullName "bin\Hostx64\x64"

# --- libobs-Header ---
$obsSrc = Join-Path $deps "obs-studio-$ObsTag"
if (-not (Test-Path (Join-Path $obsSrc "libobs\obs-module.h"))) {
  Step "Lade libobs-Header ($ObsTag)"
  if (Test-Path $obsSrc) { Remove-Item -Recurse -Force $obsSrc }
  New-Item -ItemType Directory -Force $deps | Out-Null
  git clone --quiet --depth 1 --branch $ObsTag --filter=blob:none --sparse https://github.com/obsproject/obs-studio.git $obsSrc
  if ($LASTEXITCODE) { throw "git clone fehlgeschlagen" }
  git -C $obsSrc sparse-checkout set libobs frontend/api
  if ($LASTEXITCODE) { throw "git sparse-checkout fehlgeschlagen" }
}

# obsconfig.h wird sonst von OBS' eigenem CMake erzeugt.
$gen = Join-Path $deps "generated-$ObsTag"
New-Item -ItemType Directory -Force $gen | Out-Null
Set-Content -Encoding ascii (Join-Path $gen "obsconfig.h") "#pragma once`n#define OBS_RELEASE_CANDIDATE 0`n#define OBS_BETA 0`n"

# --- Import-Bibliotheken aus den installierten DLLs ---
function New-ImportLib($dll, $name) {
  $def = Join-Path $gen "$name.def"
  $lib = Join-Path $gen "$name.lib"
  if (Test-Path $lib) { return }
  Step "Erzeuge $name.lib"
  $exports = & "$bin\dumpbin.exe" /nologo /exports $dll |
    ForEach-Object { if ($_ -match '^\s+\d+\s+[0-9A-Fa-f]+\s+[0-9A-Fa-f]{8}\s+(\S+)') { $Matches[1] } }
  Set-Content -Encoding ascii $def (@("LIBRARY $name", "EXPORTS") + $exports)
  & "$bin\lib.exe" /nologo /def:$def /machine:x64 /out:$lib | Out-Null
  if ($LASTEXITCODE) { throw "lib.exe fehlgeschlagen fuer $name" }
}
New-ImportLib $obsDll "obs"
New-ImportLib $frontendDll "obs-frontend-api"

# --- Kompilieren ---
Step "CMake konfigurieren und bauen"
cmake -S $here -B $build -A x64 `
  "-DOBS_SOURCE_DIR=$obsSrc" "-DOBS_IMPORT_DIR=$gen" "-DOBS_CONFIG_DIR=$gen" | Out-Host
if ($LASTEXITCODE) { throw "CMake-Konfiguration fehlgeschlagen" }
cmake --build $build --config $Config | Out-Host
if ($LASTEXITCODE) { throw "Build fehlgeschlagen" }

# --- Server-Exe (gemeinsamer Kern) ---
$serverExe = Join-Path $root "dist\printer-overlay.exe"
if (-not (Test-Path $serverExe)) {
  Step "Server-Exe fehlt - baue sie"
  Push-Location $root
  try { node scripts/build.mjs exe } finally { Pop-Location }
  if ($LASTEXITCODE) { throw "Server-Exe konnte nicht gebaut werden" }
}

# --- Plugin-Ordner zusammenstellen ---
Step "Stelle Plugin zusammen: $stage"
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force "$stage\bin\64bit", "$stage\data\server" | Out-Null
Copy-Item (Join-Path $build "$Config\printer-overlay.dll") "$stage\bin\64bit\"
Copy-Item -Recurse (Join-Path $here "data\locale") "$stage\data\"
Copy-Item $serverExe "$stage\data\server\printer-overlay.exe"

Write-Host "Fertig. Zum Testen den Ordner nach %ProgramData%\obs-studio\plugins\ kopieren." -ForegroundColor Green
