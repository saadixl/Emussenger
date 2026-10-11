// Tiny JSON-backed store for install/setup progress.
const fs = require('fs');
const path = require('path');
const paths = require('./paths');

let cache;

function get() {
  if (!cache) {
    try {
      cache = JSON.parse(fs.readFileSync(paths.state, 'utf8'));
    } catch {
      cache = {};
    }
  }
  return cache;
}

function update(fn) {
  const s = get();
  fn(s);
  fs.mkdirSync(path.dirname(paths.state), { recursive: true });
  fs.writeFileSync(paths.state, JSON.stringify(s, null, 2));
}

module.exports = { get, update };
