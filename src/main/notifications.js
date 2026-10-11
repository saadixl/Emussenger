// Mirrors Messenger's Android notifications to macOS by polling
// `dumpsys notification`, so no companion app is needed on the device.
const { Notification, app } = require('electron');
const emulator = require('./emulator');

const POLL_MS = 3000;
const FLAG_GROUP_SUMMARY = 0x200;

function parse(dump) {
  const records = [];
  const blocks = dump.split('NotificationRecord(').slice(1);
  for (const block of blocks) {
    if (!block.includes(`pkg=${emulator.MESSENGER} `)) continue;
    const key = block.match(/key=(\S+?): Notification\(/)?.[1];
    if (!key) continue;
    const flags = parseInt(block.match(/\n\s+flags=0x([0-9a-f]+)/i)?.[1] ?? '0', 16);
    const extra = (name) => block.match(new RegExp(`${name}=(?:String|SpannableString) \\((.*)\\)\\s*\\n`))?.[1];
    records.push({
      key,
      summary: (flags & FLAG_GROUP_SUMMARY) !== 0,
      title: extra('android\\.title') ?? 'Messenger',
      text: extra('android\\.bigText') ?? extra('android\\.text') ?? '',
    });
  }
  return records.filter((r) => !r.summary);
}

function createNotifier({ onClick, isWindowFocused }) {
  let timer = null;
  let seen = null; // key -> "title\ntext"

  async function poll() {
    let dump;
    try {
      dump = await emulator.shell('dumpsys notification --noredact', { timeout: 10000 });
    } catch {
      return;
    }
    const records = parse(dump);
    const next = new Map(records.map((r) => [r.key, `${r.title}\n${r.text}`]));

    if (seen && !isWindowFocused()) {
      for (const r of records) {
        if (seen.get(r.key) === next.get(r.key)) continue;
        const n = new Notification({ title: r.title, body: r.text, silent: true });
        n.on('click', () => onClick(r));
        n.show();
      }
    }
    seen = next;
    app.dock?.setBadge(records.length ? String(records.length) : '');
  }

  return {
    start() {
      if (timer) return;
      poll();
      timer = setInterval(poll, POLL_MS);
    },
    stop() {
      clearInterval(timer);
      timer = null;
    },
  };
}

module.exports = { createNotifier, parse };
