// Renders build/icon.svg to build/icon.png and build/icon.icns.
// Run with: npx electron scripts/build-icons.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { app, BrowserWindow } = require('electron');

const BUILD = path.join(__dirname, '..', 'build');
const SIZE = 1024;

app.dock?.hide();

app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(BUILD, 'icon.svg'), 'utf8');
  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true },
  });
  const html = `<html><body style="margin:0;background:transparent">${svg}</body></html>`;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((r) => setTimeout(r, 300));
  const image = await win.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE });
  const png = path.join(BUILD, 'icon.png');
  fs.writeFileSync(png, image.resize({ width: SIZE, height: SIZE }).toPNG());

  // Build the .icns from the standard iconset sizes.
  const iconset = path.join(os.tmpdir(), `emussenger-${Date.now()}.iconset`);
  fs.mkdirSync(iconset);
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const px = size * scale;
      const name = `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`;
      execFileSync('/usr/bin/sips', ['-z', String(px), String(px), png, '--out', path.join(iconset, name)], { stdio: 'ignore' });
    }
  }
  execFileSync('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', path.join(BUILD, 'icon.icns')]);
  fs.rmSync(iconset, { recursive: true, force: true });
  console.log('Wrote build/icon.png and build/icon.icns');
  app.quit();
});
