// Creates the virtual tablet by writing the AVD files directly (no avdmanager).
const fs = require('fs');
const path = require('path');
const paths = require('./paths');
const { API_LEVEL, ABI } = require('./sdk');

const AVD_NAME = 'Emussenger';

// A landscape tablet so Messenger uses its two-pane layout. 1920x1200 at
// 240 dpi is 1280x800 dp: crisp on Retina without a huge video stream.
const CONFIG = {
  AvdId: AVD_NAME,
  'avd.ini.displayname': AVD_NAME,
  'avd.ini.encoding': 'UTF-8',
  'PlayStore.enabled': 'true',
  'abi.type': ABI,
  'hw.cpu.arch': ABI === 'arm64-v8a' ? 'arm64' : 'x86_64',
  'hw.cpu.ncore': '4',
  'hw.ramSize': '2048',
  'vm.heapSize': '256',
  'disk.dataPartition.size': '8G',
  'hw.lcd.width': '1280',
  'hw.lcd.height': '800',
  'hw.lcd.density': '160',
  'hw.initialOrientation': 'landscape',
  'hw.keyboard': 'yes',
  'hw.mainKeys': 'no',
  'hw.gpu.enabled': 'yes',
  'hw.gpu.mode': 'auto',
  'hw.audioInput': 'yes',
  'hw.audioOutput': 'yes',
  'hw.camera.front': 'none',
  'hw.camera.back': 'none',
  'hw.sdCard': 'no',
  'hw.accelerometer': 'no',
  'hw.gps': 'no',
  'hw.sensors.orientation': 'no',
  'hw.sensors.proximity': 'no',
  'fastboot.forceColdBoot': 'no',
  'fastboot.forceFastBoot': 'yes',
  'showDeviceFrame': 'no',
  'image.sysdir.1': `system-images/android-${API_LEVEL}/google_apis_playstore/${ABI}/`,
  'tag.id': 'google_apis_playstore',
  'tag.display': 'Google Play',
  target: `android-${API_LEVEL}`,
};

const toIni = (obj) => Object.entries(obj).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';

function ensureAvd() {
  const avdDir = path.join(paths.avdHome, `${AVD_NAME}.avd`);
  fs.mkdirSync(avdDir, { recursive: true });
  fs.mkdirSync(paths.androidUserHome, { recursive: true });
  fs.writeFileSync(
    path.join(paths.avdHome, `${AVD_NAME}.ini`),
    toIni({ 'avd.ini.encoding': 'UTF-8', path: avdDir, 'path.rel': `avd/${AVD_NAME}.avd`, target: `android-${API_LEVEL}` }),
  );
  // Rewritten every launch so config changes in new app versions apply.
  fs.writeFileSync(path.join(avdDir, 'config.ini'), toIni(CONFIG));
  return AVD_NAME;
}

module.exports = { ensureAvd, AVD_NAME };
