'use strict';
/* Sweet Revenge front door: a cosy party-game menu.
   - Loading screen: scoops drop on a cone while we check your login and reach the scoreboard.
   - Three screens you switch between like a game menu: Play, Trophies, Rivals & History (#play, #trophies, #rivals).
   - Your avatar reacts to what happened since you last looked (wins, losses, trophies, level-ups).
   - Everything comes from the database (shared/records.js) and refreshes every 20 seconds.
   Needs shared/core.js, shared/records.js and shared/sound.js. */

const GAME_FOR_CODE = (code) => ({ D: 'doodle.html', P: 'plusfour.html' }[code[0]] || 'ludo.html');
const GAMES = { ludo: ['🎲', 'Ludo'], plusfour: ['🃏', 'Plus Four'], doodle: ['🖍️', 'Doodle Duel'] };
const LEVEL_NAMES = ['Sprinkle', 'Single Scoop', 'Double Scoop', 'Waffle Cone', 'Sundae', 'Banana Split', 'Brain Freeze', 'Sweet Revenge Royalty'];
const TABS = ['play', 'trophies', 'rivals'];
const POLL_MS = 20000;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ================= sounds: a few quiet, real clips (shared/sounds/ui-*, CC0 Kenney) ================= */
const player = createSamplePlayer({
  volume: 0.7,
  takes: {
    pop: ['ui-pop-1.ogg', 'ui-pop-2.ogg'], pick: ['ui-pick.ogg'], drop: ['ui-drop-1.ogg', 'ui-drop-2.ogg'],
    shine: ['ui-shine.ogg'], trophy: ['ui-trophy.ogg'], levelup: ['ui-levelup.ogg'],
  },
});
const sfx = {
  pop() { player.sample('pop', { vol: 0.35 }); },
  pick() { player.sample('pick', { vol: 0.45 }); },
  drop() { player.sample('drop', { vol: 0.4 }); },
  flip() { player.sample('shine', { vol: 0.3, rate: 1.1 }); },
  trophy() { player.sample('trophy', { vol: 0.45, vary: false }); player.sample('shine', { vol: 0.3, when: 0.15 }); },
  levelup() { player.sample('levelup', { vol: 0.5, vary: false }); },
};
// Browsers only allow sound after the first click or key press, so load the clips then.
['pointerdown', 'keydown'].forEach((ev) => addEventListener(ev, () => player.load(), { once: true }));

/* ================= little helpers ================= */
function showScreen(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === 'screen-' + name));
}
function timeAgo(t) {
  const s = Math.max(0, (Date.now() - new Date(t).getTime()) / 1000);
  if (s < 50) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${plural(Math.round(s / 86400), "day")} ago`;
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const ordinal = (n) => n + ({ 1: 'st', 2: 'nd', 3: 'rd' }[n] || 'th'); // places only go up to 4th
const shortName = (name) => String(name).split(' ').pop();
const isBotId = (id) => String(id).startsWith('bot:');
const avatarFor = (id) => (id === me.user || id === me.name.toLowerCase() ? myAvatar() : isBotId(id) ? '🤖' : DEFAULT_AVATAR[id] || '🙂');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const seenKey = () => 'sr-seen:' + me.name.toLowerCase();

// A cone with one scoop per level and a cherry on top.
function coneSVG(level) {
  const n = Math.max(1, Math.min(level, LEVEL_NAMES.length)), step = 12, r = 15;
  const H = 52 + step * (n - 1) + r + 16, coneTop = H - 50;
  const colours = ['#ff71ce', '#7ee8d8', '#fff6e0', '#ffce5c', '#9ab8ff', '#ff9a7a', '#c9a7ff', '#ffffff'];
  let scoops = '';
  for (let i = 0; i < n; i++) {
    const cx = 32 + (i % 2 ? 3 : -3) * (i ? 1 : 0), cy = coneTop - 2 - step * i;
    scoops += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${colours[i]}" stroke="#2b2140" stroke-width="3"/>`;
  }
  const topY = coneTop - 2 - step * (n - 1) - r;
  return `<svg viewBox="0 0 64 ${H}">
    <path d="M17 ${coneTop}L32 ${H - 2}L47 ${coneTop}z" fill="#ffcf7a" stroke="#2b2140" stroke-width="3" stroke-linejoin="round"/>
    <path d="M22 ${coneTop + 8}l14 14M28 ${coneTop + 4}l12 12M26 ${coneTop + 16}l8-8M34 ${coneTop + 22}l6-6" stroke="#e0a64a" stroke-width="2"/>
    ${scoops}
    <circle cx="34" cy="${topY - 3}" r="6" fill="#ff4d6d" stroke="#2b2140" stroke-width="2.5"/>
    <path d="M35 ${topY - 8}q3-7 9-8" fill="none" stroke="#2b2140" stroke-width="2.5" stroke-linecap="round"/></svg>`;
}

/* ================= avatar reactions ================= */
// state: 'cheer' | 'sulk' | 'flex' | 'smug' | 'sweat'. One-off states clear themselves.
function react(el, state, ms = 2400) {
  if (!el) return;
  el.classList.remove('cheer', 'sulk', 'flex', 'smug', 'sweat', 'saying');
  void el.offsetWidth;
  el.classList.add(state, 'saying');
  if (ms) setTimeout(() => el.classList.remove(state, 'saying'), ms);
}
const reactMe = (state) => { react($('#big-avatar'), state); react($('#me-avatar'), state); };

/* ================= loading screen ================= */
// Full show on the first open of a browser session or right after logging in; a quick one when you come back from a game.
async function boot({ full = false } = {}) {
  const quick = !full && sessionStorage.getItem('sr-booted');
  const minMs = quick ? 400 : 1300, started = Date.now();
  showScreen('loading');
  $('#load-fail').hidden = true;
  $('.load-steps').hidden = false;
  document.querySelectorAll('.load-cone .scoop').forEach((s) => s.classList.remove('in'));
  $('.load-cone').classList.remove('done');
  const steps = [...document.querySelectorAll('.load-steps li')];
  steps.forEach((li) => (li.className = ''));
  const step = async (i, ok = true) => {
    steps[i].className = ok ? 'ok' : 'bad';
    if (ok) document.querySelector(`.load-cone .s${i + 1}`).classList.add('in');
    if (steps[i + 1] && ok) steps[i + 1].className = 'now';
    if (!quick) await wait(260);
  };

  steps[0].className = 'now';
  if (!(await loadMe())) { showScreen('login'); $('#login-user').focus(); return; }
  if (!routeAway()) return;
  await step(0);

  // The scoreboard: give it up to 6 seconds, then carry on without it.
  const p = await Promise.race([records.me(), wait(6000).then(() => null)]);
  if (!p || !p.level) {
    await step(1, false);
    setLive('offline');
    $('.load-steps').hidden = true;
    $('#load-fail').hidden = false;
    $('#btn-anyway').focus();
    return;
  }
  await step(1);
  applyProfile(p, { firstLoad: true });
  await step(2);
  $('.load-cone').classList.add('done');
  await wait(Math.max(0, minMs - (Date.now() - started)));
  sessionStorage.setItem('sr-booted', '1');
  enterHub();
}
$('#btn-retry').onclick = () => boot();
$('#btn-anyway').onclick = () => { sessionStorage.setItem('sr-booted', '1'); enterHub(); };

// Room links and "send me back to the game I came from" skip the menu entirely.
function routeAway() {
  const q = new URLSearchParams(location.search), next = q.get('next');
  if (next && /^(ludo|doodle|plusfour)\.html$/.test(next)) {
    q.delete('next');
    location.replace(next + (q.toString() ? '?' + q : ''));
    return false;
  }
  const room = q.get('room');
  if (room) { location.replace(`${GAME_FOR_CODE(room.toUpperCase())}?room=${encodeURIComponent(room)}`); return false; }
  return true;
}

let hubShown = false;
function enterHub() {
  renderMe();
  showScreen('hub');
  hubShown = true;
  showTab(tabFromHash(), { animate: false });
  if (pendingReaction) { pendingReaction(); pendingReaction = null; }
  startLive();
}

/* ================= tabs ================= */
let currentTab = null;
const tabFromHash = () => (TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'play');
function showTab(name, { animate = true, sound = false } = {}) {
  if (!TABS.includes(name)) name = 'play';
  const from = TABS.indexOf(currentTab), to = TABS.indexOf(name);
  document.querySelectorAll('.tab').forEach((t) => {
    const on = t.dataset.tab === name;
    t.setAttribute('aria-selected', on);
    t.tabIndex = on ? 0 : -1;
    if (on && animate) retrigger(t, 'boing');
  });
  TABS.forEach((t) => {
    const panel = $('#tab-' + t);
    panel.hidden = t !== name;
    panel.classList.remove('from-left', 'from-right');
  });
  if (animate && from !== -1 && from !== to) $('#tab-' + name).classList.add(to > from ? 'from-right' : 'from-left');
  if (sound) sfx.pop();
  currentTab = name;
  if (location.hash.slice(1) !== name) history.replaceState(null, '', '#' + name);
  if (name === 'trophies') openedTrophies();
  if (name === 'rivals') stampTickets();
  if (innerWidth < 760) scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
}
document.querySelectorAll('.tab').forEach((t) => (t.onclick = () => showTab(t.dataset.tab, { sound: true })));
addEventListener('hashchange', () => { if (hubShown && tabFromHash() !== currentTab) showTab(tabFromHash(), { sound: true }); });
document.addEventListener('keydown', (e) => {
  if (!hubShown || !$('#screen-hub').classList.contains('active') || e.target.closest('input, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (!$('#me-sheet').hidden) return;
  const i = TABS.indexOf(currentTab), onNav = e.target === document.body || !!e.target.closest('.tabs');
  if (['1', '2', '3'].includes(e.key)) showTab(TABS[+e.key - 1], { sound: true });
  else if (e.key === 'ArrowRight' && onNav) showTab(TABS[(i + 1) % 3], { sound: true });
  else if (e.key === 'ArrowLeft' && onNav) showTab(TABS[(i + 2) % 3], { sound: true });
  else return;
  e.preventDefault();
});

/* ================= PLAY ================= */
function renderMe() {
  $('#me-avatar').textContent = myAvatar();
  $('#big-avatar').textContent = myAvatar();
  const first = me.name.split(' ').pop(), hour = new Date().getHours();
  const greet = hour < 5 ? 'Still awake' : hour < 12 ? 'Good morning' : hour < 17 ? 'Hey' : hour < 22 ? 'Evening' : 'Late night games';
  $('#hello').textContent = `${greet}, ${first}! What are we playing?`;
  setIcon($('#btn-sound'), player.muted ? 'mute' : 'volume');
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
  if (!profile) { $('#mini-cone').innerHTML = coneSVG(1); renderEmpty(); }
}

// Picking a game: squish, pop, a colour wipe from where you clicked, then go.
document.querySelectorAll('.game-card').forEach((card) => card.addEventListener('click', (e) => {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; // let "open in new tab" work
  e.preventDefault();
  if (card.classList.contains('picked')) return;
  sfx.pick();
  if (reduced) { location.href = card.href; return; }
  card.classList.add('picked');
  const wipe = $('#wipe'), r = card.getBoundingClientRect();
  wipe.style.setProperty('--wc', card.dataset.wipe || 'var(--cta)');
  wipe.style.setProperty('--wx', (e.clientX || r.left + r.width / 2) + 'px');
  wipe.style.setProperty('--wy', (e.clientY || r.top + r.height / 2) + 'px');
  setTimeout(() => wipe.classList.add('go'), 140);
  setTimeout(() => { location.href = card.href; }, 560);
}));
// Coming back with the browser's Back button restores this page from cache: undo the wipe.
addEventListener('pageshow', (e) => {
  if (!e.persisted) return;
  $('#wipe').classList.remove('go');
  document.querySelectorAll('.game-card.picked').forEach((c) => c.classList.remove('picked'));
  if (hubShown) refresh();
});

function renderRecordRibbons(p) {
  document.querySelectorAll('.game-card .meta[data-kind]').forEach((el) => {
    const k = p.record.byKind[el.dataset.kind], txt = el.closest('.txt');
    let mine = txt.querySelector('.mine');
    if (!k || !k.played) { if (mine) mine.remove(); return; }
    if (!mine) { mine = document.createElement('span'); mine.className = 'mine'; txt.appendChild(mine); }
    mine.textContent = `You've won ${k.won} of ${plural(k.played, 'game')}`;
  });
}

/* ================= level (top bar + Trophies header) ================= */
function renderLevel(p) {
  const { level, xp, from, to } = p.level, name = LEVEL_NAMES[level - 1];
  const pct = to ? Math.round(((xp - from) / (to - from)) * 100) : 100;
  $('#mini-cone').innerHTML = coneSVG(level);
  $('#lvl-name').innerHTML = `Lv ${level}<span class="lvl-title"> ${escapeHtml(name)}</span>`;
  $('#mini-xp').style.width = pct + '%';
  $('#big-cone').innerHTML = coneSVG(level);
  $('#lv-num').textContent = `Level ${level} of ${LEVEL_NAMES.length}`;
  $('#lv-title').textContent = name;
  $('#xp-fill').style.width = pct + '%';
  $('.xp-bar').setAttribute('aria-valuenow', pct);
  $('#xp-num').textContent = to ? `${xp} / ${to} XP` : `${xp} XP`;
  $('#xp-text').textContent = to ? `${to - xp} more XP to ${LEVEL_NAMES[level]}. Every game, win, bonk and bomb counts.` : 'Top of the cone. Nothing left to prove 👑';
}

/* ================= TROPHIES ================= */
function renderTrophies(p, fresh = []) {
  const seen = store.get(seenKey(), {}), viewed = seen.viewed || [];
  const done = p.achievements.filter((a) => a.done);
  const unseen = done.filter((a) => !viewed.includes(a.id));
  $('#trophy-count').textContent = `${done.length} of ${p.achievements.length}`;
  $('#tab-badge').hidden = !unseen.length;
  $('#tab-badge').textContent = unseen.length;
  const C = 2 * Math.PI * 46;
  // Unlocked first (newest first), then the closest to unlocking.
  const list = p.achievements.slice().sort((a, b) => (b.done - a.done)
    || (a.done ? new Date(b.unlockedAt) - new Date(a.unlockedAt) : b.have / b.need - a.have / a.need));
  $('#trophies').innerHTML = list.map((a, i) => {
    const frac = a.done ? 1 : a.have / a.need, isNew = a.done && !viewed.includes(a.id);
    const back = a.done ? `<b>${escapeHtml(a.name)}</b><p>${escapeHtml(a.how)}</p><p>Unlocked ${escapeHtml(timeAgo(a.unlockedAt))} 🎉</p>`
      : `<b>${escapeHtml(a.name)}</b><p>${escapeHtml(a.how)}</p><p>${a.need > 1 ? `${a.have} of ${a.need} so far` : 'Not yet. You got this.'}</p>`;
    return `<button class="badge3d ${a.done ? 'done' : 'locked'}${fresh.includes(a.id) ? ' new' : ''}" type="button" data-id="${a.id}" style="--sd:${(i % 5) * 0.7}s"
        aria-label="${escapeHtml(a.name)}: ${a.done ? 'unlocked' : 'locked'}. ${escapeHtml(a.how)}">
      ${isNew ? '<span class="ribbon">NEW</span>' : ''}
      <span class="flip">
        <span class="face front">
          <span class="medal"><svg viewBox="0 0 104 104" aria-hidden="true"><circle class="ring-bg" cx="52" cy="52" r="46"/>
            <circle class="ring" cx="52" cy="52" r="46" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - frac)}"/></svg>
            <span class="disc">${a.icon}</span></span>
          <b class="nm">${escapeHtml(a.name)}</b>
          <span class="pg">${a.done ? 'Unlocked' : a.need > 1 ? `${a.have} / ${a.need}` : 'Locked'}</span>
        </span>
        <span class="face back">${back}</span>
      </span></button>`;
  }).join('');
}
$('#trophies').addEventListener('click', (e) => {
  const b = e.target.closest('.badge3d');
  if (!b) return;
  b.classList.toggle('flipped');
  sfx.flip();
});
// Opening the Trophies screen counts as seeing your new trophies: the NEW ribbons go next time.
function openedTrophies() {
  if (!profile) return;
  const seen = store.get(seenKey(), {});
  seen.viewed = profile.achievements.filter((a) => a.done).map((a) => a.id);
  store.set(seenKey(), seen);
  $('#tab-badge').hidden = true;
}

/* ================= RIVALS & HISTORY ================= */
const CROWN = '<svg viewBox="0 0 24 18" aria-hidden="true"><path d="M2 16L1 4l6 5 5-8 5 8 6-5-1 12z" fill="currentColor" stroke="#2b2140" stroke-width="2" stroke-linejoin="round"/></svg>';
function renderRivals(p) {
  const rivals = new Map();
  for (const r of p.rivalry) {
    const mine = r.by_player === p.me.id, id = mine ? r.to_player : r.by_player;
    const e = rivals.get(id) || { id, name: mine ? r.to_name : r.by_name, bonk: [0, 0], bomb: [0, 0], cards: [0, 0] };
    e[r.kind][mine ? 0 : 1] += r.times;
    if (r.kind === 'bomb') e.cards[mine ? 0 : 1] += r.cards;
    rivals.set(id, e);
  }
  const total = (e) => e.bonk[0] + e.bonk[1] + e.bomb[0] + e.bomb[1];
  const all = [...rivals.values()].sort((a, b) => total(b) - total(a));
  const humans = all.filter((e) => !isBotId(e.id)), bots = all.filter((e) => isBotId(e.id));
  const tug = ([mine, theirs], what, extra = '') => {
    if (!mine && !theirs) return '';
    const pct = Math.round((mine / (mine + theirs)) * 100);
    return `<div class="tug"><b>${mine}</b><span class="rope" aria-hidden="true"><i class="${mine ? '' : 'none'}" data-w="${pct}"></i></span><b>${theirs}</b>
      <small>${what}${extra}</small></div>`;
  };
  const card = (e) => {
    const mine = e.bonk[0] + e.bomb[0], theirs = e.bonk[1] + e.bomb[1], them = escapeHtml(shortName(e.name));
    const lead = mine > theirs ? 'me' : theirs > mine ? 'them' : '';
    const cards = e.cards[0] || e.cards[1] ? `, ${e.cards[0]} vs ${e.cards[1]} cards` : '';
    return `<div class="vs-card">
      <div class="vs-head">
        <div class="vs-side"><span class="crown">${lead === 'me' ? CROWN : ''}</span><span class="actor" data-mood="${lead === 'me' ? 'smug' : lead ? 'sweat' : ''}">${myAvatar()}</span>You</div>
        <span class="vs-mid" aria-hidden="true">VS</span>
        <div class="vs-side"><span class="crown">${lead === 'them' ? CROWN : ''}</span><span class="actor" data-mood="${lead === 'them' ? 'smug' : lead ? 'sweat' : ''}">${avatarFor(e.id)}</span>${them}</div>
      </div>
      ${tug(e.bonk, '💥 bonks')}${tug(e.bomb, '📦 bombs', cards)}</div>`;
  };
  let html = humans.length ? humans.map(card).join('')
    : `<div class="empty-card">No bonks or bombs yet. Bonk someone in Ludo or drop a +4 pile on them in Plus Four and the feud starts here.<a class="btn cta" href="#play">Go start one</a></div>`;
  if (bots.length) html += `<details class="practice-group"><summary>🤖 Practice rivals (${bots.length})</summary><div class="versus-list">${bots.map(card).join('')}</div></details>`;
  $('#revenge').innerHTML = html;
  // Let the ropes pull into place, and the leader gloat.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    document.querySelectorAll('#revenge .rope i').forEach((i) => (i.style.width = i.dataset.w + '%'));
    document.querySelectorAll('#revenge .actor[data-mood]').forEach((a) => a.dataset.mood && react(a, a.dataset.mood, 0));
  }));
}

let seenGames = null;
function renderHistory(p) {
  const list = $('#history');
  if (!p.recent.length) {
    list.innerHTML = '<li class="empty-card">No games saved yet. Finish one and its ticket lands here within 20 seconds.<a class="btn cta" href="#play">Pick a game</a></li>';
    seenGames = new Set();
    return;
  }
  const first = seenGames === null;
  let freshCount = 0;
  list.innerHTML = p.recent.map((g, i) => {
    const [icon, label] = GAMES[g.kind] || ['🎮', g.kind];
    const others = g.players.filter((x) => x.id !== p.me.id).map((x) => (x.bot ? '🤖 ' : '') + shortName(x.name));
    const mine = g.players.find((x) => x.id === p.me.id) || {};
    let res = g.won ? ['won', 'WON'] : ['lost', 'LOST'];
    if (!g.won && g.players.length > 2 && mine.place) res = ['place', ordinal(mine.place)];
    const m = g.mine || {}, bits = [timeAgo(g.endedAt)];
    if (g.kind === 'ludo') bits.push(plural(m.bonks || 0, 'bonk'));
    if (g.kind === 'plusfour') bits.push(plural(m.bombs || 0, 'bomb'));
    if (g.kind === 'doodle' && mine.score != null) bits.push(`${mine.score} points`);
    if (g.startedAt) bits.push(`${Math.max(1, Math.round((new Date(g.endedAt) - new Date(g.startedAt)) / 60000))} min`);
    const fresh = !first && !seenGames.has(g.id);
    if (fresh) freshCount++;
    return `<li class="ticket${g.practice ? ' practice' : ''}${fresh ? ' fresh' : ''}" style="--d:${i * 0.07}s"><span class="stub" aria-hidden="true">${icon}</span>
      <span class="tt"><b>${escapeHtml(label)} vs ${escapeHtml(others.join(', ') || 'nobody')}${g.practice ? '<span class="tag">practice</span>' : ''}</b>
      <small>${escapeHtml(bits.join(', '))}</small></span><span class="stamp ${res[0]}">${res[1]}</span></li>`;
  }).join('');
  seenGames = new Set(p.recent.map((g) => g.id));
  if (freshCount && currentTab === 'rivals') sfx.drop();
}
// Stamps thump in each time you open the Rivals screen.
function stampTickets() {
  const list = $('#history');
  list.classList.remove('stamping');
  if (reduced) return;
  void list.offsetWidth;
  list.classList.add('stamping');
}

function renderEmpty() {
  $('#revenge').innerHTML = '<div class="empty-card">Loading your rivals…</div>';
  $('#history').innerHTML = '<li class="empty-card">Loading your games…</li>';
  $('#trophies').innerHTML = '';
}

/* ================= putting a profile on screen, and celebrating what's new ================= */
let profile = null, checkedAt = 0, pendingReaction = null;
function applyProfile(p, { firstLoad = false } = {}) {
  const before = profile;
  profile = p; checkedAt = Date.now();
  setLive('live');

  const seen = store.get(seenKey(), null);
  const unlocked = p.achievements.filter((a) => a.done).map((a) => a.id);
  const freshTrophies = seen && seen.ach ? unlocked.filter((id) => !seen.ach.includes(id)) : [];
  const levelUp = !!(seen && seen.level && p.level.level > seen.level);
  const newest = p.recent[0];
  const newGame = !!(seen && newest && seen.lastGame !== undefined && seen.lastGame !== newest.id);

  renderLevel(p); renderRecordRibbons(p); renderTrophies(p, freshTrophies); renderRivals(p); renderHistory(p);
  if (before) retrigger($('#btn-live'), 'blink');

  // What happened since you last looked? Saved now, celebrated once the menu is on screen.
  const celebrate = () => {
    if (levelUp) {
      retrigger($('#big-cone'), 'up');
      reactMe('cheer'); sfx.levelup(); bigConfetti();
      toast(`🍦 Level up! You're a ${LEVEL_NAMES[p.level.level - 1]} now`, 3600);
    } else if (freshTrophies.length) {
      const a = p.achievements.find((x) => x.id === freshTrophies[0]);
      reactMe('flex'); sfx.trophy(); bigConfetti();
      toast(`🏆 Trophy unlocked: ${a.icon} ${a.name}${freshTrophies.length > 1 ? ` (+${freshTrophies.length - 1} more)` : ''}`, 3600);
    } else if (newGame) {
      const rival = newest.players.find((x) => x.id !== p.me.id);
      if (newest.won) { reactMe('cheer'); toast(rival ? `You beat ${shortName(rival.name)}! 😈` : 'You won! 🎉', 3000); }
      else { reactMe('sulk'); toast('Revenge is coming… 😤', 3000); }
    }
  };
  if (levelUp || freshTrophies.length || newGame) {
    if (hubShown && !firstLoad) celebrate(); else pendingReaction = celebrate;
  }
  store.set(seenKey(), { ...(seen || {}), ach: unlocked, level: p.level.level, lastGame: newest ? newest.id : null, viewed: (seen && seen.viewed) || [] });
  if (currentTab === 'trophies' && hubShown) openedTrophies();
}

/* ================= live: is the database reachable? ================= */
function setLive(state) {
  const btn = $('#btn-live');
  btn.dataset.state = state;
  $('#live-label').textContent = { live: 'Live', offline: 'Offline', checking: 'Checking' }[state];
  renderLivePop();
}
function renderLivePop() {
  const state = $('#btn-live').dataset.state, retry = $('#btn-live-retry');
  if (state === 'live' && profile) {
    const d = profile.db, s = Math.round((Date.now() - checkedAt) / 1000);
    $('#live-head').textContent = 'Live: saving works ✅';
    $('#live-sub').textContent = `${plural(d.games, 'game')}, ${plural(d.messages, 'message')} and ${d.hits} bonks/bombs saved so far. Checked ${s < 5 ? 'just now' : s + 's ago'}.`;
    retry.hidden = true;
  } else if (state === 'offline') {
    $('#live-head').textContent = "Can't reach the scoreboard 📡";
    $('#live-sub').textContent = 'Games still work, but results won\'t be saved. Fix: Edge or Chrome → Settings → Privacy → Use secure DNS → Cloudflare.';
    retry.hidden = false;
  } else {
    $('#live-head').textContent = 'Checking the scoreboard…';
    $('#live-sub').textContent = '';
    retry.hidden = true;
  }
}
$('#btn-live').onclick = () => { const pop = $('#live-pop'); pop.hidden = !pop.hidden; renderLivePop(); };
$('#btn-live-retry').onclick = () => refresh();
document.addEventListener('pointerdown', (e) => { if (!e.target.closest('#live-pop, #btn-live')) $('#live-pop').hidden = true; });

let refreshing = false;
async function refresh() {
  if (refreshing || !me) return;
  refreshing = true;
  const p = await records.me();
  refreshing = false;
  if (!p || !p.level) { setLive('offline'); if (!profile) renderEmpty(); return; }
  applyProfile(p);
}
let liveTimer = 0;
function startLive() {
  if (liveTimer) return;
  if (!profile) refresh();
  liveTimer = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, POLL_MS);
  setInterval(() => { if (!$('#live-pop').hidden) renderLivePop(); }, 5000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
}

/* ================= sound toggle, profile, login, joining ================= */
$('#btn-sound').onclick = () => { const m = player.toggle(); setIcon($('#btn-sound'), m ? 'mute' : 'volume'); if (!m) sfx.pop(); };
document.addEventListener('profilechange', () => { if (me) { renderMe(); if (profile) renderRivals(profile); } });

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
  boot({ full: true });
});

function joinCode() {
  const code = $('#join-code').value.trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) { $('#hub-error').textContent = 'Room codes are 6 letters or numbers 🙂'; return; }
  sfx.pick();
  location.href = `${GAME_FOR_CODE(code)}?room=${code}`;
}
$('#btn-join').onclick = joinCode;
$('#join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinCode(); });

document.addEventListener('DOMContentLoaded', () => {
  hydrateIcons();
  applyPalette();
  wireProfileSheet();
  boot();
});
