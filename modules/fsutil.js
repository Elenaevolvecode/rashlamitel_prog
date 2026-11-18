/**
 * Подсчёт и удаление файлов средствами Node, без PowerShell: быстрее и
 * позволяет честно посчитать, сколько места реально освободилось.
 *
 * Правила безопасности:
 * - ссылки и junction-точки не открываем (так нельзя случайно уйти в чужую папку);
 * - удаляем только содержимое папки, саму папку не трогаем;
 * - файлы младше minAgeMs не трогаем (с ними сейчас может работать программа);
 * - занятые файлы пропускаем молча.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const isWin = process.platform === 'win32';

function norm(p) {
  const r = path.resolve(p);
  return isWin ? r.toLowerCase() : r;
}

/** Лежит ли child внутри parent (или совпадает с ним). */
function isInside(child, parent) {
  const c = norm(child), p = norm(parent);
  if (c === p) return true;
  return c.startsWith(p.endsWith(path.sep) ? p : p + path.sep);
}

/** Убрать дубли и папки, вложенные в другие папки списка. */
function dedupePaths(paths) {
  const uniq = [];
  for (const p of paths) {
    if (!p) continue;
    if (uniq.some((u) => norm(u) === norm(p))) continue;
    uniq.push(p);
  }
  return uniq.filter((p) => !uniq.some((o) => o !== p && norm(o) !== norm(p) && isInside(p, o)));
}

async function exists(p) {
  try { await fsp.access(p); return true; } catch { return false; }
}

/**
 * Обойти дерево и вызвать onFile(fullPath, stat) для каждого файла.
 * Возвращает список подпапок в порядке «глубже — раньше» (для удаления пустых).
 */
async function walk(root, onFile) {
  const dirs = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) { stack.push(full); dirs.push(full); continue; }
      if (!e.isFile()) continue;
      let st;
      try { st = await fsp.lstat(full); } catch { continue; }
      await onFile(full, st);
    }
  }
  return dirs.reverse();
}

function eligible(st, minAgeMs, now) {
  return !minAgeMs || now - st.mtimeMs >= minAgeMs;
}

/** Сколько места займут файлы, которые cleanDir удалит при тех же опциях. */
async function scanDir(root, { minAgeMs = 0, now = Date.now() } = {}) {
  const res = { bytes: 0, files: 0 };
  if (!(await exists(root))) return res;
  await walk(root, (f, st) => {
    if (eligible(st, minAgeMs, now)) { res.bytes += st.size; res.files += 1; }
  });
  return res;
}

async function unlinkFile(f) {
  try { await fsp.unlink(f); return true; } catch (e) {
    if (e && (e.code === 'EPERM' || e.code === 'EACCES')) {
      // Файл «только для чтения» в Windows не удаляется, пока не снимем атрибут
      try { await fsp.chmod(f, 0o666); await fsp.unlink(f); return true; } catch {}
    }
    return false;
  }
}

/**
 * Удалить содержимое папки. Возвращает { freed, deleted, failed }:
 * freed — сумма размеров реально удалённых файлов (в dryRun — тех, что были бы удалены).
 */
async function cleanDir(root, { minAgeMs = 0, dryRun = false, now = Date.now() } = {}) {
  const res = { freed: 0, deleted: 0, failed: 0 };
  if (!(await exists(root))) return res;
  const dirs = await walk(root, async (f, st) => {
    if (!eligible(st, minAgeMs, now)) return;
    if (dryRun) { res.freed += st.size; res.deleted += 1; return; }
    if (await unlinkFile(f)) { res.freed += st.size; res.deleted += 1; } else res.failed += 1;
  });
  if (!dryRun) {
    for (const d of dirs) { try { await fsp.rmdir(d); } catch {} } // удалятся только пустые
  }
  return res;
}

module.exports = { isInside, dedupePaths, scanDir, cleanDir, exists, walk };
