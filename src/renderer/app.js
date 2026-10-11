(() => {
  const api = window.emussenger;
  const $ = (id) => document.getElementById(id);

  const gb = (bytes) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  let screen = null;

  function show(name) {
    screen = name;
    for (const el of document.querySelectorAll('[data-screen]')) {
      el.classList.toggle('active', el.dataset.screen === name);
    }
    $('nav').hidden = name !== 'running';
  }

  api.onScreen(({ screen: name, ...data }) => {
    const wasRunning = screen === 'running';
    show(name);
    if (name === 'license') {
      $('license-size').textContent = `about ${gb(data.totalSize)}`;
      $('license-text').textContent = data.licenses.join('\n\n────────\n\n');
    } else if (name === 'booting') {
      $('boot-hint').textContent = data.firstBoot
        ? 'The first start takes a minute or two.'
        : 'This takes a few seconds.';
    } else if (name === 'install-messenger') {
      $('install-exts').textContent = data.extensions.map((e) => `.${e}`).join(' / ');
      $('install-error').hidden = !data.error;
      $('install-error').textContent = data.error ?? '';
    } else if (name === 'error') {
      $('error-message').textContent = data.message;
    } else if (name === 'running') {
      $('playstore-banner').hidden = !data.playStore;
      if (!wasRunning) {
        $('connecting').hidden = false;
        window.video.whenFirstFrame(() => {
          $('connecting').hidden = true;
        });
      }
      window.input.focus();
    }
  });

  api.onProgress(({ step, name, received, total }) => {
    const pct = total ? (received / total) * 100 : 0;
    $('progress-fill').style.width = `${pct.toFixed(1)}%`;
    $('progress-label').textContent = step === 'extract' ? `Unpacking ${name}…` : `Downloading ${name}…`;
    $('progress-detail').textContent = `${gb(received)} of ${gb(total)}`;
  });

  api.onVideoSession(() => window.video.reset());
  api.onVideoPacket((p) => window.video.handlePacket(p));

  // Dropping a file anywhere in the window installs it while the
  // "Add Messenger" screen is up; otherwise drops are ignored (Electron would
  // navigate to the file).
  const dropzone = $('dropzone');
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.toggle('over', screen === 'install-messenger');
  });
  window.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget) dropzone.classList.remove('over');
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('over');
    const file = e.dataTransfer.files[0];
    if (file && screen === 'install-messenger') api.installFile(file);
  });

  $('btn-accept').addEventListener('click', () => api.acceptLicense());
  $('btn-retry').addEventListener('click', () => api.retry());
  $('btn-logs').addEventListener('click', () => api.openLogs());
  $('btn-choose').addEventListener('click', () => api.chooseFile());
  $('link-playstore').addEventListener('click', (e) => {
    e.preventDefault();
    api.installFromPlayStore();
  });
  $('btn-cancel-playstore').addEventListener('click', () => api.cancelPlayStore());
  $('btn-back').addEventListener('click', () => api.back());

  api.ready();
})();
