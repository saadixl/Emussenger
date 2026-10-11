// In development the app runs inside node_modules/electron's Electron.app, so
// the Dock, menu bar and notifications say "Electron". This renames that
// bundle (macOS shows the bundle's file name in the Dock and Finder), updates
// its Info.plist and swaps in our icon. Packaged builds get all of this from
// electron-builder.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

if (process.platform !== 'darwin') process.exit(0);

const NAME = 'Emussenger';
const electronDir = path.join(__dirname, '..', 'node_modules', 'electron');
const dist = path.join(electronDir, 'dist');
const appDir = path.join(dist, `${NAME}.app`);
const icon = path.join(__dirname, '..', 'build', 'icon.icns');

// A fresh `npm install` brings back Electron.app.
const stock = path.join(dist, 'Electron.app');
if (fs.existsSync(stock)) {
  fs.rmSync(appDir, { recursive: true, force: true });
  fs.renameSync(stock, appDir);
}
if (!fs.existsSync(appDir)) process.exit(0);

// The electron package launches whatever path.txt points to.
fs.writeFileSync(path.join(electronDir, 'path.txt'), `${NAME}.app/Contents/MacOS/Electron`);

const plist = path.join(appDir, 'Contents', 'Info.plist');
const set = (key, value) => {
  try {
    execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, plist]);
  } catch {
    execFileSync('/usr/libexec/PlistBuddy', ['-c', `Add :${key} string ${value}`, plist]);
  }
};
set('CFBundleName', NAME);
set('CFBundleDisplayName', NAME);
set('CFBundleIdentifier', 'dev.emussenger.app.dev');

if (fs.existsSync(icon)) {
  fs.copyFileSync(icon, path.join(appDir, 'Contents', 'Resources', 'electron.icns'));
}
// Editing Info.plist invalidates the bundle's signature; re-sign it ad hoc.
execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', appDir], { stdio: 'ignore' });
// Nudge Launch Services and the Dock to pick up the new name and icon.
fs.utimesSync(appDir, new Date(), new Date());
execFileSync('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister', ['-f', appDir]);
console.log(`Branded the development Electron app as ${NAME}.app`);
