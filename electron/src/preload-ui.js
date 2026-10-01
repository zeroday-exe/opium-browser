const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('opium', {
  layout: (rect) => ipcRenderer.send('layout', rect),
  win: (action) => ipcRenderer.send('win', action),
  newTab: (url) => ipcRenderer.send('tab:new', url),
  closeTab: (id) => ipcRenderer.send('tab:close', id),
  activate: (id) => ipcRenderer.send('tab:activate', id),
  openSettings: () => ipcRenderer.send('settings:open'),
  nav: (action, value) => ipcRenderer.send('nav', { action, value }),
  suggest: (q) => ipcRenderer.invoke('suggest', q),
  toggleBookmark: () => ipcRenderer.invoke('bookmark:toggle'),
  on: (channel, fn) => {
    const allowed = ['tabs', 'focus-url', 'toggle-sidebar', 'toast', 'maximized', 'appearance', 'focus'];
    if (allowed.includes(channel)) ipcRenderer.on(channel, (_e, payload) => fn(payload));
  },
});
