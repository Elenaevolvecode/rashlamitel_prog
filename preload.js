const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rashlamitel', {
  // Настройки
  getSettings: () => ipcRenderer.invoke('store:getAll'),
  setSetting: (key, value) => ipcRenderer.invoke('store:set', key, value),
  // Очистка
  scan: () => ipcRenderer.invoke('cleaner:scan'),
  clean: (opts) => ipcRenderer.invoke('cleaner:clean', opts),
  // Подписка одна: при повторном вызове старый обработчик снимается
  onCleanProgress: (cb) => {
    ipcRenderer.removeAllListeners('cleaner:progress');
    ipcRenderer.on('cleaner:progress', (e, d) => cb(d));
  },
  getRunningBrowsers: () => ipcRenderer.invoke('cleaner:runningBrowsers'),
  closeBrowsers: (ids) => ipcRenderer.invoke('cleaner:closeBrowsers', ids),
  // Автозагрузка
  getAutostart: () => ipcRenderer.invoke('autostart:get'),
  setAutostart: (id, enabled) => ipcRenderer.invoke('autostart:set', id, enabled),
  // Программы
  getPrograms: () => ipcRenderer.invoke('programs:get'),
  uninstallProgram: (id) => ipcRenderer.invoke('programs:uninstall', id),
  // Прочее
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  getVersion: () => ipcRenderer.invoke('app:version'),
});
