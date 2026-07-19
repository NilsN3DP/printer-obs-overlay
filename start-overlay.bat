@echo off
rem Startet den Prusa OBS Overlay Server dauerhaft.
rem Fenster minimieren, nicht schliessen - solange es laeuft, hat OBS Daten.
cd /d "%~dp0"
title Prusa OBS Overlay Server
echo Overlay-URL fuer OBS: http://localhost:4200/overlay.html
npm start
pause
