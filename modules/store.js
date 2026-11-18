/**
 * Настройки и история — JSON-файл в папке данных приложения
 * (%APPDATA%\Расхламитель ПК\settings.json).
 */
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  onboardingDone: false,
  // Режим проверки: программа показывает, что удалила бы, но ничего не трогает.
  // Включён по умолчанию, пока программа на тестировании.
  dryRun: true,
  cleanCount: 0,
  history: [], // { date, freed, dryRun }
  // Выбор пользователя на экране «Вот что я нашёл»: { id: true/false }, если отличается от обычного.
  // Корзину и глубокую очистку не запоминаем — у них галочка всегда снята.
  cleanChoices: {},
  // Напоминания об очистке через Планировщик Windows: раз в reminderDays дней (7 / 14 / 30)
  reminderEnabled: true,
  reminderDays: 30,
};

function createStore(dir) {
  const file = path.join(dir, 'settings.json');
  let data = { ...DEFAULTS };
  try { data = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch {}

  function save() {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(tmp, file);
    } catch (e) { console.error('store save failed', e); }
  }

  return {
    getAll: () => ({ ...data }),
    get: (k) => data[k],
    set(k, v) {
      if (!(k in DEFAULTS)) return false;
      data[k] = v; save(); return true;
    },
    addClean(freed, dryRun) {
      if (!dryRun) data.cleanCount += 1;
      data.history = [...data.history, { date: new Date().toISOString(), freed, dryRun }].slice(-50);
      save();
    },
  };
}

module.exports = { createStore, DEFAULTS };
