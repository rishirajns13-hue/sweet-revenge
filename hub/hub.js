'use strict';
/* Sweet Revenge front door: a cosy party-game menu.
   - Loading screen: scoops drop on a cone while we check your login and reach the scoreboard.
   - Three screens you switch between like a game menu: Play, Trophies, Rivals & History (#play, #trophies, #rivals).
   - Your avatar reacts to what happened since you last looked (wins, losses, trophies, level-ups).
   - Everything comes from the database (shared/records.js) and refreshes every 20 seconds.
   Needs shared/core.js, shared/records.js and shared/sound.js. */

const GAME_FOR_CODE = (code) => ({ D: 'doodle.html', P: 'plusfour.html', S: 'snakes.html', B: 'sundae.html', G: 'sticky.html' }[code[0]] || 'ludo.html');
const GAMES = { ludo: ['🎲', 'Ludo'], plusfour: ['🃏', 'Plus Four'], doodle: ['🖍️', 'Doodle Duel'], snakes: ['🐍', 'Snakes & Ladders'], sundae: ['💣', 'Sundae Bomb'], sticky: ['🍬', 'Sticky Situation'] };
const LEVEL_NAMES = ['Sprinkle', 'Single Scoop', 'Double Scoop', 'Waffle Cone', 'Sundae', 'Banana Split', 'Brain Freeze', 'Sweet Revenge Royalty'];
const TABS = ['home', 'play', 'trophies', 'rivals', 'chat', 'me'];
const POLL_MS = 60000; // a safety net: new games and trophies arrive instantly through records.onChange
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ================= sounds: a few quiet, real recorded clips (shared/sounds, CC0, see LICENSE-ui-sounds.txt) =================
   The menus' own set: soft taps and a micro swish when you move between sections, a mouth pop when you
   pick a game, a card flick for trophies, a popping cork for a new trophy, bubbles for a level-up.
   No plucked strings, pizzicato or glass "tings" (the user dislikes them). Chat has its own set. */
const player = createSamplePlayer({
  volume: 0.7,
  takes: {
    pop: ['ui-pop-1.ogg', 'ui-pop-2.ogg'], swish: ['ui-swish.ogg'], pick: ['ui-pick.ogg'], drop: ['ui-drop-1.ogg', 'ui-drop-2.ogg'],
    flip: ['card-slide-2.ogg', 'card-slide-5.ogg'], shine: ['ui-shine.ogg'], trophy: ['ui-trophy.ogg'], levelup: ['ui-levelup.ogg'],
  },
});
const sfx = {
  pop() { player.sample('pop', { vol: 0.22 }); },
  swish() { player.sample('swish', { vol: 0.55 }); },
  pick() { player.sample('pick', { vol: 0.3 }); },
  drop() { player.sample('drop', { vol: 0.35 }); },
  flip() { player.sample('flip', { vol: 0.35 }); },
  trophy() { player.sample('trophy', { vol: 0.55, vary: false }); player.sample('shine', { vol: 0.22, when: 0.2 }); },
  levelup() { player.sample('levelup', { vol: 0.4, vary: false }); },
};
// Browsers only allow sound after the first click or key press, so load the clips then.
['pointerdown', 'keydown'].forEach((ev) => addEventListener(ev, () => setTimeout(() => player.load(), 80), { once: true })); // after the tap has drawn

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
// A friend's own chosen critter when we know it (saved to their account), else their default.
const avatarFor = (id) => {
  if (id === me.user) return myAvatar();
  if (isBotId(id)) return '🤖';
  const f = profile && profile.friends && profile.friends[id];
  return f && f.avatar && AVATARS.includes(f.avatar) ? f.avatar : DEFAULT_AVATAR[id] || '🙂';
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const seenKey = () => 'sr-seen:' + me.user;

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
// The critter's face changes with the mood too (shared/avatars.js), then goes back to happy.
const FACE = { cheer: 'cheer', sulk: 'sulk', flex: 'cheer', smug: 'smug', sweat: 'sweat' };
function react(el, state, ms = 2400) {
  if (!el) return;
  el.classList.remove('cheer', 'sulk', 'flex', 'smug', 'sweat', 'saying');
  void el.offsetWidth;
  el.classList.add(state, 'saying');
  if (el.dataset.av) setAvatar(el, el.dataset.av, FACE[state] || 'happy');
  if (ms) setTimeout(() => { el.classList.remove(state, 'saying'); if (el.dataset.av) setAvatar(el, el.dataset.av); }, ms);
}
const reactMe = (state) => { react($('#big-avatar'), state); react($('#me-avatar'), state); };

/* ================= seasons ================= */
// A few days a year the home screen gets a festive layer on top of your theme. ?season=diwali previews one.
const FESTIVALS = {
  diwali: ['2026-11-08', '2027-10-29', '2028-10-17', '2029-11-05', '2030-10-26'],
  holi: ['2027-03-22', '2028-03-11', '2029-03-01', '2030-03-20'],
};
const SEASON_LINES = {
  diwali: 'Happy Diwali! May your diyas stay lit and your rivals stay bonked 🪔',
  holi: 'Happy Holi! Bura na mano, revenge hai 🎨',
  monsoon: 'Monsoon mode: perfect weather for indoor revenge ☔',
  christmas: 'Merry Christmas! Santa saw that +4 🎄',
  newyear: 'New year, same grudges 🎆',
};
function seasonNow(d = new Date()) {
  const forced = new URLSearchParams(location.search).get('season');
  if (forced && SEASON_LINES[forced]) return forced;
  const near = (list, before, after) => list.some((x) => { const t = (d - new Date(x + 'T00:00:00')) / 864e5; return t >= -before && t < after + 1; });
  if (near(FESTIVALS.diwali, 3, 2)) return 'diwali';
  if (near(FESTIVALS.holi, 1, 1)) return 'holi';
  const m = d.getMonth() + 1, day = d.getDate();
  if ((m === 12 && day === 31) || (m === 1 && day === 1)) return 'newyear';
  if (m === 12 && day >= 20) return 'christmas';
  if ((m === 6 && day >= 15) || m === 7 || m === 8 || (m === 9 && day <= 15)) return 'monsoon';
  return null;
}
const SEASON = seasonNow();
if (SEASON) document.body.classList.add('season-' + SEASON);

/* ================= loading screen ================= */
// The menu opens straight away with what this device saw last time (level, trophies, rivals), and fresh
// data from the database swaps in quietly. The cone only shows when there's nothing saved yet,
// e.g. the first login on a device, and it never waits longer than it has to.
const cacheKey = () => 'sr-profile:' + me.user;
// Settles once the login has really been checked; the chat and anything else that talks to the
// database with your login waits for it (the saved token may have expired).
let loginOk;
const loginReady = new Promise((r) => { loginOk = r; });
async function boot({ full = false } = {}) {
  // A return visit draws straight from what this device saved, before the login check (which can be
  // slow on a bad connection). Not for room links or ?next= (a game page has just turned the login
  // down), which wait for the real check so they can't bounce back and forth.
  const q = new URLSearchParams(location.search);
  const early = !full && !q.has('next') && !q.has('room') && peekMe();
  if (early) {
    me = early;
    const saved = store.get(cacheKey(), null);
    if (saved && saved.level) {
      applyProfile(saved, { firstLoad: true, cached: true });
      enterHub();
      confirmLogin(early);
      return;
    }
    showScreen('loading'); // logged in on this device before, but nothing saved yet: the cone, at once
  }
  if (!(await loadMe())) { showScreen('login'); $('#login-user').focus(); return; }
  loginOk();
  if (!routeAway()) return;
  const cached = store.get(cacheKey(), null);
  if (cached && cached.level && !full) {
    applyProfile(cached, { firstLoad: true, cached: true });
    enterHub();
    return;
  }
  showScreen('loading');
  document.querySelectorAll('.load-cone .scoop').forEach((s) => s.classList.remove('in'));
  $('.load-cone').classList.remove('done');
  const steps = [...document.querySelectorAll('.load-steps li')];
  steps.forEach((li) => (li.className = ''));
  const step = (i) => {
    steps[i].className = 'ok';
    document.querySelector(`.load-cone .s${i + 1}`).classList.add('in');
    if (steps[i + 1]) steps[i + 1].className = 'now';
  };
  step(0);
  // The scoreboard gets up to 3 seconds. If it's slow, go in anyway: the menu fills in by itself.
  const p = await Promise.race([fetchMe(), wait(3000).then(() => null)]);
  step(1);
  if (p && p.level) applyProfile(p, { firstLoad: true });
  step(2);
  $('.load-cone').classList.add('done');
  await wait(350); // just long enough to see the last scoop land
  enterHub();
}

// The quiet check after an early start. No connection: keep the saved login and Home, and check again
// when the connection returns. A login that's really gone: forget it and start clean on the login screen.
function confirmLogin(early) {
  loadMe().then((m) => {
    if (m) { loginOk(); return; }
    if (loginOffline()) {
      me = early;
      setLive('offline');
      addEventListener('online', () => confirmLogin(early), { once: true });
      return;
    }
    store.del('sr-auth');
    location.reload(); // nothing saved now, so this opens on the login screen with nothing left running
  });
}

// Room links and "send me back to the game I came from" skip the menu entirely.
function routeAway() {
  const q = new URLSearchParams(location.search), next = q.get('next');
  if (next === 'messages.html') { q.delete('next'); history.replaceState(null, '', 'index.html' + (q.toString() ? '?' + q : '') + '#chat'); return true; }
  if (next && /^(ludo|doodle|plusfour|snakes|sundae|sticky)\.html$/.test(next)) {
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
  renderSeasonLine();
  showScreen('hub');
  hubShown = true;
  showTab(tabFromHash(), { animate: false });
  (window.requestIdleCallback || ((f) => setTimeout(f, 300)))(() => ensureChat(false), { timeout: 1500 });
  if (pendingReaction) { pendingReaction(); pendingReaction = null; }
  startLive();
}

/* ================= sections ================= */
// Home, Games (with Trophies and Rivals), Chat and You are all on this page, so switching never reloads.
// The switch is animated with a same-page view transition where the browser has one (Chrome, Edge,
// Safari 18): Chat slides in from the right like a conversation opening; the rest cross-fade.
let currentTab = null, activeVT = null;
const NAV_OF = { home: 'home', play: 'play', trophies: 'play', rivals: 'play', chat: 'chat', me: 'me' };
const ORDER = { home: 0, play: 1, trophies: 1, rivals: 1, me: 2, chat: 3 };
const calm = () => reduced || document.body.classList.contains('calm');
const tabFromHash = () => (TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'home');
function showTab(name, { animate = true, sound = false } = {}) {
  if (!TABS.includes(name)) name = 'home';
  if (name === currentTab) return;
  const from = currentTab;
  const swap = () => applyTab(name, from, animate);
  if (animate && from !== null && !calm() && document.startViewTransition && !document.hidden) {
    const dir = ORDER[name] >= ORDER[from] ? 'fwd' : 'back';
    document.documentElement.dataset.vt = name === 'chat' || from === 'chat' ? 'chat-' + dir : 'fade';
    if (activeVT) activeVT.skipTransition(); // a new tap wins over a transition still running
    const vt = (activeVT = document.startViewTransition(swap));
    vt.updateCallbackDone.catch(() => {}); vt.finished.catch(() => {});
    vt.ready.catch(() => {}); // skipped or interrupted: the switch itself still happened
    vt.finished.finally(() => { if (activeVT === vt) { activeVT = null; delete document.documentElement.dataset.vt; } });
  } else swap();
  if (sound) sfx.swish();
}
function applyTab(name, from, animate) {
  const fallback = animate && from !== null && !document.startViewTransition && !calm();
  TABS.forEach((t) => {
    const panel = $('#tab-' + t);
    panel.hidden = t !== name;
    panel.classList.remove('from-left', 'from-right');
  });
  if (fallback) $('#tab-' + name).classList.add(ORDER[name] >= ORDER[from] ? 'from-right' : 'from-left');
  currentTab = name;
  $('#screen-hub').dataset.tab = name;
  document.documentElement.classList.toggle('chat-open', name === 'chat');
  document.querySelectorAll('.nav-i').forEach((t) => {
    if (t.dataset.nav === NAV_OF[name]) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
  });
  requestAnimationFrame(movePill); // measuring forces a layout: do it after the switch has drawn
  document.querySelectorAll('[data-sub]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.sub === name));
  if (location.hash.slice(1) !== name) history.replaceState(null, '', '#' + name);
  // Chat: opening it shows the (already drawn) conversation; leaving it counts as leaving the chat.
  if (name === 'chat') { document.title = 'Messages · Sweet Revenge'; ensureChat(true); $('#dm-badge').hidden = true; } // you're reading them now
  else if (from === 'chat') { if (chatApi) chatApi.hide(); document.title = 'Sweet Revenge'; applyPalette(); countUnread(); }
  if (name === 'trophies') openedTrophies();
  if (name === 'rivals') stampTickets();
  if (name === 'me') renderYou();
  if (name === 'home') renderHome();
  if (name !== 'chat') scrollTo({ top: 0, behavior: 'auto' });
}
// The highlight behind the current nav item glides to the new one.
function movePill() {
  const nav = $('.nav-items'), on = nav && nav.querySelector('.nav-i[aria-current]');
  if (!on) return;
  const n = nav.getBoundingClientRect(), r = on.getBoundingClientRect();
  if (!r.width) return;
  nav.style.setProperty('--px', r.left - n.left + 'px'); nav.style.setProperty('--py', r.top - n.top + 'px');
  nav.style.setProperty('--pw', r.width + 'px'); nav.style.setProperty('--ph', r.height + 'px');
  nav.classList.add('pill-ready');
}
addEventListener('resize', movePill);
if (window.ResizeObserver) new ResizeObserver(() => movePill()).observe($('.nav-items')); // the logo or fonts arriving move the items
if (document.fonts) document.fonts.ready.then(movePill);

// The chat module loads in the background once the menu is up and draws the conversation from this
// device's copy straight away, so opening Chat is just showing it.
let chatApi = null, chatLoad = null;
function ensureChat(show) {
  if (!me) return Promise.resolve(null);
  if (!chatLoad) {
    chatLoad = loginReady.then(() => import(new URL('messages/app.js?v=8', document.baseURI).href))
      .then((mod) => mod.mountChat(undefined, { show: currentTab === 'chat' }))
      .then((api) => { chatApi = api; renderHome(); return api; })
      .catch((e) => { chatLoad = null; console.error(e); toast('The chat didn\'t load. Check the connection.'); return null; });
  }
  if (show) chatLoad.then((api) => { if (api && currentTab === 'chat') api.show(); });
  return chatLoad;
}

document.querySelectorAll('.nav-i, .nav-logo').forEach((t) => (t.onclick = (e) => { e.preventDefault(); showTab(t.dataset.nav, { sound: true }); }));
document.querySelectorAll('[data-sub]').forEach((b) => (b.onclick = () => showTab(b.dataset.sub, { sound: true })));
document.querySelectorAll('[data-go]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); showTab(a.dataset.go, { sound: true }); }));
addEventListener('hashchange', () => { if (hubShown && tabFromHash() !== currentTab) showTab(tabFromHash(), { sound: true }); });
document.addEventListener('keydown', (e) => {
  if (!hubShown || !$('#screen-hub').classList.contains('active') || e.target.closest('input, textarea, #dm-root') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (!$('#me-sheet').hidden || currentTab === 'chat') return; // the chat has its own keys
  const NUM = { 1: 'home', 2: 'play', 3: 'chat', 4: 'me' };
  if (!NUM[e.key]) return;
  showTab(NUM[e.key], { sound: true });
  e.preventDefault();
});

/* ================= PLAY ================= */
function renderSeasonLine() {
  let el = $('#season-line');
  if (!SEASON) { if (el) el.remove(); return; }
  if (!el) { $('.greet').insertAdjacentHTML('afterend', '<p id="season-line" class="season-line"></p>'); el = $('#season-line'); }
  el.textContent = SEASON_LINES[SEASON];
}
function renderMe() {
  setAvatar($('#me-avatar'), myAvatar());
  setAvatar($('#big-avatar'), myAvatar());
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
document.addEventListener('click', (e) => {
  const card = e.target.closest('.hm-tile') || e.target.closest('.game-card');
  if (!card || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; // let "open in new tab" work
  e.preventDefault();
  if (card.classList.contains('picked')) return;
  sfx.pick();
  if (reduced) { location.href = card.href; return; }
  card.classList.add('picked');
  const wipe = $('#wipe'), r = card.getBoundingClientRect();
  wipe.style.setProperty('--wc', card.dataset.wipe || 'var(--cta)');
  wipe.style.setProperty('--wx', (e.clientX || r.left + r.width / 2) + 'px');
  wipe.style.setProperty('--wy', (e.clientY || r.top + r.height / 2) + 'px');
  requestAnimationFrame(() => wipe.classList.add('go'));
  setTimeout(() => { location.href = card.href; }, 300); // the game page then fades in over the wipe
});
// Coming back with the browser's Back button restores this page from cache: undo the wipe.
addEventListener('pageshow', (e) => {
  if (!e.persisted) return;
  $('#wipe').classList.remove('go');
  document.querySelectorAll('.game-card.picked, .hm-tile.picked').forEach((c) => c.classList.remove('picked'));
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
  $('#mini-xp').style.setProperty('--p', pct + '%');
  $('#big-cone').innerHTML = coneSVG(level);
  $('#lv-num').textContent = `Level ${level} of ${LEVEL_NAMES.length}`;
  $('#lv-title').textContent = name;
  $('#xp-fill').style.setProperty('--p', pct + '%');
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
    const e = rivals.get(id) || { id, name: mine ? r.to_name : r.by_name, bonk: [0, 0], bomb: [0, 0], splat: [0, 0], cards: [0, 0] };
    if (!e[r.kind]) continue;
    e[r.kind][mine ? 0 : 1] += r.times;
    if (r.kind === 'bomb') e.cards[mine ? 0 : 1] += r.cards;
    rivals.set(id, e);
  }
  // Friends you've played but never bonked or bombed still get a card (for the grudge series).
  for (const id of Object.keys(p.grudge || {})) {
    if (!rivals.has(id)) rivals.set(id, { id, name: ((p.friends || {})[id] || {}).name || id, bonk: [0, 0], bomb: [0, 0], splat: [0, 0], cards: [0, 0] });
  }
  const total = (e) => e.bonk[0] + e.bonk[1] + e.bomb[0] + e.bomb[1] + e.splat[0] + e.splat[1];
  const all = [...rivals.values()].sort((a, b) => total(b) - total(a));
  const humans = all.filter((e) => !isBotId(e.id)), bots = all.filter((e) => isBotId(e.id));
  const tug = ([mine, theirs], what, extra = '') => {
    if (!mine && !theirs) return '';
    const pct = Math.round((mine / (mine + theirs)) * 100);
    return `<div class="tug"><b>${mine}</b><span class="rope" aria-hidden="true"><i class="${mine ? '' : 'none'}" data-w="${pct}"></i></span><b>${theirs}</b>
      <small>${what}${extra}</small></div>`;
  };
  const grudgeBlock = (e) => {
    const g = (p.grudge || {})[e.id];
    if (!g) return '';
    const pips = Array.from({ length: 3 }, (_, i) => `<i class="${i < g.me ? 'on me' : ''}"></i>`).join('') + '<b>vs</b>' + Array.from({ length: 3 }, (_, i) => `<i class="${i < g.them ? 'on them' : ''}"></i>`).join('');
    const them = escapeHtml(shortName(e.name));
    const state = g.me === g.them ? (g.me ? `All square, ${g.me}–${g.them}` : 'New series: first to 3 wins') : g.me > g.them ? `You lead ${g.me}–${g.them}` : `${them} leads ${g.them}–${g.me}`;
    const past = g.won || g.lost ? `<small>Series won: you ${g.won} · ${them} ${g.lost}</small>` : '';
    return `<div class="grudge"><span class="g-title">🥊 Grudge series <em>first to 3</em></span><span class="g-pips" aria-hidden="true">${pips}</span><b class="g-state">${state}</b>${past}</div>`;
  };
  const card = (e) => {
    const mine = e.bonk[0] + e.bomb[0] + e.splat[0], theirs = e.bonk[1] + e.bomb[1] + e.splat[1], them = escapeHtml(shortName(e.name));
    const lead = mine > theirs ? 'me' : theirs > mine ? 'them' : '';
    const cards = e.cards[0] || e.cards[1] ? `, ${e.cards[0]} vs ${e.cards[1]} cards` : '';
    return `<div class="vs-card">
      <div class="vs-head">
        <div class="vs-side"><span class="crown">${lead === 'me' ? CROWN : ''}</span><span class="actor" data-av="${myAvatar()}" data-mood="${lead === 'me' ? 'smug' : lead ? 'sweat' : ''}">${avatarHTML(myAvatar())}</span>You</div>
        <span class="vs-mid" aria-hidden="true">VS</span>
        <div class="vs-side"><span class="crown">${lead === 'them' ? CROWN : ''}</span><span class="actor" data-av="${avatarFor(e.id)}" data-mood="${lead === 'them' ? 'smug' : lead ? 'sweat' : ''}">${avatarHTML(avatarFor(e.id))}</span>${them}</div>
      </div>
      ${grudgeBlock(e)}${tug(e.bonk, '💥 bonks')}${tug(e.bomb, '📦 bombs', cards)}${tug(e.splat, '🥶 freezes, splats & wobbles')}</div>`;
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
// "Ammu beat you at Ludo 20 min ago. Revenge?" when your last real game against a friend was a loss
// in the past day. Tapping it opens that game, ready to start a rematch.
function renderRevengeCall(p) {
  const el = $('#revenge-call'), g = p.recent.find((x) => !x.practice);
  const winner = g && !g.won && g.players.find((x) => !x.bot && x.id !== p.me.id && g.winners.includes(x.id));
  if (!winner || Date.now() - new Date(g.endedAt).getTime() > 864e5) { el.hidden = true; return; }
  const [icon, label] = GAMES[g.kind] || ['🎮', g.kind];
  const name = (p.friends && p.friends[winner.id] && p.friends[winner.id].name) || winner.name;
  el.href = `${g.kind}.html`;
  el.innerHTML = `<span class="rc-face" aria-hidden="true">${avatarHTML(avatarFor(winner.id), 'smug')}</span>
    <span class="rc-txt"><b>${escapeHtml(shortName(name))} beat you at ${escapeHtml(label)}</b><small>${timeAgo(g.endedAt)}. They're probably still gloating.</small></span>
    <span class="rc-go">${icon} Revenge</span>`;
  el.hidden = false;
}
/* ================= challenge a friend ================= */
// A row of friends on Play, each with a Challenge button; picking a game sends the challenge and opens
// that game with a fresh room. The friend gets a pop-up on their home screen.
function renderChallengeStrip(p) {
  const el = $('#challenge-strip'), friends = Object.entries(p.friends || {}).filter(([id]) => id !== p.me.id);
  if (!friends.length) { el.hidden = true; return; }
  el.innerHTML = '<b class="cs-label">Challenge a friend</b>' + friends.map(([id, f]) =>
    `<button type="button" class="cs-friend" data-friend="${escapeHtml(id)}"><span class="cs-av" aria-hidden="true">${avatarHTML(avatarFor(id), 'smug')}</span><span>${escapeHtml(shortName(f.name))}</span><i>⚔️</i></button>`).join('');
  el.hidden = false;
}
$('#challenge-strip').addEventListener('click', (e) => {
  const b = e.target.closest('[data-friend]'); if (b) openChallengePick(b.dataset.friend);
});
function openChallengePick(id) {
  if (!profile || !id) return;
  const f = (profile.friends || {})[id] || { name: id };
  const pick = $('#challenge-pick');
  pick.querySelector('h2').textContent = `Challenge ${shortName(f.name)} to…`;
  pick.querySelector('.pick-games').innerHTML = Object.entries(GAMES).map(([k, [icon, label]]) => `<button type="button" class="btn" data-kind="${k}">${icon} ${label}</button>`).join('');
  pick.dataset.friend = id;
  pick.hidden = false;
  sfx.pop();
}
$('#challenge-pick').addEventListener('click', async (e) => {
  const pick = $('#challenge-pick');
  if (e.target.closest('[data-close]') || e.target === pick) { pick.hidden = true; return; }
  const b = e.target.closest('[data-kind]'); if (!b) return;
  b.disabled = true;
  const id = await records.challenge(pick.dataset.friend, b.dataset.kind);
  b.disabled = false;
  if (!id) { toast("Couldn't send it. Try again?"); return; }
  sfx.pick();
  location.href = `${b.dataset.kind}.html?new=1&challenge=${id}`;
});

// Incoming: a pop-up with the challenger's smug critter. Accept waits for their room if it isn't ready yet.
let waitingFor = null;
function showChallenge(c) {
  if (!profile || c.to_player !== me.user) return;
  if (waitingFor && waitingFor === c.id && c.room) { location.href = `${c.kind}.html?room=${c.room}`; return; }
  if (c.status !== 'open') { if (waitingFor === c.id && c.status === 'cancelled') { waitingFor = null; $('#challenge-pop').hidden = true; } return; }
  const f = (profile.friends || {})[c.from_player] || { name: c.from_player }, [icon, label] = GAMES[c.kind] || ['🎮', c.kind];
  const pop = $('#challenge-pop');
  pop.dataset.id = c.id; pop.dataset.kind = c.kind; pop.dataset.room = c.room || '';
  pop.querySelector('.cp-face').innerHTML = avatarHTML(avatarFor(c.from_player), 'smug');
  $('#cp-title').textContent = `${shortName(f.name)} challenges you to ${label}!`;
  $('#cp-sub').textContent = `${icon} Accept and you're straight in their room. Decline and they'll never let you hear the end of it.`;
  $('#cp-yes').disabled = false; $('#cp-yes').textContent = '⚔️ Accept';
  pop.hidden = false;
  sfx.trophy(); reactMe('sweat');
}
$('#cp-yes').onclick = async () => {
  const pop = $('#challenge-pop'), id = +pop.dataset.id;
  $('#cp-yes').disabled = true;
  await records.answerChallenge(id, true);
  if (pop.dataset.room) { location.href = `${pop.dataset.kind}.html?room=${pop.dataset.room}`; return; }
  waitingFor = id;
  $('#cp-yes').textContent = 'Waiting for their room…';
};
$('#cp-no').onclick = () => { const pop = $('#challenge-pop'); records.answerChallenge(+pop.dataset.id, false); pop.hidden = true; waitingFor = null; };
function startChallenges() {
  records.onChallenge(showChallenge);
  records.openChallenges().then((list) => list.forEach(showChallenge)).catch(() => {});
}

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
    if (g.kind === 'snakes') bits.push(plural(m.bonks || 0, 'bonk'));
    if (g.kind === 'doodle' && mine.score != null) bits.push(`${mine.score} points`);
    if (g.kind === 'sticky') bits.push(`${plural(m.teamFalls || 0, 'fall')} together`);
    if (g.startedAt) bits.push(`${Math.max(1, Math.round((new Date(g.endedAt) - new Date(g.startedAt)) / 60000))} min`);
    const fresh = !first && !seenGames.has(g.id);
    if (fresh) freshCount++;
    return `<li class="ticket${g.practice ? ' practice' : ''}${fresh ? ' fresh' : ''}" style="--d:${i * 0.07}s"><span class="stub" aria-hidden="true">${icon}</span>
      <span class="tt"><b>${escapeHtml(label)} ${g.kind === 'sticky' || g.kind === 'sundae' ? 'with' : 'vs'} ${escapeHtml(others.join(', ') || 'nobody')}${g.practice ? '<span class="tag">practice</span>' : ''}</b>
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
  $('#revenge').innerHTML = '<div class="empty-card">Your feuds show up here once the bonking starts.<a class="btn cta" href="#play">Go start one</a></div>';
  $('#history').innerHTML = '<li class="empty-card">Your games land here as tickets after you play.<a class="btn cta" href="#play">Pick a game</a></li>';
  $('#trophies').innerHTML = '<div class="empty-card">Trophies appear here as you play. The first one is just a win away 🍒</div>';
}

/* ================= putting a profile on screen, and celebrating what's new ================= */
let profile = null, checkedAt = 0, pendingReaction = null;
// Redraw only the parts whose data changed, so a refresh that brings nothing new doesn't replay
// every entry animation (that replay was the flicker right after the menu opened).
const drawn = {};
function drawProfile(p, freshTrophies) {
  const parts = {
    level: [p.level, () => renderLevel(p)],
    record: [p.record, () => renderRecordRibbons(p)],
    trophies: [p.achievements.map((a) => [a.id, a.done, a.have]), () => renderTrophies(p, freshTrophies)],
    rivals: [[p.rivalry, p.me && p.me.name, p.friends, p.grudge], () => renderRivals(p)],
    history: [p.recent.map((g) => g.id), () => renderHistory(p)],
    revenge: [p.recent.slice(0, 1).map((g) => g.id), () => renderRevengeCall(p)],
    challenge: [Object.keys(p.friends || {}), () => renderChallengeStrip(p)],
  };
  let changed = false;
  for (const [key, [data, draw]] of Object.entries(parts)) {
    const sig = JSON.stringify(data);
    if (drawn[key] === sig && !(key === 'trophies' && freshTrophies.length)) continue;
    drawn[key] = sig; draw(); changed = true;
  }
  if (changed || currentTab === 'home') renderHome();
  return changed;
}
function applyProfile(p, { firstLoad = false, cached = false } = {}) {
  const before = profile;
  profile = p;
  if (cached) { setLive('checking'); drawProfile(p, []); return; }
  checkedAt = Date.now();
  setLive('live');
  store.set(cacheKey(), p);

  const seen = store.get(seenKey(), null);
  const unlocked = p.achievements.filter((a) => a.done).map((a) => a.id);
  const freshTrophies = seen && seen.ach ? unlocked.filter((id) => !seen.ach.includes(id)) : [];
  const levelUp = !!(seen && seen.level && p.level.level > seen.level);
  const newest = p.recent[0];
  const newGame = !!(seen && newest && seen.lastGame !== undefined && seen.lastGame !== newest.id);

  if (typeof rememberProgress === 'function') rememberProgress(p);
  const changed = drawProfile(p, freshTrophies);
  if (before && changed) retrigger($('#btn-live'), 'blink');

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
  $('#live-label').textContent = { live: 'Live', offline: 'Reconnecting', checking: 'Checking' }[state];
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
    $('#live-head').textContent = 'Reconnecting to the scoreboard…';
    $('#live-sub').textContent = 'Your games work as normal. Scores pop in here as soon as it connects.';
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

// One profile request at a time: the loading screen, live updates and tab switches share it.
let mePending = null;
function fetchMe() {
  if (!mePending) mePending = records.me({ fresh: true }).finally(() => { mePending = null; });
  return mePending;
}
async function refresh() {
  if (!me) return;
  if ($('#btn-live').dataset.state !== 'live') setLive('checking');
  const p = await fetchMe();
  if (!p || !p.level) { setLive('offline'); if (!profile) renderEmpty(); return; }
  applyProfile(p);
}
let liveTimer = 0;
function startLive() {
  if (liveTimer) return;
  refresh();
  liveTimer = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, POLL_MS);
  records.onChange(refresh);
  startChallenges();
  startMessages();
  setInterval(() => { if (!$('#live-pop').hidden) renderLivePop(); }, 5000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
}

/* ================= YOU: avatar builder, theme, settings, account ================= */
const avatarKey = () => 'ludo-avatar:' + me.user;
function setMyAvatar(key) {
  store.set(avatarKey(), key);
  records.saveLook();
  document.dispatchEvent(new Event('profilechange'));
  renderYou();
  sfx.pop();
}
let previewMood = 0;
const MOODS = ['happy', 'cheer', 'smug', 'sulk', 'sweat'];
function renderYou() {
  if (!me) return;
  const key = myAvatar(), look = AVATAR_ART.parse(key);
  setAvatar($('#me-preview'), key, MOODS[previewMood]);
  $('#me-name').textContent = me.name;
  $('#acct-name').textContent = me.name;
  $('#acct-login').textContent = me.user;
  if (profile) {
    $('#me-lv').textContent = `Level ${profile.level.level} · ${LEVEL_NAMES[profile.level.level - 1]}`;
    $('#ms-played').textContent = profile.record.played;
    $('#ms-won').textContent = profile.record.won;
    $('#ms-trophies').textContent = profile.achievements.filter((a) => a.done).length;
  } else $('#me-lv').textContent = 'Level –';
  // Every option shows *your* critter wearing it, so you see what you'll get.
  const tile = (k, on, label, attr) => `<button type="button" class="b-tile" ${attr} aria-pressed="${on}" aria-label="${escapeHtml(label)}">${avatarHTML(k)}</button>`;
  $('#b-critters').innerHTML = AVATAR_ART.order.map((b) => tile(AVATAR_ART.compose(b, look.colour, look.acc), b === look.base, AVATAR_ART.name(b), `data-base="${b}"`)).join('');
  $('#b-colours').innerHTML = AVATAR_ART.COLOURS.map((c, i) => `<button type="button" class="b-swatch" data-colour="${i}" aria-pressed="${i === look.colour}" aria-label="${i ? 'Colour ' + i : 'Original colours'}" style="--sw:${c || 'conic-gradient(#ff9ad0, #ffd56b, #7ee8d8, #9ab8ff, #ff9ad0)'}">${i ? '' : '✨'}</button>`).join('');
  $('#b-accs').innerHTML = AVATAR_ART.ACCESSORIES.map(([name], i) => tile(AVATAR_ART.compose(look.base, look.colour, i), i === look.acc, name, `data-acc="${i}"`)).join('');
  const pal = store.get('ludo-palette', 'sunset');
  $('#b-themes').innerHTML = PALETTES.map(([k, label]) => `<button type="button" class="b-theme pal-${k}" data-pal="${k}" aria-pressed="${k === pal}"><span></span>${label}</button>`).join('');
  $('#set-sound').checked = !player.muted;
  $('#set-calm').checked = !!store.get('sr-calm', false);
}
$('#me-preview').onclick = () => { previewMood = (previewMood + 1) % MOODS.length; renderYou(); sfx.pop(); };
$('#b-critters').addEventListener('click', (e) => { const b = e.target.closest('[data-base]'); if (!b) return; const l = AVATAR_ART.parse(myAvatar()); setMyAvatar(AVATAR_ART.compose(b.dataset.base, l.colour, l.acc)); });
$('#b-colours').addEventListener('click', (e) => { const b = e.target.closest('[data-colour]'); if (!b) return; const l = AVATAR_ART.parse(myAvatar()); setMyAvatar(AVATAR_ART.compose(l.base, +b.dataset.colour, l.acc)); });
$('#b-accs').addEventListener('click', (e) => { const b = e.target.closest('[data-acc]'); if (!b) return; const l = AVATAR_ART.parse(myAvatar()); setMyAvatar(AVATAR_ART.compose(l.base, l.colour, +b.dataset.acc)); });
$('#b-random').onclick = () => {
  const pick = (n) => Math.floor(Math.random() * n);
  setMyAvatar(AVATAR_ART.compose(AVATAR_ART.order[pick(AVATAR_ART.order.length)], pick(AVATAR_ART.COLOURS.length), pick(AVATAR_ART.ACCESSORIES.length)));
  reactMe('cheer');
};
$('#b-themes').addEventListener('click', (e) => { const b = e.target.closest('[data-pal]'); if (!b) return; store.set('ludo-palette', applyPalette(b.dataset.pal)); records.saveLook(); renderYou(); sfx.pop(); });
$('#set-sound').onchange = () => { if (player.muted === $('#set-sound').checked) player.toggle(); setIcon($('#btn-sound'), player.muted ? 'mute' : 'volume'); if (!player.muted) sfx.pop(); };
$('#set-calm').onchange = () => { store.set('sr-calm', $('#set-calm').checked); applyPalette(); };
$('#set-howto').onclick = () => {
  try { Object.keys(localStorage).filter((k) => k.startsWith('sr-howto:')).forEach((k) => localStorage.removeItem(k)); } catch (e) { /* storage blocked */ }
  toast('The how-to cards will show again in each game 👍');
};
$('#set-logout').onclick = () => { if (confirm('Log out on this device?')) logout(); };

/* ---------- account: change your name or password ---------- */
function openAcctForm(form, other) {
  other.hidden = true;
  form.hidden = false;
  form.querySelector('.acct-msg').textContent = '';
  form.querySelector('.acct-msg').classList.remove('ok');
  form.querySelector('input:not([hidden])').focus();
}
document.querySelectorAll('.acct-form [data-cancel]').forEach((b) => (b.onclick = () => { b.closest('form').hidden = true; }));
$('#acct-edit-name').onclick = () => { $('#acct-name-input').value = me.name; openAcctForm($('#acct-name-form'), $('#acct-pass-form')); $('#acct-name-input').select(); };
$('#acct-edit-pass').onclick = () => { $('#acct-pass-form').reset(); $('#acct-pass-user').value = me.user; openAcctForm($('#acct-pass-form'), $('#acct-name-form')); };
async function acctSubmit(form, msg, work) {
  const btn = form.querySelector('[type=submit]');
  btn.disabled = true;
  const err = await work().catch(() => "Couldn't reach the scoreboard. Try again?");
  btn.disabled = false;
  msg.classList.toggle('ok', !err);
  if (err) { msg.textContent = err; retrigger(form, 'shake'); return false; }
  return true;
}
$('#acct-name-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget, msg = $('#acct-name-msg'), name = $('#acct-name-input').value.trim().replace(/\s+/g, ' ');
  if (name === me.name) { form.hidden = true; return; }
  if (!(await acctSubmit(form, msg, () => records.rename(name)))) return;
  form.hidden = true;
  if (profile) profile.me.name = me.name;
  renderYou(); renderMe();
  reactMe('cheer'); sfx.pop();
  toast(`You're ${me.name} now ✨`);
});
$('#acct-pass-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget, msg = $('#acct-pass-msg'), a = $('#acct-pass-1').value, b = $('#acct-pass-2').value;
  if (a !== b) { msg.classList.remove('ok'); msg.textContent = "Those two don't match"; retrigger(form, 'shake'); return; }
  if (!(await acctSubmit(form, msg, () => records.setPassword(a)))) return;
  form.reset(); form.hidden = true;
  sfx.pop();
  toast('Password changed 🔑 Use the new one next time you log in');
});
document.addEventListener('profilechange', () => { if (currentTab === 'me') renderYou(); });

/* ================= sound toggle, profile, login, joining ================= */
$('#btn-sound').onclick = () => { const m = player.toggle(); setIcon($('#btn-sound'), m ? 'mute' : 'volume'); if (!m) sfx.pop(); };
document.addEventListener('profilechange', () => { if (me) { renderMe(); if (profile) renderRivals(profile); } });

let fails = 0, lockedUntil = 0;
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#login-error');
  if (Date.now() < lockedUntil) { err.textContent = 'Too many tries. Chill for a bit 🧊'; return; }
  const user = $('#login-user').value, pass = $('#login-pass').value;
  const btn = $('#login-form button[type=submit]'), label = btn.textContent;
  btn.disabled = true; btn.textContent = 'Logging in…'; err.textContent = '';
  const done = () => { btn.disabled = false; btn.textContent = label; };
  let ok = null;
  try { ok = await login(user, pass); } catch (e) {
    err.textContent = e.message === 'locked' ? 'Too many wrong tries. Wait 10 minutes and try again 🧊' : "Can't reach the scoreboard. Check the internet and try again 📶";
    done(); return;
  }
  done();
  if (!ok) {
    fails++;
    if (fails >= 5) { lockedUntil = Date.now() + 30000; fails = 0; }
    err.textContent = 'Nope! Wrong name or password 🙈';
    retrigger($('#login-form'), 'shake');
    return;
  }
  err.textContent = '';
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

/* ================= HOME: what to play next, the chat at a glance, the grudge, the games, your level ================= */
const dmPeek = { names: {}, last: null, count: 0, other: null, total: null, since: null };
const PAIR_IDS = ['ammu', 'panchara kunju'];
const otherOf = () => PAIR_IDS.find((id) => id !== me.user) || PAIR_IDS[0];
// The chat at a glance: live from the chat once it has loaded, else this device's copy and the counts.
function homeChatData() {
  const o = otherOf();
  if (chatApi) { const p = chatApi.peek(1); return { ...p, total: dmPeek.total ?? p.total, since: dmPeek.since ?? p.since }; }
  const c = store.get('dm-cache:' + me.user, null) || {};
  const nick = ((c.state && c.state.nicknames) || {})[o];
  const msgs = (c.messages || []).filter((m) => m.kind !== 'system');
  const last = msgs[msgs.length - 1];
  return {
    other: o, name: nick || dmPeek.names[o] || (c.players && c.players[o] && c.players[o].name) || o.replace(/\b\w/g, (ch) => ch.toUpperCase()),
    online: false, typing: false, status: '', unread: dmPeek.count, lastAt: last && last.created_at, total: dmPeek.total, since: dmPeek.since,
  };
}
function resumeGame() {
  const games = [['plusfour-lastroom', 'plusfour.html', 'Plus Four'], ['doodle-lastroom', 'doodle.html', 'Doodle Duel'], ['ludo-lastroom', 'ludo.html', 'Ludo']];
  return games.map(([key, page, label]) => ({ ...store.get(key, {}), page, label }))
    .filter((g) => g.code && Date.now() - g.at < 3 * 3600e3).sort((a, b) => b.at - a.at)[0] || null;
}
// The one game that makes most sense right now: an unfinished one, then revenge for a fresh loss, then
// the one you play most. Returns { kind, kicker, title, sub, href }.
function upNext(them) {
  const last = resumeGame();
  if (last) return { kind: last.page.replace('.html', ''), kicker: 'Pick up where you left off', title: `Your ${last.label} game`, sub: `Room ${last.code} is still open.`, href: `${last.page}?room=${encodeURIComponent(last.code)}` };
  const g = profile && profile.recent.find((x) => !x.practice);
  const winner = g && !g.won && Date.now() - new Date(g.endedAt) < 864e5 && g.players.find((x) => !x.bot && x.id !== profile.me.id && g.winners.includes(x.id));
  if (winner) { const label = (GAMES[g.kind] || [, g.kind])[1]; return { kind: g.kind, kicker: 'Revenge', title: `Rematch at ${label}`, sub: `${them} won ${timeAgo(g.endedAt)}. They're probably still gloating.`, href: `${g.kind}.html` }; }
  const by = profile && profile.record && profile.record.byKind;
  const fav = by && Object.entries(by).filter(([k]) => GAMES[k]).sort((a, b) => b[1].played - a[1].played)[0];
  if (fav && fav[1].played) { const label = GAMES[fav[0]][1]; return { kind: fav[0], kicker: 'Up next', title: `${label} again?`, sub: `You've won ${fav[1].won} of ${plural(fav[1].played, 'game')}. ${them} wants a rematch.`, href: `${fav[0]}.html` }; }
  return { kind: 'ludo', kicker: 'Up next', title: 'Start with Ludo', sub: 'Roll, race and bonk each other all the way home.', href: 'ludo.html' };
}
const cardFor = (kind) => document.querySelector(`#tab-play .game-card[href="${kind}.html"]`);
function renderHome() {
  if (!me || !$('#home-next')) return;
  const d = homeChatData(), them = shortName(d.name), hour = new Date().getHours();
  const greet = hour < 5 ? 'Still up' : hour < 12 ? 'Good morning' : hour < 17 ? 'Hey' : hour < 22 ? 'Evening' : 'Late night';
  $('#home-hello').textContent = `${greet}, ${shortName(me.name)}.`;
  const g = profile && profile.grudge && profile.grudge[d.other];
  $('#home-sub').textContent = d.typing ? `${them} is typing…`
    : d.unread ? `${them} sent you ${d.unread === 1 ? 'a message' : d.unread + ' messages'}.`
    : SEASON ? SEASON_LINES[SEASON]
    : g && g.me > g.them ? `You're ${g.me}–${g.them} up on ${them} in this series.`
    : g && g.them > g.me ? `${them} leads this series ${g.them}–${g.me}. Not for long.`
    : 'Pick a game, or say hi.';

  // up next, drawn with that game's own card art
  const n = upNext(them), art = $('#home-next-art');
  if (art.dataset.kind !== n.kind) {
    const card = cardFor(n.kind) || cardFor('ludo');
    art.className = `${card.className} hm-art`;
    art.innerHTML = `<span class="art">${card.querySelector('.art').innerHTML}</span>`;
    art.dataset.kind = n.kind;
    $('#home-next').style.setProperty('--tc', card.dataset.wipe || 'var(--accent)');
  }
  $('#home-next-kicker').textContent = n.kicker;
  $('#home-next-title').textContent = n.title;
  $('#home-next-sub').textContent = n.sub;
  $('#home-next-play').href = $('#home-next-link').href = n.href;
  $('#home-next-play').dataset.wipe = $('#home-next').style.getPropertyValue('--tc');
  $('#home-challenge').textContent = `Challenge ${them}`;
  $('#home-challenge').dataset.friend = d.other;

  // the chat at a glance
  $('#home-chat-face').innerHTML = avatarHTML(avatarFor(d.other), d.typing ? 'cheer' : d.unread ? 'smug' : 'happy');
  $('#home-chat-face-sm').innerHTML = $('#nav-chat-face').innerHTML = avatarHTML(avatarFor(d.other));
  $('#home-chat-name').textContent = d.name;
  const ago = d.lastAt ? timeAgo(d.lastAt) : '';
  $('#home-chat-status').textContent = d.typing ? 'typing…' : d.unread ? `${d.unread > 9 ? '9+' : d.unread} new message${d.unread === 1 ? '' : 's'}${ago ? ' · ' + ago : ''}` : d.status || (ago ? 'Last message ' + ago : 'Say hi');
  $('#home-chat-status').classList.toggle('on', !!(d.typing || d.unread));
  $('#home-chat-dot').hidden = !d.online;
  const c = $('#home-chat-count'); c.hidden = !d.unread; c.textContent = d.unread > 9 ? '9+' : d.unread;
  $('#home-chat-total').textContent = d.total ? `${d.total.toLocaleString()} message${d.total === 1 ? '' : 's'} so far${d.since ? ' · since ' + new Date(d.since).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : ''}` : '';

  // the games, one tile each (colour and one emoji; the full card art is on the Games screen)
  if (!$('#home-tiles').children.length) {
    const EMOJI = { sticky: '🍬', sundae: '💣', doodle: '🖍️', ludo: '🎲', plusfour: '🃏', snakes: '🐍' };
    $('#home-tiles').innerHTML = [...document.querySelectorAll('#tab-play .game-card')].map((card) => {
      const href = card.getAttribute('href'), kind = href.replace('.html', ''), col = card.dataset.wipe || '#ff71ce';
      return `<a class="hm-tile" href="${href}" data-wipe="${col}" style="--tc:${col}"><span class="hm-tile-art" aria-hidden="true">${EMOJI[kind] || '🎮'}</span><b>${escapeHtml(card.querySelector('h2').textContent)}</b>${card.querySelector('.badge-new') ? '<i>co-op</i>' : ''}</a>`;
    }).join('');
  }

  // the grudge: a best-of-5 series against them
  const s = g || { me: 0, them: 0, won: 0, lost: 0 };
  const pips = (k) => [0, 1, 2].map((i) => `<i class="${i < k ? 'on' : ''}"></i>`).join('');
  $('#home-score').innerHTML = `<span class="side me"><b>${s.me}</b><small>You</small><span class="pips">${pips(s.me)}</span></span>
    <span class="vs" aria-hidden="true">–</span>
    <span class="side them"><b>${s.them}</b><small>${escapeHtml(them)}</small><span class="pips">${pips(s.them)}</span></span>`;
  $('#home-score').setAttribute('aria-label', `This series: you ${s.me}, ${them} ${s.them}. First to 3 wins.`);
  $('#home-score-note').textContent = !profile ? 'Loading the scores…'
    : s.won || s.lost ? `First to 3 wins. Series: you ${s.won}, ${them} ${s.lost}.` : 'First to 3 wins the series.';

  // level and trophies
  if (profile) {
    const { level, xp, from, to } = profile.level, pct = to ? Math.round(((xp - from) / (to - from)) * 100) : 100;
    $('#home-cone').innerHTML = coneSVG(level);
    $('#hm-level-title').textContent = LEVEL_NAMES[level - 1];
    $('#home-xp').style.setProperty('--p', pct + '%'); $('#home-xp').setAttribute('aria-valuenow', pct);
    $('#home-xp-note').textContent = to ? `Level ${level}. ${to - xp} more XP to ${LEVEL_NAMES[level]}.` : `Level ${level}, the top of the cone.`;
    const done = profile.achievements.filter((a) => a.done).sort((a, b) => new Date(b.unlockedAt) - new Date(a.unlockedAt));
    const next = profile.achievements.filter((a) => !a.done).sort((a, b) => b.have / b.need - a.have / a.need);
    const show = [...done.slice(0, 3).map((a) => [a, true]), ...next.slice(0, Math.max(0, 4 - Math.min(3, done.length))).map((a) => [a, false])].slice(0, 4);
    $('#home-trophies').innerHTML = show.map(([a, got]) => `<span class="hm-trophy${got ? '' : ' locked'}" title="${escapeHtml(a.name)}: ${escapeHtml(a.how)}"><span class="disc">${a.icon}</span><small>${escapeHtml(a.name)}</small></span>`).join('');
  }
  // the first visit of a session gets one entrance; switching back later doesn't replay it
  let seen = true;
  try { seen = !!sessionStorage.getItem('sr-home-seen'); sessionStorage.setItem('sr-home-seen', '1'); } catch (e) { /* storage blocked: skip the entrance */ }
  if (!seen && !reduced) {
    retrigger($('#tab-home'), 'hm-enter');
    setTimeout(() => $('#tab-home').classList.remove('hm-enter'), 1600);
  }
}
document.addEventListener('dm:change', () => { if (currentTab === 'home' || currentTab === null) renderHome(); });
$('#home-challenge').addEventListener('click', (e) => openChallengePick(e.currentTarget.dataset.friend));
async function loadDmPeek() {
  const [{ data: ps }, { data: last }, { data: st }, { count }, { data: first }] = await Promise.all([
    sb.from('players').select('id, name, avatar, last_seen').in('id', PAIR_IDS),
    sb.from('dm_messages').select('sender, kind, body, vanish, created_at').neq('kind', 'system').order('created_at', { ascending: false }).limit(1),
    sb.from('dm_state').select('nicknames').eq('id', 1).maybeSingle(),
    sb.from('dm_messages').select('id', { count: 'exact', head: true }).neq('kind', 'system'),
    sb.from('dm_messages').select('created_at').neq('kind', 'system').order('created_at', { ascending: true }).limit(1),
  ]);
  (ps || []).forEach((p) => { dmPeek.names[p.id] = p.name; });
  Object.assign(dmPeek.names, (st && st.nicknames) || {});
  dmPeek.other = (ps || []).find((p) => p.id !== me.user) || null;
  dmPeek.last = last && last[0] && !last[0].vanish ? last[0] : null;
  dmPeek.total = typeof count === 'number' ? count : null;
  dmPeek.since = first && first[0] ? first[0].created_at : null;
  renderHome();
}

/* ================= Messages: the Chat tab's unread count, live ================= */
// Counts what the friend sent that you haven't seen; a new message while you're here shows a banner.
let dmChannel = null, dmCountT = 0;
async function countUnread() {
  const { count, error } = await sb.from('dm_messages').select('id', { count: 'exact', head: true })
    .neq('sender', me.user).neq('kind', 'system').is('seen_at', null);
  if (error) return;
  const b = $('#dm-badge');
  b.hidden = !count;
  b.textContent = count > 9 ? '9+' : count;
  $('#btn-dm').setAttribute('aria-label', count ? `Chat, ${count} new` : 'Chat');
  dmPeek.count = count || 0; renderHome();
}
function startMessages() {
  if (dmChannel || !me) return;
  countUnread(); loadDmPeek();
  const names = {};
  sb.from('players').select('id, name').then(({ data }) => (data || []).forEach((p) => { names[p.id] = p.name; }));
  sb.from('dm_state').select('nicknames').eq('id', 1).maybeSingle().then(({ data }) => Object.assign(names, (data && data.nicknames) || {}));
  const recount = () => { clearTimeout(dmCountT); dmCountT = setTimeout(countUnread, 300); };
  dmChannel = sb.channel('sr-dm-badge')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'dm_messages' }, (e) => {
      recount();
      const m = e.new;
      if (e.eventType === 'INSERT' && m && m.kind !== 'system') { if (!m.vanish) dmPeek.last = m; if (dmPeek.total != null) dmPeek.total++; renderHome(); }
      if (e.eventType !== 'INSERT' || !m || m.sender === me.user || m.kind === 'system' || currentTab === 'chat') return;
      const what = m.vanish ? 'sent a message' : m.kind === 'text' ? '' : m.kind === 'voice' ? 'sent a voice message'
        : m.kind === 'gif' ? 'sent a GIF' : m.kind === 'sticker' ? 'sent a sticker' : 'sent a ❤️';
      const who = names[m.sender] || m.sender;
      toast(`💬 ${who}${what ? ' ' + what : ': ' + (m.body.length > 60 ? m.body.slice(0, 60) + '…' : m.body)}`, 3500);
      sfx.pop();
      retrigger($('#btn-dm'), 'boing');
    })
    .subscribe();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') countUnread(); });
  addEventListener('pageshow', (e) => { if (e.persisted) countUnread(); });
}
