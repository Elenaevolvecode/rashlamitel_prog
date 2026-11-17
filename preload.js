const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('rashlamitel', {
  scan: () => ipcRenderer.invoke('cleaner:scan'),
  clean: () => ipcRenderer.invoke('cleaner:clean'),
  onCleanProgress: (cb) => ipcRenderer.on('cleaner:progress', (e, d) => cb(d)),
  onCleanDone: (cb) => ipcRenderer.on('cleaner:done', (e, d) => cb(d)),
  isBrowserRunning: (n) => ipcRenderer.invoke('cleaner:isBrowserRunning', n),
  closeBrowser: (n) => ipcRenderer.invoke('cleaner:closeBrowser', n),
  getAutostart: () => ipcRenderer.invoke('autostart:get'),
  disableAutostart: (name, location) => ipcRenderer.invoke('autostart:disable', name, location),
  enableAutostart: (name, location) => ipcRenderer.invoke('autostart:enable', name, location),
  getPrograms: () => ipcRenderer.invoke('programs:get'),
  uninstallProgram: (uninstStr, quietStr) => ipcRenderer.invoke('programs:uninstall', uninstStr, quietStr),
});
