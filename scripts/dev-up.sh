#!/usr/bin/env bash
# Starts the whole local backend with one command: Docker (Postgres + RustFS), packages,
# migrations, the bucket, then the API and the worker side by side. Ctrl+C stops both.
# Guide: docs/feature-guide/local-development.md
set -euo pipefail
cd "$(dirname "$0")/.."

readonly NODE_MAJOR_WANTED=24
readonly COLIMA_MEMORY_GB=2
readonly COLIMA_CPUS=2
readonly PG_PORT=5432
readonly S3_PORT=9000
readonly WAIT_SECONDS=30
readonly RETRIES=5

step() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }
fail() { printf '\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }
port_open() { nc -z localhost "$1" >/dev/null 2>&1; }

wait_port() {
  local port=$1 i
  for ((i = 0; i < WAIT_SECONDS; i++)); do
    port_open "$port" && return 0
    sleep 1
  done
  fail "Nothing answers on port $port after ${WAIT_SECONDS}s"
}

# Postgres and RustFS take a moment after the port opens; retry the first call.
retry() {
  local i
  for ((i = 1; i <= RETRIES; i++)); do
    "$@" && return 0
    [ "$i" -lt "$RETRIES" ] && sleep 2
  done
  fail "Failed after $RETRIES tries: $*"
}

# A container (running or stopped) that binds this host port — e.g. one started with docker run.
container_on_port() {
  local id
  for id in $(docker ps -aq); do
    docker inspect -f '{{json .HostConfig.PortBindings}}' "$id" | grep -q "\"HostPort\":\"$1\"" &&
      echo "$id" && return 0
  done
}

env_value() { grep -E "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2- || true; }

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
wait_port "${api_port:-3000}"
printf '\n\033[32m✓ API http://localhost:%s  ·  docs /docs  ·  S3 console http://localhost:9001\033[0m\n\n' \
  "${api_port:-3000}"

# Stop everything as soon as either process exits.
while kill -0 "$api" 2>/dev/null && kill -0 "$worker" 2>/dev/null; do sleep 1; done
fail 'The API or the worker stopped; see its log above'
