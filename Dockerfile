FROM node:22-bookworm-slim

ENV NODE_ENV=production
ENV PORT=8080
ENV DB_PATH=/data/quintal.db

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY servidor-1.js ./
COPY scripts/reconcile-map.js ./scripts/reconcile-map.js
COPY public ./public
COPY docker-entrypoint.sh ./docker-entrypoint.sh

# Aplica a reconciliação do mapa dentro da imagem, sem substituir manualmente
# o servidor inteiro pela API de edição de arquivos.
RUN node ./scripts/reconcile-map.js \
  && node --check ./servidor-1.js \
  && chmod +x ./docker-entrypoint.sh \
  && mkdir -p /data \
  && chown -R node:node /app /data

EXPOSE 8080

ENTRYPOINT ["/app/docker-entrypoint.sh"]
