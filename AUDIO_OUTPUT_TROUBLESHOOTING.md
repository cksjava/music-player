# Audio Output Troubleshooting (Raspberry Pi)

Use these commands on the Pi when tracks are indexed but playback is silent/failing.

## 1) Verify app and player state

```bash
curl -sS http://127.0.0.1:3847/api/health
curl -sS http://127.0.0.1:3847/api/player/state
curl -sS http://127.0.0.1:3847/api/errors?limit=50
```

## 2) Simulate playback via API

```bash
chmod +x ./simulate-playback-api.sh
./simulate-playback-api.sh
```

To test a specific track:

```bash
./simulate-playback-api.sh "<track-id>"
```

## 3) Check service logs and runtime env

```bash
systemctl status music-player.service --no-pager -l
journalctl -u music-player.service -n 200 --no-pager
systemctl show music-player.service -p Environment --no-pager
```

Look for:
- `MPV_AO`
- `MPV_AUDIO_DEVICE`
- `CDROM_DEVICE`

## 4) Inspect ALSA devices

```bash
aplay -l
aplay -L
amixer scontrols
```

Confirm your IQaudIO card is present and note card/device names.

## 5) Inspect mpv output device list directly

```bash
mpv --no-config --audio-device=help 2>&1
mpv --no-config --ao=alsa --audio-device=alsa --idle=yes --no-video --no-terminal --really-quiet 2>&1 | head -n 40
```

If `--audio-device=help` does not show expected ALSA targets, it is a system audio stack/device problem.

## 6) Validate boot audio config

```bash
grep -E "^(#)?dtparam=audio=on|^dtparam=i2s=on|^dtoverlay=" /boot/firmware/config.txt
cat /etc/asound.conf
```

Expected:
- onboard analog audio disabled (`#dtparam=audio=on`)
- I2S enabled (`dtparam=i2s=on`)
- IQaudIO overlay present (`dtoverlay=iqaudio-dacplus` or equivalent)

## 7) Quick sanity test with speaker-test

```bash
speaker-test -c 2 -t wav -l 1
```

If this is silent, fix ALSA/device routing first before app-level debugging.

## 8) If playback still fails

1. Open **System -> Show error logs** in the app UI.
2. Re-run `./simulate-playback-api.sh`.
3. Re-check:

```bash
curl -sS http://127.0.0.1:3847/api/errors?limit=100
```

Focus on `mpv stderr`, `failed to start playback engine`, and ALSA/device errors.
