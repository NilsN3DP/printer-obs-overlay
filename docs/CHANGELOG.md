# Changelog

## 2.0.0

Komplett neu aufgebaut – als reines OBS-Plugin.

**Neu**
- OBS-Plugin mit eigener Quelle „Printer Overlay“: Drucker wählen, fertig; Dashboard über *Werkzeuge*
- Mitgelieferter Overlay-Server, startet und endet mit OBS, wird bei Bedarf automatisch neu gestartet
- Live-Updates per Server-Sent Events; Änderungen im Dashboard erscheinen ohne Neuladen in OBS
- Einrichtungsassistent beim ersten Start (Drucker, Aussehen, OBS)
- Dashboard neu: Übersicht, Drucker-Editor mit Netzwerksuche (mDNS, Modellerkennung) und Verbindungstest, zentrales Branding, Overlay-Varianten pro Drucker, Live-Vorschau vor dem Speichern
- Karte: Größe einstellbar und in der Vorschau frei verschiebbar; Eckrahmen abschaltbar
- Toolchanger-Funktionen (INDX/XL) als Option unter System, standardmäßig aus
- Slot-Leiste wird aus der Druckdatei abgeleitet – kein manueller Slotplan mehr nötig
- Datei-Check zeigt Abfall pro Wechsel und übernimmt ihn auf Wunsch als Fallback
- Fortschrittsanzeige beim Laden der Druckdatei vom Drucker

**Technik**
- Keine Laufzeit-Abhängigkeiten mehr (Express, Multer, dotenv entfernt)
- Server in Module aufgeteilt, automatische Tests für Parser, Adapter, Digest-Login, Konfiguration und API
- Zugangsdaten werden nie an den Browser gesendet

**Entfernt**
- Docker-Container und eigenständige Windows-App – das Projekt ist jetzt ein reines OBS-Plugin
- Kamera-URL und Slotplan im Dashboard
