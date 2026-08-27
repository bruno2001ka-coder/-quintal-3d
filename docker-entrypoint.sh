#!/bin/sh
set -eu

mkdir -p /data
chown node:node /data 2>/dev/null || true

exec su -s /bin/sh node -c 'exec node servidor-1.js'
