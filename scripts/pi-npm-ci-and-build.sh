#!/usr/bin/env bash
# Install dependencies and build the app (Raspberry Pi / production).
# Used by 01.sh and as ExecStartPre for music-player.service (systemd).
#
# We use `npm ci` (not `npm install`) when package-lock.json is present: it installs
# exactly the lockfile tree, which is what you want for devices and CI. It fails if
# package.json and the lockfile disagree — fix the lockfile locally with npm install.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# DevDependencies (Vite, tsc) are required to build; do not use production-only install.
export NODE_ENV=development

echo "==> npm ci (workspaces; includes devDependencies needed for build)"
npm ci --include=dev --workspaces

echo "==> npm run build"
npm run build
