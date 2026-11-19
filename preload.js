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
  // Программы
  getPrograms: () => ipcRenderer.invoke('programs:get'),
  uninstallProgram: (id) => ipcRenderer.invoke('programs:uninstall', id),
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
