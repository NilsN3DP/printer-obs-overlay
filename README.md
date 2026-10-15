<p align="center"><img src="docs/logo.png" width="96" alt=""></p>

# Printer OBS Overlay

Live-Werte deiner 3D-Drucker als Stream-Overlay in OBS – im Prusa-Look, mit voller
Unterstützung für Toolchanger (Core One INDX, XL).

- **Drucker:** PrusaLink (MINI, MK3.5, MK4/S, Core One/L, XL), OctoPrint, Klipper/Moonraker
- **Overlay:** Fortschritt, Restzeit, Fertig-Uhrzeit, Düse, Bett, Filament mit Farbe, Layer, Speed, Flow, Z, Lüfter
- **Toolchanger:** aktives Tool, Wechsel x/y, Slot-Leiste mit Farben, Abfallmenge – live aus der Druckdatei berechnet, ohne Spezial-Firmware
- **Dashboard im Browser:** Drucker einrichten, Netzwerksuche, Verbindungstest, Overlay-Varianten, Live-Vorschau, OBS-Link
- **Änderungen erscheinen sofort in OBS** – kein Neuladen der Quelle nötig
- Läuft als **Docker-Container**, **Windows-App** oder direkt als **OBS-Plugin**

## Installation – eine Variante wählen

| | Für wen | Dashboard |
|---|---|---|
| **A. Windows-Installer** | Streaming-PC mit Windows, am einfachsten | Startmenü → *Printer OBS Overlay* |
| **B. Docker** | Unraid, Synology, Raspberry Pi, Server, der immer läuft | `http://<server-ip>:4200` |
| **C. Nur OBS-Plugin** | Alles in OBS, kein separates Programm | OBS → *Werkzeuge* → *Printer Overlay Dashboard* |

### A. Windows

1. `PrinterOBSOverlay-Setup-x.y.z.exe` von den [Releases](https://github.com/NilsN3DP/printer-obs-overlay/releases) herunterladen und ausführen.
2. Auswählen: **Windows-App** und/oder **OBS-Plugin** (beides ist vorausgewählt). Optional: *Beim Anmelden automatisch starten*.
3. Nach der Installation öffnet sich das Dashboard. Die App läuft unsichtbar im Hintergrund; beenden unter *System → Server beenden*.

Ohne Installation geht es auch: `printer-overlay.exe` herunterladen und doppelklicken.
Daten liegen in `%APPDATA%\PrinterOverlay`.

### B. Docker

```bash
docker run -d --name printer-obs-overlay --restart unless-stopped \
  -p 4200:4200 -v /pfad/zu/daten:/config \
  ghcr.io/nilsn3dp/printer-obs-overlay:latest
```

oder mit [`docker-compose.yml`](docker-compose.yml): `docker compose up -d`.

**Unraid:** *Docker → Add Container* und die Werte aus
[`packaging/docker/unraid-template.xml`](packaging/docker/unraid-template.xml) übernehmen
(Port 4200, Pfad `/mnt/user/appdata/printer-obs-overlay` → `/config`). Die Vorlage kann
auch nach `/boot/config/plugins/dockerMan/templates-user/` kopiert werden.

| Variable | Standard | Bedeutung |
|---|---|---|
| `PUBLIC_BASE_URL` | – | Feste Adresse für kopierte OBS-Links, z. B. `http://192.168.1.10:4200` |
| `PUID` / `PGID` | `99` / `100` | Besitzer der Dateien im Datenordner |
| `TZ` | `Europe/Berlin` | Zeitzone für „fertig um …" |
| `PORT` | `4200` | Port im Container |

### C. OBS-Plugin

Im Windows-Installer die Komponente **OBS-Plugin** wählen – oder das Plugin-Zip aus den
Releases nach `C:\ProgramData\obs-studio\plugins\` entpacken. Dann in OBS:

1. *Quelle hinzufügen* → **Printer Overlay**
2. Drucker wählen – fertig. Die Quelle ist automatisch 1920 × 1080.
3. Drucker und Aussehen einrichten: Button *Dashboard öffnen* in der Quelle oder *Werkzeuge → Printer Overlay Dashboard*.

Das Plugin bringt seinen eigenen Server mit und startet/beendet ihn zusammen mit OBS.
Läuft auf dem PC bereits die Windows-App, nutzt das Plugin diese mit. Wer den
Docker-Container verwendet, stellt in der Quelle *Server → Extern* ein und trägt dessen
Adresse ein.

## Einrichten

Beim ersten Öffnen des Dashboards führt ein **Einrichtungsassistent** in drei Schritten durch
Drucker, Aussehen und OBS. Er lässt sich jederzeit unter *System → Einrichtungsassistent*
erneut starten. Alles Weitere:

1. **Drucker:** *Drucker → Im Netzwerk suchen* oder *+ Hinzufügen*. Für PrusaLink Benutzer
   (meist `maker`) und Passwort vom Druckerdisplay unter *Einstellungen → Netzwerk → PrusaLink*.
   Für INDX/XL das passende Modell wählen – dann erscheinen die Toolchanger-Bereiche. Tools,
   Farben und Materialien kommen automatisch aus der Druckdatei.
2. **Overlay & OBS:** Anzeigename, Akzentfarbe und Social-Symbole festlegen. Unter
   *Overlay-Varianten* Layout (Leiste unten oder Karte) und Bereiche wählen; die Vorschau
   zeigt Änderungen vor dem Speichern. Jedem Drucker wird unter *Drucker* eine Variante
   zugewiesen.
3. **In OBS:** Plugin-Quelle verwenden oder *Quelle hinzufügen → Browser* mit dem kopierten
   Link (1920 × 1080).

Der Demo-Drucker (unter *System* ein- und ausschaltbar) zeigt alles mit simulierten INDX-Daten.

### Toolchanger ohne Spezial-Firmware

Bei PrusaLink lädt der Server die laufende Druckdatei (`.gcode`/`.bgcode`) einmal vom
Drucker und berechnet daraus aktives Tool, Wechsel, Layer und Abfall. PrusaLink liefert
Dateien während des Drucks langsam aus – bei großen Dateien kann das einige Minuten dauern;
der Fortschritt steht im Dashboard. Das Ergebnis wird gecacht. Unter *Toolchanger* lassen
sich Dateien vorab prüfen.

## Von Version 1 umsteigen

- Bestehende `config.json` wird unverändert übernommen (Drucker, Zugangsdaten, Presets, Branding).
- Docker: gleicher Datenordner `/config`, gleicher Port. Die alte Variable `CONFIG_PATH` funktioniert weiter.
- Alte OBS-Links (`/overlay.html?printer=…&sections=…`) funktionieren weiter. Neue Links sind kurz
  (`/overlay.html?printer=…`); das Aussehen kommt aus der zugewiesenen Variante.

## Entwicklung

Voraussetzung: Node.js 22+. Der Server hat keine Laufzeit-Abhängigkeiten.

```bash
npm install          # nur Build-Werkzeuge
npm run dev          # Server mit Neustart bei Änderungen, Daten in ./data
npm test
```

| Befehl | Ergebnis |
|---|---|
| `npm run build:exe` | `dist/printer-overlay.exe` (Node SEA, Weboberfläche eingebettet) |
| `npm run build:obs` | `dist/obs-plugin/printer-overlay/` (braucht Visual Studio, CMake, installiertes OBS) |
| `npm run build:installer` | `dist/PrinterOBSOverlay-Setup-x.y.z.exe` (braucht Inno Setup 6) |
| `docker build -t printer-obs-overlay .` | Docker-Image |

Aufbau und Datenfluss: [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md).

## Lizenz

MIT. Schrift: Inter (SIL Open Font License).
