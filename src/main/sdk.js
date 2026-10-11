// Installs the Android emulator, platform-tools and a Google Play system image
// straight from Google's SDK repository: no Java, sdkmanager or Homebrew needed.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { net } = require('electron');
const { XMLParser } = require('fast-xml-parser');
const paths = require('./paths');
const state = require('./state');

const execFileP = promisify(execFile);

const REPO = 'https://dl.google.com/android/repository/';
const SYSIMG_REPO = `${REPO}sys-img/google_apis_playstore/`;
const API_LEVEL = 34;
const ABI = process.arch === 'arm64' ? 'arm64-v8a' : 'x86_64';
const HOST_ARCH = process.arch === 'arm64' ? 'aarch64' : 'x64';
const SYSIMG_PATH = `system-images;android-${API_LEVEL};google_apis_playstore;${ABI}`;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  removeNSPrefix: true,
  isArray: (name) => ['remotePackage', 'archive', 'license'].includes(name),
});

async function fetchManifest(url) {
  const res = await net.fetch(url);
  if (!res.ok) throw new Error(`Could not reach Google (HTTP ${res.status})`);
  // Root is <sdk-repository> or <sdk-sys-img> depending on the manifest.
  const doc = parser.parse(await res.text());
  return doc[Object.keys(doc).find((k) => k.startsWith('sdk-'))];
}

function revisionString(rev) {
  return ['major', 'minor', 'micro'].map((k) => rev[k]).filter((v) => v !== undefined).join('.');
}

function pickPackage(manifest, pkgPath, baseUrl, target) {
  const pkg = manifest.remotePackage.find(
    (p) => p.path === pkgPath && p.channelRef.ref === 'channel-0',
  );
  if (!pkg) throw new Error(`${pkgPath} is not available from Google right now`);
  const archive = pkg.archives.archive.find(
    (a) => (!a['host-os'] || a['host-os'] === 'macosx') && (!a['host-arch'] || a['host-arch'] === HOST_ARCH),
  );
  if (!archive) throw new Error(`${pkgPath} has no download for this Mac`);
  const licenseId = pkg['uses-license'].ref;
  const license = manifest.license.find((l) => l.id === licenseId);
  return {
    id: pkgPath,
    name: pkg['display-name'],
    revision: revisionString(pkg.revision),
    url: baseUrl + archive.complete.url,
    size: Number(archive.complete.size),
    sha1: archive.complete.checksum['#text'] ?? archive.complete.checksum,
    target,
    licenseId,
    licenseText: license?.['#text'] ?? '',
  };
}

// Resolves the exact packages (and their licenses) to install.
async function resolvePackages() {
  const [repo, sysimg] = await Promise.all([
    fetchManifest(`${REPO}repository2-3.xml`),
    fetchManifest(`${SYSIMG_REPO}sys-img2-3.xml`),
  ]);
  return [
    pickPackage(repo, 'platform-tools', REPO, path.join(paths.sdk, 'platform-tools')),
    pickPackage(repo, 'emulator', REPO, path.join(paths.sdk, 'emulator')),
    pickPackage(
      sysimg,
      SYSIMG_PATH,
      SYSIMG_REPO,
      path.join(paths.sdk, 'system-images', `android-${API_LEVEL}`, 'google_apis_playstore', ABI),
    ),
  ];
}

function isInstalled() {
  const installed = state.get().installed || {};
  return ['platform-tools', 'emulator', SYSIMG_PATH].every((id) => installed[id]) &&
    fs.existsSync(paths.emulatorBin()) && fs.existsSync(paths.adbBin());
}

async function download(pkg, onBytes) {
  fs.mkdirSync(paths.downloads, { recursive: true });
  const file = path.join(paths.downloads, path.basename(pkg.url));
  const done = fs.existsSync(file) ? fs.statSync(file).size : 0;

  if (done < pkg.size) {
    // Resume a partial download if we have one.
    const headers = done > 0 ? { Range: `bytes=${done}-` } : {};
    const res = await net.fetch(pkg.url, { headers });
    if (!res.ok) throw new Error(`Download failed for ${pkg.name} (HTTP ${res.status})`);
    const resumed = res.status === 206;
    let received = resumed ? done : 0;
    onBytes(received);
    const counter = new Transform({
      transform(chunk, _enc, cb) {
        received += chunk.length;
        onBytes(received);
        cb(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(file, { flags: resumed ? 'a' : 'w' }));
  } else {
    onBytes(pkg.size);
  }

  const hash = crypto.createHash('sha1');
  await pipeline(fs.createReadStream(file), hash);
  if (hash.digest('hex') !== pkg.sha1) {
    fs.rmSync(file, { force: true });
    throw new Error(`${pkg.name} download was corrupted. Please try again.`);
  }
  return file;
}

async function extract(zipFile, target) {
  const staging = `${target}.staging`;
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  // ditto keeps executable bits, symlinks and code signatures intact.
  await execFileP('/usr/bin/ditto', ['-x', '-k', zipFile, staging]);
  const entries = fs.readdirSync(staging).filter((e) => !e.startsWith('.') && e !== '__MACOSX');
  const inner = entries.length === 1 ? path.join(staging, entries[0]) : staging;
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.renameSync(inner, target);
  fs.rmSync(staging, { recursive: true, force: true });
}

function freeBytes(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const s = fs.statfsSync(dir);
  return s.bavail * s.bsize;
}

// onProgress({ step, name, received, total }) — step is 'download' | 'extract'.
async function install(packages, onProgress) {
  const installed = state.get().installed || {};
  const todo = packages.filter((p) => installed[p.id] !== p.revision || !fs.existsSync(p.target));

  const needed = todo.reduce((n, p) => n + p.size * 2.5, 0) + 6 * 1024 ** 3;
  if (freeBytes(paths.root) < needed) {
    const gb = (needed / 1024 ** 3).toFixed(1);
    throw new Error(`Not enough disk space. Emussenger needs about ${gb} GB free.`);
  }

  const total = todo.reduce((n, p) => n + p.size, 0);
  let before = 0;
  for (const pkg of todo) {
    const file = await download(pkg, (bytes) =>
      onProgress({ step: 'download', name: pkg.name, received: before + bytes, total }),
    );
    before += pkg.size;
    onProgress({ step: 'extract', name: pkg.name, received: before, total });
    await extract(file, pkg.target);
    fs.rmSync(file, { force: true });
    state.update((s) => {
      s.installed = { ...(s.installed || {}), [pkg.id]: pkg.revision };
    });
  }
}

module.exports = { resolvePackages, install, isInstalled, API_LEVEL, ABI };
