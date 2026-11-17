const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const cleaner = require('./modules/cleaner');
const autostart = require('./modules/autostart');
const programs = require('./modules/programs');

let mainWindow, lastScanResults = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 600, height: 690,
    resizable: false, maximizable: false, fullscreenable: false,
    title: 'Расхламитель ПК',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false, contextIsolation: true,
    },
    backgroundColor: '#FFFFFF',
  });
  mainWindow.loadFile('index.html');
  mainWindow.setMenuBarVisibility(false);
  if (process.argv.includes('--dev')) mainWindow.webContents.openDevTools({ mode: 'detach' });
}

// Cleaner
ipcMain.handle('cleaner:scan', async () => {
  try { lastScanResults = await cleaner.scan(); return lastScanResults; }
  catch (e) { console.error(e); return { total:0, internet:{size:0}, programs:{size:0}, recycle:{size:0}, downloads:{size:0}, other:{size:0} }; }
});
ipcMain.handle('cleaner:clean', async () => {
  if (!lastScanResults) lastScanResults = await cleaner.scan();
  try {
    const r = await cleaner.clean(lastScanResults, (p) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('cleaner:progress', p);
    });
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('cleaner:done', r);
    lastScanResults = null; return r;
  } catch (e) { console.error(e); return { totalFreed: 0 }; }
});
ipcMain.handle('cleaner:isBrowserRunning', (e, n) => cleaner.isBrowserRunning(n));
ipcMain.handle('cleaner:closeBrowser', (e, n) => cleaner.closeBrowser(n));

// Autostart — name + location
ipcMain.handle('autostart:get', async () => {
  try { return await autostart.getAutostart(); } catch(e) { console.error(e); return []; }
});
ipcMain.handle('autostart:disable', (e, name, location) => autostart.disableAutostart(name, location));
ipcMain.handle('autostart:enable', (e, name, location) => autostart.enableAutostart(name, location));

// Programs
ipcMain.handle('programs:get', async () => {
  try { return await programs.getInstalledPrograms(); } catch(e) { console.error(e); return []; }
});
ipcMain.handle('programs:uninstall', (e, uninstStr, quietStr) => programs.uninstallProgram(uninstStr, quietStr));

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
