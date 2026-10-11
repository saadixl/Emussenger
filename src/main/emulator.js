// Runs the headless Android emulator and wraps the adb commands we need.
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { EventEmitter } = require('events');
const paths = require('./paths');
const { ensureAvd } = require('./avd');

const CONSOLE_PORT = 5580;
const SERIAL = `emulator-${CONSOLE_PORT}`;
const MESSENGER = 'com.facebook.orca';

const events = new EventEmitter();
let proc = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function adb(args, { timeout = 30000, encoding = 'utf8' } = {}) {
  return new Promise((resolve, reject) => {
    execFile(paths.adbBin(), args, { env: paths.androidEnv(), timeout, encoding, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve(stdout)));
  });
}

const shell = (cmd, opts) => adb(['-s', SERIAL, 'shell', cmd], opts);

async function isOnline() {
  try {
    return (await adb(['-s', SERIAL, 'get-state'], { timeout: 5000 })).trim() === 'device';
  } catch {
    return false;
  }
}

async function isBooted() {
  try {
    return (await shell('getprop sys.boot_completed', { timeout: 5000 })).trim() === '1';
  } catch {
    return false;
  }
}

async function waitForBoot(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (proc && proc.exitCode !== null) throw new Error('Android stopped unexpectedly while starting.');
    if (await isBooted()) return;
    await sleep(1500);
  }
  throw new Error('Android took too long to start.');
}

async function start() {
  await adb(['start-server']);

  // Reuse an emulator left running by a previous session (e.g. after a crash).
  if (!(await isOnline())) {
    const avd = ensureAvd();
    fs.mkdirSync(paths.logs, { recursive: true });
    const log = fs.openSync(path.join(paths.logs, 'emulator.log'), 'w');
    proc = spawn(paths.emulatorBin(), [
      '-avd', avd,
      '-port', String(CONSOLE_PORT),
      '-no-window',
      '-no-boot-anim',
      '-no-snapshot', // cold boot, never save a snapshot (see avd.js)
      // Pass the Mac's microphone through for calls; without this the
      // emulator feeds Android silence.
      '-allow-host-audio',
      '-no-metrics',
      '-gpu', process.env.EMUSSENGER_GPU || 'host',
      '-memory', process.env.EMUSSENGER_RAM || '2048',
    ], { env: paths.androidEnv(), stdio: ['ignore', log, log] });
    proc.on('exit', (code) => {
      proc = null;
      events.emit('exit', code);
    });
  }

  await waitForBoot(6 * 60 * 1000);

  // Keep the screen on so Messenger stays in the foreground state and the
  // stream never shows a lock screen.
  await shell('svc power stayon true').catch(() => {});
  await shell('settings put system screen_off_timeout 2147483647').catch(() => {});
  await shell('input keyevent KEYCODE_WAKEUP').catch(() => {});
  await shell('wm dismiss-keyguard').catch(() => {});
  // Let apps fill the display whatever its shape, instead of rotating or
  // letterboxing portrait-only screens when the window is wide.
  await shell('wm set-ignore-orientation-request true').catch(() => {});
  // The real screen size follows the window, at 240 dpi so 1 dp = 1.5 px.
  await shell('wm density 240').catch(() => {});
  // Never show an on-screen keyboard: all typing comes from the Mac keyboard.
  await shell('settings put secure show_ime_with_hard_keyboard 0').catch(() => {});
}

// Resizes Android's screen; apps re-lay themselves out for the new size.
async function setDisplaySize(width, height) {
  await shell(`wm size ${width}x${height}`);
}

// Shuts Android down cleanly via the emulator console.
async function stop() {
  if (!(await isOnline())) return;
  await adb(['-s', SERIAL, 'emu', 'kill'], { timeout: 10000 }).catch(() => {});
  const deadline = Date.now() + 30000;
  while (proc && Date.now() < deadline) await sleep(250);
  if (proc) proc.kill('SIGTERM');
}

async function isMessengerInstalled() {
  const out = await shell(`pm list packages ${MESSENGER}`).catch(() => '');
  return out.split('\n').some((l) => l.trim() === `package:${MESSENGER}`);
}

// Preinstalled apps that Messenger doesn't need. Disabling them stops their
// background processes, which otherwise take several hundred MB of RAM.
// Kept on purpose: Play services (push notifications), WebView (in-app
// browser), the launcher, and the Play Store (Messenger updates).
const UNNEEDED_PACKAGES = [
  'com.google.android.googlequicksearchbox',
  'com.google.android.inputmethod.latin', // Mac keys arrive as hardware key events
  'com.google.android.gm',
  'com.google.android.apps.messaging',
  'com.google.android.as',
  'com.google.android.as.oss',
  'com.google.android.deskclock',
  'com.google.android.calendar',
  'com.google.android.dialer',
  'com.google.android.contacts',
  'com.google.android.apps.wellbeing',
  'com.google.android.tts',
  'com.google.android.youtube',
  'com.google.android.apps.youtube.music',
  'com.google.android.apps.photos',
  'com.google.android.apps.maps',
  'com.google.android.apps.docs',
  'com.google.android.apps.wallpaper',
  'com.google.android.apps.customization.pixel',
  'com.google.android.apps.restore',
  'com.google.android.projection.gearhead',
  'com.google.android.feedback',
  'com.google.android.markup',
  'com.google.android.partnersetup',
  'com.google.android.printservice.recommendation',
  'com.android.chrome',
  'com.android.camera2',
  'com.android.printspooler',
  'com.android.bips',
  'com.android.egg',
  'com.android.dreams.basic',
  'com.android.traceur',
  'com.android.stk',
];

async function disableUnneededApps() {
  const enabled = new Set((await shell('pm list packages -e')).split('\n').map((l) => l.replace('package:', '').trim()));
  const todo = UNNEEDED_PACKAGES.filter((p) => enabled.has(p));
  if (!todo.length) return;
  await shell(todo.map((p) => `pm disable-user --user 0 ${p} >/dev/null 2>&1`).join('; '), { timeout: 120000 });
  await shell('am kill-all').catch(() => {});
}

// Reads the on-screen UI (accessibility tree) as XML. Takes ~2 s.
async function dumpUi() {
  return shell('uiautomator dump /data/local/tmp/emussenger-ui.xml >/dev/null 2>&1; cat /data/local/tmp/emussenger-ui.xml', { timeout: 15000 });
}

// Messenger is portrait-only on phones. These platform compat overrides make
// Android ignore that, so it fills a window of any shape instead of being
// letterboxed. They persist, and apply the next time Messenger starts.
const allowAnyOrientation = () =>
  shell(`am compat enable OVERRIDE_ANY_ORIENTATION ${MESSENGER}; ` +
    `am compat enable OVERRIDE_UNDEFINED_ORIENTATION_TO_NOSENSOR ${MESSENGER}`);

const launchMessenger = () =>
  shell(`monkey -p ${MESSENGER} -c android.intent.category.LAUNCHER 1`);

const openPlayStore = () =>
  shell(`am start -a android.intent.action.VIEW -d 'market://details?id=${MESSENGER}'`);

async function foregroundPackage() {
  const out = await shell('dumpsys activity activities | grep topResumedActivity', { timeout: 5000 }).catch(() => '');
  return out.match(/u0 ([\w.]+)\//)?.[1] ?? null;
}

async function isHomeScreen() {
  const pkg = await foregroundPackage();
  if (!pkg) return false;
  const home = await shell('cmd package resolve-activity --brief -c android.intent.category.HOME -a android.intent.action.MAIN', { timeout: 5000 })
    .catch(() => '');
  return home.includes(`${pkg}/`);
}

// Heights (device pixels) of the status bar and navigation bar, so the stream
// can crop them away and show only the app.
async function systemBarInsets() {
  const out = await shell('dumpsys window', { timeout: 10000 }).catch(() => '');
  const bar = (type) => {
    const m = out.match(new RegExp(`type=${type} frame=\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]`));
    return m ? m.slice(1).map(Number) : null;
  };
  const status = bar('statusBars');
  const nav = bar('navigationBars');
  const even = (n) => Math.ceil(n / 2) * 2; // H.264 needs even dimensions
  // "Override size" (if any) is printed after "Physical size" and wins.
  const sizes = [...(await shell('wm size', { timeout: 5000 }).catch(() => '')).matchAll(/(\d+)x(\d+)/g)];
  const size = sizes.at(-1);
  return {
    width: size ? Number(size[1]) : 1920,
    height: size ? Number(size[2]) : 1200,
    top: status ? even(status[3] - status[1]) : 36,
    bottom: nav ? even(nav[3] - nav[1]) : 48,
  };
}

const ABIS = ['armeabi', 'armeabi_v7a', 'arm64_v8a', 'x86', 'x86_64', 'mips', 'mips64'];
const DEVICE_ABI = process.arch === 'arm64' ? 'arm64_v8a' : 'x86_64';

function apksIn(dir) {
  return fs.readdirSync(dir, { recursive: true })
    .filter((f) => f.toLowerCase().endsWith('.apk'))
    .map((f) => path.join(dir, f))
    // Skip native-code splits built for other CPU types.
    .filter((f) => {
      const abi = path.basename(f).match(/config\.([\w]+)\.apk$/i)?.[1]?.toLowerCase();
      return !abi || !ABIS.includes(abi) || abi === DEVICE_ABI;
    });
}

// Installs a user-supplied Messenger package: a plain .apk or a split bundle
// (.apkm / .xapk / .apks, which are zips of APKs). -g grants runtime
// permissions so notifications work without Android permission prompts.
async function installPackageFile(file, tmpDir) {
  const opts = { timeout: 5 * 60 * 1000 };
  if (file.toLowerCase().endsWith('.apk')) {
    await adb(['-s', SERIAL, 'install', '-r', '-g', file], opts);
  } else {
    const dir = path.join(tmpDir, `bundle-${Date.now()}`);
    fs.mkdirSync(dir, { recursive: true });
    try {
      await new Promise((resolve, reject) =>
        execFile('/usr/bin/ditto', ['-x', '-k', file, dir], (err) =>
          err ? reject(new Error("This file couldn't be opened. Use a .apk, .apkm, .xapk or .apks file.")) : resolve()));
      const apks = apksIn(dir);
      if (!apks.length) throw new Error('No Android app was found inside this file.');
      await adb(['-s', SERIAL, 'install-multiple', '-r', '-g', ...apks], opts);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  if (!(await isMessengerInstalled())) {
    throw new Error("That file installed, but it isn't Messenger. Please choose the Messenger app.");
  }
}

module.exports = {
  SERIAL, MESSENGER, events, adb, shell, start, stop,
  isMessengerInstalled, launchMessenger, openPlayStore,
  isHomeScreen, systemBarInsets, installPackageFile, setDisplaySize, allowAnyOrientation, disableUnneededApps, dumpUi,
};
