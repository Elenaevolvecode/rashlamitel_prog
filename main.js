const { app, BrowserWindow, ipcMain, shell, screen } = require('electron');
const path = require('path');
const cleaner = require('./modules/cleaner');
const autostart = require('./modules/autostart');
const programs = require('./modules/programs');
const { createStore } = require('./modules/store');

let mainWindow, store, lastScan = null, cleaning = false;

// Окно 600×700, но на невысоких экранах ноутбуков (1366×768) уменьшаем высоту,
// чтобы окно целиком помещалось над панелью задач вместе с заголовком.
const WIN_W = 600, WIN_H = 700, TITLE_BAR = 40, MIN_H = 520;
function fitHeight() {
  const work = screen.getPrimaryDisplay().workAreaSize.height;
  return Math.max(MIN_H, Math.min(WIN_H, work - TITLE_BAR));
}

/**
 * Окно уже создано: меряем его настоящий размер с рамкой и заголовком
 * (он зависит от масштаба экрана и темы Windows) и, если окно не влезает
 * над панелью задач, уменьшаем высоту и ставим его по центру свободной области.
 */
function fitToWorkArea(win) {
  try {
    const wa = screen.getDisplayMatching(win.getBounds()).workArea;
    const outer = win.getBounds();
    const [cw, ch] = win.getContentSize();
    const frame = outer.height - ch; // заголовок + рамки, как есть на этом компьютере
    const maxContent = wa.height - frame - 4;
    if (ch > maxContent) {
      win.setResizable(true); // на части систем размер нерастягиваемого окна не меняется
      win.setContentSize(cw, Math.max(MIN_H, maxContent));
      win.setResizable(false);
    }
    const b = win.getBounds();
    win.setPosition(Math.round(wa.x + (wa.width - b.width) / 2), Math.round(wa.y + Math.max(0, (wa.height - b.height) / 2)));
  } catch (e) { console.error('fitToWorkArea', e); }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: WIN_W, height: fitHeight(), useContentSize: true, center: true,
    resizable: false, maximizable: false, fullscreenable: false,
    title: 'Расхламитель ПК',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false, contextIsolation: true, sandbox: true,
    },
    backgroundColor: '#FFFFFF',
  });
  fitToWorkArea(mainWindow);
  mainWindow.loadFile('index.html');
  mainWindow.setMenuBarVisibility(false);
  // Ссылки (сайт, почта) открываем в браузере, а не внутри программы
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https:|mailto:)/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  if (process.argv.includes('--dev')) mainWindow.webContents.openDevTools({ mode: 'detach' });
}

function send(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, data);
}

// --- Настройки ---
ipcMain.handle('store:getAll', () => store.getAll());
ipcMain.handle('store:set', (e, key, value) => store.set(key, value));

// --- Очистка ---
ipcMain.handle('cleaner:scan', async () => {
  try { lastScan = await cleaner.scan(); }
  catch (e) { console.error(e); lastScan = null; }
  if (!lastScan) return { total: 0, internet: { size: 0 }, programs: { size: 0 }, recycle: { size: 0, files: 0 }, downloads: { size: 0 }, other: { size: 0 } };
  // В интерфейс отдаём только цифры, без списков путей
  const brief = (c) => ({ size: c.size, files: c.files });
  return { total: lastScan.total, internet: brief(lastScan.internet), programs: brief(lastScan.programs),
    recycle: brief(lastScan.recycle), downloads: brief(lastScan.downloads), other: brief(lastScan.other) };
});

ipcMain.handle('cleaner:runningBrowsers', () => cleaner.getRunningBrowsers());
ipcMain.handle('cleaner:closeBrowsers', (e, ids) => cleaner.closeBrowsers(Array.isArray(ids) ? ids : []));

ipcMain.handle('cleaner:clean', async (e, opts = {}) => {
  if (cleaning) return null;
  cleaning = true;
  try {
    if (!lastScan) lastScan = await cleaner.scan();
    const dryRun = store.get('dryRun');
    const result = await cleaner.clean(lastScan, {
      dryRun,
      emptyRecycle: !!opts.emptyRecycle,
      skipBrowsers: Array.isArray(opts.skipBrowsers) ? opts.skipBrowsers : [],
      trash: (p) => shell.trashItem(p),
    }, (p) => send('cleaner:progress', p));
    store.addClean(result.totalFreed, dryRun);
    lastScan = null;
    return result;
  } catch (err) {
    console.error(err);
    return { totalFreed: 0, movedToTrash: 0, error: true };
  } finally {
    cleaning = false;
  }
});

// --- Автозагрузка ---
ipcMain.handle('autostart:get', async () => {
  try { return await autostart.getAutostart(); } catch (e) { console.error(e); return []; }
});
ipcMain.handle('autostart:set', (e, id, enabled) => autostart.setEnabled(String(id), !!enabled));

// --- Программы ---
ipcMain.handle('programs:get', async () => {
  try { return await programs.getInstalledPrograms(); } catch (e) { console.error(e); return []; }
});
ipcMain.handle('programs:uninstall', (e, id) => programs.uninstallProgram(String(id)));

// --- Ссылки из «О программе» ---
ipcMain.handle('app:openExternal', (e, url) => {
  if (typeof url === 'string' && /^(https:\/\/(evolvecode|rashlamitel)\.ru|mailto:hello@evolvecode\.ru)/.test(url)) shell.openExternal(url);
});
ipcMain.handle('app:version', () => app.getVersion());

// Не даём запустить вторую копию программы
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
  });
  app.whenReady().then(() => {
    store = createStore(app.getPath('userData'));
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
