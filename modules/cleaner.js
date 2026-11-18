/**
 * Модуль очистки.
 *
 * Мусор разбит на понятные пункты (браузер, временные файлы, Telegram…).
 * У каждого пункта пояснение простым языком: что это, почему можно удалить, что будет после.
 * Сканирование и удаление файлов — на Node (fsutil); PowerShell нужен только для Корзины
 * и проверки, открыты ли программы.
 * Итоговые цифры — то, что реально удалилось, а не то, что нашлось при сканировании.
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

function listDirs(p, filter = () => true) {
  try {
    return fs.readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory() && filter(d.name)).map((d) => d.name);
  } catch { return []; }
}

const CHROMIUM_CACHE_DIRS = ['Cache', 'Code Cache', 'GPUCache'];

/** Кэш браузера на Chromium: все профили (Default, Profile 1, …). */
function chromiumCache(root) {
  const out = [];
  for (const prof of listDirs(root, (n) => n === 'Default' || n.startsWith('Profile '))) {
    for (const c of CHROMIUM_CACHE_DIRS) out.push(path.join(root, prof, c));
  }
  return out;
}

function browserTexts(name) {
  return {
    what: `Кусочки сайтов, которые ${name} сохранил «про запас», чтобы быстрее их открывать.`,
    why: 'Пароли, закладки, история и входы на сайты не трогаю — только этот запас.',
    after: 'Сайты первый раз откроются чуть медленнее, потом всё как обычно.',
  };
}

const DOWNLOAD_EXTS = ['.exe', '.msi', '.iso'];
const DOWNLOAD_MIN_AGE = 30 * DAY;

/**
 * Описание всех пунктов очистки. env и home подставляются в тестах.
 * kind: 'dirs' — чистим содержимое папок; 'downloads' — старые установщики в Корзину; 'recycle' — Корзина.
 * process — имя процесса программы: если она открыта, её файлы заняты, спросим, закрыть ли.
 */
function getItems(env = process.env, home = os.homedir()) {
  const local = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const roaming = env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const windir = env.WINDIR || env.SystemRoot || 'C:\\Windows';
  const tdata = path.join(roaming, 'Telegram Desktop', 'tdata');

  const items = [
    // --- Интернет ---
    { id: 'chrome', group: 'internet', icon: '🌐', title: 'Google Chrome', process: 'chrome',
      paths: chromiumCache(path.join(local, 'Google', 'Chrome', 'User Data')), ...browserTexts('Chrome') },
    { id: 'yandex', group: 'internet', icon: '🌐', title: 'Яндекс Браузер', process: 'browser',
      paths: chromiumCache(path.join(local, 'Yandex', 'YandexBrowser', 'User Data')), ...browserTexts('Яндекс Браузер') },
    { id: 'edge', group: 'internet', icon: '🌐', title: 'Microsoft Edge', process: 'msedge',
      paths: chromiumCache(path.join(local, 'Microsoft', 'Edge', 'User Data')), ...browserTexts('Edge') },
    { id: 'opera', group: 'internet', icon: '🌐', title: 'Opera', process: 'opera',
      paths: CHROMIUM_CACHE_DIRS.map((c) => path.join(local, 'Opera Software', 'Opera Stable', c)), ...browserTexts('Opera') },
    { id: 'firefox', group: 'internet', icon: '🌐', title: 'Firefox', process: 'firefox',
      paths: listDirs(path.join(local, 'Mozilla', 'Firefox', 'Profiles')).map((p) => path.join(local, 'Mozilla', 'Firefox', 'Profiles', p, 'cache2')),
      ...browserTexts('Firefox') },

    // --- Программы ---
    { id: 'telegram', group: 'apps', icon: '💬', title: 'Telegram', process: 'Telegram',
      paths: listDirs(tdata, (n) => n.startsWith('user_data')).flatMap((u) => [path.join(tdata, u, 'cache'), path.join(tdata, u, 'media_cache')]),
      what: 'Картинки, видео и стикеры из чатов, которые вы уже смотрели. Telegram хранит копии, чтобы показывать их быстрее.',
      why: 'Всё хранится на серверах Telegram — переписка и файлы не пропадут. Файлы, которые вы сами скачали в «Загрузки», не трогаю.',
      after: 'Старые фото и видео в чатах при открытии загрузятся заново.' },
    { id: 'discord', group: 'apps', icon: '🎧', title: 'Discord', process: 'Discord',
      paths: CHROMIUM_CACHE_DIRS.map((c) => path.join(roaming, 'discord', c)),
      what: 'Временные файлы Discord: картинки, аватарки, кусочки интерфейса.',
      why: 'Сообщения и серверы хранятся в интернете, у Discord.',
      after: 'Discord первый раз откроется чуть медленнее.' },
    { id: 'steam', group: 'apps', icon: '🎮', title: 'Steam', process: 'steamwebhelper',
      paths: [path.join(local, 'Steam', 'htmlcache')],
      what: 'Сохранённые страницы магазина и сообщества Steam.',
      why: 'Игры и сохранения в играх не трогаю.',
      after: 'Магазин Steam первый раз откроется чуть медленнее.' },

    // --- Windows ---
    { id: 'temp', group: 'windows', icon: '📁', title: 'Временные файлы', minAgeMs: DAY,
      paths: [env.TEMP || path.join(local, 'Temp'), path.join(windir, 'Temp')],
      what: 'Файлы, которые программы создают на время работы и забывают за собой убрать — как крошки после обеда.',
      why: 'Беру только файлы старше суток — с ними уже никто не работает. Занятые файлы пропускаю.',
      after: 'Ничего не изменится, просто станет больше места.' },
    { id: 'syscache', group: 'windows', icon: '🧾', title: 'Отчёты об ошибках и кэш Windows',
      paths: [path.join(local, 'Microsoft', 'Windows', 'INetCache'), path.join(local, 'CrashDumps')],
      what: 'Отчёты о сбоях программ и старый кэш встроенного браузера Windows.',
      why: 'Эти отчёты нужны только разработчикам программ, вам — нет.',
      after: 'Ничего не изменится.' },

    // --- Ваши файлы ---
    { id: 'downloads', group: 'user', icon: '📥', title: 'Старые установщики', kind: 'downloads',
      dir: path.join(home, 'Downloads'),
      what: 'Файлы установки программ (.exe, .msi, .iso) в «Загрузках», которые лежат больше месяца. Программы давно установлены, а установщики занимают место.',
      why: 'Не удаляю насовсем, а переношу в Корзину — если что, их можно вернуть.',
      after: 'Место освободится, когда очистите Корзину.' },
    { id: 'recycle', group: 'user', icon: '🗑', title: 'Корзина', kind: 'recycle', defaultOn: false,
      what: 'Файлы, которые вы удалили сами.',
      warn: 'Вернуть их после очистки будет нельзя. Поэтому галочка не стоит — поставьте, только если уверены.',
      after: 'Место освободится сразу.' },
  ];

  // Одна и та же папка не должна попасть в два пункта, и вложенные папки не считаем дважды
  const allPaths = dedupePaths(items.flatMap((i) => i.paths || []));
  for (const i of items) if (i.paths) i.paths = i.paths.filter((p) => allPaths.includes(p));
  return items.map((i) => ({ kind: 'dirs', defaultOn: true, ...i }));
}

function scanDownloads(dir, now = Date.now()) {
  const res = { size: 0, files: 0, list: [] };
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
        res.list.push({ name: f, size: st.size, path: fp });
      }
    } catch {}
  }
  res.list.sort((a, b) => b.size - a.size);
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

// --- Открытые программы ---
/** Какие из процессов сейчас открыты (есть окно на экране). Возвращает имена процессов в нижнем регистре. */
async function runningProcesses(names) {
  if (process.platform !== 'win32' || !names.length) return [];
  const running = await ps.runJson(
    `@(Get-Process -Name $A.names -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | ` +
    `Select-Object -ExpandProperty ProcessName -Unique) | ConvertTo-Json -Compress`,
    { names }, []);
  const list = Array.isArray(running) ? running : running ? [running] : [];
  return list.map((n) => String(n).toLowerCase());
}

/** Аккуратно закрыть окна программ (как крестиком). Принудительно не убиваем — чтобы ничего не потерять. */
async function closeProcesses(names) {
  if (!names.length || process.platform !== 'win32') return [];
  await ps.run(
    `Get-Process -Name $A.names -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | ` +
    `ForEach-Object { [void]$_.CloseMainWindow() }
     $deadline = (Get-Date).AddSeconds(8)
     while ((Get-Date) -lt $deadline) {
       if (-not (Get-Process -Name $A.names -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })) { break }
       Start-Sleep -Milliseconds 300
     }`, { names });
  return runningProcesses(names);
}

// --- Глубокая очистка Windows (встроенная «Очистка диска», нужны права администратора) ---
// Разделы «Очистки диска», которые включаем. Не берём «Windows ESD installation files» —
// они нужны для функции «Вернуть компьютер в исходное состояние».
const DEEP_HANDLERS = [
  'Update Cleanup', 'Previous Installations', 'Delivery Optimization Files',
  'Windows Error Reporting Files', 'Temporary Setup Files', 'Windows Upgrade Log Files',
  'System error memory dump files', 'System error minidump files', 'Thumbnail Cache',
  'Downloaded Program Files', 'Setup Log Files',
];
const DEEP_SAGE = 777; // номер набора настроек для cleanmgr /sagerun

const DEEP_SCRIPT = `
$base = 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VolumeCaches'
$flag = 'StateFlags' + ([string]$A.sage).PadLeft(4, '0')
foreach ($h in $A.handlers) {
  $k = Join-Path $base $h
  if (Test-Path -LiteralPath $k) { Set-ItemProperty -LiteralPath $k -Name $flag -Value 2 -Type DWord -Force }
}
Start-Process -FilePath 'cleanmgr.exe' -ArgumentList ('/sagerun:' + $A.sage) -Wait
foreach ($h in $A.handlers) {
  $k = Join-Path $base $h
  if (Test-Path -LiteralPath $k) { Remove-ItemProperty -LiteralPath $k -Name $flag -ErrorAction SilentlyContinue }
}
`;

function systemDrive(env = process.env) { return (env.SystemDrive || 'C:').replace(/\\$/, ''); }

async function freeBytes(drive = systemDrive()) {
  try { const st = await fs.promises.statfs(drive + '\\'); return Number(st.bavail) * Number(st.bsize); } catch { return null; }
}

/** Запустить «Очистку диска» с нашим набором. Возвращает { freed, cancelled }. */
async function deepClean() {
  const before = await freeBytes();
  const r = await ps.runElevated(DEEP_SCRIPT, { handlers: DEEP_HANDLERS, sage: DEEP_SAGE }, { timeout: 60 * 60000 });
  if (r.cancelled) return { freed: 0, cancelled: true };
  const after = await freeBytes();
  return { freed: before != null && after != null ? Math.max(0, after - before) : 0, cancelled: false };
}

function deepItem(env = process.env) {
  const windowsOld = fs.existsSync(path.join(systemDrive(env) + '\\', 'Windows.old'));
  return {
    id: 'deep', group: 'windows', kind: 'deep', icon: '🛠', title: 'Глубокая очистка Windows',
    defaultOn: false, size: 0, files: 0, sizeUnknown: true,
    what: 'Остатки старых обновлений Windows, отчёты о сбоях системы, кэш миниатюр' +
      (windowsOld ? ' и папка Windows.old — прошлая версия Windows после большого обновления, обычно это 10–30 ГБ.' : '.'),
    why: 'Чистит встроенное средство Windows «Очистка диска» — то же самое делают вручную компьютерные мастера. ' +
      'Windows спросит разрешение — нажмите «Да». Сколько освободится, станет известно после.',
    warn: (windowsOld ? 'После этого нельзя будет откатиться на прошлую версию Windows. ' : '') +
      'Очистка может занять 5–15 минут, появится и само закроется окно «Очистка диска».',
    after: 'Windows работает как прежде, просто станет больше места.',
  };
}

// --- Сканирование ---
/**
 * Возвращает { items: [...], total }.
 * У каждого найденного пункта: id, group, icon, title, what, why, after, warn, defaultOn, size, files,
 * а также служебные поля (paths, list), которые в интерфейс не отдаём.
 */
async function scan({ env, home, now = Date.now(), deep = process.platform === 'win32' } = {}) {
  const items = [];
  for (const def of getItems(env, home)) {
    const it = { ...def, size: 0, files: 0 };
    if (def.kind === 'dirs') {
      it.targets = [];
      for (const p of def.paths) {
        const s = await scanDir(p, { minAgeMs: def.minAgeMs, now });
        if (s.files > 0) { it.size += s.bytes; it.files += s.files; it.targets.push(p); }
      }
    } else if (def.kind === 'downloads') {
      const d = scanDownloads(def.dir, now);
      it.size = d.size; it.files = d.files; it.list = d.list;
    } else if (def.kind === 'recycle') {
      const r = await queryRecycleBin();
      it.size = r.size; it.files = r.files;
    }
    if (it.files > 0) items.push(it);
  }
  if (deep) items.push(deepItem(env));
  return { items, total: items.reduce((s, i) => s + i.size, 0) };
}

/** Версия результата сканирования для интерфейса: без путей к папкам. */
function forUi(scanResult) {
  return {
    total: scanResult.total,
    items: scanResult.items.map((i) => ({
      id: i.id, group: i.group, icon: i.icon, title: i.title, what: i.what, why: i.why || '', after: i.after || '',
      warn: i.warn || '', defaultOn: i.defaultOn, size: i.size, files: i.files, process: i.process || '', sizeUnknown: !!i.sizeUnknown,
      list: i.list ? i.list.slice(0, 20).map((f) => ({ name: f.name, size: f.size })) : undefined,
    })),
  };
}

// --- Очистка ---
/**
 * opts: { selected: [id], skip: [id] (открытые программы, которые не закрыли), dryRun, trash: async (path) => void, now }
 * Возвращает { dryRun, items: [{ id, title, freed, moved }], totalFreed, movedToTrash, failedFiles }.
 * totalFreed — реально освобождённое место; movedToTrash — перенесено в Корзину (место пока занято).
 */
async function clean(scanResult, opts = {}, onProgress = () => {}) {
  const selected = new Set(opts.selected || scanResult.items.filter((i) => i.defaultOn).map((i) => i.id));
  const skip = new Set(opts.skip || []);
  const dryRun = !!opts.dryRun, now = opts.now || Date.now();
  const todo = scanResult.items.filter((i) => selected.has(i.id));
  const result = { dryRun, items: [], totalFreed: 0, movedToTrash: 0, failedFiles: 0 };

  for (let n = 0; n < todo.length; n++) {
    const it = todo[n];
    const base = { step: n, total: todo.length, id: it.id, title: it.title };
    onProgress({ ...base, freed: result.totalFreed + result.movedToTrash });
    const r = { id: it.id, title: it.title, icon: it.icon, freed: 0, moved: 0, skipped: false, label: '' };

    if (skip.has(it.id)) {
      r.skipped = true;
    } else if (it.kind === 'dirs') {
      for (const p of it.targets) {
        const c = await cleanDir(p, { minAgeMs: it.minAgeMs, dryRun, now });
        r.freed += c.freed; result.failedFiles += c.failed;
      }
    } else if (it.kind === 'downloads') {
      for (const f of it.list) {
        if (dryRun) { r.moved += f.size; continue; }
        if (!opts.trash) continue;
        try { await opts.trash(f.path); r.moved += f.size; } catch { result.failedFiles += 1; }
      }
    } else if (it.kind === 'deep') {
      if (dryRun) r.label = 'в режиме проверки не запускаю';
      else {
        const d = await (opts.deepClean || deepClean)();
        if (d.cancelled) { r.skipped = true; r.label = 'Windows не разрешила'; }
        else r.freed = d.freed;
      }
    } else if (it.kind === 'recycle') {
      if (dryRun) r.freed = it.size;
      else {
        const before = (await queryRecycleBin()).size;
        await emptyRecycleBin();
        r.freed = Math.max(0, before - (await queryRecycleBin()).size);
      }
    }

    result.items.push(r);
    result.totalFreed += r.freed;
    result.movedToTrash += r.moved;
    onProgress({ ...base, freed: result.totalFreed + result.movedToTrash, done: true });
  }
  return result;
}

module.exports = { DEEP_HANDLERS, deepItem, scan, forUi, clean, getItems, scanDownloads, runningProcesses, closeProcesses, filesWord };
