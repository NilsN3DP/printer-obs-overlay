# Printer OBS Overlay

Zeigt Live-Werte deiner 3D-Drucker als transparentes Overlay in OBS an:
Druckfortschritt, Restzeit, Düsen-/Bett-Temperatur, Filament (Material + Farbe), Anzahl
Filamentwechsel, Speed, Flow, Z-Höhe und Lüfterdrehzahlen.

Features:
- **Mehrere Drucker** über eine `config.json`
- **Dashboard** (`http://<server>:4200/`): Online-Status, Fortschritt, Jobdatei, Kamera-Link und OBS-Link je Drucker
- **Auswahl oben**: globaler aktiver Drucker plus getrennte Bereiche für Übersicht, Drucker-Setup, Overlay-Builder und Toolchanger-Analyse
- **Web-Setup**: Drucker hinzufügen/bearbeiten/löschen, Config speichern und Verbindung testen
- **Layout-Presets**: Bereiche, Layout, Akzentfarbe, Branding und Social-Auswahl als OBS-Link speichern
- **Branding**: Name und sichtbare Social-Media-Seiten im Dashboard wählen
- **Druckermodelle**: xBuddy-Drucker, Core One INDX und XL-Familie auswählen; Toolchanger-Felder erscheinen nur dort
- **Netzwerksuche**: `/24`-Netz nach PrusaLink, OctoPrint und Moonraker-Kandidaten scannen
- **INDX/XL-G-Code-Analyse**: `.gcode` und `.bgcode` hochladen, Toolchanges, Layer, Waste und erste Tool-Events prüfen
- **Adapter**: `prusalink`, `octoprint`, `moonraker`
- **Demo-Modus** ohne echten Drucker
- Zwei Layouts: **Leiste** (vollflächige Fußzeile + Rahmen) oder **Karte** (frei platzierbar)
- Läuft als **Docker-Container** (z. B. auf Unraid) oder lokal mit Node.js

## 1. Druckerzugriff vorbereiten

- PrusaLink: Benutzername und Passwort aus PrusaLink eintragen. Digest-Login wird unterstützt; ein API-Key kann alternativ weiter genutzt werden.
- OctoPrint: API-Key unter **Settings > Application Keys**.
- Moonraker/Klipper: Host ist meist `<ip>:7125`; API-Key kann leer bleiben, wenn Moonraker lokal offen ist.

## 2. Auf Unraid als Docker betreiben (empfohlen)

### a) Konfiguration anlegen

Lege auf dem Unraid-Server einen Ordner an, z. B.
`/mnt/user/appdata/printer-obs-overlay/`. Beim ersten Start kann die Config leer sein;
das Dashboard schreibt sie nach `/config/config.json`. Alternativ kannst du eine
`config.json` vorab anlegen (Vorlage: `config.example.json`):

```json
{
  "pollIntervalMs": 2000,
  "printers": [
    { "id": "coreone", "name": "Core One INDX", "type": "prusalink", "host": "192.168.1.122", "username": "maker", "password": "DEIN_PASSWORT", "cameraUrl": "" },
    { "id": "octo", "name": "OctoPrint", "type": "octoprint", "host": "192.168.1.140", "apiKey": "KEY_2", "cameraUrl": "" },
    { "id": "klipper", "name": "Klipper", "type": "moonraker", "host": "192.168.1.150:7125", "apiKey": "", "cameraUrl": "" }
  ]
}
```

`id` = interner Kurzname (frei wählbar, in der URL verwendet), `name` = Anzeigename, `type` = Adapter.
API-Keys und Passwörter bleiben nur in dieser Config-Datei und werden im Dashboard nicht im Klartext zurückgegeben.

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

`http://<unraid-ip>:4200/` -> Dashboard. Dort kannst du Drucker anlegen, testen, Presets speichern,
G-Code/INDX-Dateien analysieren und die fertigen OBS-URLs kopieren.

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
| `accent`   | `&accent=%23ffaa00`               | Akzentfarbe als URL-codiertes Hex |
| `brand`    | `&brand=N3DP_de`                  | Branding-Text |
| `socials`  | `&socials=youtube,instagram`      | Sichtbare Socials; `none` blendet alle aus |
| `poll`     | `&poll=2000`                      | Abfrageintervall im Browser (ms) |

Verfügbare Bereiche: `frame`, `brand`, `printerName`, `status`, `file`, `progress`, `time`,
`nozzle`, `bed`, `filament`, `changes`, `tool`, `waste`, `layer`, `speed`, `flow`, `z`, `fanHotend`, `fanPrint`.

Das Branding-Handle kann im Dashboard gesetzt werden; es wird als URL-Parameter an OBS übergeben.

## Adapter-Hinweise

### PrusaLink

Liefert die meisten Felder und kann G-Code-Metadaten cachen, wenn die laufende Datei per PrusaLink downloadbar ist. Für PrusaLink reicht Benutzername/Passwort inklusive Digest-Auth; ein API-Key ist nur noch eine Alternative. Erweiterte Felder wie Filamentfarbe, Werkzeug, Layer und Waste kommen entweder aus Custom-Firmware oder aus G-Code-Metadaten.
Der Standardweg fuer INDX/Toolchange-Prüfung ist der Upload im Dashboard: `.gcode` oder `.bgcode` hochladen und vor dem Stream prüfen, ob Toolchanges, Layer und Waste plausibel erkannt werden.

### OctoPrint

Liefert Basisdaten wie State, Fortschritt, Dateiname, Nozzle/Bed und Zeiten. Spezialfelder wie Werkzeugwechsel, Waste oder Filamentfarbe bleiben leer, wenn sie nicht von OctoPrint-Plugins bereitgestellt werden.

### Moonraker/Klipper

Liefert Basisdaten aus `printer/objects/query`. Ohne zusätzliche Klipper/Moonraker-Objekte bleiben Spezialfelder leer.

## Filament-Infos, INDX & Wechsel

Das Overlay bevorzugt Live-Felder aus Custom-Firmware, wenn sie vorhanden sind. Ohne CFW nutzt
PrusaLink den Dateiweg: laufende Datei downloaden oder Datei im Dashboard hochladen und daraus
Toolchanges, Layer, Material/Farben und Waste ableiten.

Optionale Custom-Firmware-Felder in der PrusaLink-API (`/api/v1/status` -> `printer`):

- `material` - geladener Filamenttyp (z. B. "PLA")
- `filament_color` - zuletzt geladene Farbe als Hex (z. B. "#00AFC7")
- `filament_changes` - abgeschlossene M600-Wechsel seit Druckstart
- `filament_changes_total` - geplante Gesamtzahl (aus Slicer-Metadatum `total toolchanges`);
  das Overlay zeigt dann `x / gesamt`
- `tool` / `tools_total` - aktives Werkzeug für INDX/MMU/Toolchanger
- `waste_fill` / `waste_capacity` - live Wastebin, falls Firmware das liefert

Mit Original-Firmware fehlen diese Live-Felder; bei PrusaLink versucht das Overlay dann die
Ableitung aus G-Code/BGCode. INDX `M8600 S<n>` und normale `T<n>`-Toolwechsel werden erkannt.

## Fehlerbehebung

- **"Offline" / "fetch failed"**: Drucker nicht erreichbar. Host/IP und PrusaLink-Zugang bzw. API-Key in der
  `config.json` (bzw. `.env`) prüfen; Drucker + Server im selben Netzwerk.
- **HTTP 401**: API-Key falsch oder PrusaLink am Drucker deaktiviert.
- **Konfigurator zeigt "Keine Drucker konfiguriert"**: `config.json` nicht gefunden/leer.
  Bei Docker prüfen, dass das Volume auf `/config` zeigt und `config.json` dort liegt.
- **Werte ändern sich nicht**: Dashboard aktualisieren. Nach manuellem Editieren der Config den Container/Server neu starten.
- **INDX zeigt keine Toolchanges**: Datei im Dashboard hochladen. Wenn dort keine Events erkannt werden,
  enthält die Datei vermutlich keine `M8600 S<n>`- oder `T<n>`-Events oder sie sind anders codiert.
