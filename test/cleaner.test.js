const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cleaner = require('../modules/cleaner');

const DAY = 86400000;

function fakeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'home-'));
  const local = path.join(home, 'AppData', 'Local');
  const roaming = path.join(home, 'AppData', 'Roaming');
  const w = (rel, size, ageDays = 3) => {
    const f = path.join(home, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, Buffer.alloc(size));
    const t = new Date(Date.now() - ageDays * DAY); fs.utimesSync(f, t, t);
  };
  w('AppData/Local/Google/Chrome/User Data/Default/Cache/Cache_Data/f1', 1000);
  w('AppData/Local/Google/Chrome/User Data/Profile 1/Code Cache/js/f2', 2000);
  w('AppData/Local/Google/Chrome/User Data/Default/Bookmarks', 777); // не кэш — не трогаем
  w('AppData/Roaming/Telegram Desktop/tdata/user_data/cache/0/a', 3000);
  w('AppData/Roaming/Telegram Desktop/tdata/user_data/media_cache/b', 4000);
  w('AppData/Roaming/Telegram Desktop/tdata/user_data#2/cache/c', 500);
  w('AppData/Roaming/Telegram Desktop/tdata/key_datas', 50); // ключи входа — не трогаем
  w('AppData/Local/Temp/old.tmp', 4000);
  w('AppData/Local/Temp/Low/old2.tmp', 500); // вложено в Temp — не считать дважды
  w('AppData/Local/Temp/new.tmp', 300, 0); // свежий — не трогаем
  w('AppData/Local/CrashDumps/app.dmp', 800);
  w('Downloads/setup_old.exe', 5000, 40);
  w('Downloads/setup_new.exe', 6000, 5);
  w('Downloads/photo.jpg', 7000, 400);
  const env = { LOCALAPPDATA: local, APPDATA: roaming, TEMP: path.join(local, 'Temp'), WINDIR: path.join(home, 'Windows') };
  return { home, env };
}

const byId = (r) => Object.fromEntries(r.items.map((i) => [i.id, i]));

test('сканирование: пункты с размерами, без двойного счёта и без чужих файлов', async () => {
  const { home, env } = fakeHome();
  const r = await cleaner.scan({ env, home });
  const m = byId(r);
  assert.strictEqual(m.chrome.size, 3000);
  assert.strictEqual(m.telegram.size, 7500); // оба аккаунта, без key_datas
  assert.strictEqual(m.temp.size, 4500); // old + Low, без свежего
  assert.strictEqual(m.syscache.size, 800);
  assert.strictEqual(m.downloads.size, 5000);
  assert.deepStrictEqual(m.downloads.list.map((i) => i.name), ['setup_old.exe']);
  assert.ok(!m.edge, 'пустые пункты не показываем');
  assert.strictEqual(r.total, 3000 + 7500 + 4500 + 800 + 5000);
});

test('у каждого пункта есть пояснение, Корзина по умолчанию не выбрана', () => {
  for (const i of cleaner.getItems({}, os.tmpdir())) {
    assert.ok(i.what, `${i.id}: нет «что это»`);
    assert.ok(i.why || i.warn, `${i.id}: нет «почему можно удалить» или предупреждения`);
    if (i.id === 'recycle') assert.strictEqual(i.defaultOn, false);
    else assert.strictEqual(i.defaultOn, true);
  }
});

test('для интерфейса — без путей к папкам', async () => {
  const { home, env } = fakeHome();
  const ui = cleaner.forUi(await cleaner.scan({ env, home }));
  const json = JSON.stringify(ui);
  assert.ok(!json.includes(home), 'пути не утекают в интерфейс');
  assert.ok(ui.items.find((i) => i.id === 'downloads').list[0].name === 'setup_old.exe');
});

test('режим проверки ничего не удаляет', async () => {
  const { home, env } = fakeHome();
  const r = await cleaner.scan({ env, home });
  let trashed = 0;
  const res = await cleaner.clean(r, { dryRun: true, trash: async () => { trashed++; } });
  assert.strictEqual(res.dryRun, true);
  assert.strictEqual(res.totalFreed, 3000 + 7500 + 4500 + 800);
  assert.strictEqual(res.movedToTrash, 5000);
  assert.strictEqual(trashed, 0);
  assert.ok(fs.existsSync(path.join(home, 'AppData/Local/Temp/old.tmp')));
});

test('очистка только выбранного: снятая галочка — пункт не трогаем', async () => {
  const { home, env } = fakeHome();
  const r = await cleaner.scan({ env, home });
  const trashed = [];
  const progress = [];
  const res = await cleaner.clean(r, { selected: ['chrome', 'temp', 'downloads'], trash: async (p) => { trashed.push(path.basename(p)); } }, (p) => progress.push(p));
  assert.deepStrictEqual(res.items.map((i) => i.id), ['chrome', 'temp', 'downloads']);
  assert.strictEqual(res.totalFreed, 3000 + 4500);
  assert.strictEqual(res.movedToTrash, 5000);
  assert.deepStrictEqual(trashed, ['setup_old.exe']);
  // Telegram не выбран — кэш на месте
  assert.ok(fs.existsSync(path.join(home, 'AppData/Roaming/Telegram Desktop/tdata/user_data/media_cache/b')));
  assert.ok(fs.existsSync(path.join(home, 'AppData/Local/Google/Chrome/User Data/Default/Bookmarks')));
  assert.ok(fs.existsSync(path.join(home, 'AppData/Local/Temp/new.tmp')));
  assert.ok(fs.existsSync(path.join(home, 'Downloads/photo.jpg')));
  assert.ok(!fs.existsSync(path.join(home, 'AppData/Local/Temp/old.tmp')));
  assert.strictEqual(progress.filter((p) => p.done).length, 3);
});

test('Telegram: кэш удаляется, ключи входа остаются', async () => {
  const { home, env } = fakeHome();
  const r = await cleaner.scan({ env, home });
  const res = await cleaner.clean(r, { selected: ['telegram'] });
  assert.strictEqual(res.totalFreed, 7500);
  assert.ok(fs.existsSync(path.join(home, 'AppData/Roaming/Telegram Desktop/tdata/key_datas')));
});

test('открытую программу можно пропустить', async () => {
  const { home, env } = fakeHome();
  const r = await cleaner.scan({ env, home });
  const res = await cleaner.clean(r, { selected: ['chrome'], skip: ['chrome'] });
  assert.strictEqual(res.items[0].skipped, true);
  assert.strictEqual(res.totalFreed, 0);
  assert.ok(fs.existsSync(path.join(home, 'AppData/Local/Google/Chrome/User Data/Default/Cache/Cache_Data/f1')));
});

test('окончания: 1 файл, 2 файла, 5 файлов, 11 файлов, 21 файл', () => {
  assert.deepStrictEqual([1, 2, 5, 11, 21, 104].map(cleaner.filesWord), ['1 файл', '2 файла', '5 файлов', '11 файлов', '21 файл', '104 файла']);
});

test('глубокая очистка: пункт есть, галочка снята, размер неизвестен до запуска', async () => {
  const { home, env } = fakeHome();
  const r = await cleaner.scan({ env, home, deep: true });
  const d = r.items.find((i) => i.id === 'deep');
  assert.ok(d);
  assert.strictEqual(d.defaultOn, false);
  assert.strictEqual(d.sizeUnknown, true);
  assert.ok(d.warn.includes('5–15 минут'));
  assert.strictEqual(cleaner.forUi(r).items.find((i) => i.id === 'deep').sizeUnknown, true);
});

test('глубокая очистка: в режиме проверки не запускается', async () => {
  const { home, env } = fakeHome();
  const r = await cleaner.scan({ env, home, deep: true });
  let ran = false;
  const res = await cleaner.clean(r, { dryRun: true, selected: ['deep'], deepClean: async () => { ran = true; return { freed: 1 }; } });
  assert.strictEqual(ran, false);
  assert.strictEqual(res.items[0].label, 'в режиме проверки не запускаю');
});

test('глубокая очистка: освобождённое место и отказ в окне Windows', async () => {
  const { home, env } = fakeHome();
  const r = await cleaner.scan({ env, home, deep: true });
  const ok = await cleaner.clean(r, { selected: ['deep'], deepClean: async () => ({ freed: 5e9, cancelled: false }) });
  assert.strictEqual(ok.totalFreed, 5e9);
  const no = await cleaner.clean(r, { selected: ['deep'], deepClean: async () => ({ freed: 0, cancelled: true }) });
  assert.strictEqual(no.items[0].skipped, true);
  assert.strictEqual(no.items[0].label, 'Windows не разрешила');
});

test('глубокая очистка не трогает файлы для «Вернуть компьютер в исходное состояние»', () => {
  assert.ok(!cleaner.DEEP_HANDLERS.some((h) => /ESD/i.test(h)));
  assert.ok(cleaner.DEEP_HANDLERS.includes('Update Cleanup'));
});
