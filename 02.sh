#!/usr/bin/env bash
set -euo pipefail

# Configures Raspberry Pi OS (Trixie) for:
# - boot-time app start (systemd)
# - friendly mDNS URL (musicboxpi.local)
# - IQaudIO DAC as default audio output

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

HOSTNAME_TARGET="${HOSTNAME_TARGET:-musicboxpi}"
if [[ ! "${HOSTNAME_TARGET}" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
  echo "HOSTNAME_TARGET must match [a-z0-9-] and start with alnum."
  exit 1
fi

APP_USER="${SUDO_USER:-$USER}"
APP_GROUP="$(id -gn "${APP_USER}")"
APP_DIR="${SCRIPT_DIR}"
SERVICE_NAME="music-player.service"
STALE_BUILD_UNIT="music-player-build.service"
CI_BUILD_SCRIPT="${APP_DIR}/scripts/pi-npm-ci-and-build.sh"
CDROM_DEVICE="${CDROM_DEVICE:-/dev/sr0}"
SYSTEMCTL_BIN="$(command -v systemctl || true)"
SHUTDOWN_BIN="$(command -v shutdown || true)"

if [[ -z "${SYSTEMCTL_BIN}" || -z "${SHUTDOWN_BIN}" ]]; then
  echo "systemctl and shutdown are required."
  exit 1
fi

echo "==> Installing runtime packages for service/discovery/audio"
sudo apt-get update
sudo apt-get install -y \
  avahi-daemon \
  avahi-utils \
  libnss-mdns \
  alsa-utils

echo "==> Setting persistent hostname to ${HOSTNAME_TARGET}"
sudo hostnamectl set-hostname "${HOSTNAME_TARGET}"
if ! grep -Eq "^127\\.0\\.1\\.1[[:space:]]+${HOSTNAME_TARGET}([[:space:]]|$)" /etc/hosts; then
  sudo sed -i -E "s/^127\\.0\\.1\\.1\\s+.*/127.0.1.1\t${HOSTNAME_TARGET}/" /etc/hosts
fi

# Raspberry Pi OS Trixie + Imager can persist hostname via cloud-init user-data.
if [[ -f /boot/firmware/user-data ]]; then
  echo "==> Updating /boot/firmware/user-data hostname (cloud-init)"
  if grep -Eq "^[[:space:]]*hostname:" /boot/firmware/user-data; then
    sudo sed -i -E "s/^[[:space:]]*hostname:.*/hostname: ${HOSTNAME_TARGET}/" /boot/firmware/user-data
  else
    echo "hostname: ${HOSTNAME_TARGET}" | sudo tee -a /boot/firmware/user-data >/dev/null
  fi
fi

echo "==> Enabling mDNS service advertisement (.local)"
sudo systemctl enable avahi-daemon
sudo systemctl restart avahi-daemon

echo "==> Configuring IQaudIO DAC overlay in /boot/firmware/config.txt"
CONFIG_TXT="/boot/firmware/config.txt"
if [[ ! -f "${CONFIG_TXT}" ]]; then
  echo "Missing ${CONFIG_TXT}"
  exit 1
fi

# Disable onboard analog audio to make HAT the primary device.
if grep -Eq "^[[:space:]]*dtparam=audio=on" "${CONFIG_TXT}"; then
  sudo sed -i -E "s/^[[:space:]]*dtparam=audio=on/#dtparam=audio=on/" "${CONFIG_TXT}"
fi

# Ensure I2S is enabled.
if ! grep -Eq "^[[:space:]]*dtparam=i2s=on" "${CONFIG_TXT}"; then
  echo "dtparam=i2s=on" | sudo tee -a "${CONFIG_TXT}" >/dev/null
fi

OVERLAY="iqaudio-dacplus"
if [[ -f /proc/device-tree/hat/vendor ]]; then
  VENDOR="$(tr -d '\0' </proc/device-tree/hat/vendor || true)"
  if [[ "${VENDOR}" == "Raspberry Pi Ltd." ]]; then
    OVERLAY="rpi-dacplus"
  fi
fi

if ! grep -Eq "^[[:space:]]*dtoverlay=${OVERLAY}([[:space:]]|,|$)" "${CONFIG_TXT}"; then
  echo "dtoverlay=${OVERLAY}" | sudo tee -a "${CONFIG_TXT}" >/dev/null
fi

echo "==> Configuring ALSA default output device"
APLAY_OUT="$(aplay -l 2>&1 || true)"
CARD_ID=""
while IFS= read -r line; do
  lower="$(printf '%s' "$line" | tr '[:upper:]' '[:lower:]')"
  if [[ "$lower" =~ ^card[[:space:]]+[0-9]+: ]] && [[ "$lower" =~ iqaudio|hifiberry|dacplus|rpi[[:space:]_-]*dac|snd[_-]rpi ]]; then
    CARD_ID="$(printf '%s' "$line" | sed -nE 's/^card[[:space:]]+[0-9]+:[[:space:]]*([^[:space:]]+).*/\1/p')"
    break
  fi
done <<< "$APLAY_OUT"

if [[ -n "$CARD_ID" ]]; then
  sudo tee /etc/asound.conf >/dev/null <<EOF
pcm.!default {
  type hw
  card ${CARD_ID}
}
ctl.!default {
  type hw
  card ${CARD_ID}
}
EOF
  echo "==> ALSA default set to card ${CARD_ID}"
else
  echo "==> IQaudIO-like card not detected via aplay. Leaving existing /etc/asound.conf unchanged."
fi

chmod +x "${CI_BUILD_SCRIPT}"

echo "==> Removing legacy split build unit (if present)"
sudo systemctl disable --now "${STALE_BUILD_UNIT}" 2>/dev/null || true
sudo rm -f "/etc/systemd/system/${STALE_BUILD_UNIT}"

echo "==> Creating systemd unit: ${SERVICE_NAME} (npm ci + build as ExecStartPre, then node)"
sudo tee "/etc/systemd/system/${SERVICE_NAME}" >/dev/null <<EOF
[Unit]
Description=Music Player App Server
After=network-online.target sound.target
Wants=network-online.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_GROUP}
WorkingDirectory=${APP_DIR}
EnvironmentFile=-${APP_DIR}/.env
Environment=NODE_ENV=production
Environment=PORT=3847
Environment=MPV_AO=alsa
Environment=CDROM_DEVICE=${CDROM_DEVICE}
# Runs before every start (boot and systemctl restart). Same as: one command redeploys.
# Tradeoff: crash recovery (Restart=always) also re-runs npm ci + build — slower recovery.
ExecStartPre=/usr/bin/bash ${CI_BUILD_SCRIPT}
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=3
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF

echo "==> Enabling service"
sudo usermod -aG cdrom "${APP_USER}" || true
sudo systemctl daemon-reload
sudo systemctl enable "${SERVICE_NAME}"

if [[ -x "${APP_DIR}/configure-iqaudio-audio.sh" ]]; then
  echo "==> Running IQaudIO auto-detection script to refresh .env"
  "${APP_DIR}/configure-iqaudio-audio.sh" || true
fi

echo "==> Configuring passwordless sudo for app maintenance commands"
SUDOERS_PATH="/etc/sudoers.d/music-player"
TMP_SUDOERS="$(mktemp)"
cat > "${TMP_SUDOERS}" <<EOF
# Managed by 02.sh for music-player maintenance APIs.
${APP_USER} ALL=(root) NOPASSWD: ${SYSTEMCTL_BIN} restart ${SERVICE_NAME}, ${SHUTDOWN_BIN} -h now, ${SHUTDOWN_BIN} -r now
EOF

if sudo test -f "${SUDOERS_PATH}" && sudo cmp -s "${TMP_SUDOERS}" "${SUDOERS_PATH}"; then
  echo "==> Sudoers entry already up to date"
else
  sudo install -m 440 "${TMP_SUDOERS}" "${SUDOERS_PATH}"
  sudo visudo -cf "${SUDOERS_PATH}"
  echo "==> Updated ${SUDOERS_PATH}"
fi
rm -f "${TMP_SUDOERS}"

cat <<EOF

02.sh finished.

Next:
  1) Reboot once so DAC overlay and hostname fully apply:
       sudo reboot
  2) After reboot, service status:
       systemctl status ${SERVICE_NAME}
  3) Access app from another device on LAN:
       http://${HOSTNAME_TARGET}.local:3847

After git pull, one command reinstalls deps, rebuilds, and restarts the server:
     sudo systemctl restart ${SERVICE_NAME}
  (ExecStartPre runs npm ci + npm run build each time — including crash restarts.)

If the audio card is still not first device after reboot, run:
  aplay -l
and set MPV_AUDIO_DEVICE in /etc/systemd/system/${SERVICE_NAME} to a concrete mpv device
value (discover via: mpv --audio-device=help).
EOF
