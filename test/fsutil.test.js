const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { dedupePaths, scanDir, cleanDir, isInside } = require('../modules/fsutil');

const DAY = 86400000;

function makeTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rash-'));
  const w = (rel, size, ageDays = 0) => {
    const f = path.join(root, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, Buffer.alloc(size));
    if (ageDays) { const t = new Date(Date.now() - ageDays * DAY); fs.utimesSync(f, t, t); }
  };
  w('old1.tmp', 1000, 3);
  w('sub/old2.tmp', 2000, 3);
  w('sub/deeper/old3.tmp', 3000, 3);
  w('fresh.tmp', 500, 0);
  return root;
}

test('isInside и dedupePaths убирают вложенные папки и дубли', () => {
  const a = path.join(os.tmpdir(), 'A');
  assert.ok(isInside(path.join(a, 'Low'), a));
  assert.ok(!isInside(a + 'B', a));
  const r = dedupePaths([a, path.join(a, 'Low'), a, path.join(os.tmpdir(), 'B')]);
  assert.deepStrictEqual(r, [a, path.join(os.tmpdir(), 'B')]);
});

test('scanDir считает только файлы старше minAge', async () => {
  const root = makeTree();
  assert.deepStrictEqual(await scanDir(root), { bytes: 6500, files: 4 });
  assert.deepStrictEqual(await scanDir(root, { minAgeMs: DAY }), { bytes: 6000, files: 3 });
  assert.deepStrictEqual(await scanDir(path.join(root, 'nope')), { bytes: 0, files: 0 });
});

test('cleanDir в режиме проверки ничего не удаляет', async () => {
  const root = makeTree();
  const r = await cleanDir(root, { dryRun: true, minAgeMs: DAY });
  assert.strictEqual(r.freed, 6000);
  assert.deepStrictEqual(await scanDir(root), { bytes: 6500, files: 4 });
});

test('cleanDir удаляет старые файлы, оставляет свежие и саму папку', async () => {
  const root = makeTree();
  const r = await cleanDir(root, { minAgeMs: DAY });
  assert.strictEqual(r.freed, 6000);
  assert.strictEqual(r.deleted, 3);
  assert.ok(fs.existsSync(root));
  assert.ok(fs.existsSync(path.join(root, 'fresh.tmp')));
  assert.ok(!fs.existsSync(path.join(root, 'sub')), 'пустые подпапки удалены');
});

test('cleanDir не уходит по ссылке в чужую папку', { skip: process.platform === 'win32' && 'симлинки в Windows требуют прав' }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rash-'));
  const precious = fs.mkdtempSync(path.join(os.tmpdir(), 'precious-'));
  fs.writeFileSync(path.join(precious, 'photo.jpg'), Buffer.alloc(100));
  fs.symlinkSync(precious, path.join(root, 'link'), 'dir');
  await cleanDir(root);
  assert.ok(fs.existsSync(path.join(precious, 'photo.jpg')));
});
