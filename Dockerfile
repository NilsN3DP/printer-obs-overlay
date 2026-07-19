FROM node:22-alpine

WORKDIR /app

# Install dependencies first for better layer caching
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# App source
COPY server.js gcode-meta.js ./
COPY public ./public

# Config lives on a mounted volume in production (Unraid: /config)
ENV CONFIG_PATH=/config/config.json
ENV PORT=4200

EXPOSE 4200

CMD ["node", "server.js"]
