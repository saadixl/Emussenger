// Decodes the scrcpy H.264 stream with WebCodecs and paints it on a canvas.
(() => {
  const canvas = document.getElementById('screen');
  const ctx = canvas.getContext('2d');

  let decoder = null;
  let codec = null;
  let config = null; // latest SPS/PPS, prepended to the next key frame
  let pendingConfig = false;
  let needKey = true;
  let onFirstFrame = null;

  // Builds "avc1.PPCCLL" from the SPS NAL unit in an Annex B config packet.
  function codecFromConfig(data) {
    for (let i = 0; i + 4 < data.length; i++) {
      if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1 && (data[i + 3] & 0x1f) === 7) {
        const hex = (b) => b.toString(16).padStart(2, '0');
        return `avc1.${hex(data[i + 4])}${hex(data[i + 5])}${hex(data[i + 6])}`;
      }
    }
    return 'avc1.640028';
  }

  function createDecoder() {
    if (decoder && decoder.state !== 'closed') decoder.close();
    decoder = new VideoDecoder({
      output(frame) {
        if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
          canvas.width = frame.displayWidth;
          canvas.height = frame.displayHeight;
        }
        ctx.drawImage(frame, 0, 0);
        frame.close();
        if (onFirstFrame) {
          onFirstFrame();
          onFirstFrame = null;
        }
      },
      error(err) {
        console.error('decoder error', err);
        decoder = null;
        needKey = true;
        window.emussenger.resetVideo();
      },
    });
    decoder.configure({ codec, optimizeForLatency: true, hardwareAcceleration: 'prefer-hardware' });
    needKey = true;
  }

  function handlePacket({ data, config: isConfig, key, pts }) {
    if (isConfig) {
      config = data;
      pendingConfig = true;
      const c = codecFromConfig(data);
      if (c !== codec || !decoder || decoder.state === 'closed') {
        codec = c;
        createDecoder();
      }
      needKey = true;
      return;
    }
    if (!decoder || decoder.state === 'closed') {
      if (!codec) return;
      createDecoder();
    }
    if (needKey && !key) return;

    let payload = data;
    if (key && pendingConfig && config) {
      payload = new Uint8Array(config.length + data.length);
      payload.set(config, 0);
      payload.set(data, config.length);
      pendingConfig = false;
    }
    decoder.decode(new EncodedVideoChunk({ type: key ? 'key' : 'delta', timestamp: pts, data: payload }));
    needKey = false;
  }

  window.video = {
    handlePacket,
    whenFirstFrame(fn) {
      onFirstFrame = fn;
    },
    // A new session starts after rotation or a stream restart.
    reset() {
      pendingConfig = false;
      needKey = true;
    },
  };
})();
