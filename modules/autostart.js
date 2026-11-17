/**
 * Автозагрузка — РЕАЛЬНОЕ отключение через StartupApproved
 * Тот же механизм, что использует Диспетчер задач Windows.
 * Программы НЕ могут вернуть себя обратно после отключения.
 */
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

function ps(cmd) {
  return new Promise((resolve) => {
    exec(
      `powershell.exe -NoProfile -Command "chcp 65001 >$null; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ${cmd.replace(/"/g, '\\"')}"`,
      { maxBuffer: 5242880, encoding: 'utf8' },
      (err, stdout) => resolve(stdout ? stdout.trim() : '')
    );
  });
}

function loadDatabase() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'autostart_database.json'), 'utf-8')); }
  catch { return { programs: [] }; }
}

/**
 * Читаем автозагрузку через Get-CimInstance — тот же источник что у Диспетчера задач
 */
async function getAutostartEntries() {
  try {
    const result = await ps(
      `Get-CimInstance Win32_StartupCommand -EA SilentlyContinue | ` +
      `ForEach-Object { $_.Name + '|||' + $_.Command + '|||' + $_.Location + '|||' + $_.User }`
    );
    if (!result) return [];
    return result.split('\n').filter(l => l.includes('|||')).map(l => {
      const [name, command, location, user] = l.split('|||');
      return { name: name.trim(), command: (command||'').trim(), location: (location||'').trim(), user: (user||'').trim() };
    });
  } catch { return []; }
}

/**
 * Проверяем статус через StartupApproved
 */
async function isDisabledInStartupApproved(name, location) {
  const isHKLM = location && location.includes('HKLM');
  const approvedPath = isHKLM
    ? 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run'
    : 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run';

  try {
    const result = await ps(
      `$v = (Get-ItemProperty -Path '${approvedPath}' -Name '${name}' -EA SilentlyContinue).'${name}'; ` +
      `if ($v -ne $null) { if ($v[0] -ge 3) { 'DISABLED' } else { 'ENABLED' } } else { 'NOKEY' }`
    );
    return result === 'DISABLED';
  } catch { return false; }
}

/**
 * ОТКЛЮЧИТЬ через StartupApproved — как Диспетчер задач
 * Не удаляет запись из Run — ставит флаг «отключено»
 */
async function disableAutostart(name, location) {
  const isHKLM = location && location.includes('HKLM');
  const approvedPath = isHKLM
    ? 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run'
    : 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run';

  // Для HKCU — напрямую
  if (!isHKLM) {
    try {
      const result = await ps(
        `$path = '${approvedPath}'; ` +
        `$ts = [BitConverter]::GetBytes([DateTime]::Now.ToFileTime()); ` +
        `$bytes = @([byte]3, [byte]0, [byte]0, [byte]0, [byte]0, [byte]0, [byte]0, [byte]0) + $ts[0..3]; ` +
        `$fullBytes = New-Object byte[] 12; ` +
        `$fullBytes[0] = 3; ` +
        `[Array]::Copy($ts, 0, $fullBytes, 4, [Math]::Min($ts.Length, 8)); ` +
        `if (!(Test-Path $path)) { New-Item -Path $path -Force | Out-Null }; ` +
        `Set-ItemProperty -Path $path -Name '${name}' -Value ([byte[]]$fullBytes) -Type Binary -Force; ` +
        `'OK'`
      );
      return result.includes('OK');
    } catch { return false; }
  }

  // Для HKLM — с повышенными правами
  try {
    const result = await ps(
      `$script = @' 
$path = '${approvedPath}'
$ts = [BitConverter]::GetBytes([DateTime]::Now.ToFileTime())
$fullBytes = New-Object byte[] 12
$fullBytes[0] = 3
[Array]::Copy($ts, 0, $fullBytes, 4, [Math]::Min($ts.Length, 8))
if (!(Test-Path $path)) { New-Item -Path $path -Force | Out-Null }
Set-ItemProperty -Path $path -Name '${name}' -Value ([byte[]]$fullBytes) -Type Binary -Force
'@
$script | Out-File "$env:TEMP\\disable_startup.ps1" -Encoding UTF8
Start-Process powershell.exe -Verb RunAs -Wait -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File "$env:TEMP\\disable_startup.ps1"' -EA SilentlyContinue
'OK'`
    );
    return result.includes('OK');
  } catch { return false; }
}

/**
 * ВКЛЮЧИТЬ обратно — убираем флаг отключения
 */
async function enableAutostart(name, location) {
  const isHKLM = location && location.includes('HKLM');
  const approvedPath = isHKLM
    ? 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run'
    : 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run';

  if (!isHKLM) {
    try {
      const result = await ps(
        `$path = '${approvedPath}'; ` +
        `$fullBytes = New-Object byte[] 12; ` +
        `$fullBytes[0] = 2; ` +
        `Set-ItemProperty -Path $path -Name '${name}' -Value ([byte[]]$fullBytes) -Type Binary -Force; ` +
        `'OK'`
      );
      return result.includes('OK');
    } catch { return false; }
  }

  try {
    const result = await ps(
      `$script = @'
$path = '${approvedPath}'
$fullBytes = New-Object byte[] 12
$fullBytes[0] = 2
Set-ItemProperty -Path $path -Name '${name}' -Value ([byte[]]$fullBytes) -Type Binary -Force
'@
$script | Out-File "$env:TEMP\\enable_startup.ps1" -Encoding UTF8
Start-Process powershell.exe -Verb RunAs -Wait -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File "$env:TEMP\\enable_startup.ps1"' -EA SilentlyContinue
'OK'`
    );
    return result.includes('OK');
  } catch { return false; }
}

function matchWithDatabase(entry, database) {
  const nl = entry.name.toLowerCase(), cl = (entry.command || '').toLowerCase();
  for (const db of database.programs) {
    for (const n of db.names) if (nl.includes(n.toLowerCase()) || cl.includes(n.toLowerCase())) return db;
    for (const p of db.process) if (cl.includes(p.toLowerCase())) return db;
  }
  return null;
}

const iconMap = {kaspersky:'🛡',drweb:'🛡',windows_defender:'🛡',nvidia_display:'🖥',amd_radeon:'🖥',intel_graphics:'🖥',realtek_audio:'🔊',synaptics_touchpad:'🖱',yandex_browser:'🌐',chrome:'🌐',edge:'🌐',opera_gx_gaming:'🌐',telegram:'💬',whatsapp:'💬',viber:'💬',discord:'🎧',skype:'📞',zoom:'📹',teams:'💼',steam:'🎮',epic_games:'🎮',onedrive:'☁',yandex_disk:'☁',google_drive:'☁',dropbox:'☁',spotify:'🎵',itunes:'🎵'};

async function getAutostart() {
  const database = loadDatabase();
  const entries = [], seen = new Set();
  const sources = await getAutostartEntries();

  for (const src of sources) {
    const key = src.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const disabled = await isDisabledInStartupApproved(src.name, src.location);
    const db = matchWithDatabase(src, database);

    if (db) {
      entries.push({
        id: db.id, name: db.names[0], registryName: src.name, location: src.location,
        category: db.category,
        label: db.category === 'green' ? 'Нужна' : db.category === 'yellow' ? 'Можно откл.' : 'Лучше откл.',
        description: db.description, vendor: db.vendor,
        icon: iconMap[db.id] || (db.category === 'green' ? '🛡' : db.category === 'red' ? '⚠' : '❓'),
        enabled: !disabled,
      });
    } else {
      entries.push({
        id: 'unknown_' + key, name: src.name, registryName: src.name, location: src.location,
        category: 'yellow', label: 'Можно откл.',
        description: 'Запускается при включении', vendor: '', icon: '❓',
        enabled: !disabled,
      });
    }
  }

  entries.sort((a, b) => ({ green: 0, yellow: 1, red: 2 })[a.category] - ({ green: 0, yellow: 1, red: 2 })[b.category]);
  return entries;
}

module.exports = { getAutostart, disableAutostart, enableAutostart };
