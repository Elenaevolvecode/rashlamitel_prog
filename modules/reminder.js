/**
 * Напоминания об очистке через Планировщик заданий Windows.
 *
 * Программа не висит в фоне и не добавляет себя в автозагрузку. Раз в N дней Windows
 * запускает её с ключом --remind: без окна, программа ищет мусор и, если его больше порога,
 * показывает уведомление. Ничего не удаляет.
 *
 * Задание пересоздаётся при каждом запуске программы, поэтому срок считается
 * от последнего раза, когда человек сам открывал Расхламитель.
 * Задание создаётся для текущего пользователя, права администратора не нужны.
 */
const ps = require('./ps');

const TASK_NAME = 'Rashlamitel Reminder'; // латиницей — так надёжнее для Планировщика и деинсталлятора
const THRESHOLD = 1024 * 1024 * 1024; // 1 ГБ
const DAYS_ALLOWED = [7, 14, 30];
const NEVER_REMEMBER = ['recycle', 'deep'];

function normalizeDays(d) { return DAYS_ALLOWED.includes(Number(d)) ? Number(d) : 30; }

/** Дата первого напоминания: через N дней, в полдень по местному времени. */
function firstRun(days, now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + normalizeDays(days), 12, 0, 0);
  return d;
}

/** Сколько мусора считать для напоминания: как на главном экране (с учётом сохранённых галочек). */
function reminderBytes(items, choices = {}) {
  return items.filter((i) => {
    if (i.sizeUnknown) return false;
    const saved = choices[i.id];
    if (NEVER_REMEMBER.includes(i.id) || typeof saved !== 'boolean') return i.defaultOn;
    return saved;
  }).reduce((s, i) => s + i.size, 0);
}

function shouldRemind(bytes) { return bytes >= THRESHOLD; }

function gbText(bytes) {
  if (bytes < 0.1 * 1073741824) return Math.round(bytes / 1048576) + ' МБ';
  return (bytes / 1073741824).toFixed(1).replace('.', ',') + ' ГБ';
}

const SYNC_SCRIPT = `
$ErrorActionPreference = 'Stop'
if ($A.enabled) {
  $action = New-ScheduledTaskAction -Execute $A.exe -Argument '--remind'
  $at = [DateTime]::Parse($A.at, [Globalization.CultureInfo]::InvariantCulture)
  $trigger = New-ScheduledTaskTrigger -Daily -DaysInterval $A.days -At $at
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries ` +
    "-ExecutionTimeLimit (New-TimeSpan -Hours 2) -MultipleInstances IgnoreNew" + `
  $user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $A.name -Action $action -Trigger $trigger -Settings $settings -Principal $principal ` +
    "-Description 'Расхламитель ПК: напоминание об очистке. Отключается в настройках программы.' -Force | Out-Null" + `
  'OK'
} else {
  Unregister-ScheduledTask -TaskName $A.name -Confirm:$false -ErrorAction SilentlyContinue
  'OK'
}
`;

/** Аргументы для скрипта (вынесено отдельно для тестов). */
function syncArgs({ enabled, days, exe, now = new Date() }) {
  const at = firstRun(days, now);
  const pad = (n) => String(n).padStart(2, '0');
  return {
    name: TASK_NAME, enabled: !!enabled, exe, days: normalizeDays(days),
    at: `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:00:00`,
  };
}

/** Создать/обновить или удалить задание. Возвращает true, если получилось. */
async function syncTask(opts) {
  if (process.platform !== 'win32') return false;
  const r = await ps.run(SYNC_SCRIPT, syncArgs(opts));
  return r.stdout.includes('OK');
}

module.exports = { TASK_NAME, THRESHOLD, DAYS_ALLOWED, normalizeDays, firstRun, reminderBytes, shouldRemind, gbText, syncArgs, syncTask };
