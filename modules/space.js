/**
 * «Что занимает место»: сколько весят папки пользователя и какие файлы самые большие.
 * Только показывает. Удалить файл можно лишь по явному нажатию — и только в Корзину.
 *
 * Не заходим в AppData (это программы, ими занимается очистка), в папки с точкой в начале
 * (.android, .gradle… — тоже служебные папки программ), в ссылки/junction-точки
 * и в OneDrive: там файлы часто хранятся только в облаке, но размер показывают полный.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { walk } = require('./fsutil');

const MIN_FILE = 100 * 1024 * 1024; // в «самые большие» попадают файлы от 100 МБ
const TOP_FILES = 30;
const MIN_FOLDER = 10 * 1024 * 1024; // почти пустые папки (Контакты, Ссылки…) не показываем — только удлиняют список

const TITLES = {
  desktop: 'Рабочий стол', documents: 'Документы', downloads: 'Загрузки', pictures: 'Изображения',
  videos: 'Видео', music: 'Музыка', '3d objects': 'Объёмные объекты', 'saved games': 'Сохранённые игры',
  contacts: 'Контакты', favorites: 'Избранное', links: 'Ссылки', searches: 'Поиски',
};
const ICONS = { desktop: '💻', documents: '📄', downloads: '📥', pictures: '🖼', videos: '🎬', music: '🎵', 'saved games': '🎮' };
const SKIP = new Set(['appdata', 'application data', 'local settings', 'ntuser.dat']);

function skipTopDir(name) {
  const n = name.toLowerCase();
  // Папки с точкой в начале (.android, .gradle, .vscode…) создают программы — обычному человеку они не нужны,
  // а трогать их не стоит. Не показываем вовсе (как и AppData); заодно поиск быстрее.
  return SKIP.has(n) || n.startsWith('onedrive') || n.startsWith('ntuser') || n.startsWith('.');
}

/** Верхние папки в папке пользователя, которые будем считать. */
function topFolders(home) {
  let entries = [];
  try { entries = fs.readdirSync(home, { withFileTypes: true }); } catch {}
  return entries
    .filter((e) => e.isDirectory() && !e.isSymbolicLink() && !skipTopDir(e.name))
    .map((e) => {
      const key = e.name.toLowerCase();
      return { name: e.name, title: TITLES[key] || e.name, icon: ICONS[key] || '📁', path: path.join(home, e.name) };
    });
}

/** Сохраняем только TOP_FILES самых больших — список не разрастается на тысячах файлов. */
function pushTop(list, item) {
  if (list.length < TOP_FILES) { list.push(item); list.sort((a, b) => b.size - a.size); return; }
  if (item.size <= list[list.length - 1].size) return;
  list[list.length - 1] = item;
  list.sort((a, b) => b.size - a.size);
}

async function diskInfo(home) {
  try {
    const root = path.parse(home).root || '/';
    const st = await fs.promises.statfs(root);
    return { drive: root.replace(/\\$/, ''), total: Number(st.blocks) * Number(st.bsize), free: Number(st.bavail) * Number(st.bsize) };
  } catch { return null; }
}

/**
 * Возвращает { disk, folders: [{ title, icon, path, size }], files: [{ name, dir, folderTitle, path, size, mtime }], skipped: [] }.
 * onProgress(title) — какую папку сейчас смотрим.
 */
async function scanSpace({ home = os.homedir(), minFile = MIN_FILE, onProgress = () => {} } = {}) {
  const folders = [];
  const files = [];
  for (const f of topFolders(home)) {
    onProgress(f.title);
    let size = 0;
    await walk(f.path, (full, st) => {
      size += st.size;
      if (st.size >= minFile) {
        pushTop(files, { name: path.basename(full), dir: path.dirname(full), folderTitle: f.title, path: full, size: st.size, mtime: st.mtimeMs });
      }
    });
    if (size >= MIN_FOLDER) folders.push({ title: f.title, icon: f.icon, path: f.path, size });
  }
  // Файлы прямо в папке пользователя (не в подпапках)
  let rootSize = 0;
  try {
    for (const e of fs.readdirSync(home, { withFileTypes: true })) {
      if (!e.isFile()) continue;
      if (e.name.toLowerCase().startsWith('ntuser')) continue; // служебные файлы Windows
      const full = path.join(home, e.name);
      try {
        const st = fs.lstatSync(full);
        rootSize += st.size;
        if (st.size >= minFile) pushTop(files, { name: e.name, dir: home, folderTitle: 'Папка пользователя', path: full, size: st.size, mtime: st.mtimeMs });
      } catch {}
    }
  } catch {}
  if (rootSize >= MIN_FOLDER) folders.push({ title: 'Файлы в папке пользователя', icon: '📁', path: home, size: rootSize });

  folders.sort((a, b) => b.size - a.size);
  const skipped = topFoldersSkipped(home);
  return { disk: await diskInfo(home), folders, files, skipped };
}

function topFoldersSkipped(home) {
  try {
    return fs.readdirSync(home, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.toLowerCase().startsWith('onedrive')).map((e) => e.name);
  } catch { return []; }
}

/** Для интерфейса: без полных путей, с номерами. Пути остаются в основном процессе. */
function forUi(r) {
  return {
    disk: r.disk,
    skipped: r.skipped,
    folders: r.folders.map((f, i) => ({ id: 'f' + i, title: f.title, icon: f.icon, size: f.size })),
    files: r.files.map((f, i) => ({ id: 'x' + i, name: f.name, folderTitle: f.folderTitle, where: shortWhere(f), size: f.size, mtime: f.mtime })),
  };
}

/** «Загрузки › Фильмы» — где лежит файл, понятными словами. */
function shortWhere(f) {
  const parts = f.dir.split(/[\\/]/).filter(Boolean);
  const i = parts.findIndex((p) => (TITLES[p.toLowerCase()] || p) === f.folderTitle);
  const rest = i >= 0 ? parts.slice(i + 1) : [];
  return [f.folderTitle, ...rest].join(' › ');
}

module.exports = { scanSpace, forUi, topFolders, MIN_FILE, TOP_FILES };
