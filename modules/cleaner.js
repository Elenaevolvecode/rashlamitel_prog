/**
 * Модуль очистки.
 *
 * Сканирование и удаление файлов сделаны на Node (fsutil), PowerShell нужен
 * только для Корзины и проверки запущенных браузеров.
 * Итоговые цифры — это то, что реально удалилось, а не то, что нашлось при сканировании.
 */
const path = require('path');
const os = require('os');
const fs = require('fs');
const ps = require('./ps');
const { dedupePaths, scanDir, cleanDir } = require('./fsutil');

const DAY = 86400000;

function filesWord(n) {
  const m10 = n % 10, m100 = n % 100;
  const w = m10 === 1 && m100 !== 11 ? 'файл' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'файла' : 'файлов';
  return `${n} ${w}`;
}

// Браузеры на движке Chromium: папка профилей и имя процесса
const CHROMIUM = [
  { id: 'chrome', name: 'Google Chrome', dir: ['Google', 'Chrome', 'User Data'], process: 'chrome' },
  { id: 'edge', name: 'Microsoft Edge', dir: ['Microsoft', 'Edge', 'User Data'], process: 'msedge' },
  { id: 'yandex', name: 'Яндекс Браузер', dir: ['Yandex', 'YandexBrowser', 'User Data'], process: 'browser' },
];
const CHROMIUM_CACHE_DIRS = ['Cache', 'Code Cache', 'GPUCache'];
const BROWSERS = [
  ...CHROMIUM.map(({ id, name, process }) => ({ id, name, process })),
  { id: 'opera', name: 'Opera', process: 'opera' },
  { id: 'firefox', name: 'Firefox', process: 'firefox' },
];

const DOWNLOAD_EXTS = ['.exe', '.msi', '.iso'];
const DOWNLOAD_MIN_AGE = 30 * DAY;

function listDirs(p, filter) {
  try {
    return fs.readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory() && filter(d.name)).map((d) => d.name);
  } catch { return []; }
}

/**
 * Где искать мусор. env и home подставляются в тестах.
 * Каждая цель: { path, minAgeMs?, browser? }
 */
function getTargets(env = process.env, home = os.homedir()) {
  const local = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const windir = env.WINDIR || env.SystemRoot || 'C:\\Windows';

  const internet = [];
  for (const b of CHROMIUM) {
    const root = path.join(local, ...b.dir);
    const profiles = listDirs(root, (n) => n === 'Default' || n.startsWith('Profile '));
    for (const prof of profiles) {
      for (const c of CHROMIUM_CACHE_DIRS) internet.push({ path: path.join(root, prof, c), browser: b.id });
    }
  }
  const opera = path.join(local, 'Opera Software', 'Opera Stable');
  for (const c of CHROMIUM_CACHE_DIRS) internet.push({ path: path.join(opera, c), browser: 'opera' });
  const ff = path.join(local, 'Mozilla', 'Firefox', 'Profiles');
  for (const prof of listDirs(ff, () => true)) internet.push({ path: path.join(ff, prof, 'cache2'), browser: 'firefox' });

  // Временные файлы: свежие (моложе суток) не трогаем — с ними может работать установщик
  const programs = [
    { path: env.TEMP || path.join(local, 'Temp'), minAgeMs: DAY },
    { path: path.join(windir, 'Temp'), minAgeMs: DAY },
  ];

  const other = [
    { path: path.join(local, 'Microsoft', 'Windows', 'INetCache') },
    { path: path.join(local, 'CrashDumps') },
  ];

  // Убираем дубли и вложенные папки во всех категориях сразу (например, Temp\Low внутри Temp)
  const all = dedupePaths([...internet, ...programs, ...other].map((t) => t.path));
  const keep = (list) => list.filter((t) => all.includes(t.path));
  return {
    internet: keep(internet),
    programs: keep(programs),
    other: keep(other),
    downloads: path.join(home, 'Downloads'),
  };
}

async function scanTargets(targets, now) {
  const res = { size: 0, files: 0, targets: [] };
  for (const t of targets) {
    const s = await scanDir(t.path, { minAgeMs: t.minAgeMs, now });
    if (s.files > 0) {
      res.size += s.bytes; res.files += s.files;
      res.targets.push({ ...t, size: s.bytes });
    }
  }
  return res;
}

function scanDownloads(dir, now = Date.now()) {
  const res = { size: 0, files: 0, items: [] };
  let names;
  try { names = fs.readdirSync(dir); } catch { return res; }
  for (const f of names) {
    if (!DOWNLOAD_EXTS.includes(path.extname(f).toLowerCase())) continue;
    const fp = path.join(dir, f);
    try {
      const st = fs.lstatSync(fp);
      if (!st.isFile()) continue;
      if (now - st.mtimeMs > DOWNLOAD_MIN_AGE) {
        res.size += st.size; res.files += 1;
        res.items.push({ name: f, size: st.size, path: fp });
      }
    } catch {}
  }
  return res;
}

// --- Корзина (только Windows) ---
const RECYCLE_QUERY = `
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class RashRB {
  [StructLayout(LayoutKind.Sequential)] public struct Q { public int cbSize; public long size; public long items; }
  [DllImport("shell32.dll", CharSet=CharSet.Unicode)] public static extern int SHQueryRecycleBin(string root, ref Q q);
}
"@
$q = New-Object RashRB+Q
$q.cbSize = [Runtime.InteropServices.Marshal]::SizeOf($q)
$hr = [RashRB]::SHQueryRecycleBin($null, [ref]$q)
@{ hr = $hr; size = $q.size; items = $q.items } | ConvertTo-Json -Compress
`;

async function queryRecycleBin() {
  if (process.platform !== 'win32') return { size: 0, files: 0 };
  const r = await ps.runJson(RECYCLE_QUERY, {}, null);
  if (!r || r.hr !== 0) return { size: 0, files: 0 };
  return { size: Number(r.size) || 0, files: Number(r.items) || 0 };
}

async function emptyRecycleBin() {
  await ps.run('try { Clear-RecycleBin -Force -ErrorAction Stop } catch {}');
}

// --- Браузеры ---
/** Какие браузеры сейчас открыты (есть окно на экране). */
async function getRunningBrowsers() {
  if (process.platform !== 'win32') return [];
  const names = BROWSERS.map((b) => b.process);
  const running = await ps.runJson(
    `@(Get-Process -Name $A.names -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | ` +
    `Select-Object -ExpandProperty ProcessName -Unique) | ConvertTo-Json -Compress`,
    { names }, []);
  const list = Array.isArray(running) ? running : running ? [running] : [];
  const lower = list.map((n) => String(n).toLowerCase());
  return BROWSERS.filter((b) => lower.includes(b.process)).map(({ id, name }) => ({ id, name }));
}

/** Аккуратно закрыть окна браузеров (как крестиком). Принудительно не убиваем — чтобы ничего не потерять. */
async function closeBrowsers(ids) {
  const procs = BROWSERS.filter((b) => ids.includes(b.id)).map((b) => b.process);
  if (!procs.length || process.platform !== 'win32') return [];
  await ps.run(
    `Get-Process -Name $A.procs -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | ` +
    `ForEach-Object { [void]$_.CloseMainWindow() }
     $deadline = (Get-Date).AddSeconds(8)
     while ((Get-Date) -lt $deadline) {
       if (-not (Get-Process -Name $A.procs -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })) { break }
       Start-Sleep -Milliseconds 300
     }`, { procs });
  const still = await getRunningBrowsers();
  return still.filter((b) => ids.includes(b.id));
}

// --- Основной сценарий ---
async function scan({ env, home, now = Date.now() } = {}) {
  const t = getTargets(env, home);
  const r = {
    internet: await scanTargets(t.internet, now),
    programs: await scanTargets(t.programs, now),
    other: await scanTargets(t.other, now),
    downloads: scanDownloads(t.downloads, now),
    recycle: await queryRecycleBin(),
  };
  r.total = r.internet.size + r.programs.size + r.other.size + r.downloads.size + r.recycle.size;
  return r;
}

const STEPS = [
  { id: 'internet', text: 'Убираю мусор из интернета…', sub: 'Chrome, Яндекс Браузер, Edge, Opera, Firefox' },
  { id: 'programs', text: 'Удаляю остатки от программ…', sub: 'Временные файлы Windows' },
  { id: 'recycle', text: 'Очищаю корзину…', sub: '' },
  { id: 'downloads', text: 'Проверяю скачанные файлы…', sub: 'Старые установщики — в Корзину' },
  { id: 'other', text: 'Почти готово!', sub: 'Кэш и отчёты об ошибках' },
];

async function cleanTargets(targets, opts, skipBrowsers) {
  const res = { freed: 0, failed: 0 };
  for (const t of targets) {
    if (t.browser && skipBrowsers.includes(t.browser)) continue;
    const c = await cleanDir(t.path, { minAgeMs: t.minAgeMs, dryRun: opts.dryRun, now: opts.now });
    res.freed += c.freed; res.failed += c.failed;
  }
  return res;
}

/**
 * opts: { dryRun, emptyRecycle, skipBrowsers: [id], trash: async (path) => void, now }
 * trash — перемещение файла в Корзину (в Electron это shell.trashItem).
 */
async function clean(scanResults, opts = {}, onProgress = () => {}) {
  const o = { dryRun: !!opts.dryRun, emptyRecycle: !!opts.emptyRecycle, skipBrowsers: opts.skipBrowsers || [],
    trash: opts.trash, now: opts.now || Date.now() };
  const result = { dryRun: o.dryRun, totalFreed: 0, movedToTrash: 0, failedFiles: 0,
    skipped: { recycle: !o.emptyRecycle, browsers: o.skipBrowsers } };

  for (let i = 0; i < STEPS.length; i++) {
    const step = { ...STEPS[i] };
    if (step.id === 'recycle') step.sub = o.emptyRecycle ? filesWord(scanResults.recycle.files) : 'Пропускаю — вы решили не очищать';
    onProgress({ step: i, total: STEPS.length, id: step.id, text: step.text, sub: step.sub, freed: result.totalFreed });

    let freed = 0;
    if (step.id === 'internet' || step.id === 'programs' || step.id === 'other') {
      const r = await cleanTargets(scanResults[step.id].targets, o, step.id === 'internet' ? o.skipBrowsers : []);
      freed = r.freed; result.failedFiles += r.failed;
    } else if (step.id === 'recycle') {
      if (o.emptyRecycle) {
        if (o.dryRun) freed = scanResults.recycle.size;
        else {
          const before = (await queryRecycleBin()).size;
          await emptyRecycleBin();
          const after = (await queryRecycleBin()).size;
          freed = Math.max(0, before - after);
        }
      }
    } else if (step.id === 'downloads') {
      for (const item of scanResults.downloads.items) {
        if (o.dryRun) { freed += item.size; continue; }
        if (!o.trash) continue;
        try { await o.trash(item.path); freed += item.size; } catch { result.failedFiles += 1; }
      }
    }

    result[step.id] = freed;
    // Перенесённое в Корзину место ещё занято — в «освобождено» не считаем
    if (step.id === 'downloads') result.movedToTrash = freed;
    else result.totalFreed += freed;
    onProgress({ step: i, total: STEPS.length, id: step.id, text: step.text, sub: step.sub, freed: result.totalFreed, done: true });
  }
  return result;
}

module.exports = { filesWord, scan, clean, getTargets, scanDownloads, getRunningBrowsers, closeBrowsers, STEPS, BROWSERS };
