#!/bin/sh
# Startet den Server als PUID:PGID statt als root. Der Datenordner wird vorher
# uebernommen, damit auch alte, von root angelegte Dateien (Version 1) beschreibbar sind.
set -e

DATA="${DATA_DIR:-/config}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA"
  chown -R "${PUID:-99}:${PGID:-100}" "$DATA" 2>/dev/null || echo "Hinweis: Besitzer von $DATA konnte nicht geaendert werden" >&2
  exec su-exec "${PUID:-99}:${PGID:-100}" "$@"
fi

exec "$@"
