/**
 * Модуль программ — Расхламитель ПК
 * РЕАЛЬНОЕ удаление программ через их деинсталляторы
 */
const { exec, execFile } = require('child_process');
const path = require('path');

function ps(cmd) {
  return new Promise((resolve) => {
    exec(
      `powershell.exe -NoProfile -Command "chcp 65001 >$null; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ${cmd.replace(/"/g, '\\"')}"`,
      { maxBuffer: 10485760, encoding: 'utf8' },
      (err, stdout) => resolve(stdout ? stdout.trim() : '')
    );
  });
}

const SYSTEM_PATTERNS = [
  'windows', 'microsoft visual c++', 'microsoft .net', '.net framework', '.net runtime',
  'microsoft edge', 'nvidia', 'intel', 'realtek', 'amd software', 'amd radeon',
  'windows driver', 'update for windows', 'security update', 'hotfix',
  'microsoft windows desktop runtime', 'windows software development',
  'windows sdk', 'visual studio build', 'microsoft update',
  'vs_coreeditorfonts', 'microsoft visual studio installer',
];

const POPULAR_PATTERNS = [
  'google chrome', 'mozilla firefox', 'telegram', 'yandex browser', 'яндекс браузер',
  'microsoft office', 'zoom', 'whatsapp', 'viber', 'discord', 'steam',
  'python', 'node.js', 'visual studio code', 'git', '7-zip', 'winrar',
  'adobe photoshop', 'adobe illustrator', 'adobe premiere', 'adobe after effects',
  'adobe animate', 'adobe media encoder', 'adobe acrobat',
  'vlc', 'obs studio', 'skype', 'slack', 'pdf24',
];

const JUNK_PATTERNS = [
  { pattern: 'ccleaner', desc: 'Программа для очистки', reason: 'Заблокирована в России — не работает' },
  { pattern: 'avast', desc: 'Антивирус', reason: 'Заблокирован в России — не обновляется' },
  { pattern: 'avg antivirus', desc: 'Антивирус', reason: 'Заблокирован в России' },
  { pattern: 'avg free', desc: 'Антивирус', reason: 'Заблокирован в России' },
  { pattern: 'amigo', desc: 'Браузер', reason: 'Рекламный браузер, установился без спроса' },
  { pattern: 'mail.ru', desc: 'Программа Mail.ru', reason: 'Устаревшая, сервис закрыт' },
  { pattern: 'driverpack', desc: 'Установщик драйверов', reason: 'Ставит ненужные программы и рекламу' },
  { pattern: 'driver booster', desc: 'Установщик драйверов', reason: 'Windows обновляет драйверы сам' },
  { pattern: 'iobit', desc: 'Утилита оптимизации', reason: 'Показывает рекламу, мало пользы' },
  { pattern: 'utorrent', desc: 'Программа для скачивания', reason: 'Показывает рекламу, замедляет ПК' },
  { pattern: 'bittorrent', desc: 'Программа для скачивания', reason: 'Показывает рекламу' },
  { pattern: 'hp support', desc: 'Утилита HP', reason: 'Показывает рекламу, ПК работает без неё' },
  { pattern: 'hp jumpstart', desc: 'Утилита HP', reason: 'Замедляет компьютер' },
  { pattern: 'mcafee', desc: 'Антивирус', reason: 'Навязчивая реклама, замедляет ПК' },
  { pattern: 'norton', desc: 'Антивирус', reason: 'Навязчивая реклама, замедляет ПК' },
  { pattern: 'ask toolbar', desc: 'Панель браузера', reason: 'Рекламная панель' },
  { pattern: 'baidu', desc: 'Нежелательная', reason: 'Нежелательное ПО' },
  { pattern: 'bleachbit', desc: 'Очистка', reason: 'Вы уже используете Расхламитель' },
  { pattern: 'autoworkinstaller', desc: 'Установщик', reason: 'Может устанавливать ненужные программы' },
];

function formatSize(bytes) {
  if (!bytes || bytes === 0) return '—';
  if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + ' ГБ';
  if (bytes >= 1048576) return Math.round(bytes / 1048576) + ' МБ';
  if (bytes >= 1024) return Math.round(bytes / 1024) + ' КБ';
  return bytes + ' Б';
}

async function readUninstallRegistry(regPath) {
  try {
    const result = await ps(
      `Get-ChildItem -Path '${regPath}' -EA SilentlyContinue | ForEach-Object { ` +
      `$p = Get-ItemProperty $_.PSPath -EA SilentlyContinue; ` +
      `if ($p.DisplayName -and -not $p.SystemComponent -and -not $p.ParentKeyName) { ` +
      `$size = if ($p.EstimatedSize) { $p.EstimatedSize } else { 0 }; ` +
      `$inst = if ($p.InstallDate) { $p.InstallDate } else { '' }; ` +
      `$pub = if ($p.Publisher) { $p.Publisher } else { '' }; ` +
      `$qu = if ($p.QuietUninstallString) { $p.QuietUninstallString } else { '' }; ` +
      `$u = if ($p.UninstallString) { $p.UninstallString } else { '' }; ` +
      `$p.DisplayName + '|||' + $size + '|||' + $u + '|||' + $pub + '|||' + $inst + '|||' + $qu ` +
      `} }`
    );
    if (!result) return [];
    return result.split('\n').filter(l => l.includes('|||')).map(l => {
      const p = l.split('|||');
      const sizeBytes = (parseInt(p[1]) || 0) * 1024;
      return {
        name: p[0].trim(), sizeBytes, size: formatSize(sizeBytes),
        uninstallString: (p[2] || '').trim(),
        publisher: (p[3] || '').trim(),
        installDate: (p[4] || '').trim(),
        quietUninstall: (p[5] || '').trim(),
      };
    }).filter(p => p.name.length > 0);
  } catch { return []; }
}

async function getInstalledPrograms() {
  const regPaths = [
    'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  ];
  const all = [], seen = new Set();
  for (const rp of regPaths) {
    for (const p of await readUninstallRegistry(rp)) {
      const k = p.name.toLowerCase();
      if (!seen.has(k)) { seen.add(k); all.push(p); }
    }
  }

  const result = [];
  for (const prog of all) {
    const nl = prog.name.toLowerCase();
    const junk = JUNK_PATTERNS.find(j => nl.includes(j.pattern.toLowerCase()));
    if (junk) { result.push({ ...prog, category: 'junk', desc: junk.desc, reason: junk.reason }); continue; }
    if (SYSTEM_PATTERNS.some(s => nl.includes(s))) { result.push({ ...prog, category: 'system', desc: '', reason: '' }); continue; }
    if (POPULAR_PATTERNS.some(p => nl.includes(p))) { result.push({ ...prog, category: 'used', desc: '', reason: '' }); continue; }
    result.push({ ...prog, category: 'other', desc: '', reason: '' });
  }

  result.sort((a, b) => {
    const o = { junk: 0, other: 1, used: 2, system: 3 };
    if (o[a.category] !== o[b.category]) return o[a.category] - o[b.category];
    return b.sizeBytes - a.sizeBytes;
  });
  return result;
}

/**
 * РЕАЛЬНОЕ удаление программы
 * Разбирает uninstall string и запускает деинсталлятор правильно
 */
async function uninstallProgram(uninstallString, quietUninstall) {
  // Предпочитаем тихое удаление
  const cmd = quietUninstall || uninstallString;
  if (!cmd) return false;

  try {
    // MsiExec — специальная обработка
    if (cmd.toLowerCase().includes('msiexec')) {
      // Заменяем /I на /X для удаления, добавляем /passive для минимального UI
      let msiCmd = cmd.replace(/\/I/gi, '/X');
      if (!msiCmd.includes('/passive') && !msiCmd.includes('/quiet')) {
        msiCmd += ' /passive';
      }
      await ps(`Start-Process -FilePath 'msiexec.exe' -ArgumentList '${msiCmd.replace(/msiexec\.exe\s*/i, '').replace(/'/g, "''")}' -Wait -EA SilentlyContinue`);
      return true;
    }

    // Обычный uninstall string — может содержать путь в кавычках + аргументы
    // Пример: "C:\Program Files\App\uninstall.exe" --silent
    // Или: C:\Program Files\App\uninstall.exe
    let exePath, args;
    if (cmd.startsWith('"')) {
      const endQuote = cmd.indexOf('"', 1);
      exePath = cmd.substring(1, endQuote);
      args = cmd.substring(endQuote + 1).trim();
    } else {
      const parts = cmd.split(' ');
      // Ищем .exe в пути
      let exeEnd = 0;
      for (let i = 0; i < parts.length; i++) {
        exeEnd = i;
        if (parts.slice(0, i + 1).join(' ').toLowerCase().includes('.exe')) break;
      }
      exePath = parts.slice(0, exeEnd + 1).join(' ');
      args = parts.slice(exeEnd + 1).join(' ');
    }

    // Запускаем деинсталлятор
    await ps(
      `Start-Process -FilePath '${exePath.replace(/'/g, "''")}' ` +
      (args ? `-ArgumentList '${args.replace(/'/g, "''")}'` : '') +
      ` -Wait -EA SilentlyContinue`
    );
    return true;
  } catch (e) {
    console.error('Uninstall error:', e);
    return false;
  }
}

module.exports = { getInstalledPrograms, uninstallProgram, formatSize };
