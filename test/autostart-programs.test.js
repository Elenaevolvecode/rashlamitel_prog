const { test } = require('node:test');
const assert = require('node:assert');
const { displayName, resolveStartupFile, approvedKeyFor, isDisabledFlag, isForCurrentUser, buildList } = require('../modules/autostart');
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
