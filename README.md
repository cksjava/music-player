# Music Player

A Raspberry Pi friendly music player app with a React frontend and Node.js backend.

## Install on Raspberry Pi

```bash
git clone git@github.com:cksjava/music-player.git
cd music-player
chmod +x 01.sh 02.sh
./01.sh
./02.sh
sudo reboot
```

After reboot, the app is configured to start automatically.

## Access from mobile devices

1. Connect your phone and Raspberry Pi to the **same local network** (same Wi-Fi/LAN).
2. Open a browser on the phone and go to:

```text
http://musicboxpi.local:3847
```

If `.local` does not resolve on your network/client, use the Pi's LAN IP instead:

```text
http://<raspberry-pi-ip>:3847
```

## Assumptions

- Primary audio output HAT is **IQaudIO**.
- Library audio files are expected to be mostly **M4A** or **FLAC**.

## Screenshot

<img src="./screenshots/Library.png" alt="Library screen" width="380" />
