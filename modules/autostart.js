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
# Программы, которые запускаются при входе/включении через Планировщик заданий (не системные задания Windows)
$tasks = @(Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object {
  $_.TaskPath -notlike '\\Microsoft\\*' -and $_.TaskName -ne $A.ownTask -and
  (@($_.Triggers) | Where-Object { $_ -and $_.CimClass.CimClassName -in @('MSFT_TaskLogonTrigger', 'MSFT_TaskBootTrigger') })
} | ForEach-Object {
  $act = @($_.Actions)[0]
  [pscustomobject]@{ name = $_.TaskName; path = $_.TaskPath; state = [string]$_.State;
    exe = $(if ($act) { [string]$act.Execute + ' ' + [string]$act.Arguments } else { '' }) }
})
@{ entries = $entries; approved = $approved; startup = $startup; tasks = $tasks } | ConvertTo-Json -Depth 5 -Compress
`;

// Пакетные операции: одним вызовом PowerShell (а для общих настроек — одним окном «Разрешить изменения?»)
const APPLY_SCRIPT = `
foreach ($r in @($A.reg)) {
  try {
    if (-not (Test-Path $r.path)) { New-Item -Path $r.path -Force | Out-Null }
    $b = New-Object byte[] 12
    $b[0] = [byte]$r.flag
    if ($r.flag -eq 3) { $ts = [BitConverter]::GetBytes([DateTime]::Now.ToFileTime()); [Array]::Copy($ts, 0, $b, 4, 8) }
    Set-ItemProperty -Path $r.path -Name $r.name -Value $b -Type Binary -Force
  } catch {}
}
foreach ($t in @($A.tasks)) {
  try {
    if ($t.enable) { Enable-ScheduledTask -TaskPath $t.path -TaskName $t.name -ErrorAction Stop | Out-Null }
    else { Disable-ScheduledTask -TaskPath $t.path -TaskName $t.name -ErrorAction Stop | Out-Null }
  } catch {}
}
`;

const VERIFY_SCRIPT = `
$reg = @(foreach ($r in @($A.reg)) {
  $v = (Get-ItemProperty -Path $r.path -Name $r.name -ErrorAction SilentlyContinue).($r.name)
  if ($v -is [byte[]] -and $v.Length -gt 0) { [int]$v[0] } else { -1 }
})
$tasks = @(foreach ($t in @($A.tasks)) {
  $x = Get-ScheduledTask -TaskPath $t.path -TaskName $t.name -ErrorAction SilentlyContinue
  if ($x) { [string]$x.State } else { 'Missing' }
})
@{ reg = $reg; tasks = $tasks } | ConvertTo-Json -Compress
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
      _key: { kind: 'reg', ...key },
    });
  }
  for (const t of arr(raw.tasks)) {
    if (!t || !t.name) continue;
    const id = `task:${t.path || '\\'}${t.name}`.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    const db = matchWithDatabase({ name: t.name, command: t.exe || '' }, database);
    const category = db ? db.category : 'yellow';
    list.push({
      id,
      name: db ? db.names[0] : displayName(t.name),
      category,
      label: LABELS[category],
      description: db ? db.description : 'Запускается при включении компьютера',
      vendor: db ? db.vendor : '',
      icon: (db && iconMap[db.id]) || (category === 'green' ? '🛡' : category === 'red' ? '⚠' : '❓'),
      enabled: t.state !== 'Disabled',
      needsAdmin: false, // заранее не знаем: попробуем без разрешения, не выйдет — попросим
      _key: { kind: 'task', path: t.path || '\\', name: t.name },
    });
  }
  list.sort((a, b) => ({ green: 0, yellow: 1, red: 2 })[a.category] - ({ green: 0, yellow: 1, red: 2 })[b.category]);
  return list;
}

let lastList = [];

async function getAutostart() {
  if (process.platform !== 'win32') return [];
  const raw = await ps.runJson(READ_SCRIPT, { base: APPROVED_BASE, subkeys: SUBKEYS, ownTask: 'Rashlamitel Reminder' }, { entries: [], approved: {} });
  lastList = buildList(raw, loadDatabase());
  return lastList.map(({ _key, ...rest }) => rest);
}

/** Разложить пункты на «запись в реестре» и «задание Планировщика» в формате скриптов. */
function toOps(items, enabled) {
  const reg = [], tasks = [];
  for (const it of items) {
    if (it._key.kind === 'task') tasks.push({ id: it.id, path: it._key.path, name: it._key.name, enable: enabled });
    else reg.push({ id: it.id, hklm: it._key.hive === 'HKLM', path: approvedRegPath(it._key.hive, it._key.sub), name: it._key.valueName, flag: enabled ? 2 : 3 });
  }
  return { reg, tasks };
}

/** Проверить, что изменения действительно применились. Возвращает Set id, где всё как надо. */
async function verify(ops, enabled) {
  const r = await ps.runJson(VERIFY_SCRIPT, { reg: ops.reg, tasks: ops.tasks }, { reg: [], tasks: [] });
  const regRes = Array.isArray(r.reg) ? r.reg : r.reg != null ? [r.reg] : [];
  const taskRes = Array.isArray(r.tasks) ? r.tasks : r.tasks != null ? [r.tasks] : [];
  const ok = new Set();
  ops.reg.forEach((x, i) => { const b0 = Number(regRes[i]); if (b0 >= 0 && isDisabledFlag(b0) === !enabled) ok.add(x.id); });
  ops.tasks.forEach((x, i) => { const st = String(taskRes[i] || ''); if (st && st !== 'Missing' && (st === 'Disabled') === !enabled) ok.add(x.id); });
  return ok;
}

/**
 * Включить/выключить сразу несколько пунктов по id из последнего списка.
 * Сначала — всё, что можно без разрешения Windows; остальное (общие настройки, задания других
 * пользователей) — одним окном «Разрешить изменения?».
 * Возвращает { done, total, cancelled, okIds } — «ok» только для того, что реально изменилось.
 */
async function setMany(ids, enabled) {
  const items = lastList.filter((x) => ids.includes(x.id));
  if (!items.length) return { done: 0, total: 0, cancelled: false, okIds: [] };
  const all = toOps(items, enabled);

  // 1. Без разрешения: свои записи реестра и задания Планировщика
  const first = { reg: all.reg.filter((x) => !x.hklm), tasks: all.tasks };
  if (first.reg.length || first.tasks.length) await ps.run(APPLY_SCRIPT, first);
  let ok = await verify(all, enabled);

  // 2. Остальное — одним окном Windows
  let cancelled = false;
  const left = { reg: all.reg.filter((x) => !ok.has(x.id)), tasks: all.tasks.filter((x) => !ok.has(x.id)) };
  if (left.reg.length || left.tasks.length) {
    const r = await ps.runElevated(APPLY_SCRIPT, left);
    cancelled = r.cancelled;
    ok = await verify(all, enabled);
  }

  for (const it of items) if (ok.has(it.id)) it.enabled = enabled;
  return { done: ok.size, total: items.length, cancelled, okIds: [...ok] };
}

/** Включить/выключить один пункт. Возвращает { ok, cancelled }. */
async function setEnabled(id, enabled) {
  const r = await setMany([id], enabled);
  return { ok: r.done === 1, cancelled: r.cancelled };
}

module.exports = { getAutostart, setEnabled, setMany, toOps, displayName, resolveStartupFile, approvedKeyFor, isForCurrentUser, isDisabledFlag, buildList };
