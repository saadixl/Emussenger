const { Menu, app } = require('electron');

// Android keycodes for the Ctrl shortcuts that ⌘ maps to.
const KEY = { A: 29, C: 31, V: 50, X: 52, Z: 54 };
const META_CTRL = 0x1000 | 0x2000;
const META_SHIFT = 0x1 | 0x40;

// actions: { getStream(), getWindow(), paste(), back(), openMessenger(), onBulkEdit() }
function buildMenu(actions) {
  const ctrlKey = (keycode, extraMeta = 0) => () => {
    const stream = actions.getStream();
    if (!stream) return;
    stream.key(0, keycode, META_CTRL | extraMeta);
    stream.key(1, keycode, META_CTRL | extraMeta);
    // Undo/redo/cut/select-all can change or empty the message box.
    if (keycode !== KEY.C) actions.onBulkEdit();
  };
  // Outside the Android screen (setup pages) fall back to normal editing.
  const edit = (androidFn, webFn) => () => {
    if (actions.getStream()) androidFn();
    else actions.getWindow()?.webContents[webFn]();
  };

  const template = [
    { role: 'appMenu' },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'Cmd+Z', click: edit(ctrlKey(KEY.Z), 'undo') },
        { label: 'Redo', accelerator: 'Shift+Cmd+Z', click: edit(ctrlKey(KEY.Z, META_SHIFT), 'redo') },
        { type: 'separator' },
        { label: 'Cut', accelerator: 'Cmd+X', click: edit(ctrlKey(KEY.X), 'cut') },
        { label: 'Copy', accelerator: 'Cmd+C', click: edit(ctrlKey(KEY.C), 'copy') },
        {
          label: 'Paste',
          accelerator: 'Cmd+V',
          click: edit(() => actions.paste(), 'paste'),
        },
        { label: 'Select All', accelerator: 'Cmd+A', click: edit(ctrlKey(KEY.A), 'selectAll') },
      ],
    },
    {
      label: 'Go',
      submenu: [
        { label: 'Back', accelerator: 'Cmd+[', click: () => actions.back() },
        { label: 'Reopen Messenger', accelerator: 'Cmd+1', click: () => actions.openMessenger() },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }]),
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = { buildMenu };
