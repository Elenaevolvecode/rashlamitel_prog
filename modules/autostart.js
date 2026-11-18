/**
 * Автозагрузка — отключение через StartupApproved,
 * тем же механизмом, что использует Диспетчер задач Windows.
 * Запись в Run не удаляется, ставится флаг «отключено», поэтому всё обратимо.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const ps = require('./ps');

const APPROVED_BASE = 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved';
const SUBKEYS = ['Run', 'Run32', 'StartupFolder'];

function approvedRegPath(hive, sub) {
  return `${hive}:\\${APPROVED_BASE}\\${sub}`;
}

function loadDatabase() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'autostart_database.json'), 'utf-8')); }
  catch { return { programs: [] }; }
}

/**
 * По записи Win32_StartupCommand определить, где лежит её флаг в StartupApproved.
 * Возвращает { hive, sub, valueName } или null, если запись нельзя переключать.
 */
/**
 * Для записи из папки «Автозагрузка» найти настоящее имя файла.
 * Флаг в StartupApproved\StartupFolder хранится ровно под именем файла (с расширением),
 * а Windows отдаёт имя по-разному: то без «.lnk», то с ним, а у ярлыков с двойным
 * расширением («X.lnk.lnk») — без последнего. Поэтому сверяемся со списком файлов в папке.
 */
function resolveStartupFile(name, command, files) {
  const list = (files || []).filter((f) => f && f.toLowerCase() !== 'desktop.ini');
  const find = (cand) => list.find((f) => f.toLowerCase() === cand.toLowerCase());
  const cmd = (command || '').trim();
  const candidates = [`${name}.lnk`, name];
  if (cmd && !cmd.includes('\\')) candidates.push(cmd);
  for (const c of candidates) { const f = find(c); if (f) return f; }
  const pref = list.find((f) => f.toLowerCase().startsWith(name.toLowerCase() + '.'));
  if (pref) return pref;
  // Список файлов недоступен — угадываем, как раньше
  if (/\.(lnk|exe|bat|cmd|url)$/i.test(name)) return name;
  if (/\.(lnk|exe|bat|cmd|url)$/i.test(cmd) && !cmd.includes('\\')) return cmd;
  return `${name}.lnk`;
}

function approvedKeyFor(entry, startupFiles = {}) {
  const loc = (entry.location || '').toUpperCase();
  if (loc.includes('RUNONCE')) return null;
  if (loc === 'STARTUP' || loc === 'COMMON STARTUP') {
    const isUser = loc === 'STARTUP';
    const valueName = resolveStartupFile((entry.name || '').trim(), entry.command, isUser ? startupFiles.user : startupFiles.common);
    return { hive: isUser ? 'HKCU' : 'HKLM', sub: 'StartupFolder', valueName };
  }
  const sub = loc.includes('WOW6432NODE') ? 'Run32' : 'Run';
  if (loc.startsWith('HKLM')) return { hive: 'HKLM', sub, valueName: entry.name };
  if (loc.startsWith('HKU') || loc.startsWith('HKCU')) return { hive: 'HKCU', sub, valueName: entry.name };
  return null;
}

/** Запись относится к текущему пользователю или ко всем? Чужие записи не показываем. */
function isForCurrentUser(entry, username = os.userInfo().username) {
  const u = (entry.user || '').toLowerCase();
  if (!u) return true;
  const me = username.toLowerCase();
  if (u === me || u.endsWith('\\' + me)) return true;
  // Общие записи (HKLM, общая папка «Автозагрузка»)
  return ['public', 'all users', 'nt authority\\system', '.default'].some((x) => u.includes(x));
}

/**
 * Человеческое имя записи: без «.lnk» и без хвостов «_disabled»,
 * которые дописывают некоторые программы-оптимизаторы при отключении.
 */
function displayName(raw) {
  let n = String(raw || '').trim().replace(/\.(lnk|url)$/i, '');
  n = n.replace(/([ _.-]?disabled)+$/i, '').trim();
  return n || String(raw || '').trim();
}

/** Флаг в StartupApproved: нечётный первый байт = отключено (02/06 — вкл, 03/07 — откл). */
function isDisabledFlag(b0) {
  return typeof b0 === 'number' && (b0 & 1) === 1;
}

const READ_SCRIPT = `
$entries = @(Get-CimInstance Win32_StartupCommand -ErrorAction SilentlyContinue | ForEach-Object {
  [pscustomobject]@{ name = $_.Name; command = $_.Command; location = $_.Location; user = $_.User }
})
$approved = @{}
foreach ($hive in 'HKCU','HKLM') {
  foreach ($sub in $A.subkeys) {
    $vals = @{}
    $p = $hive + ':\\' + $A.base + '\\' + $sub
    if (Test-Path $p) {
      $item = Get-Item $p
      foreach ($n in $item.GetValueNames()) {
        $v = $item.GetValue($n)
        if ($v -is [byte[]] -and $v.Length -gt 0) { $vals[$n] = [int]$v[0] }
      }
    }
    $approved[$hive + '\\' + $sub] = $vals
  }
}
function Get-StartupFiles($folder) {
  $p = [Environment]::GetFolderPath($folder)
  if ($p -and (Test-Path -LiteralPath $p)) { @(Get-ChildItem -LiteralPath $p -File -Force -ErrorAction SilentlyContinue | ForEach-Object { $_.Name }) } else { @() }
}
$startup = @{ user = @(Get-StartupFiles 'Startup'); common = @(Get-StartupFiles 'CommonStartup') }
@{ entries = $entries; approved = $approved; startup = $startup } | ConvertTo-Json -Depth 5 -Compress
`;

const WRITE_SCRIPT = `
$p = $A.path
if (-not (Test-Path $p)) { New-Item -Path $p -Force | Out-Null }
$b = New-Object byte[] 12
$b[0] = [byte]$A.flag
if ($A.flag -eq 3) {
  $ts = [BitConverter]::GetBytes([DateTime]::Now.ToFileTime())
  [Array]::Copy($ts, 0, $b, 4, 8)
}
Set-ItemProperty -Path $p -Name $A.name -Value $b -Type Binary -Force
`;

const READ_FLAG_SCRIPT = `
$v = (Get-ItemProperty -Path $A.path -Name $A.name -ErrorAction SilentlyContinue).($A.name)
if ($v -is [byte[]] -and $v.Length -gt 0) { [int]$v[0] } else { -1 }
`;

function matchWithDatabase(entry, database) {
  const nl = entry.name.toLowerCase(), cl = (entry.command || '').toLowerCase();
  for (const db of database.programs) {
    for (const n of db.names) if (nl.includes(n.toLowerCase()) || cl.includes(n.toLowerCase())) return db;
    for (const p of db.process) if (cl.includes(p.toLowerCase())) return db;
  }
  return null;
}

const iconMap = { kaspersky: '🛡', drweb: '🛡', windows_defender: '🛡', nvidia_display: '🖥', amd_radeon: '🖥', intel_graphics: '🖥', realtek_audio: '🔊', synaptics_touchpad: '🖱', yandex_browser: '🌐', chrome: '🌐', edge: '🌐', opera_gx_gaming: '🌐', telegram: '💬', whatsapp: '💬', viber: '💬', discord: '🎧', skype: '📞', zoom: '📹', teams: '💼', steam: '🎮', epic_games: '🎮', onedrive: '☁', yandex_disk: '☁', google_drive: '☁', dropbox: '☁', spotify: '🎵', itunes: '🎵' };
const LABELS = { green: 'Нужна', yellow: 'Можно откл.', red: 'Лучше откл.' };

/**
 * Собрать список для интерфейса из сырых данных PowerShell (вынесено отдельно для тестов).
 */
function buildList(raw, database, username) {
  const entries = Array.isArray(raw.entries) ? raw.entries : raw.entries ? [raw.entries] : [];
  const approved = raw.approved || {};
  const arr = (v) => (Array.isArray(v) ? v : v ? [v] : []);
  const startupFiles = { user: arr(raw.startup && raw.startup.user), common: arr(raw.startup && raw.startup.common) };
  const list = [], seen = new Set();
  for (const e of entries) {
    if (!e || !e.name) continue;
    if (!isForCurrentUser(e, username)) continue;
    const key = approvedKeyFor(e, startupFiles);
    if (!key) continue;
    const id = `${key.hive}\\${key.sub}\\${key.valueName}`.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);

    const flag = (approved[`${key.hive}\\${key.sub}`] || {})[key.valueName];
    const db = matchWithDatabase(e, database);
    const category = db ? db.category : 'yellow';
    list.push({
      id,
      name: db ? db.names[0] : displayName(e.name),
      category,
      label: LABELS[category],
      description: db ? db.description : 'Запускается при включении компьютера',
      vendor: db ? db.vendor : '',
      icon: (db && iconMap[db.id]) || (category === 'green' ? '🛡' : category === 'red' ? '⚠' : '❓'),
      enabled: !isDisabledFlag(flag),
      needsAdmin: key.hive === 'HKLM',
      _key: key,
    });
  }
  list.sort((a, b) => ({ green: 0, yellow: 1, red: 2 })[a.category] - ({ green: 0, yellow: 1, red: 2 })[b.category]);
  return list;
}

let lastList = [];

async function getAutostart() {
  if (process.platform !== 'win32') return [];
  const raw = await ps.runJson(READ_SCRIPT, { base: APPROVED_BASE, subkeys: SUBKEYS }, { entries: [], approved: {} });
  lastList = buildList(raw, loadDatabase());
  return lastList.map(({ _key, ...rest }) => rest);
}

/**
 * Включить/выключить по id из последнего списка.
 * Возвращает { ok, cancelled } — ok только если флаг реально изменился в реестре.
 */
async function setEnabled(id, enabled) {
  const item = lastList.find((x) => x.id === id);
  if (!item) return { ok: false };
  const { hive, sub, valueName } = item._key;
  const args = { path: approvedRegPath(hive, sub), name: valueName, flag: enabled ? 2 : 3 };

  let cancelled = false;
  if (hive === 'HKLM') {
    const r = await ps.runElevated(WRITE_SCRIPT, args);
    cancelled = r.cancelled;
  } else {
    await ps.run(WRITE_SCRIPT, args);
  }
  // Проверяем, что флаг действительно записался (а не «ОК» на всякий случай)
  const check = await ps.run(READ_FLAG_SCRIPT, { path: args.path, name: valueName });
  const b0 = parseInt(check.stdout, 10);
  const ok = b0 >= 0 && isDisabledFlag(b0) === !enabled;
  if (ok) item.enabled = enabled;
  return { ok, cancelled };
}

module.exports = { getAutostart, setEnabled, displayName, resolveStartupFile, approvedKeyFor, isForCurrentUser, isDisabledFlag, buildList };
