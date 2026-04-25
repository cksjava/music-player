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
CDROM_DEVICE="${CDROM_DEVICE:-/dev/sr0}"

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

echo "==> Creating ALSA default device config"
sudo tee /etc/asound.conf >/dev/null <<'EOF'
pcm.!default {
  type hw
  card 0
}
ctl.!default {
  type hw
  card 0
}
EOF

echo "==> Creating systemd service at /etc/systemd/system/${SERVICE_NAME}"
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
Environment=NODE_ENV=production
Environment=PORT=3847
Environment=MPV_AO=alsa
# Most stable with ALSA default selected via /etc/asound.conf
Environment=MPV_AUDIO_DEVICE=alsa
Environment=CDROM_DEVICE=${CDROM_DEVICE}
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

echo "==> Enabling service"
sudo usermod -aG cdrom "${APP_USER}" || true
sudo systemctl daemon-reload
sudo systemctl enable "${SERVICE_NAME}"

cat <<EOF

02.sh finished.

Next:
  1) Reboot once so DAC overlay and hostname fully apply:
       sudo reboot
  2) After reboot, service status:
       systemctl status ${SERVICE_NAME}
  3) Access app from another device on LAN:
       http://${HOSTNAME_TARGET}.local:3847

If the audio card is still not first device after reboot, run:
  aplay -l
and set MPV_AUDIO_DEVICE in /etc/systemd/system/${SERVICE_NAME} to a concrete mpv device
value (discover via: mpv --audio-device=help).
EOF
