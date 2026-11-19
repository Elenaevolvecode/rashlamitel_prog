/* Окошко-напоминание в углу экрана. Текст приходит в адресе страницы, кнопки отвечают основному процессу. */
(function () {
  const q = new URLSearchParams(location.search);
  const gb = q.get('gb') || '';
  const sample = q.get('sample') === '1';
  const text = document.getElementById('text');
  if (sample) {
    text.textContent = `Так выглядит напоминание. Сейчас мусора немного — ${gb}. Когда станет больше 1 ГБ, я сам покажу это окошко.`;
  } else {
    text.innerHTML = 'Накопилось <b></b> мусора. Посмотрим, что можно убрать?';
    text.querySelector('b').textContent = gb;
  }
  const act = (a) => window.rashlamitel && window.rashlamitel.reminderAction(a);
  document.getElementById('go').onclick = () => act('open');
  document.getElementById('later').onclick = () => act('later');
  document.getElementById('x').onclick = () => act('later');
  document.getElementById('never').onclick = () => act('never');
})();
