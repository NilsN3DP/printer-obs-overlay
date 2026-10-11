# Architektur

Ein gemeinsamer Kern (Node.js, ohne Laufzeit-Abhängigkeiten) wird auf drei Arten ausgeliefert.

```
                 ┌────────────────────── Kern: src/server ───────────────────────┐
 Drucker  ──►    │ printers/*   Poller ─► Enricher ─► HTTP-API + SSE + Webdateien │ ──► Browser / OBS
 (PrusaLink,     │              ▲           ▲                                     │
  OctoPrint,     │   ConfigStore│  JobMetaService (G-code laden, parsen, cachen)  │
  Moonraker)     └──────────────┴───────────────────────────────────────────────┘
                     Docker-Image │ Windows-Exe (Node SEA) │ OBS-Plugin (startet die Exe)
```

## Betriebsarten (`PO_MODE`)

| Modus | Start | Datenordner | Adresse |
|---|---|---|---|
| `docker` | Container | `/config` | `0.0.0.0:4200` |
| `app` | `printer-overlay.exe` | `%APPDATA%\PrinterOverlay` | `127.0.0.1:4200` |
| `obs` | vom OBS-Plugin | `%APPDATA%\PrinterOverlay` | `127.0.0.1:4217` |
| `dev` | `npm run dev` | `./data` | `0.0.0.0:4200` |

Überschreibbar mit `--port`, `--host`, `--data-dir` bzw. `PORT`, `HOST`, `DATA_DIR`.
App und Plugin teilen sich den Datenordner; Änderungen an `config.json` werden von jedem
laufenden Server nach spätestens zwei Sekunden übernommen.

## Server (`src/server`)

| Datei | Aufgabe |
|---|---|
| `runtime.js` | Modus, Pfade, Port, Version |
| `config/store.js` | `config.json` laden/normalisieren/speichern; Zugangsdaten verlassen den Server nie |
| `config/models.js` | Druckermodelle und Fähigkeiten (Toolchanger, Slots) |
| `printers/*` | Adapter je Schnittstelle → gemeinsames Statusformat; `client.js` mit Digest-Login |
| `telemetry/poller.js` | Fragt alle Drucker zyklisch ab, meldet Änderungen per Event |
| `telemetry/job-meta.js` | Lädt die laufende Druckdatei, parst sie, cacht das Ergebnis |
| `telemetry/gcode/*` | G-code/bgcode lesen (heatshrink, MeatPack), Timeline, Live-Berechnung |
| `telemetry/enrich.js` | Firmware-Werte + Datei-Analyse + Slotplan → Overlay-Felder |
| `app.js` | HTTP-Routen, Server-Sent Events (`/api/stream`) |

### API

| Methode | Pfad | |
|---|---|---|
| GET | `/api/health` | Kurzstatus aller Drucker |
| GET | `/api/status?printer=id` | Vollständiger Status eines Druckers |
| GET | `/api/stream?printer=id` | SSE: `status` bei jeder Abfrage, `config` bei Änderungen |
| GET/PUT | `/api/config` | Konfiguration ohne Zugangsdaten (`apiKeySet`, `passwordSet`) |
| POST | `/api/printers/test` | Verbindungstest ohne Speichern |
| POST | `/api/analyze` | Datei-Check (Rohdaten im Body, Name in `X-Filename`) |
| GET | `/api/discover?cidr=` | Netzwerksuche |
| GET | `/api/camera?printer=id` | Kamerabild über den Server (mit Drucker-Login) |
| GET | `/api/obs/options` | Drucker/Varianten für die OBS-Quelle |

Ändernde Anfragen verlangen `application/json` (außer Upload) und gleiche Herkunft.

## Web (`src/web`)

- `overlay.html` + `overlay/` – das OBS-Overlay. Aussehen: URL-Parameter > Variante > Branding.
- `index.html` + `dashboard/` – Dashboard, eine Datei je Ansicht unter `dashboard/views/`.
- `shared/sections.js` – Bereiche und Link-Aufbau, von beiden genutzt.

## OBS-Plugin (`packaging/obs-plugin`)

C++-Modul für libobs. Registriert die Quelle `printer_overlay_source`, die intern eine
private Browserquelle mit der passenden Overlay-URL betreibt. Beim Laden startet es
`data/server/printer-overlay.exe` unsichtbar (Job-Objekt: endet mit OBS) – es sei denn,
auf Port 4217 oder 4200 läuft schon ein Server, dann wird dieser genutzt.

Gebaut wird gegen die Header der installierten OBS-Version; `build.ps1` erzeugt die
Import-Bibliotheken aus den installierten DLLs.
