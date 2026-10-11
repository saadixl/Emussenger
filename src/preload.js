const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (fn) => ipcRenderer.on(channel, (_e, payload) => fn(payload));

contextBridge.exposeInMainWorld('emussenger', {
  ready: () => ipcRenderer.send('app:ready'),
  retry: () => ipcRenderer.send('app:retry'),
  acceptLicense: () => ipcRenderer.send('app:accept-license'),
  openLogs: () => ipcRenderer.send('app:open-logs'),

  onScreen: on('app:screen'),
  onProgress: on('app:progress'),
  onVideoSession: on('video:session'),
  onVideoPacket: on('video:packet'),

  touch: (action, x, y) => ipcRenderer.send('input:touch', { action, x, y }),
  scroll: (x, y, h, v) => ipcRenderer.send('input:scroll', { x, y, h, v }),
  key: (action, keycode, meta) => ipcRenderer.send('input:key', { action, keycode, meta }),
  text: (text) => ipcRenderer.send('input:text', text),
  paste: () => ipcRenderer.send('input:paste'),
  enter: () => ipcRenderer.send('input:enter'),
  resetVideo: () => ipcRenderer.send('video:reset'),

  back: () => ipcRenderer.send('nav:back'),
});
