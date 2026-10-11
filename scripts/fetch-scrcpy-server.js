// Downloads the scrcpy server (Apache-2.0) that gets bundled into the app.
// The version must match SCRCPY_VERSION in src/main/scrcpy.js.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const VERSION = '5.0.1';
const SHA256 = '764eb6f79811d5211fe9df341120882ba9994c7a61b897d7bf3fb662e53bc536';
const URL = `https://github.com/Genymobile/scrcpy/releases/download/v${VERSION}/scrcpy-server-v${VERSION}`;
const DEST = path.join(__dirname, '..', 'resources', 'scrcpy-server');
// Apache-2.0 requires shipping the license with the bundled server.
const LICENSE_URL = `https://raw.githubusercontent.com/Genymobile/scrcpy/v${VERSION}/LICENSE`;
const LICENSE_DEST = path.join(__dirname, '..', 'resources', 'scrcpy-LICENSE.txt');

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

async function fetchLicense() {
  if (fs.existsSync(LICENSE_DEST)) return;
  const res = await fetch(LICENSE_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${LICENSE_URL}`);
  fs.mkdirSync(path.dirname(LICENSE_DEST), { recursive: true });
  fs.writeFileSync(LICENSE_DEST, await res.text());
}

async function main() {
  await fetchLicense();
  if (fs.existsSync(DEST) && sha256(fs.readFileSync(DEST)) === SHA256) return;
  console.log(`Downloading scrcpy-server v${VERSION}…`);
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${URL}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (sha256(buf) !== SHA256) throw new Error('scrcpy-server checksum mismatch');
  fs.mkdirSync(path.dirname(DEST), { recursive: true });
  fs.writeFileSync(DEST, buf);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
