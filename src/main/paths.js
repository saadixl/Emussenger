const path = require('path');
const { app } = require('electron');

const root = path.join(app.getPath('appData'), 'Emussenger');

const paths = {
  root,
  sdk: path.join(root, 'sdk'),
  downloads: path.join(root, 'downloads'),
  avdHome: path.join(root, 'avd'),
  androidUserHome: path.join(root, 'android-home'),
  state: path.join(root, 'state.json'),
  logs: path.join(root, 'logs'),
  emulatorBin: () => path.join(paths.sdk, 'emulator', 'emulator'),
  adbBin: () => path.join(paths.sdk, 'platform-tools', 'adb'),
  scrcpyServer: () =>
    app.isPackaged
      ? path.join(process.resourcesPath, 'scrcpy-server')
      : path.join(__dirname, '..', '..', 'resources', 'scrcpy-server'),
};

// Environment shared by every adb/emulator process we spawn. Everything lives
// under our own app-data folder and uses a private adb server port, so we never
// collide with an Android Studio install on the same Mac.
paths.androidEnv = () => ({
  ...process.env,
  ANDROID_HOME: paths.sdk,
  ANDROID_SDK_ROOT: paths.sdk,
  ANDROID_AVD_HOME: paths.avdHome,
  ANDROID_USER_HOME: paths.androidUserHome,
  ANDROID_EMULATOR_HOME: paths.androidUserHome,
  ANDROID_ADB_SERVER_PORT: '5038',
});

module.exports = paths;
