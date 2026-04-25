#!/usr/bin/env bash
set -euo pipefail

# Simulate a playback request through the app API.
# Usage:
#   ./simulate-playback-api.sh
#   ./simulate-playback-api.sh <track-id>
#   BASE_URL=http://musicboxpi.local:3847 ./simulate-playback-api.sh

BASE_URL="${BASE_URL:-http://127.0.0.1:3847}"
TRACK_ID="${1:-}"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1"
    exit 1
  fi
}

require_cmd curl
require_cmd python3

echo "==> Checking API health at ${BASE_URL}"
curl -fsS "${BASE_URL}/api/health" >/dev/null

if [[ -z "${TRACK_ID}" ]]; then
  echo "==> Fetching first indexed track ID"
  TRACK_ID="$(
    curl -fsS "${BASE_URL}/api/tracks?limit=1" \
      | python3 -c 'import sys, json; d=json.load(sys.stdin); t=d.get("tracks") or []; print((t[0] if t else {}).get("id",""))'
  )"
fi

if [[ -z "${TRACK_ID}" ]]; then
  echo "No indexed tracks found. Index music first, then retry."
  exit 1
fi

echo "==> Triggering playback for track: ${TRACK_ID}"
curl -fsS -X POST "${BASE_URL}/api/player/play" \
  -H "Content-Type: application/json" \
  -d "{\"trackId\":\"${TRACK_ID}\"}" >/dev/null

echo "==> Current player state"
curl -fsS "${BASE_URL}/api/player/state"
echo

echo "Playback API call completed."
