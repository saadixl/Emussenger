// Makes Enter send the message. Android's Messenger treats Enter as a newline,
// so on Enter we tap its Send button instead. Finding the button needs a UI
// dump (~2 s), so we read it ahead of time: whenever the user starts typing
// after a touch (the only way focus moves), a dump runs in the background.
const emulator = require('./emulator');

// The send button's label is "Send" with text and "Send 👍" (a thumbs-up)
// when the box is empty. We must never tap it while empty.
const THUMBS_UP = /👍|&#128077;|like/i;

const parseBounds = (b) => {
  const m = b?.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  return m ? { x1: +m[1], y1: +m[2], x2: +m[3], y2: +m[4] } : null;
};

function attrs(node) {
  const a = {};
  for (const [, k, v] of node.matchAll(/(\S+?)="([^"]*)"/g)) a[k] = v;
  return a;
}

// Finds the focused text box and a Send button on the same row, to its right.
function findComposer(xml) {
  const nodes = [...xml.matchAll(/<node [^>]*>/g)].map((m) => attrs(m[0]));
  const field = nodes.find((n) => n.class?.endsWith('EditText') && n.focused === 'true');
  if (!field) return null;
  const fb = parseBounds(field.bounds);
  const send = nodes.find((n) => {
    const b = parseBounds(n.bounds);
    return n.clickable === 'true' && /^send/i.test(n['content-desc'] ?? '') &&
      b && fb && b.x1 >= fb.x2 - 4 && b.y1 < fb.y2 && b.y2 > fb.y1;
  });
  if (!send) return null;
  const sb = parseBounds(send.bounds);
  return { x: (sb.x1 + sb.x2) / 2, y: (sb.y1 + sb.y2) / 2, empty: THUMBS_UP.test(send['content-desc']) };
}

// getStream() returns the live scrcpy session; getCrop() the stream crop, used
// to turn device coordinates into stream coordinates.
function createComposer({ getStream, getCrop, getVideoSize }) {
  let cached = null; // { composer, startedAt } from the last dump, or null if stale
  let pending = null;
  let typed = 0; // characters typed since the last send/clear
  let unsure = false; // text may have been removed in ways we can't count
  let lastEditAt = 0;

  function refresh() {
    if (!pending) {
      const startedAt = Date.now();
      pending = emulator.dumpUi()
        .then((xml) => { cached = { composer: findComposer(xml), startedAt }; })
        .catch(() => { cached = null; })
        .finally(() => { pending = null; });
    }
    return pending;
  }

  function tapSend(c) {
    const stream = getStream();
    const crop = getCrop();
    const { width, height } = getVideoSize();
    if (!stream) return;
    const x = c.x - (crop?.x ?? 0);
    const y = c.y - (crop?.y ?? 0);
    stream.touch(0, x, y, width, height);
    stream.touch(1, x, y, width, height);
    typed = 0;
    unsure = false;
    // The Send button stays put after sending, so keep its position for the
    // next message. Touches and resizes still clear it.
  }

  function pressEnterKey() {
    const stream = getStream();
    stream?.key(0, 66, 0);
    stream?.key(1, 66, 0);
  }

  return {
    // Focus or layout may have changed: forget the layout we know.
    invalidate() {
      cached = null;
    },
    onText(text) {
      lastEditAt = Date.now();
      typed += [...text].length;
      if (!cached) refresh();
    },
    onDelete() {
      lastEditAt = Date.now();
      typed = Math.max(0, typed - 1);
      if (typed === 0) unsure = true;
    },
    // Select-all, cut, delete-line: we no longer know if the box has text.
    onBulkEdit() {
      lastEditAt = Date.now();
      unsure = true;
    },
    async enter() {
      // Common case: we just typed into a box whose Send button we know.
      if (cached?.composer && typed > 0 && !unsure) {
        tapSend(cached.composer);
        return;
      }
      // Otherwise decide from a UI read taken after the last edit.
      if (pending) await pending;
      if (!cached || cached.startedAt < lastEditAt) await refresh();
      const c = cached?.composer;
      if (!c) pressEnterKey(); // not in a message box (e.g. search): plain Enter
      else if (!c.empty) tapSend(c);
      // An empty message box: do nothing rather than send a thumbs-up.
    },
  };
}

module.exports = { createComposer, findComposer };
