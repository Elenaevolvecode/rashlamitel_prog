const { app, BrowserWindow, ipcMain, shell, screen } = require('electron');
const path = require('path');
const cleaner = require('./modules/cleaner');
const autostart = require('./modules/autostart');
const programs = require('./modules/programs');
const { createStore } = require('./modules/store');
const reminder = require('./modules/reminder');

const APP_ID = 'ru.rashlamitel.pc'; // совпадает с appId сборки — нужно Windows для уведомлений
// Запуск из Планировщика: без окна, только проверить мусор и при необходимости напомнить
const REMIND_MODE = process.argv.includes('--remind');

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

function createWindow({ openPreview = false } = {}) {
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
  mainWindow.loadFile('index.html', openPreview ? { query: { open: 'preview' } } : {});
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

// --- Напоминания ---
/** Создать/обновить задание в Планировщике по текущим настройкам. В режиме разработки задание не трогаем. */
async function syncReminder() {
  if (!app.isPackaged) return 'dev';
  try {
    return await reminder.syncTask({ enabled: store.get('reminderEnabled'), days: store.get('reminderDays'), exe: process.execPath });
  } catch (e) { console.error('syncReminder', e); return false; }
}
ipcMain.handle('reminder:sync', () => syncReminder());

/**
 * Своё окошко-напоминание в правом нижнем углу.
 * Не уведомление Windows: те многие отключают целиком, а включать их за человека нельзя —
 * на него посыплются уведомления всех программ. Окошко работает при любых настройках Windows.
 */
let reminderWindow = null;
const REM_W = 440, REM_H = 178;

function showReminderWindow(gbText, sample) {
  if (reminderWindow && !reminderWindow.isDestroyed()) reminderWindow.close();
  const wa = screen.getPrimaryDisplay().workArea;
  reminderWindow = new BrowserWindow({
    width: REM_W, height: REM_H, useContentSize: true,
    x: wa.x + wa.width - REM_W - 16, y: wa.y + wa.height - REM_H - 16,
    frame: false, resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
    alwaysOnTop: true, skipTaskbar: true, show: false, title: 'Расхламитель ПК',
    icon: path.join(__dirname, 'assets', 'icon.png'), backgroundColor: '#FFFFFF',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  reminderWindow.loadFile('reminder.html', { query: { gb: gbText, sample: sample ? '1' : '0' } });
  // Показываем, не перехватывая клавиатуру у того, чем человек сейчас занят
  reminderWindow.once('ready-to-show', () => reminderWindow.showInactive());
  reminderWindow.on('closed', () => {
    reminderWindow = null;
    // Запуск-напоминание без главного окна: окошко закрыли — программа тоже закрывается
    if (!mainWindow || mainWindow.isDestroyed()) app.quit();
  });
}

function openMainWithPreview() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show(); mainWindow.focus();
    send('app:open-preview');
  } else createWindow({ openPreview: true });
}

ipcMain.handle('reminder:action', async (e, action) => {
  if (action === 'open') openMainWithPreview(); // главное окно создаём до закрытия окошка, чтобы программа не закрылась
  if (action === 'never') {
    store.set('reminderEnabled', false);
    await syncReminder();
    send('app:settings-changed');
  }
  if (reminderWindow && !reminderWindow.isDestroyed()) reminderWindow.close();
});

/** Поискать мусор и показать окошко. force — показать даже при малом количестве (проверка из настроек). */
async function remindCheck({ force = false } = {}) {
  let scan;
  try { scan = await cleaner.scan({ deep: false }); } catch (e) { console.error(e); return false; }
  const bytes = reminder.reminderBytes(scan.items, store.get('cleanChoices') || {});
  const enough = reminder.shouldRemind(bytes);
  if (!enough && !force) return false;
  showReminderWindow(reminder.gbText(bytes), !enough);
  return true;
}
ipcMain.handle('reminder:test', () => remindCheck({ force: true }));

// --- Очистка ---
const ids = (v) => (Array.isArray(v) ? v.map(String) : []);

ipcMain.handle('cleaner:scan', async () => {
  try { lastScan = await cleaner.scan(); }
  catch (e) { console.error(e); lastScan = { items: [], total: 0 }; }
  return cleaner.forUi(lastScan); // в интерфейс — только цифры и тексты, без путей
});

/** Какие из выбранных пунктов принадлежат открытым сейчас программам. */
ipcMain.handle('cleaner:runningApps', async (e, selected) => {
  if (!lastScan) return [];
  const sel = new Set(ids(selected));
  const withProc = lastScan.items.filter((i) => sel.has(i.id) && i.process);
  const running = await cleaner.runningProcesses(withProc.map((i) => i.process));
  return withProc.filter((i) => running.includes(i.process.toLowerCase())).map((i) => ({ id: i.id, title: i.title }));
});

/** Закрыть программы этих пунктов. Возвращает id тех, что не закрылись. */
ipcMain.handle('cleaner:closeApps', async (e, list) => {
  if (!lastScan) return [];
  const sel = new Set(ids(list));
  const items = lastScan.items.filter((i) => sel.has(i.id) && i.process);
  const still = await cleaner.closeProcesses(items.map((i) => i.process));
  return items.filter((i) => still.includes(i.process.toLowerCase())).map((i) => i.id);
});

ipcMain.handle('cleaner:clean', async (e, opts = {}) => {
  if (cleaning) return null;
  cleaning = true;
  try {
    if (!lastScan) lastScan = await cleaner.scan();
    const dryRun = store.get('dryRun');
    const result = await cleaner.clean(lastScan, {
      dryRun, selected: ids(opts.selected), skip: ids(opts.skip),
      trash: (p) => shell.trashItem(p),
    }, (p) => send('cleaner:progress', p));
    store.addClean(result.totalFreed + result.movedToTrash, dryRun);
    lastScan = null;
    return result;
  } catch (err) {
    console.error(err);
    return { error: true };
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
  if (typeof url === 'string' && /^(https:\/\/evolvecode\.ru(\/|$)|mailto:hello@evolvecode\.ru$)/.test(url)) shell.openExternal(url);
});
ipcMain.handle('app:version', () => app.getVersion());

if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

// Не даём запустить вторую копию программы.
// Если программа уже открыта, запуск-напоминание просто тихо завершается.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
    else createWindow(); // человек открыл программу, пока висело напоминание
  });
  app.whenReady().then(async () => {
    store = createStore(app.getPath('userData'));
    if (REMIND_MODE) {
      // Напоминания выключили, а задание почему-то осталось — убираем его и выходим
      if (!store.get('reminderEnabled')) { await syncReminder(); app.quit(); return; }
      const shown = await remindCheck();
      if (!shown) { app.quit(); return; }
      // Окошко ждёт ответа (человек мог отойти от компьютера), но не дольше 12 часов
      setTimeout(() => { if (!mainWindow || mainWindow.isDestroyed()) app.quit(); }, 12 * 60 * 60000);
      return;
    }
    createWindow();
    syncReminder(); // срок напоминания отсчитывается от последнего запуска
  });
  app.on('window-all-closed', () => app.quit());
}
