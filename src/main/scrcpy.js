// Minimal scrcpy v5 client: streams the emulator screen as H.264 and injects
// input. Protocol reference: scrcpy doc/develop.md and server sources at v5.0.1.
const net = require('net');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const paths = require('./paths');
const emulator = require('./emulator');

const SCRCPY_VERSION = '5.0.1';
const DEVICE_SERVER_PATH = '/data/local/tmp/emussenger-scrcpy-server.jar';

const MSG = {
  INJECT_KEYCODE: 0,
  INJECT_TEXT: 1,
  INJECT_TOUCH_EVENT: 2,
  INJECT_SCROLL_EVENT: 3,
  BACK_OR_SCREEN_ON: 4,
  SET_CLIPBOARD: 9,
  RESET_VIDEO: 17,
};
const DEVICE_MSG_CLIPBOARD = 0;
const DEVICE_MSG_ACK_CLIPBOARD = 1;
const DEVICE_MSG_UHID_OUTPUT = 2;
const POINTER_ID_MOUSE = -1n;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Accumulates socket chunks and hands out exact-size reads.
class ByteQueue {
  constructor() {
    this.chunks = [];
    this.length = 0;
  }
  push(chunk) {
    this.chunks.push(chunk);
    this.length += chunk.length;
  }
  read(n) {
    if (n > this.length) return null;
    const out = Buffer.allocUnsafe(n);
    let off = 0;
    while (off < n) {
      const c = this.chunks[0];
      const take = Math.min(c.length, n - off);
      c.copy(out, off, 0, take);
      off += take;
      if (take === c.length) this.chunks.shift();
      else this.chunks[0] = c.subarray(take);
    }
    this.length -= n;
    return out;
  }
  peek(n) {
    const out = this.read(n);
    if (out) {
      this.chunks.unshift(out);
      this.length += n;
    }
    return out;
  }
}

const toI16FixedPoint = (v) => {
  const clamped = Math.max(-1, Math.min(1, v));
  return Math.max(-0x8000, Math.min(0x7fff, Math.round(clamped * 0x8000)));
};

class ScrcpySession extends EventEmitter {
  // crop: { width, height, x, y } in device pixels, or null for the full screen.
  constructor({ crop = null } = {}) {
    super();
    this.crop = crop;
    this.serverProc = null;
    this.video = null;
    this.control = null;
    this.forwardPort = null;
    this.clipboardSeq = 1n;
    this.stopped = false;
  }

  async start() {
    await emulator.adb(['-s', emulator.SERIAL, 'push', paths.scrcpyServer(), DEVICE_SERVER_PATH]);

    const scid = Math.floor(Math.random() * 0x7fffffff);
    const socketName = `scrcpy_${scid.toString(16).padStart(8, '0')}`;
    const out = await emulator.adb(['-s', emulator.SERIAL, 'forward', 'tcp:0', `localabstract:${socketName}`]);
    this.forwardPort = Number(out.trim());

    const args = [
      `scid=${scid.toString(16).padStart(8, '0')}`,
      'log_level=info',
      'audio=false',
      'tunnel_forward=true',
      'control=true',
      'video_codec=h264',
      'video_bit_rate=8000000',
      'max_fps=60',
      'clipboard_autosync=true',
      'cleanup=true',
      'power_on=true',
    ];
    if (this.crop) {
      const { width, height, x, y } = this.crop;
      args.push(`crop=${width}:${height}:${x}:${y}`);
    }
    this.serverProc = spawn(paths.adbBin(), [
      '-s', emulator.SERIAL, 'shell',
      `CLASSPATH=${DEVICE_SERVER_PATH} app_process / com.genymobile.scrcpy.Server ${SCRCPY_VERSION} ${args.join(' ')}`,
    ], { env: paths.androidEnv() });
    this.serverProc.stdout.on('data', (d) => this.emit('log', d.toString()));
    this.serverProc.stderr.on('data', (d) => this.emit('log', d.toString()));
    this.serverProc.on('exit', () => {
      if (!this.stopped) this.emit('closed');
    });

    this.video = await this.connectFirstSocket();
    this.control = await this.connect();
    this.readVideo(this.video);
    this.readControl(this.control);
  }

  connect() {
    return new Promise((resolve, reject) => {
      const s = net.connect(this.forwardPort, '127.0.0.1');
      s.setNoDelay(true);
      s.once('connect', () => resolve(s));
      s.once('error', reject);
    });
  }

  // With a forward tunnel, adb accepts the connection even before the server
  // listens; the dummy byte tells us the server is really there.
  async connectFirstSocket() {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline && !this.stopped) {
      const s = await this.connect().catch(() => null);
      if (s) {
        const ok = await new Promise((resolve) => {
          const onData = (d) => {
            cleanup();
            if (d.length > 1) s.unshift(d.subarray(1));
            resolve(true);
          };
          const onEnd = () => {
            cleanup();
            resolve(false);
          };
          const cleanup = () => {
            s.off('data', onData);
            s.off('close', onEnd);
            s.off('error', onEnd);
          };
          s.on('data', onData);
          s.once('close', onEnd);
          s.once('error', onEnd);
        });
        if (ok) {
          s.pause();
          return s;
        }
        s.destroy();
      }
      await sleep(100);
    }
    throw new Error('Could not connect to the Android screen stream.');
  }

  readVideo(socket) {
    const q = new ByteQueue();
    let stage = 'deviceMeta';
    let header = null;

    const drain = () => {
      for (;;) {
        if (stage === 'deviceMeta') {
          const b = q.read(64);
          if (!b) return;
          stage = 'codec';
        } else if (stage === 'codec') {
          const b = q.read(4);
          if (!b) return;
          const codec = b.readUInt32BE(0);
          if (codec === 0 || codec === 1) {
            this.emit('error', new Error('The Android screen encoder failed to start.'));
            return;
          }
          stage = 'header';
        } else if (stage === 'header') {
          const b = q.read(12);
          if (!b) return;
          if (b[0] & 0x80) {
            // Session packet: a new capture session (e.g. after rotation).
            this.emit('session', { width: b.readUInt32BE(4), height: b.readUInt32BE(8) });
          } else {
            const ptsFlags = b.readBigUInt64BE(0);
            header = {
              config: (ptsFlags & (1n << 62n)) !== 0n,
              key: (ptsFlags & (1n << 61n)) !== 0n,
              pts: Number(ptsFlags & ((1n << 61n) - 1n)),
              size: b.readUInt32BE(8),
            };
            stage = 'payload';
          }
        } else if (stage === 'payload') {
          const data = q.read(header.size);
          if (!data) return;
          this.emit('packet', { ...header, data });
          stage = 'header';
        }
      }
    };

    socket.on('data', (chunk) => {
      q.push(chunk);
      drain();
    });
    socket.on('close', () => {
      if (!this.stopped) this.emit('closed');
    });
    socket.resume();
  }

  readControl(socket) {
    const q = new ByteQueue();
    socket.on('data', (chunk) => {
      q.push(chunk);
      for (;;) {
        const type = q.peek(1)?.[0];
        if (type === undefined) return;
        if (type === DEVICE_MSG_CLIPBOARD) {
          const head = q.peek(5);
          if (!head) return;
          const len = head.readUInt32BE(1);
          const msg = q.read(5 + len);
          if (!msg) return;
          this.emit('clipboard', msg.subarray(5).toString('utf8'));
        } else if (type === DEVICE_MSG_ACK_CLIPBOARD) {
          if (!q.read(9)) return;
        } else if (type === DEVICE_MSG_UHID_OUTPUT) {
          const head = q.peek(5);
          if (!head) return;
          if (!q.read(5 + head.readUInt16BE(3))) return;
        } else {
          // Unknown message: the stream is out of sync, stop parsing it.
          socket.removeAllListeners('data');
          return;
        }
      }
    });
    socket.on('error', () => {});
  }

  send(buf) {
    if (this.control && !this.control.destroyed) this.control.write(buf);
  }

  // action: 0 down, 1 up, 2 move (Android MotionEvent actions).
  touch(action, x, y, width, height) {
    const b = Buffer.alloc(32);
    b.writeUInt8(MSG.INJECT_TOUCH_EVENT, 0);
    b.writeUInt8(action, 1);
    b.writeBigInt64BE(POINTER_ID_MOUSE, 2);
    b.writeInt32BE(Math.round(x), 10);
    b.writeInt32BE(Math.round(y), 14);
    b.writeUInt16BE(width, 18);
    b.writeUInt16BE(height, 20);
    b.writeUInt16BE(action === 1 ? 0 : 0xffff, 22); // pressure
    b.writeInt32BE(1, 24); // action button: primary
    b.writeInt32BE(action === 1 ? 0 : 1, 28); // buttons held
    this.send(b);
  }

  // hScroll/vScroll in wheel "ticks", positive = left/up (Android convention).
  scroll(x, y, width, height, hScroll, vScroll) {
    const b = Buffer.alloc(21);
    b.writeUInt8(MSG.INJECT_SCROLL_EVENT, 0);
    b.writeInt32BE(Math.round(x), 1);
    b.writeInt32BE(Math.round(y), 5);
    b.writeUInt16BE(width, 9);
    b.writeUInt16BE(height, 11);
    b.writeInt16BE(toI16FixedPoint(hScroll / 16), 13);
    b.writeInt16BE(toI16FixedPoint(vScroll / 16), 15);
    b.writeInt32BE(0, 17);
    this.send(b);
  }

  // action: 0 down, 1 up.
  key(action, keycode, metaState = 0, repeat = 0) {
    const b = Buffer.alloc(14);
    b.writeUInt8(MSG.INJECT_KEYCODE, 0);
    b.writeUInt8(action, 1);
    b.writeInt32BE(keycode, 2);
    b.writeInt32BE(repeat, 6);
    b.writeInt32BE(metaState, 10);
    this.send(b);
  }

  text(str) {
    const data = Buffer.from(str, 'utf8');
    const b = Buffer.alloc(5);
    b.writeUInt8(MSG.INJECT_TEXT, 0);
    b.writeUInt32BE(data.length, 1);
    this.send(Buffer.concat([b, data]));
  }

  setClipboard(str, paste) {
    const data = Buffer.from(str, 'utf8');
    const b = Buffer.alloc(14);
    b.writeUInt8(MSG.SET_CLIPBOARD, 0);
    b.writeBigUInt64BE(this.clipboardSeq++, 1);
    b.writeUInt8(paste ? 1 : 0, 9);
    b.writeUInt32BE(data.length, 10);
    this.send(Buffer.concat([b, data]));
  }

  // Asks the server to restart the encoder, which sends a fresh key frame.
  resetVideo() {
    this.send(Buffer.from([MSG.RESET_VIDEO]));
  }

  back() {
    this.send(Buffer.from([MSG.BACK_OR_SCREEN_ON, 0]));
    this.send(Buffer.from([MSG.BACK_OR_SCREEN_ON, 1]));
  }

  async stop() {
    this.stopped = true;
    this.video?.destroy();
    this.control?.destroy();
    this.serverProc?.kill();
    if (this.forwardPort) {
      await emulator.adb(['-s', emulator.SERIAL, 'forward', '--remove', `tcp:${this.forwardPort}`]).catch(() => {});
    }
  }
}

module.exports = { ScrcpySession };
