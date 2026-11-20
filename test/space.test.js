const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const space = require('../modules/space');

const MB = 1024 * 1024;

function fakeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'spc-'));
  const w = (rel, size) => {
    const f = path.join(home, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    // Разреженный файл: размер есть, места на диске почти не занимает — тесты быстрые
    const fd = fs.openSync(f, 'w'); fs.ftruncateSync(fd, size); fs.closeSync(fd);
  };
  w('Videos/Отпуск/море.mp4', 300 * MB);
  w('Videos/кот.mp4', 50 * MB);
  w('Downloads/windows.iso', 500 * MB);
  w('Downloads/фото.jpg', 2 * MB);
  w('Documents/отчёт.docx', 1 * MB);
  w('AppData/Local/Temp/big.tmp', 900 * MB); // программы — не считаем
  w('OneDrive/облако.mp4', 800 * MB); // может быть только в облаке — не считаем
  w('big_in_root.zip', 150 * MB);
  w('.android/avd/ram.img', 200 * MB); // служебная папка программы — не показываем
  w('.gradle/caches/x.bin', 5 * MB);
  return home;
}

test('папки: размеры и порядок, без AppData и OneDrive', async () => {
  const home = fakeHome();
  const r = await space.scanSpace({ home });
  const byTitle = Object.fromEntries(r.folders.map((f) => [f.title, f.size]));
  assert.strictEqual(byTitle['Загрузки'], 502 * MB);
  assert.strictEqual(byTitle['Видео'], 350 * MB);
  assert.strictEqual(byTitle['Документы'], undefined, 'папки меньше 10 МБ не показываем');
  assert.strictEqual(byTitle['Файлы в папке пользователя'], 150 * MB);
  // Смотрим только часть пути внутри тестовой папки: в Windows сама временная папка лежит в AppData\Local\Temp
  assert.ok(!r.folders.some((f) => f.path && /appdata|onedrive/i.test(path.relative(home, f.path))));
  assert.strictEqual(r.folders[0].title, 'Загрузки', 'самые тяжёлые — первыми');
  assert.deepStrictEqual(r.skipped, ['OneDrive']);
});

test('самые большие файлы: от 100 МБ, по убыванию', async () => {
  const home = fakeHome();
  const r = await space.scanSpace({ home });
  assert.deepStrictEqual(r.files.map((f) => f.name), ['windows.iso', 'море.mp4', 'big_in_root.zip']);
});

test('для интерфейса — без полных путей, с понятным «где лежит»', async () => {
  const home = fakeHome();
  const ui = space.forUi(await space.scanSpace({ home }));
  assert.ok(!JSON.stringify(ui).includes(home));
  const sea = ui.files.find((f) => f.name === 'море.mp4');
  assert.strictEqual(sea.where, 'Видео › Отпуск');
  assert.ok(ui.folders[0].id && ui.files[0].id);
});

test('в списке не больше 30 файлов', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'spc-'));
  fs.mkdirSync(path.join(home, 'Videos'));
  for (let i = 0; i < 40; i++) {
    const fd = fs.openSync(path.join(home, 'Videos', `v${i}.mp4`), 'w'); fs.ftruncateSync(fd, (101 + i) * MB); fs.closeSync(fd);
  }
  const r = await space.scanSpace({ home });
  assert.strictEqual(r.files.length, space.TOP_FILES);
  assert.strictEqual(r.files[0].name, 'v39.mp4');
});

test('папки с точкой (.android, .gradle…) не показываем вовсе', async () => {
  const home = fakeHome();
  const ui = space.forUi(await space.scanSpace({ home }));
  assert.ok(!ui.folders.some((f) => f.title.startsWith('.')));
  assert.ok(!ui.files.some((f) => f.name === 'ram.img'));
});
