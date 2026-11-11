'use strict';
/* Sweet Revenge front door: log in, pick a game, or jump in with a friend's code.
   Also shows your level, record, revenge board, match history and trophy shelf, straight from the
   database (shared/records.js), and refreshes them live so you can see saving is working. */
const sfx = { pop() {} }; // the hub stays quiet; games bring their own sounds

const GAME_FOR_CODE = (code) => ({ D: 'doodle.html', P: 'plusfour.html' }[code[0]] || 'ludo.html');
const GAMES = { ludo: ['🎲', 'Ludo'], plusfour: ['🃏', 'Plus Four'], doodle: ['🖍️', 'Doodle Duel'] };
const LEVEL_NAMES = ['Sprinkle', 'Single Scoop', 'Double Scoop', 'Waffle Cone', 'Sundae', 'Banana Split', 'Brain Freeze', 'Sweet Revenge Royalty'];
const POLL_MS = 20000;

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
  startLive();
}

function renderHub() {
  $('#me-avatar').textContent = myAvatar();
  $('#p-name').textContent = me.name;
  const first = me.name.split(' ').pop(), hour = new Date().getHours();
  const greet = hour < 5 ? 'Still awake' : hour < 12 ? 'Good morning' : hour < 17 ? 'Hey' : hour < 22 ? 'Evening' : 'Late night games';
  $('#hello').textContent = `${greet}, ${first}! What are we playing?`;
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
  if (!profile) { renderCone(1); emptyBoards('Loading…'); }
}

/* ================= your profile, live from the database ================= */
let profile = null, checkedAt = 0, seenGames = null;

// The level badge: a cone with one scoop per level and a cherry on top.
function renderCone(level) {
  const n = Math.max(1, Math.min(level, LEVEL_NAMES.length)), step = 12, r = 15;
  const H = 52 + step * (n - 1) + r + 16, coneTop = H - 50;
  const colours = ['#ff71ce', '#7ee8d8', '#fff6e0', '#ffce5c', '#9ab8ff', '#ff9a7a', '#c9a7ff', '#ffffff'];
  let scoops = '';
  for (let i = 0; i < n; i++) {
    const cx = 32 + (i % 2 ? 3 : -3) * (i ? 1 : 0), cy = coneTop - 2 - step * i;
    scoops += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${colours[i]}" stroke="#2b2140" stroke-width="3"/>`;
  }
  const topY = coneTop - 2 - step * (n - 1) - r;
  $('#cone').innerHTML = `<svg viewBox="0 0 64 ${H}">
    <path d="M17 ${coneTop}L32 ${H - 2}L47 ${coneTop}z" fill="#ffcf7a" stroke="#2b2140" stroke-width="3" stroke-linejoin="round"/>
    <path d="M22 ${coneTop + 8}l14 14M28 ${coneTop + 4}l12 12M26 ${coneTop + 16}l8-8M34 ${coneTop + 22}l6-6" stroke="#e0a64a" stroke-width="2"/>
    ${scoops}
    <circle cx="34" cy="${topY - 3}" r="6" fill="#ff4d6d" stroke="#2b2140" stroke-width="2.5"/>
    <path d="M35 ${topY - 8}q3-7 9-8" fill="none" stroke="#2b2140" stroke-width="2.5" stroke-linecap="round"/></svg>`;
}

function timeAgo(t) {
  const s = Math.max(0, (Date.now() - new Date(t).getTime()) / 1000);
  if (s < 50) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.round(s / 86400)} days ago`;
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const ordinal = (n) => n + ({ 1: 'st', 2: 'nd', 3: 'rd' }[n] || 'th'); // places only go up to 4th
const shortName = (name) => String(name).split(' ').pop();
const isBotId = (id) => String(id).startsWith('bot:');

function emptyBoards(text) {
  $('#revenge').innerHTML = `<p class="empty">${text}</p>`;
  $('#history').innerHTML = `<li class="empty">${text}</li>`;
}

function renderLevel(p) {
  const { level, xp, from, to } = p.level;
  renderCone(level);
  $('#p-title').innerHTML = `<em>Lv ${level}</em>${escapeHtml(LEVEL_NAMES[level - 1])}`;
  const pct = to ? Math.round(((xp - from) / (to - from)) * 100) : 100;
  $('#xp-fill').style.width = pct + '%';
  $('.xp .bar').setAttribute('aria-valuenow', pct);
  $('#xp-text').textContent = to ? `${xp} XP. ${to - xp} more to ${LEVEL_NAMES[level]}.` : `${xp} XP. Top of the cone!`;
  const r = p.record;
  $('#r-won').textContent = r.won; $('#r-lost').textContent = r.played - r.won; $('#r-played').textContent = r.played;
  // Your record on each game card.
  document.querySelectorAll('.game-card .meta[data-kind]').forEach((el) => {
    const k = r.byKind[el.dataset.kind], txt = el.closest('.txt');
    let mine = txt.querySelector('.mine');
    if (!k || !k.played) { if (mine) mine.remove(); return; }
    if (!mine) { mine = document.createElement('span'); mine.className = 'mine'; txt.appendChild(mine); }
    mine.textContent = `You've won ${k.won} of ${plural(k.played, 'game')}`;
  });
}

// One row per rival, with a tug of war for bonks and one for bombs.
function renderRevenge(p) {
  const rivals = new Map();
  for (const r of p.rivalry) {
    const mine = r.by_player === p.me.id, id = mine ? r.to_player : r.by_player;
    const e = rivals.get(id) || { id, name: mine ? r.to_name : r.by_name, bonk: [0, 0], bomb: [0, 0], cards: [0, 0] };
    e[r.kind][mine ? 0 : 1] += r.times;
    if (r.kind === 'bomb') e.cards[mine ? 0 : 1] += r.cards;
    rivals.set(id, e);
  }
  const list = [...rivals.values()].sort((a, b) => isBotId(a.id) - isBotId(b.id) || (b.bonk[0] + b.bonk[1] + b.bomb[0] + b.bomb[1]) - (a.bonk[0] + a.bonk[1] + a.bomb[0] + a.bomb[1]));
  if (!list.length) { $('#revenge').innerHTML = '<p class="empty">No bonks or bombs yet. Bonk someone in Ludo or stack a +4 on them in Plus Four, and the score starts here.</p>'; return; }
  const tug = ([me, them], what, extra = '') => {
    if (!me && !them) return '';
    const pct = Math.round((me / (me + them)) * 100);
    return `<div class="tug"><b>${me}</b><span class="rope" aria-hidden="true"><i class="${me ? '' : 'none'}" style="width:${pct}%"></i></span><b>${them}</b>
      <small>${what}${extra}</small></div>`;
  };
  $('#revenge').innerHTML = list.map((e) => {
    const mine = e.bonk[0] + e.bomb[0], theirs = e.bonk[1] + e.bomb[1], them = escapeHtml(shortName(e.name));
    const lead = mine > theirs ? 'you lead' : theirs > mine ? `${them} leads` : 'all square';
    const cards = e.cards[0] || e.cards[1] ? `, ${e.cards[0]} vs ${e.cards[1]} cards` : '';
    return `<div class="feud"><header>${isBotId(e.id) ? '🤖 ' : ''}You vs ${them}<span>${lead}</span></header>
      ${tug(e.bonk, '💥 bonks')}${tug(e.bomb, '📦 bombs', cards)}</div>`;
  }).join('');
}

function renderHistory(p) {
  if (!p.recent.length) { $('#history').innerHTML = '<li class="empty">No games saved yet. Finish a game and it pops up here within a few seconds.</li>'; return; }
  const first = seenGames === null;
  $('#history').innerHTML = p.recent.map((g) => {
    const [icon, label] = GAMES[g.kind] || ['🎮', g.kind];
    const others = g.players.filter((x) => x.id !== p.me.id).map((x) => (x.bot ? '🤖 ' : '') + shortName(x.name));
    const mine = g.players.find((x) => x.id === p.me.id) || {};
    let res = g.won ? ['won', 'Won'] : ['lost', 'Lost'];
    if (!g.won && g.players.length > 2 && mine.place) res = ['place', ordinal(mine.place)];
    const m = g.mine || {}, bits = [timeAgo(g.endedAt)];
    if (g.kind === 'ludo') bits.push(plural(m.bonks || 0, 'bonk'));
    if (g.kind === 'plusfour') bits.push(plural(m.bombs || 0, 'bomb'));
    if (g.kind === 'doodle' && mine.score != null) bits.push(`${mine.score} points`);
    if (g.startedAt) bits.push(`${Math.max(1, Math.round((new Date(g.endedAt) - new Date(g.startedAt)) / 60000))} min`);
    const fresh = !first && !seenGames.has(g.id);
    return `<li class="match${fresh ? ' fresh' : ''}"><span class="gi" aria-hidden="true">${icon}</span>
      <span class="mt"><b>${escapeHtml(label)} vs ${escapeHtml(others.join(', ') || 'nobody')}${g.practice ? '<span class="tag">practice</span>' : ''}</b>
      <small>${escapeHtml(bits.join(', '))}</small></span><span class="res ${res[0]}">${res[1]}</span></li>`;
  }).join('');
  seenGames = new Set(p.recent.map((g) => g.id));
}

function renderTrophies(p, fresh) {
  const done = p.achievements.filter((a) => a.done).length;
  $('#trophy-count').textContent = `${done} of ${p.achievements.length}`;
  $('#trophies').innerHTML = p.achievements.map((a) => {
    const prog = a.done ? `<small class="when">Unlocked ${escapeHtml(timeAgo(a.unlockedAt))}</small>`
      : a.need > 1 ? `<span class="prog" aria-hidden="true"><i style="width:${Math.round((a.have / a.need) * 100)}%"></i></span><small>${a.have} of ${a.need}</small>` : '';
    return `<div class="trophy ${a.done ? 'done' : 'locked'}${fresh.includes(a.id) ? ' new' : ''}" title="${escapeHtml(a.how)}">
      <span class="ti" aria-hidden="true">${a.icon}</span><b>${escapeHtml(a.name)}</b><small>${escapeHtml(a.how)}</small>${prog}</div>`;
  }).join('');
}

/* ---------- live: refresh every 20 seconds while the page is showing ---------- */
function setLive(state, head, sub) {
  const el = $('#live');
  el.dataset.state = state;
  $('#live-head').textContent = head;
  if (sub !== undefined) $('#live-sub').textContent = sub;
}
function liveSub() {
  if (!profile || $('#live').dataset.state !== 'live') return;
  const d = profile.db, s = Math.round((Date.now() - checkedAt) / 1000);
  $('#live-sub').textContent = `${plural(d.games, 'game')}, ${plural(d.messages, 'message')} and ${d.hits} bonks/bombs saved. Checked ${s < 5 ? 'just now' : s + 's ago'}.`;
}

let refreshing = false;
async function refresh() {
  if (refreshing || !me) return;
  refreshing = true;
  const p = await records.me();
  refreshing = false;
  if (!p || !p.level) {
    setLive('offline', "Can't reach the scoreboard", 'Games still work, but results may not be saved right now. Trying again…');
    if (!profile) { emptyBoards("Can't load your history right now."); $('#p-title').textContent = 'Level shows up once the scoreboard is back'; }
    return;
  }
  const before = profile;
  profile = p; checkedAt = Date.now();
  setLive('live', 'Live: the database is saving');
  if (before) retrigger($('#live'), 'blink');
  liveSub();

  // Celebrate trophies and level-ups you haven't seen on this device yet.
  const key = 'sr-seen:' + me.name.toLowerCase(), seen = store.get(key, null);
  const unlocked = p.achievements.filter((a) => a.done).map((a) => a.id);
  const fresh = seen ? unlocked.filter((id) => !seen.ach.includes(id)) : [];
  renderLevel(p); renderRevenge(p); renderHistory(p); renderTrophies(p, fresh);
  if (seen && p.level.level > seen.level) {
    retrigger($('#cone'), 'up');
    toast(`🍦 Level up! You're a ${LEVEL_NAMES[p.level.level - 1]} now`, 3200);
    bigConfetti();
  } else if (fresh.length) {
    const a = p.achievements.find((x) => x.id === fresh[0]);
    toast(`🏆 Trophy unlocked: ${a.icon} ${a.name}${fresh.length > 1 ? ` (+${fresh.length - 1} more)` : ''}`, 3200);
    bigConfetti();
  }
  store.set(key, { ach: unlocked, level: p.level.level });
}

let liveTimer = 0;
function startLive() {
  refresh();
  if (liveTimer) return;
  liveTimer = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, POLL_MS);
  setInterval(liveSub, 5000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
}

/* ================= login and joining ================= */
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
