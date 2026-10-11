<p align="center">
  <img src="build/icon.png" width="128" alt="Emussenger icon">
</p>

<h1 align="center">Emussenger</h1>

<p align="center">
  Messenger on your Mac, for people who deactivated Facebook but still use Messenger.
</p>

<img width="1512" height="982" alt="sshot" src="https://github.com/user-attachments/assets/37865def-413b-493c-96ae-2bccf53f4346" />


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

## Download

Get the latest `.dmg` from the [Releases page](https://github.com/saadixl/Emussenger/releases):

- **Apple Silicon** (M1 and newer): `Emussenger-<version>-arm64.dmg`
- **Intel** (untested): `Emussenger-<version>-x64.dmg`

Open the DMG and drag Emussenger to Applications.

Emussenger isn't notarized by Apple yet (that needs a paid Apple Developer account), so macOS
blocks it the first time. To open it:

1. Open Emussenger once and dismiss the warning.
2. Go to **System Settings → Privacy & Security**, scroll down, and click **Open Anyway** next
   to the Emussenger message.

If macOS says the app "is damaged", run this once in Terminal, then open it again:

```bash
xattr -dr com.apple.quarantine /Applications/Emussenger.app
```

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
  Android down.
- **Memory:** Android always cold-boots (about 10 seconds) instead of restoring a snapshot,
  which would load all of its RAM up front.

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
- Calls use your Mac's microphone and built-in camera. Only one camera is available, so
  switching cameras in a video call doesn't work.

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


## What's next?
The first version allows you to chat naturally. But there are some improvements I want to do.
- The app uses whopping 5GB memory. Need to optimize that. (If I would supply the APK from a 3rd party website and use a lighter Android image or some other container, it could be lighter. But that would be a huge security risk.)
- Haven't tried the video call yet.
