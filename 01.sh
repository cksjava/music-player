#!/usr/bin/env bash
set -euo pipefail

# One-shot setup for Raspberry Pi OS (Trixie) 64-bit.
# Installs system dependencies, Node.js, npm packages, and builds the app.
# Safe to re-run (idempotent): package managers converge to desired state.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ "${EUID}" -eq 0 ]]; then
  echo "Please run as a regular user with sudo access, not as root."
  exit 1
fi

if ! command -v sudo >/dev/null 2>&1; then
  echo "sudo is required but not installed."
  exit 1
fi

if [[ ! -f "package.json" || ! -d "server" || ! -d "client" ]]; then
  echo "Run this script from the project root."
  exit 1
fi

echo "==> Updating apt index"
sudo apt-get update

echo "==> Installing system packages"
sudo apt-get install -y \
  ca-certificates \
  curl \
  gnupg \
  build-essential \
  python3 \
  pkg-config \
  sqlite3 \
  libsqlite3-dev \
  ffmpeg \
  mpv \
  cdparanoia \
  eject

NODE_MAJOR=""
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
fi

if [[ -z "${NODE_MAJOR}" || "${NODE_MAJOR}" -lt 20 ]]; then
  echo "==> Installing Node.js 22.x (current Node is missing or too old)"
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
else
  echo "==> Node.js $(node -v) is already compatible"
fi

echo "==> Node: $(node -v)"
echo "==> npm:  $(npm -v)"

echo "==> Installing npm dependencies (including dev tools like tsc)"
npm ci --include=dev --workspaces

echo "==> Building client and server"
npm run build

cat <<'EOF'

Setup complete.

Next commands:
  npm run start

Optional for development:
  npm run dev

EOF
