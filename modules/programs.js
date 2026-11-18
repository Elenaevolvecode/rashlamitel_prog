/**
 * Модуль программ: список установленных и запуск их штатного деинсталлятора.
 * Интерфейс передаёт только id программы из последнего списка, команду удаления
 * берём из реестра здесь, в основном процессе.
 */
const ps = require('./ps');

// Шаблоны — целые слова (иначе «intel» ловит IntelliJ, а «git» — digital)
function wordRe(words) {
  return new RegExp('(^|[^\\p{L}\\p{N}])(' + words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')($|[^\\p{L}\\p{N}])', 'iu');
}

const SYSTEM_RE = wordRe([
  'microsoft visual c++', 'microsoft .net', '.net framework', '.net runtime', '.net desktop runtime',
  'microsoft edge', 'microsoft edge webview2', 'nvidia', 'intel', 'intel(r)', 'realtek', 'amd software', 'amd radeon',
  'windows driver package', 'update for windows', 'security update', 'hotfix',
  'microsoft windows desktop runtime', 'windows software development kit', 'windows sdk',
  'microsoft update health tools', 'vs_coreeditorfonts', 'microsoft visual studio installer',
  'windows pc health check', 'microsoft gameinput',
]);

const POPULAR_RE = wordRe([
  'google chrome', 'mozilla firefox', 'telegram', 'yandex', 'яндекс',
  'microsoft office', 'microsoft 365', 'zoom', 'whatsapp', 'viber', 'discord', 'steam',
  'python', 'node.js', 'visual studio code', 'git', '7-zip', 'winrar',
  'adobe photoshop', 'adobe illustrator', 'adobe premiere', 'adobe after effects',
  'adobe acrobat', 'vlc', 'obs studio', 'skype', 'pdf24', 'libreoffice', 'кинопоиск',
]);

// Формулировки нейтральные и проверяемые: без оценок «вредная», только факты и польза
const JUNK = [
  { re: wordRe(['ccleaner']), desc: 'Программа для очистки', reason: 'Ушла из России и больше не обновляется' },
  { re: wordRe(['avast']), desc: 'Антивирус', reason: 'Ушёл из России и больше не обновляется — защиты от новых вирусов нет' },
  { re: wordRe(['avg antivirus', 'avg internet security']), desc: 'Антивирус', reason: 'Ушёл из России и больше не обновляется' },
  { re: wordRe(['amigo']), desc: 'Браузер', reason: 'Часто ставится сам вместе с другими программами' },
  { re: wordRe(['mail.ru агент', 'спутник@mail.ru', 'guard@mail.ru']), desc: 'Программа Mail.ru', reason: 'Устарела и больше не поддерживается' },
  { re: wordRe(['driverpack', 'driverpack solution']), desc: 'Установщик драйверов', reason: 'Может ставить лишние программы. Windows обновляет драйверы сама' },
  { re: wordRe(['driver booster']), desc: 'Установщик драйверов', reason: 'Windows обновляет драйверы сама' },
  { re: wordRe(['iobit', 'advanced systemcare']), desc: 'Утилита оптимизации', reason: 'Часто просит купить платную версию, польза небольшая' },
  { re: wordRe(['utorrent', 'bittorrent']), desc: 'Программа для скачивания', reason: 'Показывает рекламу' },
  { re: wordRe(['hp jumpstart']), desc: 'Утилита HP', reason: 'Не нужна для работы компьютера' },
  { re: wordRe(['mcafee', 'norton']), desc: 'Платный антивирус', reason: 'Часто стоит с покупки ноутбука и просит продлить подписку. Если у вас другой антивирус — этот лишний' },
  { re: wordRe(['ask toolbar']), desc: 'Панель браузера', reason: 'Рекламная панель' },
  { re: wordRe(['baidu']), desc: 'Нежелательная программа', reason: 'Обычно ставится без спроса' },
];

function formatSize(bytes) {
  if (!bytes || bytes === 0) return '—';
  if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + ' ГБ';
  if (bytes >= 1048576) return Math.round(bytes / 1048576) + ' МБ';
  if (bytes >= 1024) return Math.round(bytes / 1024) + ' КБ';
  return bytes + ' Б';
}

function classify(name) {
  const junk = JUNK.find((j) => j.re.test(name));
  if (junk) return { category: 'junk', desc: junk.desc, reason: junk.reason };
  if (SYSTEM_RE.test(name) || /^(windows|microsoft windows)\b/i.test(name)) return { category: 'system', desc: '', reason: '' };
  if (POPULAR_RE.test(name)) return { category: 'used', desc: '', reason: '' };
  return { category: 'other', desc: '', reason: '' };
}

const LIST_SCRIPT = `
$out = foreach ($rp in $A.paths) {
  Get-ChildItem -Path $rp -ErrorAction SilentlyContinue | ForEach-Object {
    $p = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
    if ($p.DisplayName -and -not $p.SystemComponent -and -not $p.ParentKeyName -and ($p.UninstallString -or $p.QuietUninstallString)) {
      [pscustomobject]@{
        name = [string]$p.DisplayName
        sizeKb = [int64]($p.EstimatedSize)
        publisher = [string]$p.Publisher
        installDate = [string]$p.InstallDate
        uninstall = [string]$p.UninstallString
        quiet = [string]$p.QuietUninstallString
        key = [string]$_.PSPath
      }
    }
  }
}
@($out) | ConvertTo-Json -Depth 3 -Compress
`;

const REG_PATHS = [
  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
];

let lastList = [];

function buildList(raw) {
  const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const seen = new Set(), list = [];
  for (const p of arr) {
    const name = (p.name || '').trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const sizeBytes = (Number(p.sizeKb) || 0) * 1024;
    list.push({
      id: String(list.length), name, sizeBytes, size: formatSize(sizeBytes),
      publisher: p.publisher || '', installDate: p.installDate || '',
      ...classify(name),
      _uninstall: p.uninstall || '', _quiet: p.quiet || '', _key: p.key || '',
    });
  }
  const order = { junk: 0, other: 1, used: 2, system: 3 };
  list.sort((a, b) => order[a.category] - order[b.category] || b.sizeBytes - a.sizeBytes);
  return list;
}

async function getInstalledPrograms() {
  if (process.platform !== 'win32') return [];
  const raw = await ps.runJson(LIST_SCRIPT, { paths: REG_PATHS }, []);
  lastList = buildList(raw);
  return lastList.map(({ _uninstall, _quiet, _key, ...rest }) => rest);
}

/**
 * Разобрать строку удаления на файл и аргументы.
 * MsiExec: /I{GUID} → /X{GUID} (удаление вместо установки).
 */
function parseUninstall(cmd) {
  const s = (cmd || '').trim();
  if (!s) return null;
  if (/^"?[^"]*msiexec(\.exe)?"?\s/i.test(s)) {
    const args = s.replace(/^"?[^"]*msiexec(\.exe)?"?\s*/i, '').replace(/\/I(\s*\{)/i, '/X$1');
    return { file: 'msiexec.exe', args };
  }
  if (s.startsWith('"')) {
    const end = s.indexOf('"', 1);
    if (end < 0) return { file: s.slice(1), args: '' };
    return { file: s.slice(1, end), args: s.slice(end + 1).trim() };
  }
  // Путь без кавычек, может содержать пробелы: берём всё до первого «.exe»
  const m = s.match(/^(.*?\.exe)(\s+.*)?$/i);
  if (m) return { file: m[1], args: (m[2] || '').trim() };
  return { file: s, args: '' };
}

const UNINSTALL_SCRIPT = `
try {
  $sp = @{ FilePath = $A.file; Wait = $true; PassThru = $true }
  if ($A.args) { $sp.ArgumentList = $A.args }
  $proc = Start-Process @sp
  $code = $proc.ExitCode
} catch { $code = -1 }
$still = Test-Path -LiteralPath $A.key
@{ code = $code; stillInstalled = $still } | ConvertTo-Json -Compress
`;

/**
 * Запустить деинсталлятор программы по id.
 * Возвращает { status: 'removed' | 'pending' | 'failed' }:
 *  pending — деинсталлятор отработал или ещё открыт, но программа пока на месте
 *  (часто деинсталлятор открывает своё окно и ждёт ответа пользователя).
 */
async function uninstallProgram(id) {
  const prog = lastList.find((p) => p.id === id);
  if (!prog) return { status: 'failed' };
  const parsed = parseUninstall(prog._quiet || prog._uninstall);
  if (!parsed) return { status: 'failed' };
  const r = await ps.runJson(UNINSTALL_SCRIPT, { file: parsed.file, args: parsed.args, key: prog._key }, null, { timeout: 30 * 60000 });
  if (!r) return { status: 'failed' };
  if (!r.stillInstalled) return { status: 'removed' };
  if (r.code === -1) return { status: 'failed' };
  return { status: 'pending' };
}

module.exports = { getInstalledPrograms, uninstallProgram, formatSize, classify, parseUninstall, buildList };
