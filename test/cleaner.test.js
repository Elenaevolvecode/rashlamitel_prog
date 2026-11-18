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
  const w = (rel, size, ageDays = 3) => {
    const f = path.join(home, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, Buffer.alloc(size));
    const t = new Date(Date.now() - ageDays * DAY); fs.utimesSync(f, t, t);
  };
  w('AppData/Local/Google/Chrome/User Data/Default/Cache/Cache_Data/f1', 1000);
  w('AppData/Local/Google/Chrome/User Data/Profile 1/Code Cache/js/f2', 2000);
  w('AppData/Local/Google/Chrome/User Data/Default/Bookmarks', 777); // не кэш — не трогаем
  w('AppData/Local/Temp/old.tmp', 4000);
  w('AppData/Local/Temp/Low/old2.tmp', 500); // вложено в Temp — не считать дважды
  w('AppData/Local/Temp/new.tmp', 300, 0); // свежий — не трогаем
  w('AppData/Local/CrashDumps/app.dmp', 800);
  w('Downloads/setup_old.exe', 5000, 40);
  w('Downloads/setup_new.exe', 6000, 5);
  w('Downloads/photo.jpg', 7000, 400);
  const env = { LOCALAPPDATA: local, TEMP: path.join(local, 'Temp'), WINDIR: path.join(home, 'Windows') };
  return { home, env };
}

test('сканирование: категории, без двойного счёта и без чужих файлов', async () => {
  const { home, env } = fakeHome();
  const r = await cleaner.scan({ env, home });
  assert.strictEqual(r.internet.size, 3000);
  assert.strictEqual(r.programs.size, 4500); // old + Low, без свежего
  assert.strictEqual(r.other.size, 800);
  assert.strictEqual(r.downloads.size, 5000);
  assert.deepStrictEqual(r.downloads.items.map((i) => i.name), ['setup_old.exe']);
});

test('режим проверки ничего не удаляет и не трогает Корзину', async () => {
  const { home, env } = fakeHome();
  const r = await cleaner.scan({ env, home });
  let trashed = 0;
  const res = await cleaner.clean(r, { dryRun: true, trash: async () => { trashed++; } });
  assert.strictEqual(res.dryRun, true);
  assert.strictEqual(res.totalFreed, 3000 + 4500 + 800);
  assert.strictEqual(res.movedToTrash, 5000);
  assert.strictEqual(trashed, 0);
  assert.ok(fs.existsSync(path.join(home, 'AppData/Local/Temp/old.tmp')));
});

test('очистка: удаляет мусор, установщики — в Корзину, закладки и свежие файлы на месте', async () => {
  const { home, env } = fakeHome();
  const r = await cleaner.scan({ env, home });
  const trashed = [];
  const progress = [];
  const res = await cleaner.clean(r, { trash: async (p) => { trashed.push(path.basename(p)); } }, (p) => progress.push(p));
  assert.strictEqual(res.totalFreed, 8300);
  assert.strictEqual(res.movedToTrash, 5000);
  assert.deepStrictEqual(trashed, ['setup_old.exe']);
  assert.ok(fs.existsSync(path.join(home, 'AppData/Local/Google/Chrome/User Data/Default/Bookmarks')));
  assert.ok(fs.existsSync(path.join(home, 'AppData/Local/Temp/new.tmp')));
  assert.ok(fs.existsSync(path.join(home, 'Downloads/photo.jpg')));
  assert.ok(!fs.existsSync(path.join(home, 'AppData/Local/Temp/old.tmp')));
  assert.strictEqual(progress.filter((p) => p.done).length, cleaner.STEPS.length);
});

test('открытый браузер можно пропустить', async () => {
  const { home, env } = fakeHome();
  const r = await cleaner.scan({ env, home });
  const res = await cleaner.clean(r, { skipBrowsers: ['chrome'], trash: async () => {} });
  assert.strictEqual(res.internet, 0);
  assert.ok(fs.existsSync(path.join(home, 'AppData/Local/Google/Chrome/User Data/Default/Cache/Cache_Data/f1')));
});

test('окончания: 1 файл, 2 файла, 5 файлов, 11 файлов, 21 файл', () => {
  assert.deepStrictEqual([1, 2, 5, 11, 21, 104].map(cleaner.filesWord), ['1 файл', '2 файла', '5 файлов', '11 файлов', '21 файл', '104 файла']);
});
