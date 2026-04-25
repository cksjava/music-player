#!/usr/bin/env bash
set -euo pipefail

# Detect IQaudIO/compatible ALSA card, choose best mpv audio-device,
# set system default playback device, and write app audio env vars.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ ! -f "package.json" || ! -d "server" || ! -d "client" ]]; then
  echo "Run this script from the project root."
  exit 1
fi

if ! command -v aplay >/dev/null 2>&1; then
  echo "Missing 'aplay'. Install alsa-utils first."
  exit 1
fi
if ! command -v mpv >/dev/null 2>&1; then
  echo "Missing 'mpv'. Run ./01.sh first."
  exit 1
fi
if ! command -v sudo >/dev/null 2>&1; then
  echo "Missing sudo."
  exit 1
fi

echo "==> Detecting ALSA cards"
APLAY_OUT="$(aplay -l 2>&1 || true)"
echo "$APLAY_OUT"

CARD_INDEX=""
CARD_ID=""

while IFS= read -r line; do
  lower="$(printf '%s' "$line" | tr '[:upper:]' '[:lower:]')"
  if [[ "$lower" =~ ^card[[:space:]]+[0-9]+: ]] && [[ "$lower" =~ iqaudio|hifiberry|dacplus|rpi[[:space:]_-]*dac|snd[_-]rpi ]]; then
    CARD_INDEX="$(printf '%s' "$line" | sed -nE 's/^card[[:space:]]+([0-9]+):.*/\1/p')"
    CARD_ID="$(printf '%s' "$line" | sed -nE 's/^card[[:space:]]+[0-9]+:[[:space:]]*([^[:space:]]+).*/\1/p')"
    break
  fi
done <<< "$APLAY_OUT"

if [[ -z "$CARD_INDEX" || -z "$CARD_ID" ]]; then
  echo "Could not detect an IQaudIO-like card. Falling back to card 0."
  CARD_INDEX="0"
  CARD_ID="$(printf '%s' "$APLAY_OUT" | sed -nE 's/^card[[:space:]]+0:[[:space:]]*([^[:space:]]+).*/\1/p' | head -n1)"
fi

if [[ -z "$CARD_ID" ]]; then
  echo "Could not determine ALSA card ID."
  exit 1
fi

echo "==> Candidate ALSA card index: ${CARD_INDEX}"
echo "==> Candidate ALSA card id:    ${CARD_ID}"

echo "==> Detecting mpv audio devices"
MPV_HELP="$(mpv --no-config --audio-device=help 2>&1 || true)"
echo "$MPV_HELP"

extract_mpv_id() {
  # Extract first quoted token from a line like:
  #   'alsa/....' (Description)
  sed -n "s/^[[:space:]]*'\\([^']*\\)'.*/\\1/p" <<< "$1"
}

MPV_AUDIO_DEVICE=""
while IFS= read -r line; do
  lower="$(printf '%s' "$line" | tr '[:upper:]' '[:lower:]')"
  if [[ "$lower" == *"alsa"* ]] && [[ "$lower" =~ iqaudio|hifiberry|dacplus|snd_rpi|rpi-dac ]]; then
    candidate="$(extract_mpv_id "$line")"
    if [[ -n "$candidate" ]]; then
      MPV_AUDIO_DEVICE="$candidate"
      break
    fi
  fi
done <<< "$MPV_HELP"

if [[ -z "$MPV_AUDIO_DEVICE" ]]; then
  while IFS= read -r line; do
    lower="$(printf '%s' "$line" | tr '[:upper:]' '[:lower:]')"
    if [[ "$lower" == *"alsa/"* ]] && [[ "$line" == *"CARD=${CARD_ID}"* ]]; then
      candidate="$(extract_mpv_id "$line")"
      if [[ -n "$candidate" ]]; then
        MPV_AUDIO_DEVICE="$candidate"
        break
      fi
    fi
  done <<< "$MPV_HELP"
fi

if [[ -z "$MPV_AUDIO_DEVICE" ]]; then
  MPV_AUDIO_DEVICE="alsa"
fi

echo "==> Selected mpv audio device: ${MPV_AUDIO_DEVICE}"

echo "==> Writing /etc/asound.conf to use card ${CARD_ID}"
sudo cp /etc/asound.conf /etc/asound.conf.bak.music-player 2>/dev/null || true
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

ENV_FILE=".env"
touch "$ENV_FILE"

upsert_env() {
  local key="$1"
  local value="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i.bak -E "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
    rm -f "${ENV_FILE}.bak"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

echo "==> Writing app audio env vars to ${ENV_FILE}"
upsert_env "MPV_AO" "alsa"
upsert_env "MPV_AUDIO_DEVICE" "$MPV_AUDIO_DEVICE"
upsert_env "IQAUDIO_ALSA_CARD_INDEX" "$CARD_INDEX"
upsert_env "IQAUDIO_ALSA_CARD_ID" "$CARD_ID"

cat <<EOF

Done.

Resolved values:
  MPV_AO=alsa
  MPV_AUDIO_DEVICE=${MPV_AUDIO_DEVICE}
  IQAUDIO_ALSA_CARD_INDEX=${CARD_INDEX}
  IQAUDIO_ALSA_CARD_ID=${CARD_ID}

If running as a service:
  sudo systemctl restart music-player.service
  systemctl status music-player.service

You can inspect logs:
  journalctl -u music-player.service -n 100 --no-pager
EOF
