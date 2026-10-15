# Changelog

## 2.0.0

Komplett neu aufgebaut – gleiche Funktionen, einfacher zu installieren und zu bedienen.

**Neu**
- Drei Installationswege: Windows-Installer (App und/oder OBS-Plugin), Docker-Image (amd64 + arm64), natives OBS-Plugin
- OBS-Plugin mit eigener Quelle „Printer Overlay": Drucker wählen, fertig; Dashboard über das Werkzeuge-Menü
- Live-Updates per Server-Sent Events; Änderungen im Dashboard erscheinen ohne Neuladen in OBS
- Einrichtungsassistent beim ersten Start (Drucker, Aussehen, OBS)
- Dashboard neu: Übersicht, Drucker-Editor mit Netzwerksuche und Verbindungstest, zentrales Branding, Overlay-Varianten pro Drucker, Live-Vorschau vor dem Speichern
- Kurze OBS-Links (`/overlay.html?printer=…`)
- Datei-Check zeigt Abfall pro Wechsel und übernimmt ihn auf Wunsch als Fallback
- Slot-Leiste wird aus der Druckdatei abgeleitet – kein manueller Slotplan mehr nötig
- Keine Vorbelegung mit Anzeigename oder Social-Symbolen
- Fortschrittsanzeige beim Laden der Druckdatei vom Drucker
- Autostart für die Windows-App (im Installer oder unter System)
- Docker: läuft nicht mehr als root (PUID/PGID), Healthcheck, Zeitzone

**Technik**
- Keine Laufzeit-Abhängigkeiten mehr (Express, Multer, dotenv entfernt)
- Server in Module aufgeteilt, automatische Tests für Parser, Adapter, Digest-Login, Konfiguration und API
- Zugangsdaten werden nie an den Browser gesendet
- Mehrere Server mit gleichem Datenordner bleiben synchron

**Entfernt**
- Kamera-URL und Slotplan im Dashboard

**Kompatibilität**
- `config.json` aus Version 1 wird übernommen, alte OBS-Links funktionieren weiter
- Docker: gleicher Port und Datenordner, `CONFIG_PATH` wird weiter unterstützt
