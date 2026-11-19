/* РАСХЛАМИТЕЛЬ ПК — интерфейс.
 * В Electron работает по-настоящему (window.rashlamitel из preload.js),
 * при открытии index.html в браузере — демо-режим на выдуманных данных.
 */
const api = window.rashlamitel || null;
const isElectron = !!api;
const GB = 1073741824;

const state = {
  navStack: [], currentScreen: null,
  settings: { onboardingDone: false, dryRun: true, reminderEnabled: true, reminderDays: 30, cleanChoices: {} },
  scanResults: null, selected: new Set(), scanning: false, cleaningInProgress: false,
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
  if (id === 'screen-settings') { $('setting-dryrun').checked = !!state.settings.dryRun; updateReminderUI(); }
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
// ===== Напоминания =====
const FREQ = { 7: 'Раз в неделю', 14: 'Раз в две недели', 30: 'Раз в месяц' };
function reminderDays() { return FREQ[state.settings.reminderDays] ? Number(state.settings.reminderDays) : 30; }
function updateReminderUI() {
  const on = state.settings.reminderEnabled !== false;
  $('setting-reminder').checked = on;
  $('setting-reminder-days').value = String(reminderDays());
  $('setting-reminder-days').disabled = !on;
  $('reminder-desc').textContent = on
    ? `${FREQ[reminderDays()]} тихо проверю компьютер. Если мусора больше 1 ГБ — покажу небольшое окошко в углу экрана. Сам ничего не удаляю.`
    : 'Напоминания выключены. Включите, и я буду сам подсказывать, когда пора почистить.';
}
async function applyReminder(okText) {
  updateReminderUI();
  const ok = isElectron ? await api.syncReminder() : true;
  showToast(ok ? okText : 'Не получилось настроить напоминание. Попробуйте ещё раз');
}
async function toggleReminder(input) {
  await setSetting('reminderEnabled', input.checked);
  await applyReminder(input.checked ? `Буду напоминать: ${FREQ[reminderDays()].toLowerCase()}` : 'Напоминания выключены');
}
async function changeReminderDays(sel) {
  await setSetting('reminderDays', Number(sel.value));
  await applyReminder(`Буду напоминать: ${FREQ[reminderDays()].toLowerCase()}`);
}
async function testReminder() {
  if (!isElectron) { showToast('В программе здесь появится окошко в правом нижнем углу экрана'); return; }
  showToast('Ищу мусор, чтобы показать окошко…');
  const ok = await api.testReminder();
  if (!ok) showToast('Не получилось показать окошко. Попробуйте ещё раз');
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
const GROUPS = { internet: 'Интернет', apps: 'Программы', windows: 'Windows', user: 'Ваши файлы' };

function demoItem(id, group, icon, title, sizeGb, extra = {}) {
  return { id, group, icon, title, size: Math.round(sizeGb * GB), files: 100, defaultOn: true,
    what: 'Демо: здесь будет пояснение, что это за файлы.', why: 'Демо: почему их можно удалить.', after: 'Демо: что изменится после.', ...extra };
}
const DEMO_ITEMS = [
  demoItem('chrome', 'internet', '🌐', 'Google Chrome', 1.2, {
    what: 'Кусочки сайтов, которые Chrome сохранил «про запас», чтобы быстрее их открывать.',
    why: 'Пароли, закладки, история и входы на сайты не трогаю — только этот запас.',
    after: 'Сайты первый раз откроются чуть медленнее, потом всё как обычно.' }),
  demoItem('yandex', 'internet', '🌐', 'Яндекс Браузер', 0.6),
  demoItem('telegram', 'apps', '💬', 'Telegram', 4.1, {
    what: 'Картинки, видео и стикеры из чатов, которые вы уже смотрели. Telegram хранит копии, чтобы показывать их быстрее.',
    why: 'Всё хранится на серверах Telegram — переписка и файлы не пропадут. Файлы, которые вы сами скачали в «Загрузки», не трогаю.',
    after: 'Старые фото и видео в чатах при открытии загрузятся заново.' }),
  demoItem('temp', 'windows', '📁', 'Временные файлы', 0.9),
  demoItem('syscache', 'windows', '🧾', 'Отчёты об ошибках и кэш Windows', 0.1),
  demoItem('deep', 'windows', '🛠', 'Глубокая очистка Windows', 0, { defaultOn: false, sizeUnknown: true,
    what: 'Остатки старых обновлений Windows, отчёты о сбоях системы, кэш миниатюр и папка Windows.old — прошлая версия Windows после большого обновления, обычно это 10–30 ГБ.',
    why: 'Чистит встроенное средство Windows «Очистка диска» — то же самое делают вручную компьютерные мастера. Windows спросит разрешение — нажмите «Да». Сколько освободится, станет известно после.',
    warn: 'После этого нельзя будет откатиться на прошлую версию Windows. Очистка может занять 5–15 минут, появится и само закроется окно «Очистка диска».',
    after: 'Windows работает как прежде, просто станет больше места.' }),
  demoItem('downloads', 'user', '📥', 'Старые установщики', 0.3, {
    list: [{ name: 'ChromeSetup.exe', size: 1.3e6 }, { name: 'Zoom_installer.exe', size: 9e7 }, { name: 'office2019.iso', size: 2.2e8 }] }),
  demoItem('recycle', 'user', '🗑', 'Корзина', 0.6, { defaultOn: false, why: '',
    what: 'Файлы, которые вы удалили сами.',
    warn: 'Вернуть их после очистки будет нельзя. Поэтому галочка не стоит — поставьте, только если уверены.' }),
];
function demoScan(items = DEMO_ITEMS) { return { items, total: items.reduce((s, i) => s + i.size, 0) }; }

// Пункты, которые никогда не запоминаем: необратимые или долгие — галочка каждый раз снята
const NEVER_REMEMBER = ['recycle', 'deep'];
/** Отмечен ли пункт при открытии: обычный выбор или то, что пользователь выбрал в прошлый раз. */
function isChosen(i) {
  const saved = (state.settings.cleanChoices || {})[i.id];
  if (NEVER_REMEMBER.includes(i.id) || typeof saved !== 'boolean') return i.defaultOn;
  return saved;
}
function rememberChoice(id, on) {
  if (NEVER_REMEMBER.includes(id)) return;
  const item = scanItems().find((i) => i.id === id);
  const choices = { ...(state.settings.cleanChoices || {}) };
  if (item && on === item.defaultOn) delete choices[id]; else choices[id] = on;
  setSetting('cleanChoices', choices);
}

function scanItems() { return (state.scanResults && state.scanResults.items) || []; }
/** Сколько уберу «по умолчанию» — ровно столько покажет и экран предпросмотра при открытии. */
function defaultBytes() { return scanItems().filter(isChosen).reduce((s, i) => s + i.size, 0); }

async function scanTrash() {
  if (state.scanning) return;
  state.scanning = true;
  $('main-mascot-text').textContent = 'Ищу мусор… Это займёт от 20 секунд до пары минут.';
  $('scan-details').classList.add('hidden');
  try {
    if (isElectron) state.scanResults = await api.scan();
    else { await sleep(500); state.scanResults = demoScan(); }
  } finally { state.scanning = false; }
  state.selected = new Set(scanItems().filter(isChosen).map((i) => i.id));

  // Короткая сводка по группам; подробности — на экране предпросмотра
  const rows = Object.entries(GROUPS).map(([g, title]) => {
    const items = scanItems().filter((i) => i.group === g && !i.sizeUnknown);
    if (!items.length) return '';
    const size = items.reduce((s, i) => s + i.size, 0);
    const names = items.map((i) => i.title).join(', ');
    return `<div class="scan-detail-row" title="${escHtml(names)}"><span>${escHtml(title)}</span><span>${formatBytes(size)}</span></div>`;
  }).join('');
  $('scan-details').innerHTML = rows;
  $('scan-details').classList.toggle('hidden', !rows);
  updateMainScreen();
}

function updateMainScreen() {
  const f = $('trash-bar-fill'), a = $('trash-amount'), t = $('main-mascot-text');
  // Корзину в «мусор» не считаем: это файлы пользователя, чистим только с его согласия
  const bytes = defaultBytes();
  const gb = parseFloat(bytesToGB(bytes));
  const warm = 'linear-gradient(90deg,var(--accent-amber),#e05a15)';
  if (gb > 3) { t.textContent = `Накопилось ${gb} ГБ мусора — пора почистить!`; f.style.width = Math.min(gb / 5 * 100, 100) + '%'; f.style.background = warm; }
  else if (gb > 0.5) { t.textContent = 'Есть что почистить!'; f.style.width = Math.max(gb / 5 * 100, 15) + '%'; f.style.background = warm; }
  // Пару десятков мегабайт служебных файлов Windows создаёт постоянно — это не повод тревожить
  else if (bytes >= 50 * 1048576) { t.textContent = 'Мусора немного, но почистить можно'; f.style.width = '12%'; f.style.background = '#1D8A40'; }
  else { t.textContent = 'Компьютер чистый — мусора почти нет!'; f.style.width = '5%'; f.style.background = '#1D8A40'; }
  a.textContent = (bytes > 0 && gb === 0 ? formatBytes(bytes) : gb + ' ГБ');
}

// ===== Экран «Вот что я нашёл» =====
async function openPreview() {
  if (state.cleaningInProgress) return;
  if (state.scanning) { showToast('Секунду, ещё ищу мусор…'); return; }
  if (!state.scanResults) await scanTrash();
  if (!scanItems().length) { showToast('Мусора не нашёл — компьютер чистый!'); return; }
  renderPreview();
  showScreen('screen-preview');
}

function previewCard(i) {
  const on = state.selected.has(i.id);
  const files = i.list && i.list.length
    ? `<ul class="preview-files">${i.list.map((f) => `<li>${escHtml(f.name)} — ${formatBytes(f.size)}</li>`).join('')}</ul>` : '';
  return `<div class="preview-card${on ? '' : ' off'}" id="pc-${escHtml(i.id)}">
    <label class="preview-row"><input type="checkbox" ${on ? 'checked' : ''} onchange="togglePreviewItem('${escHtml(i.id)}', this.checked)">
      <span class="preview-icon">${escHtml(i.icon)}</span><span class="preview-name">${escHtml(i.title)}</span><span class="preview-size">${i.sizeUnknown ? 'узнаю после' : formatBytes(i.size)}</span></label>
    <button class="preview-more" onclick="togglePreviewDetails('${escHtml(i.id)}', this)">Что это?</button>
    <div class="preview-details hidden" id="pd-${escHtml(i.id)}">
      <p><b>Что это:</b> ${escHtml(i.what)}</p>
      ${i.why ? `<p><b>Почему можно удалить:</b> ${escHtml(i.why)}</p>` : ''}
      ${i.warn ? `<p class="preview-warn">⚠ ${escHtml(i.warn)}</p>` : ''}
      ${i.after ? `<p><b>Что будет после:</b> ${escHtml(i.after)}</p>` : ''}
      ${files}
    </div></div>`;
}

function renderPreview() {
  $('preview-list').innerHTML = Object.entries(GROUPS).map(([g, title]) => {
    const items = scanItems().filter((i) => i.group === g);
    return items.length ? `<h3 class="preview-group-title">${escHtml(title)}</h3>` + items.map(previewCard).join('') : '';
  }).join('');
  updatePreviewTotal();
}

function togglePreviewItem(id, on) {
  if (on) state.selected.add(id); else state.selected.delete(id);
  rememberChoice(id, on);
  const card = $('pc-' + id); if (card) card.classList.toggle('off', !on);
  updatePreviewTotal();
}

function togglePreviewDetails(id, btn) {
  const d = $('pd-' + id); if (!d) return;
  const open = d.classList.toggle('hidden') === false;
  btn.textContent = open ? 'Скрыть' : 'Что это?';
}

function updatePreviewTotal() {
  const bytes = scanItems().filter((i) => state.selected.has(i.id)).reduce((s, i) => s + i.size, 0);
  $('preview-total').textContent = formatBytes(bytes) + (state.selected.has('deep') ? ' + глубокая очистка Windows' : '');
  const btn = $('preview-go');
  btn.disabled = state.selected.size === 0;
  btn.textContent = state.settings.dryRun ? 'Проверить отмеченное' : 'Удалить отмеченное';
}

// ===== Очистка =====
/** Если какие-то из выбранных программ открыты — спросить, закрыть ли их. Возвращает id пунктов, которые пропустить. */
async function askAboutRunningApps(selected) {
  // В режиме проверки ничего не закрываем — незачем
  if (!isElectron || state.settings.dryRun) return [];
  const running = await api.getRunningApps(selected);
  if (!running.length) return [];
  const names = running.map((r) => r.title).join(', ');
  const close = await confirmDialog({
    title: running.length > 1 ? `Сейчас открыты: ${names}` : `Сейчас открыт ${names}`,
    text: 'Чтобы убрать их мусор, их нужно закрыть. Ничего не потеряется: пароли, закладки и переписка остаются, а браузер предложит восстановить вкладки.',
    yes: 'Закрыть и почистить', no: 'Не трогать их',
  });
  if (!close) return running.map((r) => r.id);
  const still = await api.closeApps(running.map((r) => r.id));
  if (still.length) showToast('Не все программы закрылись — их пропущу');
  return still;
}

async function startCleaning() {
  if (state.cleaningInProgress) return;
  const selected = scanItems().filter((i) => state.selected.has(i.id));
  if (!selected.length) return;
  state.cleaningInProgress = true;
  try {
    const skip = await askAboutRunningApps(selected.map((i) => i.id));
    state.navStack = []; showScreen('screen-cleaning');
    resetCleanUI(selected);
    let result;
    if (isElectron) {
      api.onCleanProgress(updateCleanUI);
      result = await api.clean({ selected: selected.map((i) => i.id), skip });
    } else result = await runDemo(selected, skip);
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

function resetCleanUI(items) {
  $('progress-fill').style.width = '0%';
  $('cleaning-freed').textContent = (state.settings.dryRun ? 'Можно убрать: ' : 'Убрано: ') + '0 Б';
  $('cleaning-percent').textContent = '0%';
  $('cleaning-step-text').textContent = state.settings.dryRun ? 'Смотрю, что можно убрать…' : 'Начинаю уборку…';
  $('cleaning-step-sub').textContent = '';
  $('cleaning-steps').innerHTML = items.map((i) =>
    `<div class="step-item"><span class="step-check">○</span> ${escHtml(i.icon)} ${escHtml(i.title)}</div>`).join('');
}

function updateCleanUI(d) {
  // Процент — по шагам: честнее, чем по гигабайтам, которые заранее точно не известны
  const pct = Math.min(100, Math.round(((d.step + (d.done ? 1 : 0.5)) / d.total) * 100));
  $('cleaning-step-text').textContent = (state.settings.dryRun ? 'Смотрю: ' : 'Убираю: ') + d.title;
  $('cleaning-step-sub').textContent = d.id === 'deep' && !state.settings.dryRun
    ? 'Работает «Очистка диска» Windows — это может занять до 15 минут. Окно появится и закроется само.'
    : `Шаг ${d.step + 1} из ${d.total}`;
  $('progress-fill').style.width = pct + '%';
  $('cleaning-freed').textContent = (state.settings.dryRun ? 'Можно убрать: ' : 'Убрано: ') + formatBytes(d.freed);
  $('cleaning-percent').textContent = pct + '%';
  document.querySelectorAll('#cleaning-steps .step-item').forEach((el, i) => {
    el.classList.remove('active', 'done');
    const check = el.querySelector('.step-check');
    if (i < d.step || (i === d.step && d.done)) { el.classList.add('done'); check.textContent = '✓'; }
    else if (i === d.step) { el.classList.add('active'); check.textContent = '●'; }
    else check.textContent = '○';
  });
}

async function runDemo(items, skip) {
  const res = { dryRun: state.settings.dryRun, items: [], totalFreed: 0, movedToTrash: 0, failedFiles: 0 };
  for (let n = 0; n < items.length; n++) {
    const i = items[n];
    updateCleanUI({ step: n, total: items.length, title: i.title, freed: res.totalFreed + res.movedToTrash });
    await sleep(700 + Math.random() * 500);
    const r = { id: i.id, title: i.title, icon: i.icon, freed: 0, moved: 0, skipped: skip.includes(i.id) };
    if (i.id === 'deep') { if (res.dryRun) r.label = 'в режиме проверки не запускаю'; else r.freed = 2.4 * GB; }
    else if (!r.skipped) { if (i.id === 'downloads') r.moved = i.size; else r.freed = i.size; }
    res.items.push(r); res.totalFreed += r.freed; res.movedToTrash += r.moved;
    updateCleanUI({ step: n, total: items.length, title: i.title, freed: res.totalFreed + res.movedToTrash, done: true });
  }
  return res;
}

function showRes(r) {
  const dry = !!r.dryRun;
  const moved = r.movedToTrash || 0;
  $('result-title').textContent = dry ? 'ПРОВЕРКА ЗАВЕРШЕНА' : 'ГОТОВО!';
  $('result-subtitle').textContent = dry ? 'Вот сколько я мог бы убрать' : 'Ваш компьютер стал чище';
  $('result-amount-label').textContent = dry ? 'можно убрать' : moved ? 'убрано' : 'освобождено';
  $('result-gb').textContent = bytesToGB(r.totalFreed + moved);

  $('result-summary').innerHTML = r.items.map((i) => {
    const value = i.label ? escHtml(i.label) : i.skipped ? 'не трогал' : i.moved ? `${formatBytes(i.moved)} → в Корзину` : formatBytes(i.freed);
    return `<div class="summary-row"><span>${escHtml(i.icon || '')} ${escHtml(i.title)}</span><span>${value}</span></div>`;
  }).join('');

  const notes = [];
  const skipped = r.items.filter((i) => i.skipped && i.id !== 'deep').map((i) => i.title);
  const deepRefused = r.items.some((i) => i.id === 'deep' && i.skipped);
  if (dry) notes.push('Это был режим проверки — я ничего не удалил. Выключить его можно в настройках ⚙.');
  else {
    if (r.failedFiles > 0) notes.push('Часть файлов сейчас заняты программами — их я пропустил, это нормально.');
    if (skipped.length) notes.push(`${skipped.join(', ')} не трогал — ${skipped.length > 1 ? 'они были открыты' : 'программа была открыта'}.`);
    if (deepRefused) notes.push('Глубокую очистку не запускал — Windows не дала разрешения (в окне «Разрешить изменения?» нужно нажать «Да»).');
    if (moved > 0) notes.push(`Старые установщики (${formatBytes(moved)}) перенёс в Корзину — если что, их можно вернуть. Место освободится, когда очистите Корзину.`);
    if (!notes.length) notes.push('Очистка завершена. Ваш компьютер стал чище!');
  }
  $('result-note').textContent = notes.join(' ');
  state.navStack = []; showScreen('screen-result');
}

async function finishCleaning() {
  state.navStack = []; showScreen('screen-main');
  if (isElectron) await scanTrash();
  else {
    state.scanResults = demoScan(DEMO_ITEMS.filter((i) => i.id === 'recycle'));
    state.selected = new Set();
    $('scan-details').classList.add('hidden');
    updateMainScreen();
  }
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
  if (isElectron) {
    api.onOpenPreview(() => openPreview()); // нажали «Посмотреть» в окошке-напоминании, когда программа уже открыта
    // В окошке нажали «Больше не напоминать» — обновить настройки на экране
    api.onSettingsChanged(async () => {
      try { state.settings = { ...state.settings, ...(await api.getSettings()) }; } catch {}
      if (state.currentScreen === 'screen-settings') updateReminderUI();
    });
  }
  const wantPreview = new URLSearchParams(location.search).get('open') === 'preview'; // открыли из окошка-напоминания
  if (state.settings.onboardingDone) {
    state.navStack = []; showScreen('screen-main');
    if (wantPreview) { await scanTrash(); openPreview(); } else scanTrash();
  } else showScreen('screen-onboarding1');
}
document.addEventListener('DOMContentLoaded', init);
