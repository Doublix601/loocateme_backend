# syntax=docker/dockerfile:1
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json* .npmrc* ./
# Prefer lockfile installation; if lockfile is out of sync, fall back to npm install to regenerate
RUN sh -c "if [ -f package-lock.json ]; then (npm ci --omit=dev || npm install --omit=dev); else npm install --omit=dev; fi"

COPY . .

EXPOSE 4000

CMD ["node", "src/server.js"]
