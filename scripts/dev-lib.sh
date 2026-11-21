#!/usr/bin/env bash
# Shared by dev-up.sh and dev-down.sh: ports, output helpers and Docker lookups. Source it.

readonly PG_PORT=5432
readonly S3_PORT=9000
readonly API_PORT_DEFAULT=3000
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

# The API and worker this repo runs with tsx watch (npm run dev / worker:dev).
readonly DEV_PROCESS_PATTERN="tsx watch .*src/(main|worker)\.ts"
