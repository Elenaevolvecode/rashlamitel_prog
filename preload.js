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
  getRunningApps: (selected) => ipcRenderer.invoke('cleaner:runningApps', selected),
  closeApps: (ids) => ipcRenderer.invoke('cleaner:closeApps', ids),
  // Автозагрузка
  getAutostart: () => ipcRenderer.invoke('autostart:get'),
  setAutostart: (id, enabled) => ipcRenderer.invoke('autostart:set', id, enabled),
  setAutostartMany: (ids, enabled) => ipcRenderer.invoke('autostart:setMany', ids, enabled),
  // Программы
  getPrograms: () => ipcRenderer.invoke('programs:get'),
  uninstallProgram: (id) => ipcRenderer.invoke('programs:uninstall', id),
  // Что занимает место
  scanSpace: () => ipcRenderer.invoke('space:scan'),
  onSpaceProgress: (cb) => { ipcRenderer.removeAllListeners('space:progress'); ipcRenderer.on('space:progress', (e, t) => cb(t)); },
  openSpaceFolder: (id) => ipcRenderer.invoke('space:openFolder', id),
  showSpaceFile: (id) => ipcRenderer.invoke('space:showFile', id),
  trashSpaceFile: (id) => ipcRenderer.invoke('space:trashFile', id),
  // Напоминания
  syncReminder: () => ipcRenderer.invoke('reminder:sync'),
  testReminder: () => ipcRenderer.invoke('reminder:test'),
  reminderAction: (action) => ipcRenderer.invoke('reminder:action', action),
  onSettingsChanged: (cb) => { ipcRenderer.removeAllListeners('app:settings-changed'); ipcRenderer.on('app:settings-changed', () => cb()); },
  onOpenPreview: (cb) => { ipcRenderer.removeAllListeners('app:open-preview'); ipcRenderer.on('app:open-preview', () => cb()); },
  // Прочее
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  getVersion: () => ipcRenderer.invoke('app:version'),
});
