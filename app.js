/* РАСХЛАМИТЕЛЬ ПК — интерфейс.
 * В Electron работает по-настоящему (window.rashlamitel из preload.js),
 * при открытии index.html в браузере — демо-режим на выдуманных данных.
 */
const api = window.rashlamitel || null;
const isElectron = !!api;
const GB = 1073741824;

const state = {
  navStack: [], currentScreen: null,
  settings: { onboardingDone: false, dryRun: true },
  scanResults: null, scanning: false, cleaningInProgress: false,
  autostartData: null, programsData: null, progScreen: null,
};

// ===== Утилиты =====
function formatBytes(b) {
  if (!b) return '0 Б';
  if (b >= GB) return (b / GB).toFixed(1) + ' ГБ';
  if (b >= 1048576) return Math.round(b / 1048576) + ' МБ';
  if (b >= 1024) return Math.round(b / 1024) + ' КБ';
  return b + ' Б';
}
function bytesToGB(b) { return (b / GB).toFixed(1); }
/** Окончание по числу: plural(1,'файл','файла','файлов') → 'файл', 3 → 'файла', 5 → 'файлов' */
function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
function $(id) { return document.getElementById(id); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function showToast(m) {
  const t = $('toast'); t.textContent = m; t.classList.remove('hidden');
  clearTimeout(window._tt); window._tt = setTimeout(() => t.classList.add('hidden'), 4500);
}

/** Диалог подтверждения. Возвращает Promise<boolean>. */
function confirmDialog({ title, text, yes, no }) {
  return new Promise((resolve) => {
    $('confirm-dialog-title').textContent = title;
    $('confirm-dialog-text').textContent = text;
    $('confirm-dialog-yes').textContent = yes;
    $('confirm-dialog-no').textContent = no;
    const overlay = $('confirm-dialog-overlay');
    overlay.classList.remove('hidden');
    const done = (v) => { overlay.classList.add('hidden'); resolve(v); };
    $('confirm-dialog-yes').onclick = () => done(true);
    $('confirm-dialog-no').onclick = () => done(false);
  });
}

// ===== Навигация =====
function showScreen(id) {
  if (state.currentScreen && state.currentScreen !== id) state.navStack.push(state.currentScreen);
  document.querySelectorAll('.screen').forEach((s) => s.classList.add('hidden'));
  $(id).classList.remove('hidden');
  state.currentScreen = id;
  if (id === 'screen-settings') $('setting-dryrun').checked = !!state.settings.dryRun;
}
function goBack() {
  if (state.navStack.length) {
    const p = state.navStack.pop();
    document.querySelectorAll('.screen').forEach((s) => s.classList.add('hidden'));
    $(p).classList.remove('hidden');
    state.currentScreen = p;
  } else showScreen('screen-main');
}
function switchTab(btn) {
  const id = btn.dataset.tab;
  document.querySelectorAll('.nav-tab').forEach((t) => t.classList.remove('active'));
  document.querySelectorAll(`.nav-tab[data-tab="${id}"]`).forEach((t) => t.classList.add('active'));
  state.navStack = []; state.currentScreen = id;
  document.querySelectorAll('.screen').forEach((s) => s.classList.add('hidden'));
  $(id).classList.remove('hidden');
  if (id === 'screen-autostart') { if (!state.autostartData) loadAutostart(); else renderAutostart(); }
  if (id === 'screen-programs') { if (!state.programsData) loadPrograms(); else renderProgramsMenu(); }
}

// ===== Настройки =====
async function setSetting(key, value) {
  state.settings[key] = value;
  if (isElectron) await api.setSetting(key, value);
}
function updateDryRunBanner() {
  $('dryrun-banner').classList.toggle('hidden', !state.settings.dryRun);
}
async function toggleDryRun(input) {
  await setSetting('dryRun', input.checked);
  updateDryRunBanner();
  showToast(input.checked ? 'Режим проверки включён: ничего не удаляю, только показываю' : 'Режим проверки выключен: теперь буду удалять по-настоящему');
}
async function completeOnboarding() {
  await setSetting('onboardingDone', true);
  state.navStack = []; showScreen('screen-main');
  await scanTrash();
}
function openLink(url) {
  if (isElectron) api.openExternal(url); else window.open(url, '_blank');
}

// ===== Главный экран =====
const DEMO_SCAN = { internet: { size: 1.8 * GB, files: 4120 }, programs: { size: 0.9 * GB, files: 2310 }, recycle: { size: 0.6 * GB, files: 847 },
  downloads: { size: 0.3 * GB, files: 3 }, other: { size: 0.1 * GB, files: 112 }, total: 3.7 * GB };

async function scanTrash() {
  if (state.scanning) return;
  state.scanning = true;
  $('main-mascot-text').textContent = 'Ищу мусор… Это займёт от 20 секунд до пары минут.';
  $('scan-details').classList.add('hidden');
  try {
    if (isElectron) state.scanResults = await api.scan();
    else { await sleep(500); state.scanResults = DEMO_SCAN; }
  } finally { state.scanning = false; }
  const r = state.scanResults;
  $('scan-d-internet').textContent = formatBytes(r.internet.size);
  $('scan-d-programs').textContent = formatBytes(r.programs.size);
  $('scan-d-recycle').textContent = formatBytes(r.recycle.size);
  $('scan-d-downloads').textContent = formatBytes(r.downloads.size);
  $('scan-d-other').textContent = formatBytes(r.other.size);
  $('scan-details').classList.remove('hidden');
  updateMainScreen();
}

function updateMainScreen() {
  const f = $('trash-bar-fill'), a = $('trash-amount'), t = $('main-mascot-text');
  // Корзину в «мусор» не считаем: это файлы пользователя, чистим только с его согласия
  const r = state.scanResults;
  const bytes = r ? r.total - r.recycle.size : 0;
  const gb = parseFloat(bytesToGB(bytes));
  const warm = 'linear-gradient(90deg,var(--accent-amber),#e05a15)';
  if (gb > 3) { t.textContent = `Накопилось ${gb} ГБ мусора — пора почистить!`; f.style.width = Math.min(gb / 5 * 100, 100) + '%'; f.style.background = warm; }
  else if (gb > 0.5) { t.textContent = 'Есть что почистить!'; f.style.width = Math.max(gb / 5 * 100, 15) + '%'; f.style.background = warm; }
  // Пару десятков мегабайт служебных файлов Windows создаёт постоянно — это не повод тревожить
  else if (bytes >= 50 * 1048576) { t.textContent = 'Мусора немного, но почистить можно'; f.style.width = '12%'; f.style.background = '#1D8A40'; }
  else { t.textContent = 'Компьютер чистый — мусора почти нет!'; f.style.width = '5%'; f.style.background = '#1D8A40'; }
  a.textContent = (bytes > 0 && gb === 0 ? formatBytes(bytes) : gb + ' ГБ');
}

// ===== Очистка =====
async function askCleanOptions() {
  const opts = { emptyRecycle: false, skipBrowsers: [] };
  const r = state.scanResults;

  if (r && r.recycle.size > 0) {
    opts.emptyRecycle = await confirmDialog({
      title: 'Очистить Корзину?',
      text: `В Корзине ${formatBytes(r.recycle.size)} (${r.recycle.files} шт.). Это файлы, которые вы удалили сами. После очистки вернуть их будет нельзя.`,
      yes: 'Да, очистить Корзину', no: 'Нет, оставить как есть',
    });
  }

  // В режиме проверки браузеры не закрываем — незачем
  if (isElectron && !state.settings.dryRun) {
    const running = await api.getRunningBrowsers();
    if (running.length) {
      const names = running.map((b) => b.name).join(', ');
      const close = await confirmDialog({
        title: running.length > 1 ? `Открыты браузеры: ${names}` : `Открыт браузер ${names}`,
        text: 'Чтобы убрать мусор из браузера, его нужно закрыть. Пароли и закладки я не трогаю, а вкладки браузер предложит восстановить при следующем запуске.',
        yes: 'Закрыть браузер и почистить', no: 'Не трогать браузер',
      });
      if (close) {
        const still = await api.closeBrowsers(running.map((b) => b.id));
        if (still.length) showToast(`${still.map((b) => b.name).join(', ')} не закрылся — его пропущу`);
        opts.skipBrowsers = still.map((b) => b.id);
      } else opts.skipBrowsers = running.map((b) => b.id);
    }
  }
  return opts;
}

async function startCleaning() {
  if (state.cleaningInProgress) return;
  if (state.scanning) { showToast('Секунду, ещё ищу мусор…'); return; }
  state.cleaningInProgress = true;
  try {
    const opts = await askCleanOptions();
    state.navStack = []; showScreen('screen-cleaning');
    resetCleanUI();
    let result;
    if (isElectron) {
      api.onCleanProgress(updateCleanUI);
      result = await api.clean(opts);
    } else result = await runDemo(opts);
    if (!result || result.error) {
      showToast('Что-то пошло не так. Попробуйте ещё раз');
      state.navStack = []; showScreen('screen-main');
      return;
    }
    showRes(result);
  } finally {
    state.cleaningInProgress = false;
  }
}

function resetCleanUI() {
  $('progress-fill').style.width = '0%';
  $('cleaning-freed').textContent = state.settings.dryRun ? 'Можно освободить: 0.0 ГБ' : 'Освобождено: 0.0 ГБ';
  $('cleaning-percent').textContent = '0%';
  document.querySelectorAll('.step-item').forEach((el, i) => { el.classList.remove('active', 'done'); el.querySelector('.step-check').textContent = i === 0 ? '●' : '○'; });
}

function updateCleanUI(d) {
  // Процент — по шагам: честнее, чем по гигабайтам, которые заранее точно не известны
  const pct = Math.min(100, Math.round(((d.step + (d.done ? 1 : 0.5)) / d.total) * 100));
  $('cleaning-step-text').textContent = d.text;
  $('cleaning-step-sub').textContent = d.sub;
  $('progress-fill').style.width = pct + '%';
  $('cleaning-freed').textContent = (state.settings.dryRun ? 'Можно освободить: ' : 'Освобождено: ') + bytesToGB(d.freed) + ' ГБ';
  $('cleaning-percent').textContent = pct + '%';
  document.querySelectorAll('.step-item').forEach((el, i) => {
    el.classList.remove('active', 'done');
    const check = el.querySelector('.step-check');
    if (i < d.step || (i === d.step && d.done)) { el.classList.add('done'); check.textContent = '✓'; }
    else if (i === d.step) { el.classList.add('active'); check.textContent = '●'; }
    else check.textContent = '○';
  });
}

async function runDemo(opts) {
  const r = DEMO_SCAN;
  const steps = [
    { id: 'internet', text: 'Убираю мусор из интернета…', sub: 'Chrome, Яндекс Браузер, Edge, Opera, Firefox' },
    { id: 'programs', text: 'Удаляю остатки от программ…', sub: 'Временные файлы Windows' },
    { id: 'recycle', text: 'Очищаю корзину…', sub: opts.emptyRecycle ? '847 файлов' : 'Пропускаю — вы решили не очищать' },
    { id: 'downloads', text: 'Проверяю скачанные файлы…', sub: 'Старые установщики — в Корзину' },
    { id: 'other', text: 'Почти готово!', sub: 'Кэш и отчёты об ошибках' },
  ];
  const res = { dryRun: state.settings.dryRun, totalFreed: 0, movedToTrash: 0, failedFiles: 0, skipped: { recycle: !opts.emptyRecycle, browsers: [] } };
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    updateCleanUI({ step: i, total: steps.length, ...s, freed: res.totalFreed });
    await sleep(900 + Math.random() * 600);
    const freed = s.id === 'recycle' && !opts.emptyRecycle ? 0 : r[s.id].size;
    res[s.id] = freed;
    if (s.id === 'downloads') res.movedToTrash = freed; else res.totalFreed += freed;
    updateCleanUI({ step: i, total: steps.length, ...s, freed: res.totalFreed, done: true });
  }
  return res;
}

function showRes(r) {
  const dry = !!r.dryRun;
  $('result-title').textContent = dry ? 'ПРОВЕРКА ЗАВЕРШЕНА' : 'ГОТОВО!';
  $('result-subtitle').textContent = dry ? 'Вот сколько места я мог бы освободить' : 'Ваш компьютер стал чище';
  $('result-amount-label').textContent = dry ? 'можно освободить' : 'освобождено';
  $('result-gb').textContent = bytesToGB(r.totalFreed);
  $('res-internet').textContent = formatBytes(r.internet);
  $('res-programs').textContent = formatBytes(r.programs);
  $('res-trash').textContent = r.skipped && r.skipped.recycle ? 'не трогал' : formatBytes(r.recycle);
  $('res-downloads').textContent = formatBytes(r.downloads);
  $('res-other').textContent = formatBytes(r.other);

  const notes = [];
  if (dry) notes.push('Это был режим проверки — я ничего не удалил. Выключить его можно в настройках ⚙.');
  else {
    if (r.failedFiles > 0) notes.push('Часть файлов сейчас заняты программами — их я пропустил, это нормально.');
    if (r.skipped && r.skipped.browsers && r.skipped.browsers.length) notes.push('Браузер не чистил — он был открыт.');
    if (r.movedToTrash > 0) notes.push(`Старые установщики (${formatBytes(r.movedToTrash)}) перенёс в Корзину — если что, их можно вернуть.`);
    if (!notes.length) notes.push('Очистка завершена. Ваш компьютер стал чище!');
  }
  $('result-note').textContent = notes.join(' ');
  state.navStack = []; showScreen('screen-result');
}

async function finishCleaning() {
  state.navStack = []; showScreen('screen-main');
  if (isElectron) await scanTrash();
  else { state.scanResults = { ...DEMO_SCAN, internet: { size: 0 }, programs: { size: 0 }, downloads: { size: 0 }, other: { size: 0 }, total: DEMO_SCAN.recycle.size }; updateMainScreen(); }
}

// ===== Автозагрузка =====
async function loadAutostart() {
  $('autostart-list').innerHTML = '<p style="text-align:center;color:var(--text-secondary);padding:16px">Загрузка…</p>';
  if (isElectron) state.autostartData = await api.getAutostart();
  else state.autostartData = [
    { id: 'win_def', name: 'Windows Security', category: 'green', label: 'Нужна', icon: '🛡', description: 'Защита Windows', enabled: true, needsAdmin: true },
    { id: 'chrome', name: 'Google Chrome', category: 'yellow', label: 'Можно откл.', icon: '🌐', description: 'Браузер. Откроется, когда понадобится', enabled: true },
    { id: 'telegram', name: 'Telegram', category: 'yellow', label: 'Можно откл.', icon: '💬', description: 'Мессенджер', enabled: true },
    { id: 'utorrent', name: 'uTorrent', category: 'red', label: 'Лучше откл.', icon: '⚠', description: 'Программа для скачивания, показывает рекламу', enabled: true },
  ];
  renderAutostart();
}

function renderAutostart() {
  const list = $('autostart-list'), d = state.autostartData;
  if (!d) return;
  const canOff = d.filter((p) => p.category !== 'green' && p.enabled).length;
  $('autostart-subtitle').textContent = d.length
    ? `${d.length} ${plural(d.length, 'программа запускается', 'программы запускаются', 'программ запускаются')} при включении компьютера. ` +
      (!canOff ? 'Лишнего не нашёл.'
        : d.length === 1 ? 'Её можно отключить — компьютер будет включаться быстрее.'
        : `${canOff} из них можно отключить — компьютер будет включаться быстрее.`)
    : 'Не нашёл программ, которые запускаются при включении.';
  list.innerHTML = d.map((p) => `
    <div class="autostart-card"><div class="autostart-card-left"><span class="autostart-icon">${escHtml(p.icon)}</span><div>
      <span class="autostart-name">${escHtml(p.name)}</span>
      <span class="autostart-label ${escHtml(p.category)}">${escHtml(p.label)}</span>
      ${p.description ? `<span class="autostart-hint">${escHtml(p.description)}</span>` : ''}
    </div></div>
    <label class="toggle"><input type="checkbox" ${p.enabled ? 'checked' : ''} data-id="${escHtml(p.id)}" onchange="toggleAutostart(this)"><span class="toggle-slider"></span></label></div>`).join('');
}

async function setAutostart(prog, enabled) {
  if (!isElectron) { prog.enabled = enabled; return { ok: true }; }
  if (prog.needsAdmin) showToast('Windows спросит разрешение — нажмите «Да»');
  return api.setAutostart(prog.id, enabled);
}

async function toggleAutostart(input) {
  const prog = state.autostartData.find((p) => p.id === input.dataset.id);
  if (!prog) return;
  if (prog.category === 'green' && !input.checked) { input.checked = true; showToast(`${prog.name} нужна для работы компьютера`); return; }
  input.disabled = true;
  const r = await setAutostart(prog, input.checked);
  input.disabled = false;
  if (!r.ok) {
    input.checked = !input.checked;
    showToast(r.cancelled ? 'Без разрешения Windows не получится — ничего не изменил' : 'Не получилось изменить. Попробуйте ещё раз');
    return;
  }
  prog.enabled = input.checked;
  showToast(input.checked ? `${prog.name} снова будет запускаться` : `${prog.name} больше не запускается при включении`);
  renderAutostart();
}

async function disableAllUnnecessary() {
  const targets = (state.autostartData || []).filter((p) => p.category === 'red' && p.enabled);
  if (!targets.length) { showToast('Лишнего уже ничего не запускается'); return; }
  let done = 0;
  for (const p of targets) {
    const r = await setAutostart(p, false);
    if (r.ok) { p.enabled = false; done++; }
  }
  renderAutostart();
  showToast(done === targets.length ? 'Готово! При следующем включении компьютер запустится быстрее' : `Отключил ${done} из ${targets.length}`);
}

// ===== Программы =====
async function loadPrograms() {
  $('programs-subtitle').textContent = 'Загрузка…';
  if (isElectron) state.programsData = await api.getPrograms();
  else state.programsData = [
    { id: '0', name: 'uTorrent Web', size: '28 МБ', sizeBytes: 29360128, category: 'junk', reason: 'Показывает рекламу' },
    { id: '1', name: 'Adobe Photoshop', size: '2.7 ГБ', sizeBytes: 2900000000, category: 'other', reason: '' },
    { id: '2', name: 'Microsoft Office', size: '2.1 ГБ', sizeBytes: 2254857830, category: 'used', reason: '' },
    { id: '3', name: 'Windows SDK', size: '2.3 ГБ', sizeBytes: 2469606195, category: 'system', reason: '' },
  ];
  renderProgramsMenu();
}

function renderProgramsMenu() {
  const d = state.programsData; if (!d) return;
  const junk = d.filter((p) => p.category === 'junk');
  const other = d.filter((p) => p.category === 'other' || p.category === 'used');
  const sys = d.filter((p) => p.category === 'system');
  $('programs-subtitle').textContent = `На компьютере ${d.length} ${plural(d.length, 'программа', 'программы', 'программ')}.` +
    (junk.length ? ` Есть ${junk.length} ${plural(junk.length, 'программа, которая обычно не нужна', 'программы, которые обычно не нужны', 'программ, которые обычно не нужны')}.` : ' Лишних не нашёл.');
  const junkMenu = $('prog-menu-junk');
  if (junk.length) { junkMenu.style.display = ''; $('prog-count-junk').textContent = junk.length; } else junkMenu.style.display = 'none';
  $('prog-count-other').textContent = other.length;
  $('prog-count-system').textContent = sys.length;
}

function programCard(p, { removable, locked } = {}) {
  return `<div class="program-card"><div class="program-info"><span class="program-name">${escHtml(p.name)}</span>${p.sizeBytes ? `<span class="program-size">${escHtml(p.size)}</span>` : ''}${p.reason ? `<span class="program-reason">${escHtml(p.reason)}</span>` : ''}</div>` +
    (removable ? `<button class="btn-remove" onclick="doUninstall('${escHtml(p.id)}')">Удалить</button>` : '') +
    (locked ? '<span class="btn-system">🔒</span>' : '') + '</div>';
}

function renderProgList(type) {
  const d = state.programsData || [];
  const empty = (t) => `<p style="text-align:center;color:var(--text-secondary);padding:20px">${t}</p>`;
  if (type === 'junk') $('prog-list-junk').innerHTML = d.filter((p) => p.category === 'junk').map((p) => programCard(p, { removable: true })).join('') || empty('Лишних программ не нашёл');
  if (type === 'other') $('prog-list-other').innerHTML = d.filter((p) => p.category === 'other' || p.category === 'used').map((p) => programCard(p)).join('');
  if (type === 'other-delete') $('prog-list-other-delete').innerHTML = d.filter((p) => p.category === 'other' || p.category === 'used').map((p) => programCard(p, { removable: true })).join('');
  if (type === 'system') $('prog-list-system').innerHTML = d.filter((p) => p.category === 'system').map((p) => programCard(p, { locked: true })).join('');
}

function showProgScreen(type) {
  if (!state.programsData) return;
  state.progScreen = type;
  renderProgList(type);
  showScreen('screen-prog-' + type);
}

function doUninstall(id) {
  const prog = (state.programsData || []).find((p) => p.id === id);
  if (!prog) return;
  $('delete-dialog-title').textContent = 'Удалить ' + prog.name + '?';
  $('delete-dialog-text').textContent = (prog.sizeBytes ? 'Это освободит около ' + prog.size + '. ' : '') + 'Откроется штатный деинсталлятор программы — следуйте его подсказкам.';
  $('delete-dialog-overlay').classList.remove('hidden');
  $('delete-confirm-btn').onclick = async () => {
    closeDeleteDialog();
    if (!isElectron) {
      state.programsData = state.programsData.filter((p) => p.id !== id);
      renderProgList(state.progScreen); renderProgramsMenu();
      showToast(prog.name + ' удалена (демо)');
      return;
    }
    showToast('Запускаю удаление ' + prog.name + '…');
    const r = await api.uninstallProgram(id);
    if (r.status === 'removed') showToast(prog.name + ' удалена');
    else if (r.status === 'pending') showToast('Если открылось окно удаления — завершите его. Список обновлю.');
    else showToast('Не удалось запустить удаление ' + prog.name);
    await loadPrograms();
    if (state.progScreen) renderProgList(state.progScreen);
  };
}
function closeDeleteDialog() { $('delete-dialog-overlay').classList.add('hidden'); }

// ===== Старт =====
async function init() {
  if (isElectron) {
    try { state.settings = { ...state.settings, ...(await api.getSettings()) }; } catch {}
    try { const v = await api.getVersion(); document.querySelectorAll('.app-version').forEach((el) => { el.textContent = v; }); } catch {}
  }
  updateDryRunBanner();
  if (state.settings.onboardingDone) {
    state.navStack = []; showScreen('screen-main');
    scanTrash();
  } else showScreen('screen-onboarding1');
}
document.addEventListener('DOMContentLoaded', init);
