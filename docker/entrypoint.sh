#!/bin/sh
set -e

echo "[entrypoint] running database migrations..."
node /app/docker/migrate.js

echo "[entrypoint] starting Next.js..."
exec node /app/server.js
