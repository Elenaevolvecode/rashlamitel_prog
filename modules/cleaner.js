/**
 * Модуль очистки — РЕАЛЬНАЯ работа
 * Проверенные PowerShell-команды с UTF-8
 */
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

function ps(cmd) {
  return new Promise((resolve) => {
    exec(
      `powershell.exe -NoProfile -Command "chcp 65001 >$null; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ${cmd.replace(/"/g, '\\"')}"`,
      { maxBuffer: 10485760, encoding: 'utf8', timeout: 30000 },
      (err, stdout) => resolve(stdout ? stdout.trim() : '')
    );
  });
}

async function getFolderSize(p) {
  try {
    const r = await ps(`(Get-ChildItem -Path '${p}' -Recurse -File -EA SilentlyContinue | Measure-Object -Property Length -Sum).Sum`);
    return parseInt(r) || 0;
  } catch { return 0; }
}

async function cleanFolder(p) {
  try {
    await ps(`Remove-Item -Path '${p}\\*' -Recurse -Force -EA SilentlyContinue`);
    return true;
  } catch { return false; }
}

function getBrowserCachePaths() {
  const l = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const paths = [];
  // Chrome
  const chromeProf = path.join(l, 'Google', 'Chrome', 'User Data');
  if (fs.existsSync(chromeProf)) {
    paths.push(path.join(chromeProf, 'Default', 'Cache'));
    paths.push(path.join(chromeProf, 'Default', 'Code Cache'));
    // Дополнительные профили
    try {
      fs.readdirSync(chromeProf).filter(d => d.startsWith('Profile ')).forEach(d => {
        paths.push(path.join(chromeProf, d, 'Cache'));
        paths.push(path.join(chromeProf, d, 'Code Cache'));
      });
    } catch {}
  }
  // Edge
  const edgeProf = path.join(l, 'Microsoft', 'Edge', 'User Data');
  if (fs.existsSync(edgeProf)) {
    paths.push(path.join(edgeProf, 'Default', 'Cache'));
    paths.push(path.join(edgeProf, 'Default', 'Code Cache'));
  }
  // Яндекс Браузер
  const yaProf = path.join(l, 'Yandex', 'YandexBrowser', 'User Data');
  if (fs.existsSync(yaProf)) {
    paths.push(path.join(yaProf, 'Default', 'Cache'));
    paths.push(path.join(yaProf, 'Default', 'Code Cache'));
  }
  // Firefox — cache2
  const ffProf = path.join(l, 'Mozilla', 'Firefox', 'Profiles');
  if (fs.existsSync(ffProf)) {
    try {
      fs.readdirSync(ffProf).forEach(d => {
        paths.push(path.join(ffProf, d, 'cache2'));
      });
    } catch {}
  }
  return paths.filter(p => fs.existsSync(p));
}

async function scan() {
  const r = {
    internet: { size: 0, paths: [] },
    programs: { size: 0, paths: [] },
    recycle: { size: 0, files: 0 },
    downloads: { size: 0, installers: [] },
    other: { size: 0, paths: [] },
    total: 0,
  };

  // 1. Кэши браузеров
  for (const p of getBrowserCachePaths()) {
    const s = await getFolderSize(p);
    if (s > 0) { r.internet.size += s; r.internet.paths.push(p); }
  }

  // 2. Temp
  const temps = [
    process.env.TEMP || path.join(os.homedir(), 'AppData', 'Local', 'Temp'),
    'C:\\Windows\\Temp',
  ];
  for (const t of temps) {
    if (fs.existsSync(t)) { const s = await getFolderSize(t); r.programs.size += s; r.programs.paths.push(t); }
  }

  // 3. Корзина — через PowerShell COM
  try {
    const s = await ps(`$shell = New-Object -ComObject Shell.Application; $rb = $shell.NameSpace(0xA); $items = $rb.Items(); $sum = 0; foreach($i in $items) { $sum += $i.Size }; $sum`);
    const c = await ps(`$shell = New-Object -ComObject Shell.Application; $rb = $shell.NameSpace(0xA); $rb.Items().Count`);
    r.recycle.size = parseInt(s) || 0;
    r.recycle.files = parseInt(c) || 0;
  } catch {}

  // 4. Старые установщики из Загрузок (>30 дней)
  const dl = path.join(os.homedir(), 'Downloads');
  if (fs.existsSync(dl)) {
    try {
      const exts = ['.exe', '.msi', '.tmp', '.iso'];
      const limit = 30 * 86400000;
      for (const f of fs.readdirSync(dl)) {
        if (exts.includes(path.extname(f).toLowerCase())) {
          const fp = path.join(dl, f);
          try {
            const st = fs.statSync(fp);
            if (Date.now() - st.mtimeMs > limit) {
              r.downloads.size += st.size;
              r.downloads.installers.push({ name: f, size: st.size, path: fp });
            }
          } catch {}
        }
      }
    } catch {}
  }

  // 5. Прочее
  const others = [
    path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'Windows', 'INetCache'),
    path.join(os.homedir(), 'AppData', 'Local', 'Temp', 'Low'),
  ];
  for (const o of others) {
    if (fs.existsSync(o)) { const s = await getFolderSize(o); r.other.size += s; r.other.paths.push(o); }
  }

  r.total = r.internet.size + r.programs.size + r.recycle.size + r.downloads.size + r.other.size;
  return r;
}

async function clean(scanResults, onProgress) {
  const steps = [
    { id: 'internet', text: 'Убираю мусор из интернета…', sub: 'Chrome, Яндекс Браузер, Edge, Firefox' },
    { id: 'programs', text: 'Удаляю остатки от программ…', sub: 'Временные файлы Windows' },
    { id: 'recycle', text: 'Очищаю корзину…', sub: `${scanResults.recycle.files} файлов` },
    { id: 'downloads', text: 'Проверяю скачанные файлы…', sub: 'Старые установщики' },
    { id: 'other', text: 'Почти готово!', sub: 'Кэш и логи' },
  ];

  let totalFreed = 0;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    onProgress({ step: i, total: steps.length, text: step.text, sub: step.sub, freed: totalFreed });

    let freed = 0;
    switch (step.id) {
      case 'internet':
        for (const p of scanResults.internet.paths) await cleanFolder(p);
        freed = scanResults.internet.size; break;
      case 'programs':
        for (const p of scanResults.programs.paths) await cleanFolder(p);
        freed = scanResults.programs.size; break;
      case 'recycle':
        await ps('Clear-RecycleBin -Force -EA SilentlyContinue');
        freed = scanResults.recycle.size; break;
      case 'downloads':
        for (const inst of scanResults.downloads.installers) {
          try { fs.unlinkSync(inst.path); freed += inst.size; } catch {}
        } break;
      case 'other':
        for (const p of scanResults.other.paths) await cleanFolder(p);
        freed = scanResults.other.size; break;
    }
    totalFreed += freed;
    onProgress({ step: i, total: steps.length, text: step.text, sub: step.sub, freed: totalFreed, done: true });
    await new Promise(r => setTimeout(r, 300));
  }

  return { totalFreed, internet: scanResults.internet.size, programs: scanResults.programs.size,
    recycle: scanResults.recycle.size, downloads: scanResults.downloads.size, other: scanResults.other.size };
}

async function isBrowserRunning(name) {
  const r = await ps(`Get-Process -Name '${name}' -EA SilentlyContinue | Select-Object -First 1 | ForEach-Object { $_.Id }`);
  return r.length > 0;
}
async function closeBrowser(name) {
  await ps(`Stop-Process -Name '${name}' -Force -EA SilentlyContinue`);
  await new Promise(r => setTimeout(r, 1000));
  return true;
}

module.exports = { scan, clean, isBrowserRunning, closeBrowser };
