# Architektur

Das OBS-Plugin (C++) startet einen kleinen Overlay-Server (Node.js, als Einzel-Exe gebaut, ohne
Laufzeit-Abhängigkeiten). Der Server fragt die Drucker ab und liefert Dashboard und Overlay aus;
die Quelle „Printer Overlay“ zeigt das Overlay über eine private Browserquelle an.

```
                 ┌────────────────────── Server: src/server ─────────────────────┐
 Drucker  ──►    │ printers/*   Poller ─► Enricher ─► HTTP-API + SSE + Webdateien │ ──► OBS-Quelle / Dashboard
 (PrusaLink,     │              ▲           ▲                                     │
  OctoPrint,     │   ConfigStore│  JobMetaService (G-code laden, parsen, cachen)  │
  Moonraker)     └──────────────┴───────────────────────────────────────────────┘
                              gestartet und beendet vom OBS-Plugin (packaging/obs-plugin)
```

## Betriebsarten (`PO_MODE`)

| Modus | Start | Datenordner | Adresse |
|---|---|---|---|
| `obs` | vom OBS-Plugin (Einzel-Exe) | `%APPDATA%\PrinterOverlay` | `127.0.0.1:4217` |
| `dev` | `npm run dev` | `./data` | `127.0.0.1:4200` |

Überschreibbar mit `--port`, `--host`, `--data-dir` bzw. `PORT`, `HOST`, `DATA_DIR`.
Änderungen an `config.json` werden vom laufenden Server nach spätestens zwei Sekunden übernommen.

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
| `telemetry/enrich.js` | Firmware-Werte + Datei-Analyse (inkl. Slots) → Overlay-Felder |
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
| GET | `/api/obs/options` | Drucker/Varianten für die OBS-Quelle |

Ändernde Anfragen verlangen `application/json` (außer Upload) und gleiche Herkunft.

## Web (`src/web`)

- `overlay.html` + `overlay/` – das OBS-Overlay. Aussehen: URL-Parameter > Variante > Branding.
- `index.html` + `dashboard/` – Dashboard, eine Datei je Ansicht unter `dashboard/views/`, Assistent in `dashboard/wizard.js`.
- `shared/sections.js` – Bereiche und Link-Aufbau, von beiden genutzt.

## OBS-Plugin (`packaging/obs-plugin`)

C++-Modul für libobs. Registriert die Quelle `printer_overlay_source`, die intern eine
private Browserquelle mit der passenden Overlay-URL betreibt. Beim Laden startet es
`data/server/printer-overlay.exe` unsichtbar auf Port 4217 (Job-Objekt: endet mit OBS); ein
Wächter startet ihn neu, falls er beendet wird. Läuft auf 4217 schon ein Server (zweite
OBS-Instanz), wird dieser mitbenutzt.

Gebaut wird gegen die Header der installierten OBS-Version; `build.ps1` erzeugt die
Import-Bibliotheken aus den installierten DLLs.
