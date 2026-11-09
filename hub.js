'use strict';
/* Sweet Revenge front door: log in, pick a game, or jump in with a friend's code. */
const sfx = { pop() {} }; // the hub stays quiet; games bring their own sounds

const GAME_FOR_CODE = (code) => ({ D: 'doodle.html', P: 'plusfour.html' }[code[0]] || 'ludo.html');

function showScreen(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === 'screen-' + name));
}

// After logging in, go back to wherever a game page sent you (keeping its ?room=).
function continueOrHub() {
  const q = new URLSearchParams(location.search), next = q.get('next');
  if (next && /^(ludo|doodle|plusfour)\.html$/.test(next)) {
    q.delete('next');
    location.replace(next + (q.toString() ? '?' + q : ''));
    return;
  }
  const room = q.get('room');
  if (room) { location.replace(`${GAME_FOR_CODE(room.toUpperCase())}?room=${encodeURIComponent(room)}`); return; }
  renderHub();
  showScreen('hub');
}

function renderHub() {
  $('#me-avatar').textContent = myAvatar();
  const first = me.name.split(' ').pop(), hour = new Date().getHours();
  const greet = hour < 5 ? 'Still awake' : hour < 12 ? 'Good morning' : hour < 17 ? 'Hey' : hour < 22 ? 'Evening' : 'Late night games';
  $('#hello').textContent = `${greet}, ${first}! What are we playing?`;
  // Ludo all-time score against your most-played friend, if there is one.
  const rec = store.get('ludo-record:' + me.name.toLowerCase(), {});
  const top = Object.entries(rec).sort((a, b) => b[1].w + b[1].l - (a[1].w + a[1].l))[0];
  if (top) $('#ludo-meta').textContent = `You ${top[1].w} – ${top[1].l} ${top[0].split(' ').pop()} · the long one`;
  // An unfinished game you can hop back into.
  const games = [['plusfour-lastroom', 'plusfour.html', 'Plus Four'], ['doodle-lastroom', 'doodle.html', 'Doodle Duel'], ['ludo-lastroom', 'ludo.html', 'Ludo']];
  const last = games.map(([key, page, label]) => ({ ...store.get(key, {}), page, label }))
    .filter((g) => g.code && Date.now() - g.at < 3 * 3600e3).sort((a, b) => b.at - a.at)[0];
  const banner = $('#resume');
  banner.hidden = !last;
  if (last) {
    banner.href = `${last.page}?room=${last.code}`;
    banner.innerHTML = `${ic('play')}<span>Back to your ${escapeHtml(last.label)} game · <b>${escapeHtml(last.code)}</b></span>`;
  }
}

let fails = 0, lockedUntil = 0;
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#login-error');
  if (Date.now() < lockedUntil) { err.textContent = 'Too many tries. Chill for a bit 🧊'; return; }
  const user = $('#login-user').value, pass = $('#login-pass').value;
  const proof = await makeProof(user, pass);
  const name = await checkProof(user, proof);
  if (!name) {
    fails++;
    if (fails >= 5) { lockedUntil = Date.now() + 30000; fails = 0; }
    err.textContent = 'Nope! Wrong name or password 🙈';
    retrigger($('#login-form'), 'shake');
    return;
  }
  saveMe({ name, proof, user: user.trim().toLowerCase() });
  continueOrHub();
});

function joinCode() {
  const code = $('#join-code').value.trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) { $('#hub-error').textContent = 'Room codes are 6 letters or numbers 🙂'; return; }
  location.href = `${GAME_FOR_CODE(code)}?room=${code}`;
}
$('#btn-join').onclick = joinCode;
$('#join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinCode(); });
document.addEventListener('profilechange', renderHub);

document.addEventListener('DOMContentLoaded', async () => {
  hydrateIcons();
  applyPalette();
  wireProfileSheet();
  if (await loadMe()) continueOrHub();
  else { showScreen('login'); $('#login-user').focus(); }
});
