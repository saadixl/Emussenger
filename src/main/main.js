const path = require('path');
const { app, BrowserWindow, ipcMain, clipboard, dialog, shell: macShell } = require('electron');
const paths = require('./paths');
const state = require('./state');
const sdk = require('./sdk');
const emulator = require('./emulator');
const { ScrcpySession } = require('./scrcpy');
const { createNotifier } = require('./notifications');
const { buildMenu } = require('./menu');

const TOOLBAR_HEIGHT = 38;
const PACKAGE_EXTENSIONS = ['apk', 'apkm', 'xapk', 'apks'];

let win = null;
let stream = null;
let androidReady = false;
let showAndroid = false; // true while the Messenger (or Play Store) screen is shown
let quitting = false;
let licenseWaiter = null;
let running = null;
let installPoll = null;
let watchdog = null;
let crop = null;
let videoSize = { width: 1920, height: 1200 };

const notifier = createNotifier({
  onClick: () => showWindow(),
  isWindowFocused: () => Boolean(win?.isVisible() && win.isFocused()),
});

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

let lastScreen = null;
function setScreen(screen, extra = {}) {
  lastScreen = { screen, ...extra };
  send('app:screen', lastScreen);
}

function createWindow() {
  const bounds = state.get().windowBounds ?? { width: 1280, height: 800 + TOOLBAR_HEIGHT };
  win = new BrowserWindow({
    ...bounds,
    minWidth: 640,
    minHeight: 400 + TOOLBAR_HEIGHT,
    title: 'Emussenger',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0b0b0f',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());

  // Closing the window keeps Android running in the background so messages
  // keep arriving as notifications; Cmd+Q shuts everything down.
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });
  // Android's screen follows the window size once the user stops resizing.
  let resizeTimer = null;
  win.on('resize', () => {
    clearTimeout(resizeTimer);
    saveBounds();
    resizeTimer = setTimeout(() => fitDisplayToWindow().catch((e) => console.error('resize failed:', e.message)), 350);
  });
  win.on('move', saveBounds);
  win.on('hide', stopStream);
  win.on('minimize', stopStream);
  win.on('show', startStream);
  win.on('restore', startStream);
}

let saveTimer = null;
function saveBounds() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (win && !win.isDestroyed() && !win.isFullScreen()) {
      state.update((st) => { st.windowBounds = win.getBounds(); });
    }
  }, 500);
}

function showWindow() {
  if (!win) return;
  win.show();
  win.focus();
}

async function startStream() {
  if (stream || !showAndroid || !win?.isVisible() || win.isMinimized()) return;
  const session = new ScrcpySession({ crop });
  stream = session;
  session.on('session', (size) => {
    videoSize = size;
    send('video:session', size);
  });
  session.on('packet', (p) => send('video:packet', p));
  session.on('clipboard', (text) => Promise.resolve(clipboard.writeText(text)).catch(() => {}));
  session.on('closed', () => {
    if (stream !== session) return;
    stream = null;
    session.stop();
    setTimeout(startStream, 1000);
  });
  try {
    await session.start();
  } catch (err) {
    if (stream === session) stream = null;
    session.stop();
    console.error('stream failed:', err.message);
    setTimeout(startStream, 2000);
  }
}

function stopStream() {
  const s = stream;
  stream = null;
  s?.stop();
}

// Android pixels per window point. The AVD is 240 dpi (1.5 px per dp), so
// one window point is one Android dp: Messenger looks like a desktop app.
const PX_PER_POINT = 1.5;
// Caps the stream so the in-guest H.264 encoder stays fast on big windows;
// beyond this Android gets fewer dp and content simply scales up.
const MAX_PIXELS = 2560 * 1600;
const MIN_SIDE = 480;
let fitting = null;

const even = (n) => Math.max(MIN_SIDE, Math.round(n / 2) * 2);

// Sizes Android's screen so that, after cropping the system bars, it exactly
// fills the window's content area, then restarts the stream with the new crop.
async function fitDisplayToWindow() {
  if (!androidReady || !win) return;
  if (fitting) return fitting.then(fitDisplayToWindow);
  fitting = (async () => {
    const [w, h] = win.getContentSize();
    const contentH = Math.max(1, h - TOOLBAR_HEIGHT);
    let scale = PX_PER_POINT;
    if (w * contentH * scale * scale > MAX_PIXELS) scale = Math.sqrt(MAX_PIXELS / (w * contentH));

    const bars = await emulator.systemBarInsets();
    const width = even(w * scale);
    const height = even(contentH * scale) + bars.top + bars.bottom;
    if (width === bars.width && height === bars.height && crop) return;

    const wasStreaming = Boolean(stream);
    stopStream();
    await emulator.setDisplaySize(width, height);
    // The bars can change height when the layout switches (phone vs tablet).
    await new Promise((r) => setTimeout(r, 400));
    const after = await emulator.systemBarInsets();
    crop = { width: after.width, height: after.height - after.top - after.bottom, x: 0, y: after.top };
    if (wasStreaming || showAndroid) startStream();
  })().finally(() => { fitting = null; });
  return fitting;
}

function showAndroidScreen(extra = {}) {
  showAndroid = true;
  setScreen('running', extra);
  startStream();
}

// Messenger is installed: show it full-window and keep it in front. If the
// user ever lands on Android's home screen, bring Messenger straight back.
async function enterMessenger() {
  clearInterval(installPoll);
  await emulator.allowAnyOrientation().catch(() => {});
  await emulator.launchMessenger().catch(() => {});
  showAndroidScreen();
  notifier.start();
  clearInterval(watchdog);
  watchdog = setInterval(async () => {
    if (await emulator.isHomeScreen()) emulator.launchMessenger().catch(() => {});
  }, 1500);
}

function showInstallScreen(error) {
  showAndroid = false;
  stopStream();
  clearInterval(installPoll);
  setScreen('install-messenger', { error, extensions: PACKAGE_EXTENSIONS });
}

async function installFromFile(file) {
  if (!androidReady || running) return;
  const ext = path.extname(file).slice(1).toLowerCase();
  if (!PACKAGE_EXTENSIONS.includes(ext)) {
    showInstallScreen(`"${path.basename(file)}" isn't an Android app. Use a .apk, .apkm, .xapk or .apks file.`);
    return;
  }
  setScreen('installing-messenger');
  try {
    await emulator.installPackageFile(file, paths.downloads);
    await enterMessenger();
  } catch (err) {
    const reason = err.message.match(/INSTALL_[A-Z_]+/)?.[0];
    showInstallScreen(reason ? `Android couldn't install this file (${reason}).` : err.message);
  }
}

async function chooseFile() {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Choose the Messenger app file',
    properties: ['openFile'],
    filters: [{ name: 'Android app', extensions: PACKAGE_EXTENSIONS }],
  });
  if (!canceled && filePaths[0]) await installFromFile(filePaths[0]);
}

// Fallback: install from Google Play, which needs a Google account.
async function installFromPlayStore() {
  await emulator.openPlayStore().catch(() => {});
  showAndroidScreen({ playStore: true });
  clearInterval(installPoll);
  installPoll = setInterval(async () => {
    if (await emulator.isMessengerInstalled()) enterMessenger();
  }, 4000);
}

// Runs setup → boot → Messenger once; repeated calls (renderer reload, retry)
// reuse the run in flight or just re-show the current state.
function run() {
  if (running) {
    if (lastScreen) send('app:screen', lastScreen);
    return running;
  }
  if (androidReady && lastScreen) {
    send('app:screen', lastScreen);
    if (showAndroid) {
      stopStream();
      startStream();
    }
    return Promise.resolve();
  }
  running = setup().finally(() => { running = null; });
  return running;
}

async function setup() {
  try {
    if (!sdk.isInstalled()) {
      setScreen('checking');
      const packages = await sdk.resolvePackages();
      const licenseIds = [...new Set(packages.map((p) => p.licenseId))].sort().join(',');
      if (state.get().acceptedLicenses !== licenseIds) {
        const licenses = [...new Map(packages.map((p) => [p.licenseId, p.licenseText])).values()];
        const totalSize = packages.reduce((n, p) => n + p.size, 0);
        setScreen('license', { licenses, totalSize });
        await new Promise((resolve) => { licenseWaiter = resolve; });
        state.update((s) => { s.acceptedLicenses = licenseIds; });
      }
      setScreen('installing');
      await sdk.install(packages, (p) => send('app:progress', p));
    }

    setScreen('booting', { firstBoot: !state.get().booted });
    await emulator.start();
    state.update((s) => { s.booted = true; });
    await emulator.disableUnneededApps().catch((e) => console.error('trim failed:', e.message));

    androidReady = true;
    await fitDisplayToWindow();

    if (await emulator.isMessengerInstalled()) await enterMessenger();
    else showInstallScreen();
  } catch (err) {
    console.error(err);
    setScreen('error', { message: err.message });
  }
}

// clipboard.readText() returns a Promise in recent Electron versions; awaiting
// also works where it's still synchronous.
async function paste() {
  const text = await clipboard.readText();
  if (text) stream?.setClipboard(text, true);
}
const openMessenger = () => emulator.launchMessenger().catch(() => {});

// Text that the default Android key map can type goes through key events;
// anything else (emoji, Bangla, accented letters…) goes through the clipboard.
function injectText(text) {
  if (!stream || !text) return;
  if (/^[\x20-\x7e]+$/.test(text)) stream.text(text);
  else stream.setClipboard(text, true);
}

function registerIpc() {
  ipcMain.on('app:ready', () => run());
  ipcMain.on('app:retry', () => run());
  ipcMain.on('app:accept-license', () => licenseWaiter?.());
  ipcMain.on('app:open-logs', () => macShell.openPath(paths.logs));

  ipcMain.on('messenger:install-file', (_e, file) => installFromFile(file));
  ipcMain.on('messenger:choose-file', () => chooseFile());
  ipcMain.on('messenger:play-store', () => installFromPlayStore());
  ipcMain.on('messenger:cancel-play-store', () => showInstallScreen());

  ipcMain.on('input:touch', (_e, { action, x, y }) => stream?.touch(action, x, y, videoSize.width, videoSize.height));
  ipcMain.on('input:scroll', (_e, { x, y, h, v }) => stream?.scroll(x, y, videoSize.width, videoSize.height, h, v));
  ipcMain.on('input:key', (_e, { action, keycode, meta }) => stream?.key(action, keycode, meta));
  ipcMain.on('input:text', (_e, text) => injectText(text));
  ipcMain.on('video:reset', () => stream?.resetVideo());
  ipcMain.on('input:paste', paste);

  ipcMain.on('nav:back', () => stream?.back());
}

app.setName('Emussenger');

app.whenReady().then(() => {
  // Packaged builds get the icon from the bundle; in development set it here.
  if (!app.isPackaged) app.dock?.setIcon(path.join(__dirname, '..', '..', 'build', 'icon.png'));
  registerIpc();
  buildMenu({ getStream: () => stream, getWindow: () => win, paste, openMessenger });
  createWindow();
  app.on('activate', showWindow);
});

app.on('before-quit', async (e) => {
  if (quitting) return;
  quitting = true;
  e.preventDefault();
  notifier.stop();
  clearInterval(installPoll);
  clearInterval(watchdog);
  stopStream();
  win?.hide();
  if (androidReady) await emulator.stop().catch(() => {});
  app.exit(0);
});
