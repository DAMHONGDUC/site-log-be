#!/usr/bin/env bash
# Starts the whole local backend with one command: Docker (Postgres + RustFS), packages,
# migrations, the bucket, then the API and the worker side by side. Ctrl+C stops both.
# Guide: docs/feature-guide/local-development.md
set -euo pipefail
cd "$(dirname "$0")/.."

readonly NODE_MAJOR_WANTED=24
readonly COLIMA_MEMORY_GB=2
readonly COLIMA_CPUS=2
source scripts/dev-lib.sh

step 'Checking the machine'
[ -f .env ] || fail '.env is missing: cp .env.example .env (guide §2)'
firebase_key="${FIREBASE_SERVICE_ACCOUNT_BASE64:-$(env_value FIREBASE_SERVICE_ACCOUNT_BASE64)}"
[ -n "$firebase_key" ] || fail 'FIREBASE_SERVICE_ACCOUNT_BASE64 is empty in .env (guide §2, Firebase key)'
node_major=$(node -p 'process.versions.node.split(".")[0]')
[ "$node_major" -ge "$NODE_MAJOR_WANTED" ] ||
  echo "! Node $node_major found, the project wants $NODE_MAJOR_WANTED (brew install node@$NODE_MAJOR_WANTED)"

if ! docker info >/dev/null 2>&1; then
  command -v colima >/dev/null || fail 'Docker is not running and Colima is not installed (guide §2)'
  step "Starting Colima (${COLIMA_MEMORY_GB} GB)"
  colima start --memory "$COLIMA_MEMORY_GB" --cpu "$COLIMA_CPUS"
fi

step 'Postgres'
if port_open "$PG_PORT"; then
  echo "Already running on $PG_PORT"
else
  # An older container (started with docker run) owns the port: start it rather than clash.
  existing=$(container_on_port "$PG_PORT" || true)
  if [ -n "$existing" ]; then
    docker start "$existing" >/dev/null
    wait_port "$PG_PORT"
  else
    docker compose up -d --wait postgres
  fi
fi

step 'S3 (RustFS)'
docker compose up -d s3
wait_port "$S3_PORT"

if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  step 'Installing packages'
  npm ci
fi

step 'Migrations and bucket'
retry npm run --silent migrate
retry npm run --silent s3:bucket

step 'API and worker (Ctrl+C stops both)'
trap 'trap - INT TERM EXIT; kill 0 2>/dev/null' INT TERM EXIT
prefix() { awk -v tag="$1" '{ print tag " " $0; fflush() }'; }
npm run --silent dev 2>&1 | prefix '[api]   ' &
api=$!
npm run --silent worker:dev 2>&1 | prefix '[worker]' &
worker=$!

api_port=$(env_value PORT)
api_port="${api_port:-$API_PORT_DEFAULT}"
wait_port "$api_port"
api_url="$LOCAL_HOST_URL:$api_port"
printf '\n\033[32m✓ API %s  ·  docs %s  ·  S3 console %s\033[0m\n\n' \
  "$api_url$API_HEALTH_PATH" "$api_url$API_DOCS_PATH" "$LOCAL_HOST_URL:$S3_CONSOLE_PORT"

# Stop everything as soon as either process exits.
while kill -0 "$api" 2>/dev/null && kill -0 "$worker" 2>/dev/null; do sleep 1; done
fail 'The API or the worker stopped; see its log above'
