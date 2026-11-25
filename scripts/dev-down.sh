#!/usr/bin/env bash
# Stops what npm run dev:all started: the API and worker, then the Postgres and S3 containers.
# Data stays in the Docker volumes. --colima also stops the Colima VM to give its RAM back.
# Guide: docs/feature-guide/local-development.md
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/dev-lib.sh

if ! docker info >/dev/null 2>&1; then
  echo 'Docker is not running: nothing to stop there'
else
  step 'API and worker'
  if pkill -f "$PWD/node_modules/.bin/$DEV_PROCESS_PATTERN"; then echo 'Stopped'; else echo 'Not running'; fi

  step 'Containers'
  docker compose stop
  # The older Postgres container started with docker run (sitelog-pg) is not in compose.
  pg=$(container_on_port "$PG_PORT" || true)
  [ -n "$pg" ] && docker stop "$pg" >/dev/null && echo "Stopped $(docker inspect -f '{{.Name}}' "$pg" | tr -d /)"
fi

if [ "${1:-}" = '--colima' ] && command -v colima >/dev/null; then
  step 'Colima'
  colima stop
fi

printf '\n\033[32m✓ Stopped. Start again: npm run dev:all\033[0m\n'
