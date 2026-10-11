# Printer OBS Overlay – Docker-Image (Unraid, Synology, Raspberry Pi, jeder Linux-Server).
# Keine npm-Abhaengigkeiten zur Laufzeit: das Image enthaelt nur Node und den Quellcode.
FROM node:24-alpine

RUN apk add --no-cache su-exec tzdata

WORKDIR /app
COPY package.json ./
COPY src ./src
COPY packaging/docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod 755 /usr/local/bin/entrypoint.sh

# PUID/PGID: Besitzer der Dateien in /config (Unraid-Standard: nobody/users = 99/100).
ENV NODE_ENV=production \
    PO_MODE=docker \
    DATA_DIR=/config \
    HOST=0.0.0.0 \
    PORT=4200 \
    PUID=99 \
    PGID=100 \
    TZ=Europe/Berlin

VOLUME /config
EXPOSE 4200

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4200)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

ENTRYPOINT ["entrypoint.sh"]
CMD ["node", "src/server/main.js"]
