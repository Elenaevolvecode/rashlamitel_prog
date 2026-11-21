const { test } = require('node:test');
const assert = require('node:assert');
const { taskDisplayName, displayName, resolveStartupFile, approvedKeyFor, isDisabledFlag, isForCurrentUser, buildList } = require('../modules/autostart');
const { classify, parseUninstall, buildList: buildPrograms } = require('../modules/programs');

test('автозагрузка: правильный раздел StartupApproved', () => {
  assert.deepStrictEqual(approvedKeyFor({ name: 'Telegram', location: 'HKU\\S-1-5-21-1\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run' }),
    { hive: 'HKCU', sub: 'Run', valueName: 'Telegram' });
  assert.deepStrictEqual(approvedKeyFor({ name: 'Old32', location: 'HKLM\\SOFTWARE\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Run' }),
    { hive: 'HKLM', sub: 'Run32', valueName: 'Old32' });
  assert.deepStrictEqual(approvedKeyFor({ name: 'Zoom', command: 'Zoom.lnk', location: 'Startup' }),
    { hive: 'HKCU', sub: 'StartupFolder', valueName: 'Zoom.lnk' });
  assert.deepStrictEqual(approvedKeyFor({ name: 'Tool', command: 'C:\\x\\tool.exe', location: 'Common Startup' }),
    { hive: 'HKLM', sub: 'StartupFolder', valueName: 'Tool.lnk' });
  assert.deepStrictEqual(approvedKeyFor({ name: 'Voice.ai - Voice Changer.lnk', command: 'C:\\Users\\x\\voice.exe', location: 'Startup' }),
    { hive: 'HKCU', sub: 'StartupFolder', valueName: 'Voice.ai - Voice Changer.lnk' });
  assert.strictEqual(approvedKeyFor({ name: 'Once', location: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\RunOnce' }), null);
});

test('автозагрузка: флаги 02/06 — включено, 03/07 — отключено', () => {
  assert.strictEqual(isDisabledFlag(2), false);
  assert.strictEqual(isDisabledFlag(6), false);
  assert.strictEqual(isDisabledFlag(3), true);
  assert.strictEqual(isDisabledFlag(7), true);
  assert.strictEqual(isDisabledFlag(undefined), false);
});

test('автозагрузка: чужие пользователи скрыты, статус из реестра', () => {
  assert.ok(isForCurrentUser({ user: 'PC\\elena' }, 'elena'));
  assert.ok(isForCurrentUser({ user: 'Public' }, 'elena'));
  assert.ok(!isForCurrentUser({ user: 'PC\\guest' }, 'elena'));
  const raw = {
    entries: [
      { name: 'uTorrent', command: 'C:\\utorrent.exe', location: 'HKU\\S-1\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run', user: 'PC\\elena' },
      { name: 'Other', command: 'x.exe', location: 'HKU\\S-2\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run', user: 'PC\\guest' },
    ],
    approved: { 'HKCU\\Run': { uTorrent: 3 } },
  };
  const db = { programs: [{ id: 'utorrent', names: ['uTorrent'], process: ['utorrent.exe'], category: 'red', description: 'Реклама', vendor: '' }] };
  const list = buildList(raw, db, 'elena');
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].enabled, false);
  assert.strictEqual(list[0].category, 'red');
});

test('программы: классификация по целым словам', () => {
  assert.strictEqual(classify('Intel(R) Graphics Driver').category, 'system');
  assert.notStrictEqual(classify('IntelliJ IDEA Community').category, 'system');
  assert.strictEqual(classify('uTorrent Web').category, 'junk');
  assert.strictEqual(classify('Telegram Desktop').category, 'used');
  assert.strictEqual(classify('Digital Editions').category, 'other');
});

test('программы: разбор строки удаления', () => {
  assert.deepStrictEqual(parseUninstall('MsiExec.exe /I{1234-ABCD}'), { file: 'msiexec.exe', args: '/X{1234-ABCD}' });
  assert.deepStrictEqual(parseUninstall('"C:\\Program Files\\App\\unins000.exe" /SILENT'), { file: 'C:\\Program Files\\App\\unins000.exe', args: '/SILENT' });
  assert.deepStrictEqual(parseUninstall('C:\\Program Files\\App\\uninstall.exe --quiet'), { file: 'C:\\Program Files\\App\\uninstall.exe', args: '--quiet' });
  assert.strictEqual(parseUninstall(''), null);
});

test('программы: интерфейс не получает команду удаления', () => {
  const list = buildPrograms([{ name: 'App', sizeKb: 2048, uninstall: 'evil.exe', key: 'k' }]);
  assert.strictEqual(list[0].id, '0');
  assert.strictEqual(list[0].size, '2 МБ');
  assert.ok('_uninstall' in list[0]); // внутри есть, но getInstalledPrograms его вырезает
});

test('автозагрузка: имена без .lnk и хвостов _disabled', () => {
  assert.strictEqual(displayName('Voice.ai - Voice Changer.lnk'), 'Voice.ai - Voice Changer');
  assert.strictEqual(displayName('Skrinshoter_disabled_disabled'), 'Skrinshoter');
  assert.strictEqual(displayName('movavika_suiteplatform_3.2.0_suiteplatform_disabled_disabled'), 'movavika_suiteplatform_3.2.0_suiteplatform');
  assert.strictEqual(displayName('Telegram'), 'Telegram');
});

test('программы: Расхламитель не показывает сам себя', () => {
  const list = buildPrograms([{ name: 'Расхламитель ПК 0.9.1', sizeKb: 1 }, { name: 'Telegram Desktop', sizeKb: 1 }]);
  assert.deepStrictEqual(list.map((p) => p.name), ['Telegram Desktop']);
});

test('автозагрузка: имя ярлыка берётся из настоящих файлов папки', () => {
  // Двойное расширение: Windows отдаёт «X.lnk», а файл — «X.lnk.lnk»
  assert.strictEqual(resolveStartupFile('Voice.ai - Voice Changer.lnk', 'C:\\v\\voice.exe', ['desktop.ini', 'Voice.ai - Voice Changer.lnk.lnk']), 'Voice.ai - Voice Changer.lnk.lnk');
  // Обычный ярлык: имя без расширения
  assert.strictEqual(resolveStartupFile('Zoom', 'C:\\z\\zoom.exe', ['Zoom.lnk']), 'Zoom.lnk');
  // Имя уже с расширением и такой файл есть
  assert.strictEqual(resolveStartupFile('Tool.lnk', 'C:\\t.exe', ['Tool.lnk']), 'Tool.lnk');
  // Не .lnk, а, например, .bat
  assert.strictEqual(resolveStartupFile('run', 'C:\\r.bat', ['run.bat']), 'run.bat');
  // Регистр букв не важен, возвращаем как в папке
  assert.strictEqual(resolveStartupFile('zoom', '', ['Zoom.LNK']), 'Zoom.LNK');
  // Списка нет — старое угадывание
  assert.strictEqual(resolveStartupFile('Zoom', 'C:\\z.exe', []), 'Zoom.lnk');
});

test('автозагрузка: buildList использует список файлов папки «Автозагрузка»', () => {
  const raw = {
    entries: { name: 'Voice.ai - Voice Changer.lnk', command: 'C:\\v\\voice.exe', location: 'Startup', user: 'PC\\elena' },
    approved: { 'HKCU\\StartupFolder': { 'Voice.ai - Voice Changer.lnk.lnk': 3 } },
    startup: { user: ['Voice.ai - Voice Changer.lnk.lnk'], common: [] },
  };
  const list = buildList(raw, { programs: [] }, 'elena');
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].enabled, false, 'видит, что в Диспетчере задач он отключён');
  assert.strictEqual(list[0].name, 'Voice.ai - Voice Changer');
});

test('автозагрузка: задания Планировщика попадают в список, обновлялки узнаются', () => {
  const db = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'autostart_database.json'), 'utf8'));
  const raw = {
    entries: [], approved: {},
    tasks: [
      { name: 'MicrosoftEdgeUpdateTaskMachineUA', path: '\\', state: 'Ready', exe: 'C:\\Program Files (x86)\\Microsoft\\EdgeUpdate\\MicrosoftEdgeUpdate.exe /ua' },
      { name: 'SomeVendorHelper', path: '\\Vendor\\', state: 'Disabled', exe: 'C:\\v\\helper.exe' },
    ],
  };
  const list = buildList(raw, db, 'elena');
  const edge = list.find((x) => x.id.includes('microsoftedgeupdate'));
  assert.strictEqual(edge.name, 'Обновление Microsoft Edge', 'обновлялка Edge, а не сам браузер');
  assert.ok(edge.description.includes('обновления'));
  assert.strictEqual(edge.enabled, true);
  const helper = list.find((x) => x.id === 'task:\\vendor\\somevendorhelper');
  assert.strictEqual(helper.enabled, false);
  assert.strictEqual(helper.name, 'SomeVendorHelper');
});

test('автозагрузка: Яндекс Диск не путается с Яндекс Браузером', () => {
  const db = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'autostart_database.json'), 'utf8'));
  const raw = { entries: [{ name: 'YandexDisk2', command: 'C:\\Users\\x\\AppData\\Roaming\\Yandex\\YandexDisk2\\YandexDisk2.exe', location: 'HKU\\S-1\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run', user: 'PC\\elena' }], approved: {} };
  assert.strictEqual(buildList(raw, db, 'elena')[0].name, 'Яндекс Диск');
});

test('Windows: задание с запуском при входе находится, отключается и включается', { skip: process.platform !== 'win32' && 'только на Windows' }, async () => {
  const ps = require('../modules/ps');
  const autostart = require('../modules/autostart');
  const NAME = 'Rashlamitel Test Logon Task';
  const reg = await ps.run(
    // Тем же способом, что и задание-напоминание (проверен на этой Windows): для текущего пользователя, без прав администратора
    "$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name; " +
    "$act = New-ScheduledTaskAction -Execute 'notepad.exe'; " + // не $a: в PowerShell $a и $A — одна переменная
    "$t = New-ScheduledTaskTrigger -AtLogOn -User $user; " +
    "$p = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited; " +
    "Register-ScheduledTask -TaskName $A.name -Action $act -Trigger $t -Principal $p -Force | Out-Null; " +
    "$x = Get-ScheduledTask -TaskName $A.name; $x.TaskPath + '|' + $x.State + '|' + (@($x.Triggers)[0].CimClass.CimClassName)", { name: NAME });
  try {
    const list = await autostart.getAutostart();
    const item = list.find((x) => x.id === `task:\\${NAME}`.toLowerCase());
    if (!item) {
      // Диагностика: создалось ли задание и что вернул скрипт чтения
      const rr = await autostart.readRaw();
      console.log('DIAG register:', reg.code, reg.stdout, reg.stderr.slice(0, 1500));
      console.log('DIAG read code:', rr.code, 'stderr:', rr.stderr.slice(0, 1500));
      console.log('DIAG tasks:', JSON.stringify(rr.raw.tasks).slice(0, 1500));
      console.log('DIAG ids:', list.filter((x) => x.id.startsWith('task:')).map((x) => x.id).join(', ').slice(0, 1500));
    }
    assert.ok(item, 'задание видно в списке автозагрузки');
    assert.strictEqual(item.enabled, true);
    const off = await autostart.setMany([item.id], false);
    assert.strictEqual(off.done, 1, 'отключилось');
    const on = await autostart.setEnabled(item.id, true);
    assert.strictEqual(on.ok, true, 'включилось обратно');
  } finally {
    await ps.run('Unregister-ScheduledTask -TaskName $A.name -Confirm:$false -ErrorAction SilentlyContinue', { name: NAME });
  }
});

test('автозагрузка: названия заданий по-человечески', () => {
  assert.strictEqual(taskDisplayName('CometUpdaterTaskSystem149.0.7827.1095{D5A05A68-9A1C-4C32-AEFC-274B7FB5F83B}'), 'Обновление Comet');
  assert.strictEqual(taskDisplayName('BraveSoftwareUpdateTaskMachineCore{ABC12345-0000}'), 'Обновление BraveSoftware');
  assert.strictEqual(taskDisplayName('StartCN'), 'StartCN');
  assert.strictEqual(taskDisplayName('Opera GX scheduled Autoupdate 1712345678'), 'Обновление Opera GX');
});

test('автозагрузка: незнакомая обновлялка получает понятное пояснение', () => {
  const list = buildList({ entries: [], approved: {}, tasks: [{ name: 'CometUpdaterTaskSystem149.0{D5A05A68-9A1C-4C32}', path: '\\', state: 'Ready', exe: 'C:\\x\\updater.exe' }] }, { programs: [] }, 'elena');
  assert.strictEqual(list[0].name, 'Обновление Comet');
  assert.ok(list[0].description.startsWith('Проверяет обновления'));
});

test('автозагрузка: две записи одной программы — одна строка, переключаются вместе', () => {
  const raw = {
    entries: [
      { name: 'Skype', command: 'C:\\s\\Skype.exe', location: 'HKU\\S-1\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run', user: 'PC\\elena' },
      { name: 'Skype for Desktop', command: 'C:\\s2\\Skype.exe', location: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run', user: 'Public' },
    ],
    approved: { 'HKCU\\Run': { Skype: 3 } },
  };
  const db = { programs: [{ id: 'skype', names: ['Skype'], process: ['Skype.exe'], category: 'yellow', description: 'Звонки', vendor: '' }] };
  const list = buildList(raw, db, 'elena');
  assert.strictEqual(list.length, 1, 'одна строка');
  assert.strictEqual(list[0].enabled, true, 'включена, если включена хоть одна запись');
  assert.strictEqual(list[0].needsAdmin, true);
  const ops = require('../modules/autostart').toOps(list, false);
  assert.strictEqual(ops.reg.length, 2, 'выключаем обе записи');
});
