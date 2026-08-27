FROM node:22-bookworm-slim

ENV NODE_ENV=production
ENV PORT=8080
ENV DB_PATH=/data/quintal.db

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY servidor-1.js ./
COPY public ./public
COPY docker-entrypoint.sh ./docker-entrypoint.sh

RUN chmod +x ./docker-entrypoint.sh \
  && mkdir -p /data \
  && chown -R node:node /app /data

EXPOSE 8080

ENTRYPOINT ["/app/docker-entrypoint.sh"]
