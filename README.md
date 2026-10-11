<p align="center">
  <img src="build/icon.png" width="128" alt="Emussenger icon">
</p>

<h1 align="center">Emussenger</h1>

<p align="center">
  Messenger on your Mac, for people who deactivated Facebook but still use Messenger.
</p>

---

> **Disclaimer:** Emussenger is an independent, unofficial project. It is not affiliated with,
> endorsed by, or sponsored by Meta Platforms, Inc. "Messenger" and "Facebook" are trademarks of
> Meta Platforms, Inc. Emussenger does not include, modify or redistribute Meta's software. You
> install the Messenger app yourself.

## Why

Meta shut down the Messenger desktop apps in late 2025 and messenger.com in April 2026. On the
web, Messenger now lives at facebook.com/messages, which requires an active Facebook account.
People who deactivated Facebook but kept Messenger can only use the mobile app.

Emussenger runs the real Android Messenger app inside a private, hidden Android device on your
Mac and shows it in a normal Mac window. You never see Android itself, only Messenger.

## Requirements

- macOS on Apple Silicon. Intel Macs are supported in code but untested.
- About 6 GB of free disk space. The one-time Android download is about 1.8 GB.
- About 3–4 GB of free RAM while it runs.
- The Messenger Android app file, which you download yourself (see below).

## Getting started

1. Open Emussenger. On first launch it asks you to accept Google's Android SDK license, then
   downloads Android from Google. This happens once and resumes if interrupted.
2. When Android is ready you'll see **Add Messenger**. Drop the Messenger app file onto the
   window, or click **Choose file…**. Accepted formats: `.apk`, `.apkm`, `.xapk`, `.apks`.
   - Download it from a trusted source such as APKMirror, and make sure the developer is
     **Meta Platforms, Inc.**
   - Prefer Google Play? Click **Install from Google Play instead** and sign in with a Google
     account.
3. Log in to Messenger. Done.

Closing the window keeps Messenger running in the background, so new messages still arrive as
macOS notifications with a Dock badge. Quit with ⌘Q.

### Shortcuts

| Shortcut | Action |
|---|---|
| ⌘C / ⌘V / ⌘X / ⌘A / ⌘Z | Copy, paste, cut, select all, undo (inside Messenger) |
| ⌘[ or right-click | Back |
| ⌘1 | Reopen Messenger |
| ⌘← / ⌘→, ⌥← / ⌥→, ⌥⌫ | Line and word navigation, delete word |

## How it works

- **Android setup:** on first launch the app downloads the Android emulator, platform-tools and
  an Android 14 Google Play system image directly from Google's SDK repository into
  `~/Library/Application Support/Emussenger/`. Java, Homebrew and Android Studio are not needed.
  It uses its own adb server port, so it doesn't conflict with Android Studio.
- **Virtual device:** a headless emulator renders with the Mac's GPU. Preinstalled Google apps
  that Messenger doesn't need are disabled to save memory. Google Play services stays enabled
  for push notifications.
- **Display:** Android's screen is resized to match the window (1 Android dp per window point),
  so Messenger re-lays itself out like a desktop app. Its portrait lock is overridden so it
  fills any window shape. Android's status and navigation bars are cropped out, and Messenger
  is relaunched automatically if Android's home screen ever comes to the front.
- **Streaming and input:** the screen is streamed as H.264 with the
  [scrcpy](https://github.com/Genymobile/scrcpy) server (v5.0.1) and decoded with WebCodecs.
  Mouse, trackpad, keyboard, IME input (e.g. Bangla) and the clipboard are sent back to Android.
- **Notifications:** Messenger's Android notifications are read via `dumpsys notification` and
  shown as macOS notifications, with an unread count on the Dock icon.
- **Background:** with the window closed, the stream stops but Android keeps running. ⌘Q shuts
  Android down and saves a quick-boot snapshot, so the next start takes about a second.

## Privacy and security

- Everything runs locally. Emussenger has no servers, analytics or telemetry. Your messages
  travel only between Messenger and Meta, as they would on a phone.
- All Android data, including your Messenger login, is stored in
  `~/Library/Application Support/Emussenger/`. Deleting that folder resets everything.
- While Emussenger is running, the emulator's control ports (adb and the emulator console)
  listen on `localhost` only. They can't be reached from the network, but other software running
  on your Mac could connect to them and access the Android device, including Messenger's data.
  Only run Emussenger on a Mac you trust.

## Known limitations

- Meta may flag or checkpoint logins from an emulator. Use at your own risk.
- Notification mirroring and Intel Macs haven't been fully tested yet.
- Resizing the window briefly blanks the screen while Android re-lays out.
- Messenger calls depend on the emulator's audio and have no camera passthrough yet.

## Development

```bash
npm install   # also fetches the scrcpy server and brands the dev Electron app
npm start     # run in development
npm run dist  # build a .dmg with electron-builder
npm run icons # re-render build/icon.svg to icon.png and icon.icns
```

| Path | Purpose |
|---|---|
| `src/main/sdk.js` | Downloads and installs the Android SDK pieces from Google |
| `src/main/avd.js` | Writes the virtual device configuration |
| `src/main/emulator.js` | Emulator lifecycle, adb helpers, Messenger install, app trimming |
| `src/main/scrcpy.js` | scrcpy v5 client: video stream and input control messages |
| `src/main/notifications.js` | Mirrors Messenger notifications to macOS |
| `src/main/main.js` | App flow, window, display fitting, IPC |
| `src/renderer/` | Setup screens, WebCodecs video decoding, input handling |
| `scripts/` | scrcpy-server fetch, icon rendering, dev branding |

## Credits and licenses

- Emussenger's source code is released under the MIT License.
- [scrcpy](https://github.com/Genymobile/scrcpy) by Genymobile and Romain Vimont is licensed
  under the Apache License 2.0. Its server binary is downloaded at build time and bundled into
  packaged builds, which must include its license and notice.
- The Android emulator and system images are downloaded directly from Google by each user, under
  Google's Android SDK license terms, which the user accepts in the app. Emussenger does not
  redistribute them.
