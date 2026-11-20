const { test } = require('node:test');
const assert = require('node:assert');
const r = require('../modules/reminder');

const GB = 1073741824;

test('частота: только неделя, две недели, месяц; иначе месяц', () => {
  assert.strictEqual(r.normalizeDays(7), 7);
  assert.strictEqual(r.normalizeDays('14'), 14);
  assert.strictEqual(r.normalizeDays(30), 30);
  assert.strictEqual(r.normalizeDays(1), 30);
  assert.strictEqual(r.normalizeDays(undefined), 30);
});

test('первое напоминание — через N дней в полдень', () => {
  const now = new Date(2026, 10, 18, 20, 15); // 18 ноября, 20:15
  const d = r.firstRun(30, now);
  assert.strictEqual(d.getDate(), 18);
  assert.strictEqual(d.getMonth(), 11); // декабрь
  assert.strictEqual(d.getHours(), 12);
  assert.strictEqual(r.syncArgs({ enabled: true, days: 7, exe: 'C:\\a.exe', now }).at, '2026-11-25T12:00:00');
});

test('считаем мусор как на главном экране: всё найденное, без Корзины и глубокой очистки', () => {
  const items = [
    { id: 'chrome', size: 2 * GB, defaultOn: true },
    { id: 'telegram', size: 1 * GB, defaultOn: true },
    { id: 'recycle', size: 5 * GB, defaultOn: false },
    { id: 'deep', size: 0, defaultOn: false, sizeUnknown: true },
  ];
  assert.strictEqual(r.reminderBytes(items), 3 * GB);
});

test('порог 1 ГБ и текст', () => {
  assert.strictEqual(r.shouldRemind(0.9 * GB), false);
  assert.strictEqual(r.shouldRemind(1 * GB), true);
  assert.strictEqual(r.gbText(3.24 * GB), '3,2 ГБ');
  assert.strictEqual(r.gbText(40 * 1048576), '40 МБ');
});

test('задание: латинское имя, ключ --remind передаётся в скрипт', () => {
  const a = r.syncArgs({ enabled: true, days: 14, exe: 'C:\\Users\\x\\AppData\\Local\\Programs\\rashlamitel-pc\\Расхламитель ПК.exe' });
  assert.strictEqual(a.name, 'Rashlamitel Reminder');
  assert.strictEqual(a.days, 14);
  assert.strictEqual(a.enabled, true);
  assert.ok(a.exe.endsWith('Расхламитель ПК.exe'));
});

test('Windows: задание по-настоящему создаётся в Планировщике и удаляется', { skip: process.platform !== 'win32' && 'только на Windows' }, async () => {
  const ps = require('../modules/ps');
  const query = async () => (await ps.run(
    "$t = Get-ScheduledTask -TaskName $A.name -ErrorAction SilentlyContinue; " +
    "if ($t) { $t.Actions[0].Arguments + '|' + $t.Triggers[0].DaysInterval } else { 'NONE' }", { name: r.TASK_NAME })).stdout;

  assert.strictEqual(await r.syncTask({ enabled: true, days: 14, exe: process.execPath }), true);
  assert.strictEqual(await query(), '--remind|14');
  // повторный вызов обновляет, а не ругается
  assert.strictEqual(await r.syncTask({ enabled: true, days: 7, exe: process.execPath }), true);
  assert.strictEqual(await query(), '--remind|7');
  assert.strictEqual(await r.syncTask({ enabled: false, days: 7, exe: process.execPath }), true);
  assert.strictEqual(await query(), 'NONE');
});
