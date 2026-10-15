# Printer OBS Overlay

OBS-Plugin, das die Live-Werte deiner 3D-Drucker als Stream-Overlay zeigt – im Prusa-Look.

- **Drucker:** PrusaLink (MINI, MK3.5, MK4/S, Core One/L, XL), OctoPrint, Klipper/Moonraker
- **Overlay:** Fortschritt, Restzeit, Fertig-Uhrzeit, Düse, Bett, Filament mit Farbe, Layer, Speed, Flow, Z, Lüfter
- **Zwei Layouts:** Leiste über die ganze Breite mit Eckrahmen oder kompakte Karte – skalierbar und frei verschiebbar
- **Dashboard:** Einrichtungsassistent, Netzwerksuche mit Modellerkennung, Verbindungstest, Branding, Overlay-Varianten pro Drucker, Live-Vorschau
- **Änderungen erscheinen sofort in OBS** – ohne die Quelle neu zu laden
- **Toolchanger (optional):** aktives Tool, Wechsel, Slot-Leiste, Abfall – unter *System* einschaltbar

## Installation

1. Die neueste `printer-overlay-obs-plugin-*.zip` unter [Releases](https://github.com/NilsN3DP/printer-obs-overlay/releases) herunterladen.
2. OBS schließen.
3. Zip entpacken und den Ordner `printer-overlay` nach `C:\ProgramData\obs-studio\plugins\` kopieren
   (Administratorrechte bestätigen). Danach muss es so aussehen:
   ```
   C:\ProgramData\obs-studio\plugins\printer-overlay\bin\64bit\printer-overlay.dll
   ```
4. OBS starten. Unter *Werkzeuge → Plugin-Manager → Installiert* erscheint **Printer Overlay**.

Voraussetzungen: Windows 10/11 (64 Bit), OBS Studio 32, Drucker im selben Netzwerk.

## Einrichten

1. **Werkzeuge → Printer Overlay Dashboard** öffnen. Beim ersten Mal führt ein Assistent durch
   Drucker, Aussehen und OBS. Für PrusaLink braucht es Benutzer (meist `maker`) und Passwort vom
   Druckerdisplay unter *Einstellungen → Netzwerk → PrusaLink*.
2. In OBS bei *Quellen* auf **+** → **Printer Overlay** → Drucker wählen → OK.
3. Die Quelle in der Liste ganz nach oben schieben.

Im Dashboard unter *Overlay & OBS* lassen sich Anzeigename, Akzentfarbe, Social-Symbole und
Eckrahmen festlegen. Unter *Overlay-Varianten* werden Layout und Bereiche gewählt; die Karte lässt
sich in der Größe ändern und in der Vorschau mit der Maus verschieben. Jedem Drucker wird unter
*Drucker* eine Variante zugewiesen.

Das Plugin bringt einen eigenen kleinen Server mit, der mit OBS startet und endet. Einstellungen
liegen in `%APPDATA%\PrinterOverlay`.

### Toolchanger (INDX / XL)

Die Toolchanger-Funktionen sind standardmäßig aus und werden unter *System* eingeschaltet.
Sie sind aktuell nur mit Custom-Firmware (CFW) oder über die Auswertung der Druckdatei
nutzbar, da PrusaLink diese Daten nicht liefert.

Bei PrusaLink lädt der Server dafür die laufende Druckdatei (`.gcode`/`.bgcode`) einmal vom
Drucker und berechnet daraus aktives Tool, Wechsel, Layer und Abfall. PrusaLink liefert Dateien
während des Drucks langsam aus – bei großen Dateien kann das einige Minuten dauern; der
Fortschritt steht im Dashboard. Unter *Toolchanger* lassen sich Dateien vorab prüfen.

## Entwicklung

Voraussetzungen: Node.js 22+, für das Plugin zusätzlich Visual Studio (C++), CMake, Git und ein
installiertes OBS Studio.

```bash
npm install
npm run dev
```

`npm run dev` startet den Server mit Dashboard unter `http://localhost:4200` (Daten in `./data`).

| Befehl | Ergebnis |
|---|---|
| `npm test` | Tests (Parser, Adapter, Login, Konfiguration, API) |
| `npm run build` | `dist/obs-plugin/printer-overlay/` und `dist/printer-overlay-obs-plugin-<version>-windows-x64.zip` |

Ein Tag `v*` (z. B. `v2.0.1`) baut das Plugin auf GitHub und hängt das Zip an einen Release.
Aufbau und Datenfluss: [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md).

## Lizenz

MIT. Schrift: Inter (SIL Open Font License).
