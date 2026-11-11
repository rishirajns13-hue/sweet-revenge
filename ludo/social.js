'use strict';
/* Ludo social layer: the all-time score, and the shared chat (shared/chat.js) set up for Ludo.
   Talks to game.js through sendSocial(), game, myColors, nameOf(), isMine() and sfx. */

document.addEventListener('profilechange', renderHome);

/* ================= all-time score, kept on this device ================= */
const recordKey = () => 'ludo-record:' + me.name.toLowerCase();
function recordResult(s) {
  if (mode === 'cpu' || !s.winners || !me) return;
  const done = store.get('ludo-recorded', []);
  if (done.includes(s.gid)) return;
  store.set('ludo-recorded', done.concat(s.gid).slice(-50));
  const mine = myColors[0], iWon = s.winners.includes(mine), rec = store.get(recordKey(), {});
  const myTeam = R.teamOf(s, mine);
  for (const c of s.players) {
    if (myTeam.includes(c) || (s.bots || []).includes(c)) continue;
    const theyWon = s.winners.includes(c);
    if (iWon === theyWon) continue; // neither beat the other
    const name = s.names[c], r = rec[name] || { w: 0, l: 0, streak: 0 };
    if (iWon) { r.w++; r.streak = r.streak > 0 ? r.streak + 1 : 1; } else { r.l++; r.streak = r.streak < 0 ? r.streak - 1 : -1; }
    r.avatar = (s.avatars || {})[c] || r.avatar; r.at = Date.now();
    rec[name] = r;
  }
  store.set(recordKey(), rec);
}
function mainRival() {
  const rec = store.get(recordKey(), {});
  let best = null;
  for (const [name, r] of Object.entries(rec)) {
    const n = r.w + r.l;
    if (!best || n > best.n || (n === best.n && r.at > best.r.at)) best = { name, r, n };
  }
  return best;
}
function rivalLine(name) {
  const r = store.get(recordKey(), {})[name];
  return r ? `You <b>${r.w} – ${r.l}</b> ${escapeHtml(name)}, all time` : '';
}
function renderHome() {
  if (!me) return;
  const av = myAvatar(), first = me.name.split(' ').pop();
  $('#me-avatar').textContent = av;
  const best = mainRival();
  if (!best) {
    $('#hello').textContent = `Hey ${first}! Ready to roll?`;
    $('#rival').className = 'card rival empty';
    $('#rival').innerHTML = '<b>No games yet</b><p>Play a friend and your all-time score shows up here.</p>';
    return;
  }
  const { name, r } = best, them = name.split(' ').pop();
  $('#hello').textContent = r.w < r.l ? `Hey ${first}! Ready for revenge?` : r.w > r.l ? `Hey ${first}! Defend that lead.` : `Hey ${first}! Tie-breaker time?`;
  const streak = r.streak >= 2 ? `You won the last ${r.streak}` : r.streak <= -2 ? `${escapeHtml(them)} won the last ${-r.streak}`
    : r.streak === 1 ? 'You won the last game' : `${escapeHtml(them)} won the last game`;
  $('#rival').className = 'card rival';
  $('#rival').innerHTML = `<div class="row">
      <div class="rface" style="--c:var(--red)">${r.w > r.l ? `<span class="crown">${ic('crown')}</span>` : ''}<span class="av">${av}</span><span>You</span></div>
      <div class="score" aria-label="${r.w} to ${r.l}"><span>${r.w}</span><i>–</i><span>${r.l}</span></div>
      <div class="rface" style="--c:var(--yellow)">${r.l > r.w ? `<span class="crown">${ic('crown')}</span>` : ''}<span class="av">${r.avatar || '🙂'}</span><span>${escapeHtml(them)}</span></div>
    </div><p>${streak}</p>`;
}

/* ================= chat (shared/chat.js) ================= */
// Where a player's chip is on screen, so their bubble and reactions come out of it.
function chipFor(color) { return document.querySelector(`.chip[data-c="${color}"]`); }
const chat = createChat({
  send: (m) => sendSocial(m),
  game: 'ludo', room: () => roomCode || null,
  players: () => (game ? game.players.map((c) => ({ k: c, name: nameOf(c), color: COLORS[c] })) : []),
  me: () => myColors[0],
  anchor: (c) => (isMine(c) ? $('#dice') : chipFor(c)),
  stage: () => $('#board-wrap'),
  stickers: {
    bonk: ['Get bonked!', '#ff5a5f'], all: ['Is that all?', '#ffc233'], lucky: ['Lucky roll 🍀', '#2bc48a'],
    noob: ["Beginner's luck", '#4d9de0'], gg: ['GG 🤝', '#ffffff'], revenge: ['Revenge is coming', '#c9a7ff'],
  },
  dockAt: 1000,
  sound: () => sfx.pop(),
});
chat.mountTools($('#chat-tools'));
const receiveSocial = (m) => chat.receive(m);
const resetSocial = () => chat.reset();
