// Turns mouse, trackpad and keyboard input into Android touch/key events.
(() => {
  const api = window.emussenger;
  const canvas = document.getElementById('screen');
  const ime = document.getElementById('ime');

  const ACTION_DOWN = 0;
  const ACTION_UP = 1;
  const ACTION_MOVE = 2;

  // Android KeyEvent meta-state flags.
  const META_SHIFT = 0x1 | 0x40;
  const META_ALT = 0x2 | 0x10;
  const META_CTRL = 0x1000 | 0x2000;

  // DOM key -> Android keycode for keys that are not plain text.
  const KEYCODES = {
    Enter: 66,
    Backspace: 67,
    Delete: 112,
    Tab: 61,
    Escape: 111,
    ArrowUp: 19,
    ArrowDown: 20,
    ArrowLeft: 21,
    ArrowRight: 22,
    Home: 122,
    End: 123,
    PageUp: 92,
    PageDown: 93,
  };

  // Maps a client point to device pixels, honouring the letterboxing that
  // object-fit: contain adds around the video.
  function toDevice(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    const vw = canvas.width;
    const vh = canvas.height;
    if (!vw || !vh) return null;
    const scale = Math.min(r.width / vw, r.height / vh);
    const ox = (r.width - vw * scale) / 2;
    const oy = (r.height - vh * scale) / 2;
    const x = (clientX - r.left - ox) / scale;
    const y = (clientY - r.top - oy) / scale;
    return {
      x: Math.max(0, Math.min(vw - 1, x)),
      y: Math.max(0, Math.min(vh - 1, y)),
      inside: x >= 0 && y >= 0 && x < vw && y < vh,
    };
  }

  let pointerDown = false;

  canvas.addEventListener('pointerdown', (e) => {
    const p = toDevice(e.clientX, e.clientY);
    if (!p?.inside) return;
    if (e.button === 2) return api.back();
    if (e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    pointerDown = true;
    api.touch(ACTION_DOWN, p.x, p.y);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!pointerDown) return;
    // Coalesced events keep fast swipes smooth.
    for (const ev of e.getCoalescedEvents?.() ?? [e]) {
      const p = toDevice(ev.clientX, ev.clientY);
      if (p) api.touch(ACTION_MOVE, p.x, p.y);
    }
  });

  const endTouch = (e) => {
    if (!pointerDown) return;
    pointerDown = false;
    const p = toDevice(e.clientX, e.clientY);
    if (p) api.touch(ACTION_UP, p.x, p.y);
    ime.focus();
  };
  canvas.addEventListener('pointerup', endTouch);
  canvas.addEventListener('pointercancel', endTouch);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // Trackpads send many small pixel deltas; Android accepts fractional ticks.
  const PIXELS_PER_TICK = 40;
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = toDevice(e.clientX, e.clientY);
    if (!p?.inside) return;
    const unit = e.deltaMode === 1 ? PIXELS_PER_TICK : e.deltaMode === 2 ? PIXELS_PER_TICK * 10 : 1;
    const h = (-e.deltaX * unit) / PIXELS_PER_TICK;
    const v = (-e.deltaY * unit) / PIXELS_PER_TICK;
    api.scroll(p.x, p.y, Math.max(-16, Math.min(16, h)), Math.max(-16, Math.min(16, v)));
  }, { passive: false });

  function sendKey(keycode, meta) {
    api.key(ACTION_DOWN, keycode, meta);
    api.key(ACTION_UP, keycode, meta);
  }

  ime.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    // ⌘ shortcuts are handled by the app menu (copy, paste, back…).
    if (e.metaKey) {
      if (e.key === 'ArrowLeft') sendKey(KEYCODES.Home, 0);
      else if (e.key === 'ArrowRight') sendKey(KEYCODES.End, 0);
      else if (e.key === 'Backspace') {
        sendKey(KEYCODES.Home, META_SHIFT);
        sendKey(KEYCODES.Backspace, 0);
      } else return;
      e.preventDefault();
      return;
    }
    // Enter sends the message; Shift+Enter (below) inserts a new line.
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.ctrlKey) {
      e.preventDefault();
      api.enter();
      return;
    }
    const keycode = KEYCODES[e.key];
    if (keycode === undefined) return; // plain text arrives via the input event
    e.preventDefault();
    let meta = 0;
    if (e.shiftKey) meta |= META_SHIFT;
    // macOS word navigation (⌥←, ⌥⌫) maps to Ctrl on Android.
    if (e.altKey) meta |= META_CTRL;
    if (e.ctrlKey) meta |= META_CTRL;
    sendKey(keycode, meta);
  });

  // Typed characters, IME compositions (Bangla, Chinese…) and the emoji picker
  // all land in the hidden textarea; forward whatever it receives.
  ime.addEventListener('input', (e) => {
    if (e.isComposing) return;
    if (ime.value) api.text(ime.value);
    ime.value = '';
  });
  ime.addEventListener('compositionend', () => {
    if (ime.value) api.text(ime.value);
    ime.value = '';
  });

  window.addEventListener('focus', () => ime.focus());

  window.input = {
    focus: () => ime.focus(),
  };
})();
