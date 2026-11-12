'use strict';
/* Sweet Revenge "how to play" card: shown once per player per game, the first time they open it.
   Three short steps with a picture each, and a "Got it" button. Never shown again on this device
   unless they tap the game's help button (showHowTo(key, steps, { force: true })).
     showHowTo('snakes', [{ icon: '🎲', title: 'Roll', text: 'Space or tap the die' }, ...]) */
function showHowTo(key, steps, { force = false, title = 'How to play' } = {}) {
  const seenKey = 'sr-howto:' + key;
  if (!force && store.get(seenKey, false)) return;
  document.querySelector('.howto')?.remove();
  document.body.insertAdjacentHTML('beforeend', `
    <div class="howto" role="dialog" aria-modal="true" aria-labelledby="howto-h">
      <div class="howto-card">
        <h2 id="howto-h">${escapeHtml(title)}</h2>
        <ol>${steps.map((s, i) => `<li style="--i:${i}"><span class="hi" aria-hidden="true">${s.icon}</span><div><b>${escapeHtml(s.title)}</b><small>${escapeHtml(s.text)}</small></div></li>`).join('')}</ol>
        <button class="btn big cta" type="button">Got it, let's play!</button>
      </div>
    </div>`);
  const box = document.querySelector('.howto'), btn = box.querySelector('button');
  const close = () => { store.set(seenKey, true); box.classList.add('bye'); setTimeout(() => box.remove(), 250); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); close(); } };
  btn.onclick = close;
  box.addEventListener('click', (e) => { if (e.target === box) close(); });
  document.addEventListener('keydown', onKey);
  setTimeout(() => btn.focus(), 50);
}
