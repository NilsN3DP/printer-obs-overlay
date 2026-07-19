# Printer OBS Overlay

Zeigt Live-Werte deiner 3D-Drucker als transparentes Overlay in OBS an:
Druckfortschritt, Restzeit, Düsen-/Bett-Temperatur, Filament (Material + Farbe), Anzahl
Filamentwechsel, Speed, Flow, Z-Höhe und Lüfterdrehzahlen.

Features:
- **Mehrere Drucker** über eine `config.json`
- **Dashboard** (`http://<server>:4200/`): Online-Status, Fortschritt, Jobdatei und OBS-Link je Drucker
- **Konfigurator-Oberfläche**: Drucker wählen, einzelne Bereiche
  an-/abwählen, Live-Vorschau, fertige OBS-URL zum Kopieren
- **Adapter**: `prusalink`, `octoprint`, `moonraker`
- Zwei Layouts: **Leiste** (vollflächige Fußzeile + Rahmen) oder **Karte** (frei platzierbar)
- Läuft als **Docker-Container** (z. B. auf Unraid) oder lokal mit Node.js

## 1. Druckerzugriff vorbereiten

- PrusaLink: API-Key am Display unter **Settings > Network > PrusaLink** oder im PrusaLink-Webinterface.
- OctoPrint: API-Key unter **Settings > Application Keys**.
- Moonraker/Klipper: Host ist meist `<ip>:7125`; API-Key kann leer bleiben, wenn Moonraker lokal offen ist.

## 2. Auf Unraid als Docker betreiben (empfohlen)

### a) Konfiguration anlegen

Lege auf dem Unraid-Server einen Ordner an, z. B.
`/mnt/user/appdata/printer-obs-overlay/`, und darin eine `config.json`
(Vorlage: `config.example.json`):

```json
{
  "pollIntervalMs": 2000,
  "printers": [
    { "id": "coreone", "name": "Core One INDX", "type": "prusalink", "host": "192.168.1.122", "apiKey": "DEIN_KEY" },
    { "id": "octo", "name": "OctoPrint", "type": "octoprint", "host": "192.168.1.140", "apiKey": "KEY_2" },
    { "id": "klipper", "name": "Klipper", "type": "moonraker", "host": "192.168.1.150:7125", "apiKey": "" }
  ]
}
```

`id` = interner Kurzname (frei wählbar, in der URL verwendet), `name` = Anzeigename, `type` = Adapter.

### b) Image bauen und starten

Projektordner auf den Server kopieren, dann:

```
docker compose up -d --build
```

Das `docker-compose.yml` mountet `./config` nach `/config` (dort liegt `config.json`) und
veröffentlicht Port `4200`.

**Alternativ ohne Compose** (z. B. Unraid „Add Container"):
- Repository/Image: `ghcr.io/nilsn3dp/printer-obs-overlay:latest` oder lokal `docker build -t printer-obs-overlay .`
- Port: `4200` -> `4200`
- Volume: Host `/mnt/user/appdata/printer-obs-overlay` -> Container `/config`
- Env (optional): `CONFIG_PATH=/config/config.json`, `PORT=4200`

### c) Öffnen

`http://<unraid-ip>:4200/` -> Dashboard und Konfigurator. Drucker + Bereiche wählen, URL kopieren.

## 3. Lokal ohne Docker (Alternative)

Einzelner Drucker per `.env` (siehe `.env.example`) **oder** mehrere per `config.json`
im Projektordner. Dann:

- **`start-overlay.bat` doppelklicken** (Fenster minimieren, offen lassen), oder
- `npm install && npm start`

## 4. In OBS einbinden

1. Quelle hinzufügen -> **Browser**
2. Im Konfigurator die passende URL erzeugen und einfügen, z. B.
   `http://<server>:4200/overlay.html?printer=coreone&sections=progress,time,nozzle,bed,filament`
3. Breite/Höhe:
   - Layout **Leiste**: exakt deine Canvas-Auflösung (z. B. `1920` x `1080`), Quelle ganz
     nach oben ziehen -> legt sich als Rahmen + Fußzeile über die Szene
   - Layout **Karte**: kleinerer Bereich reicht, frei platzierbar
4. Haken bei "Lokale Datei" **nicht** setzen
5. Optional: "Shutdown source when not visible" deaktivieren

Hintergrund ist transparent; nur die gewählten Bereiche werden gezeichnet.

### URL-Parameter (falls du die URL von Hand baust)

| Parameter  | Beispiel                          | Bedeutung |
|------------|-----------------------------------|-----------|
| `printer`  | `?printer=coreone`                | Drucker-`id` aus der config.json (Standard: erster) |
| `sections` | `&sections=progress,nozzle,bed`   | Nur diese Bereiche zeigen (fehlt = alle) |
| `layout`   | `&layout=card`                    | `bar` (Standard) oder `card` |
| `poll`     | `&poll=2000`                      | Abfrageintervall im Browser (ms) |

Verfügbare Bereiche: `frame`, `brand`, `printerName`, `status`, `file`, `progress`, `time`,
`nozzle`, `bed`, `filament`, `changes`, `tool`, `waste`, `layer`, `speed`, `flow`, `z`, `fanHotend`, `fanPrint`.

Das Branding-Handle (`N3DP_de`) steht in `public/overlay.html`.

## Adapter-Hinweise

### PrusaLink

Liefert die meisten Felder und kann G-Code-Metadaten cachen, wenn die laufende Datei per PrusaLink downloadbar ist. Erweiterte Felder wie Filamentfarbe, Werkzeug, Layer und Waste kommen entweder aus Custom-Firmware oder aus G-Code-Metadaten.

### OctoPrint

Liefert Basisdaten wie State, Fortschritt, Dateiname, Nozzle/Bed und Zeiten. Spezialfelder wie Werkzeugwechsel, Waste oder Filamentfarbe bleiben leer, wenn sie nicht von OctoPrint-Plugins bereitgestellt werden.

### Moonraker/Klipper

Liefert Basisdaten aus `printer/objects/query`. Ohne zusätzliche Klipper/Moonraker-Objekte bleiben Spezialfelder leer.

## Filament-Infos & Wechsel bei PrusaLink Custom-Firmware

Die Boxen "Filament" (Material + Farbpunkt) und "Changes" (Filamentwechsel) benötigen die
Custom-Firmware (Repo `New project/buddy-sparse`, v6.6.1-Basis). Dort liefert die PrusaLink-API
(`/api/v1/status` -> `printer`) zusätzlich:

- `material` - geladener Filamenttyp (z. B. "PLA")
- `filament_color` - zuletzt geladene Farbe als Hex (z. B. "#00AFC7")
- `filament_changes` - abgeschlossene M600-Wechsel seit Druckstart
- `filament_changes_total` - geplante Gesamtzahl (aus Slicer-Metadatum `total toolchanges`);
  das Overlay zeigt dann `x / gesamt`

Mit Original-Firmware fehlen diese Felder; das Overlay zeigt "–".

## INDX-Werkzeugwechsler (Core One+)

Die Anzeige "aktives Werkzeug X/8" ist noch offen - kommt mit den eigenen INDX-Firmware-
Anpassungen (v6.6.1 hat die nötige `VirtualToolIndex`-Basis bereits).

## Fehlerbehebung

- **"Offline" / "fetch failed"**: Drucker nicht erreichbar. Host/IP und API-Key in der
  `config.json` (bzw. `.env`) prüfen; Drucker + Server im selben Netzwerk.
- **HTTP 401**: API-Key falsch oder PrusaLink am Drucker deaktiviert.
- **Konfigurator zeigt "Keine Drucker konfiguriert"**: `config.json` nicht gefunden/leer.
  Bei Docker prüfen, dass das Volume auf `/config` zeigt und `config.json` dort liegt.
- **Werte ändern sich nicht**: Container/Server nach Config-Änderung neu starten.
