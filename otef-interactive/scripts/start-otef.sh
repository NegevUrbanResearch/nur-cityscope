#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-120}"

cd "$ROOT"
docker compose up -d

port_line="$(docker compose port nginx 80)"
if [[ ! "$port_line" =~ :([0-9]+)[[:space:]]*$ ]]; then
  echo "The running nginx container has no published FRONT_PORT." >&2
  exit 1
fi
port="${BASH_REMATCH[1]}"
if [ "$port" -lt 1 ] || [ "$port" -gt 65535 ]; then
  echo "The running nginx container has no published FRONT_PORT." >&2
  exit 1
fi

if [ "$port" -eq 80 ]; then
  origin="http://localhost"
else
  origin="http://localhost:${port}"
fi

launcher_url="${origin}/otef-interactive/launcher.html"
api_url="${origin}/api/otef/projection-config/?table=otef"

start_ts="$(date +%s)"
ready=0
while [ $(( $(date +%s) - start_ts )) -lt "$TIMEOUT_SECONDS" ]; do
  remaining=$(( TIMEOUT_SECONDS - ($(date +%s) - start_ts) ))
  if [ "$remaining" -le 0 ]; then
    break
  fi
  probe_timeout=5
  if [ "$remaining" -lt 5 ]; then
    probe_timeout=$remaining
  fi
  if [ "$probe_timeout" -lt 1 ]; then
    probe_timeout=1
  fi
  if curl -fsS --max-time "$probe_timeout" "$launcher_url" >/dev/null 2>&1 \
    && curl -fsS --max-time "$probe_timeout" "$api_url" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done

if [ "$ready" -ne 1 ]; then
  echo "OTEF readiness timed out after ${TIMEOUT_SECONDS} seconds; launcher was not opened." >&2
  exit 1
fi

node --experimental-detect-module "$SCRIPT_DIR/write-share-hosts.mjs" --repository-root "$ROOT" --port "$port"

open "$launcher_url"
echo "OTEF ready: $launcher_url"
