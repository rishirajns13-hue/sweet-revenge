'use strict';
/* The co-op platformer: stages, couch mode and online rooms.
   Physics runs at a fixed 60 steps a second (coop/physics.js); the 3D view (coop/view.js, a module) draws
   every frame. Online, each browser moves only its own hero; the partner's position, facing, door and
   push direction stream in about 20 times a second and are eased in. The host's browser is the referee
   (keys, locks, buttons, gates, crates, lifts, flags, the exit) and sends a small snapshot 10 times a
   second, which the guest adopts. Saved as kind 'sticky' in the history (it replaces Sticky Situation). */
const CP = window.CoopPhysics, LV = window.CoopLevels;
const NS = 'coop-1';
const GAME_NAME = 'Two Peas';                      // working title until the user picks one
const SEAT_COLORS = ['#ff5fa8', '#3f9bff'];
const SEND_MS = 50;
const firstName = (name) => String(name).split(' ').pop();
const avHTML = (a) => (typeof avatarHTML === 'function' ? avatarHTML(a) : escapeHtml(a));
const PROGRESS_KEY = 'coop-progress';            // { cleared: { '1-1': bestSecs, ... } } on this laptop
const LOOK_KEY = 'li-look';                       // the Human or Critter you made in Locked In (shared)

const sfx = (() => {
  const p = createSamplePlayer({ takes: { pop: ['ui-pop-1.ogg', 'ui-pop-2.ogg'], drop: ['ui-drop-1.ogg', 'ui-drop-2.ogg'], shine: ['ui-shine.ogg'], win: ['ui-levelup.ogg'], slide: ['card-slide-1.ogg', 'card-slide-2.ogg'], pick: ['ui-pick.ogg'], place: ['card-place-1.ogg', 'card-place-2.ogg'], shove: ['card-shove-1.ogg', 'card-shove-2.ogg'], trophy: ['ui-trophy.ogg'] } });
  return {
    load: p.load,
    jump() { p.sample('pop', { vol: 0.18, rate: 1.35 }); },
    land(v) { p.sample('drop', { vol: Math.min(0.5, 0.12 + v * 0.02), rate: 0.8 }); },
    spring() { p.sample('pop', { vol: 0.5, rate: 0.6 }); },
    key() { p.sample('shine', { vol: 0.45, rate: 1.2 }); },
    unlock() { p.sample('trophy', { vol: 0.35 }); },
    press() { p.sample('place', { vol: 0.35, rate: 0.9 }); },
    release() { p.sample('place', { vol: 0.2, rate: 1.2 }); },
    die() { p.sample('slide', { vol: 0.5, rate: 0.7 }); },
    flag() { p.sample('shine', { vol: 0.4 }); },
    door() { p.sample('pick', { vol: 0.35 }); },
    win() { p.sample('win', { vol: 0.7 }); },
    pop() { p.sample('pick', { vol: 0.35 }); },
    chat() { p.sample('pop', { vol: 0.25 }); },
    get muted() { return p.muted; }, toggle: p.toggle,
  };
})();

/* ================= state ================= */
let mode = null;              // 'couch' | 'host' | 'guest'
let session = 0, timers = [];
let room = null, conn = null, myK = null, roomCode = '';
let players = [];             // [{ k, name, avatar, look }]
let world = null, running = false, last = 0, acc = 0, stageId = '1-1', run = null;
let incoming = null, sendTimer = 0, snapTimer = 0, partnerAway = false, posSeq = 0, lastQ = -1, remoteDir = 0;
let savedGid = null, hudKey = '';
const alive = (my) => () => my === session;
const later = (ms, fn) => timers.push(setTimeout(fn, ms));
const online = () => mode === 'host' || mode === 'guest';
const partnerK = () => (myK === 'a' ? 'b' : 'a');
const playerOf = (k) => players.find((p) => p.k === k);
const nameOf = (k) => (mode === 'couch' ? (k === 'a' ? 'Pink' : 'Blue') : k === myK ? 'You' : playerOf(k) ? firstName(playerOf(k).name) : 'Your partner');
// The 3D view (three.js + models) loads only on this page, and not before the menu shows: it starts
// downloading in the background once the home screen is up, so the first stage opens quickly.
const VIEW_SRC = './view.js?v=1'; // import() in a classic script resolves from this file's folder
let viewLoad = null;
const loadView = () => (viewLoad ||= import(VIEW_SRC).catch((e) => { viewLoad = null; throw e; }));

function show(s) {
  document.querySelectorAll('.screen').forEach((el) => el.classList.toggle('active', el.id === 'screen-' + s));
  document.body.classList.toggle('in-game', s === 'play');
  chat.setInGame(online() && (s === 'play' || s === 'end'));
}

/* ================= your look (Human or Critter, shared with Locked In) ================= */
function myLook() {
  const l = store.get(LOOK_KEY, null);
  if (l && (l.kind === 'human' || l.kind === 'critter')) return { ...l, critter: l.critter || myAvatar() };
  return { kind: 'critter', critter: myAvatar() };
}
function cleanLook(l, fallbackCritter) {
  if (!l || typeof l !== 'object') return { kind: 'critter', critter: fallbackCritter };
  const n = (v, max) => (Number.isInteger(v) && v >= 0 && v < max ? v : 0);
  if (l.kind === 'human') return { kind: 'human', style: String(l.style || '').slice(0, 20), skin: n(l.skin, 12), hair: n(l.hair, 20), top: n(l.top, 20), bottom: n(l.bottom, 20), acc: n(l.acc, 4) };
  return { kind: 'critter', critter: AVATARS.includes(l.critter) ? l.critter : fallbackCritter };
}

/* ================= progress (stages cleared on this laptop) ================= */
const progress = () => store.get(PROGRESS_KEY, { cleared: {} });
const unlocked = (id) => { const i = LV.LEVELS.findIndex((l) => l.id === id); return i <= 0 || id in progress().cleared || LV.LEVELS[i - 1].id in progress().cleared; };
function markCleared(id, secs) {
  const p = progress();
  if (!(id in p.cleared) || secs < p.cleared[id]) p.cleared[id] = Math.round(secs);
  store.set(PROGRESS_KEY, p);
}
const nextStage = (id) => { const i = LV.LEVELS.findIndex((l) => l.id === id); return LV.LEVELS[i + 1] ? LV.LEVELS[i + 1].id : null; };
function renderStages(el, { pick, canPick = true } = {}) {
  const p = progress(), worlds = [...new Set(LV.LEVELS.map((l) => l.world))];
  const WORLD_NAMES = { 1: 'World 1 · Together', 2: 'World 2 · Pink and Blue', 3: 'World 3 · Moving Parts' };
  el.innerHTML = worlds.map((w) => `<div class="cp-world"><h3>${WORLD_NAMES[w] || 'World ' + w}</h3><div class="cp-stages">${LV.LEVELS.filter((l) => l.world === w).map((l) => {
    const open = unlocked(l.id), done = l.id in p.cleared, on = l.id === stageId;
    return `<button type="button" class="cp-stage${done ? ' done' : ''}${on ? ' on' : ''}" data-id="${l.id}" ${open && canPick ? '' : 'disabled'}><b>${l.id}</b><span>${escapeHtml(l.name)}</span>${done ? `<small>⭐ ${clock(p.cleared[l.id])}</small>` : open ? '<small>New</small>' : '<small>🔒</small>'}</button>`;
  }).join('')}</div></div>`).join('');
  el.onclick = (e) => { const b = e.target.closest('.cp-stage'); if (!b || b.disabled) return; stageId = b.dataset.id; sfx.pop(); renderStages(el, { pick, canPick }); pick && pick(stageId); };
}
const clock = (n) => `${Math.floor(n / 60)}:${String(Math.round(n) % 60).padStart(2, '0')}`;

/* ================= keys ================= */
const keys = new Set(), pressed = new Set();
const P1 = { left: ['a'], right: ['d'], jump: ['w', ' '], up: ['s', 'e'] };
const P2 = { left: ['arrowleft'], right: ['arrowright'], jump: ['arrowup'], up: ['arrowdown', '/'] };
const ME = { left: ['a', 'arrowleft'], right: ['d', 'arrowright'], jump: ['w', 'arrowup', ' '], up: ['s', 'arrowdown', 'e'] };
const SHOUTS = ['hold', 'jump', 'wait', 'sorry'];
const keyName = (e) => e.key.toLowerCase();
addEventListener('keydown', (e) => {
  if (!running || chat.typing(e)) return;
  const k = keyName(e);
  if (!keys.has(k)) pressed.add(k);
  keys.add(k);
  if (online() && !e.repeat && /^[1-4]$/.test(k)) chat.sticker(SHOUTS[+k - 1]);
  if (k === 'r' && !e.repeat) restartStage();
  if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' ', '/'].includes(k)) e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(keyName(e)));
addEventListener('blur', () => keys.clear());
const inputFor = (map) => ({
  left: map.left.some((k) => keys.has(k)), right: map.right.some((k) => keys.has(k)),
  jump: map.jump.some((k) => pressed.has(k)), up: map.up.some((k) => pressed.has(k)),
});

/* ================= a stage ================= */
let beginSeq = 0;
async function begin(id, resume) {
  const my = ++beginSeq; // a newer begin() (Next pressed twice, a quick restart) wins
  running = false;
  stageId = id;
  const def = LV.byId(id) || LV.LEVELS[0];
  world = CP.newWorld(def);
  if (resume) CP.adopt(world, resume);
  run = run && run.id === id && resume ? run : { id, at: Date.now(), gid: (run && run.gid) || '' };
  incoming = null; partnerAway = false; lastQ = -1; hudKey = '';
  $('#awards').innerHTML = ''; $('#cp-wait').hidden = true;
  show('play');
  $('#cp-loading').hidden = false;
  try { await loadView(); } catch (e) { $('#cp-loading').hidden = true; goHome('The 3D part didn\'t load. Check your internet and try again 🙏'); return; }
  if (!CoopView.getStage()) await CoopView.init($('#view'));
  const W0 = world;
  await CoopView.build({ ...def, parsed: W0.L });
  if (my !== beginSeq) return;
  const looks = { a: (playerOf('a') || {}).look || myLook(), b: (playerOf('b') || {}).look || { kind: 'critter', critter: '🐼' } };
  await CoopView.setHeroes(looks, { a: nameOf('a'), b: nameOf('b') });
  if (my !== beginSeq) return;
  $('#cp-loading').hidden = true;
  $('#cp-stage-name').textContent = `${def.id} · ${def.name}`;
  $('#cp-hint').textContent = def.hint || '';
  running = true; last = performance.now(); acc = 0;
  banner(def.name, def.hint, 2600);
  clearInterval(sendTimer); clearInterval(snapTimer);
  if (online()) { sendTimer = setInterval(sendPosition, SEND_MS); if (mode === 'host') snapTimer = setInterval(sendSnapshot, 100); }
  CoopView.render(world, 0, { snap: true });
  requestAnimationFrame(frame);
}
function restartStage() {
  if (!world) return;
  if (mode === 'guest') { send({ t: 'restart' }); return; }
  if (mode === 'host') { send({ t: 'go', id: stageId, players, run }); }
  begin(stageId);
}

function frame(now) {
  if (!running) return;
  acc += Math.max(0, Math.min(0.1, (now - last) / 1000)); last = now;
  while (acc >= CP.P.dt) {
    if (mode === 'couch') CP.step(world, { a: inputFor(P1), b: inputFor(P2) }, { sim: { a: true, b: true }, authority: true });
    else {
      steerRemote();
      const mine = inputFor(ME), inputs = { [myK]: mine, [partnerK()]: { left: remoteDir < 0, right: remoteDir > 0 } };
      CP.step(world, inputs, { sim: { [myK]: true }, authority: mode === 'host' });
    }
    pressed.clear();
    acc -= CP.P.dt;
    world.events.splice(0).forEach(onEvent);
    if (!running) return;
  }
  CoopView.render(world, Math.min(0.05, (now - (frame.prev || now)) / 1000));
  frame.prev = now;
  hud();
  requestAnimationFrame(frame);
}

// The partner's hero eases toward the newest position we heard (plus a little prediction), so it looks smooth.
function steerRemote() {
  const h = world[partnerK()], m = incoming;
  if (!m) { h.lastDx = 0; h.lastDy = 0; return; }
  const tx = m.x + m.vx * 0.05, ty = m.y + Math.max(0, m.vy) * 0.05;
  const jump = Math.hypot(tx - h.x, ty - h.y) > 3;
  const nx = jump ? tx : h.x + (tx - h.x) * 0.25, ny = jump ? ty : h.y + (ty - h.y) * 0.25;
  h.lastDx = nx - h.x; h.lastDy = ny - h.y;
  h.x = nx; h.y = ny; h.vx = m.vx; h.vy = m.vy; h.ground = m.g; h.face = m.f || h.face;
  h.inDoor = m.d; h.dead = m.dead ? 0.5 : 0;
  if (m.n !== null) h.deaths = m.n;
}

function onEvent(e) {
  const mine = mode === 'couch' || e.k === myK || !e.k;
  CoopView.event(e, world);
  if (e.t === 'jump') { if (mine) sfx.jump(); }
  else if (e.t === 'land') { if (mine) sfx.land(e.v); }
  else if (e.t === 'spring') sfx.spring();
  else if (e.t === 'key') { sfx.key(); toast(`🔑 ${nameOf(e.k)} got the key`, 1600); }
  else if (e.t === 'unlock') { sfx.unlock(); toast('🔓 Unlocked!', 1400); }
  else if (e.t === 'press') sfx.press();
  else if (e.t === 'release') sfx.release();
  else if (e.t === 'flag') { sfx.flag(); toast('🚩 Checkpoint!', 1400); }
  else if (e.t === 'die') { sfx.die(); noteDeath(e.k); }
  else if (e.t === 'door-in' || e.t === 'door-out') { if (mine) sfx.door(); }
  else if (e.t === 'clear') cleared();
}
function noteDeath(k) {
  if (online() && k === myK) send({ t: 'died' });
  const who = nameOf(k);
  toast(who === 'You' ? 'Oops! Back to the flag 😵' : `${who} went splat 😵`, 1500);
}

function hud() {
  const inDoor = ['a', 'b'].filter((k) => world[k].inDoor).length;
  const key = `${world.a.deaths}|${world.b.deaths}|${inDoor}|${mode}`;
  if (key === hudKey) return;
  hudKey = key;
  $('#cp-door').textContent = inDoor === 1 ? '1 of 2 at the door 🚪' : '';
  $('#cp-deaths').innerHTML = ['a', 'b'].map((k) => `<span style="--c:${SEAT_COLORS[k === 'a' ? 0 : 1]}">${escapeHtml(nameOf(k))} <b>${world[k].deaths}</b> 💥</span>`).join('');
}
function banner(title, sub, ms) {
  const el = $('#cp-banner');
  el.innerHTML = `<b>${escapeHtml(title)}</b>${sub ? `<small>${escapeHtml(sub)}</small>` : ''}`;
  el.hidden = false; retrigger(el, 'pop');
  if (ms) later(ms, () => (el.hidden = true));
}

/* ================= the end of a stage ================= */
function cleared() {
  sfx.win(); bigConfetti();
  banner('Stage clear! ⭐', 'Both of you made it through.', 0);
  const secs = world.t;
  markCleared(stageId, secs);
  later(2600, () => showEnd(secs));
}
function showEnd(secs) {
  running = false; clearInterval(sendTimer); clearInterval(snapTimer);
  show('end');
  $('#cp-banner').hidden = true;
  const total = world.a.deaths + world.b.deaths, def = LV.byId(stageId);
  if (online() && me && players.length === 2) {
    const gid = (run.gid || 'cp') + '-' + stageId + '-' + Math.round(run.at / 1000);
    if (savedGid !== gid) {
      savedGid = gid;
      records.game({ kind: 'sticky', gid, room: roomCode || null, practice: false, startedAt: run.at,
        players: players.map((p) => ({ name: p.name, bot: false, place: 1, score: world[p.k].deaths })),
        winners: players.map((p) => p.name),
        stats: Object.fromEntries(players.map((p) => [p.name, { falls: world[p.k].deaths, teamFalls: total, secs: Math.round(secs), stage: stageId }])), hits: [] });
      if (typeof showRewards === 'function') showRewards($('#awards'), gid);
    }
  }
  const best = progress().cleared[stageId];
  $('#end-title').textContent = total === 0 ? `Flawless! ${def.name} ⭐` : `${def.name}: cleared! ⭐`;
  const worst = world.a.deaths === world.b.deaths ? null : world.a.deaths > world.b.deaths ? 'a' : 'b';
  $('#results').innerHTML = ['a', 'b'].map((k) => {
    const p = playerOf(k), av = p ? p.avatar : k === 'a' ? myAvatar() : '🐼';
    return `<div class="cp-res" style="--c:${SEAT_COLORS[k === 'a' ? 0 : 1]}"><span class="av">${avHTML(av)}</span><div><b>${escapeHtml(nameOf(k))}</b><small>${k === worst ? 'Went splat the most 😈' : world[k].deaths ? 'A few oopsies' : 'Not a scratch'}</small></div><span class="cp-blame">${world[k].deaths} 💥</span></div>`;
  }).join('') + `<p class="cp-stat">Cleared in ${clock(secs)} · best ${clock(best ?? secs)}</p>`;
  const next = nextStage(stageId);
  $('#btn-next').hidden = mode === 'guest' || !next;
  $('#btn-again').hidden = mode === 'guest';
  $('#end-wait').hidden = mode !== 'guest';
  $('#end-wait').textContent = 'Waiting for the host to pick the next stage…';
}

/* ================= couch ================= */
function couch(id = stageId) {
  teardown();
  mode = 'couch'; myK = 'a';
  players = [{ k: 'a', name: 'Pink', avatar: myAvatar(), look: myLook() }, { k: 'b', name: 'Blue', avatar: '🐼', look: { kind: 'critter', critter: '🐼' } }];
  begin(id);
}

/* ================= online: rooms ================= */
function teardown() {
  session++;
  running = false;
  clearInterval(sendTimer); clearInterval(snapTimer);
  timers.forEach(clearTimeout); timers = [];
  const oldRoom = room, oldConn = conn;
  room = null; conn = null;
  if (oldConn) { try { oldConn.close(); } catch (e) {} }
  if (oldRoom) oldRoom.seats.forEach((s) => { try { s.link && s.link.close(); } catch (e) {} });
  if (typeof closeAllClients === 'function') closeAllClients();
  mode = null; myK = null; players = []; world = null; run = null;
  chat.reset();
}
function goHome(error = '') {
  teardown();
  show('home');
  renderHomeBits();
  $('#home-error').textContent = error;
}
function leaveToHome() { store.del('coop-lastroom'); goHome(); }
function renderHomeBits() {
  if (me) $('#me-avatar').innerHTML = avHTML(myAvatar());
  const last = store.get('coop-lastroom', null), fresh = last && Date.now() - last.at < 3 * 3600e3;
  $('#btn-resume').hidden = !fresh;
  if (fresh) $('#resume-code').textContent = last.code;
  const p = progress().cleared, n = Object.keys(p).length;
  $('#cp-progress').textContent = n ? `${n} of ${LV.LEVELS.length} stages cleared ⭐` : `${LV.LEVELS.length} stages to clear together`;
  const firstOpen = LV.LEVELS.find((l) => !(l.id in p)) || LV.LEVELS[0];
  stageId = firstOpen.id;
  renderStages($('#cp-stages-home'), { pick: () => {} });
}
const rememberRoom = (code) => code && store.set('coop-lastroom', { code, at: Date.now() });

function send(m, fast = false) {
  const go = (l) => l && l.open && (fast ? l.sendFast(m) : l.send(m));
  if (mode === 'host') { if (room) room.seats.forEach((s) => go(s.link)); }
  else if (mode === 'guest') go(conn);
}
const r2 = (v) => Math.round(v * 100) / 100;
function sendPosition() {
  if (!world || !running) return;
  const h = world[myK];
  posSeq++;
  const link = mode === 'host' ? room && room.seats[1] && room.seats[1].link : conn;
  if (link && !link.direct && posSeq % 3) return; // over the public relay every third tick is plenty
  const dir = (ME.right.some((k) => keys.has(k)) ? 1 : 0) - (ME.left.some((k) => keys.has(k)) ? 1 : 0);
  send({ t: 'p', q: posSeq, s: stageId, x: r2(h.x), y: r2(h.y), vx: r2(h.vx), vy: r2(h.vy), g: h.ground ? 1 : 0, f: h.face, d: h.inDoor ? 1 : 0, dead: h.dead > 0 ? 1 : 0, dn: h.deaths, dir }, true); // (never call a field 'n': net.js numbers messages with it)
}
function sendSnapshot() {
  if (!world || !running || mode !== 'host') return;
  const link = room && room.seats[1] && room.seats[1].link;
  if (link && !link.direct && posSeq % 2) return;
  send({ t: 's', s: stageId, w: CP.snapshot(world) }, true);
}
function onPosition(m) {
  if (!world || !running || m.s !== stageId) return;
  if (![m.x, m.y, m.vx, m.vy].every(Number.isFinite)) return;
  if (Number.isFinite(m.q)) { if (m.q <= lastQ && lastQ - m.q < 1000) return; lastQ = m.q; }
  incoming = { x: m.x, y: m.y, vx: m.vx, vy: m.vy, g: !!m.g, f: m.f === -1 ? -1 : 1, d: !!m.d, dead: !!m.dead, n: Number.isInteger(m.dn) ? m.dn : null };
  remoteDir = m.dir > 0 ? 1 : m.dir < 0 ? -1 : 0;
  if (partnerAway) { partnerAway = false; $('#cp-wait').hidden = true; }
}
function onSnapshot(m) {
  if (!world || !running || mode !== 'guest' || m.s !== stageId || !m.w) return;
  try {
    const wasDone = world.done;
    CP.adopt(world, m.w);
    if (world.done && !wasDone) onEvent({ t: 'clear' });
  } catch (e) { /* a malformed snapshot is ignored */ }
}

function roomPayload() { return { t: 'room', code: room.code, host: me.name, stage: stageId, seats: room.seats.map((s) => ({ name: s.name, avatar: s.avatar })) }; }
function sendRoom() {
  const p = roomPayload();
  room.seats.forEach((s) => s.link && s.link.open && s.link.send(p));
  renderRoom(p);
}
function renderRoom(p) {
  const amHost = mode === 'host', n = p.seats.length;
  if (p.stage && LV.byId(p.stage)) stageId = p.stage;
  $('#room-title').textContent = amHost ? 'Your room' : `${firstName(p.host)}'s room`;
  $('#code-hint').textContent = amHost ? 'Send this code to your partner' : 'Room code';
  $('#room-code').textContent = p.code;
  $('#seats').innerHTML = [0, 1].map((i) => {
    const s = p.seats[i];
    return s ? `<div class="seat" style="--c:${SEAT_COLORS[i]}"><span class="av">${avHTML(s.avatar)}</span><span class="nm">${escapeHtml(s.name)}${s.name === me.name ? ' (you)' : ''}</span><span class="st">${i === 0 ? 'Pink · host' : `${ic('check')}Blue`}</span></div>`
      : '<div class="seat empty"><span class="av"></span><span class="nm">Waiting for your partner</span></div>';
  }).join('');
  renderStages($('#cp-stages-room'), { canPick: amHost, pick: () => amHost && room && sendRoom() });
  $('#btn-start').hidden = !amHost;
  $('#btn-start').disabled = n < 2;
  const wait = $('#room-wait');
  wait.hidden = amHost && n >= 2;
  wait.innerHTML = amHost ? `${GAME_NAME} needs two. Waiting for your partner<span class="dots"><i>.</i><i>.</i><i>.</i></span>`
    : `Waiting for ${escapeHtml(firstName(p.host))} to start<span class="dots"><i>.</i><i>.</i><i>.</i></span>`;
}

const seatPlayers = () => room.seats.map((s) => ({ k: s.k, name: s.name, avatar: s.avatar, look: s.look }));
function startStage(id = stageId) {
  if (!room) return;
  if (!room.seats.every((s) => s.k === myK || (s.link && s.link.open)) || room.seats.length < 2) return toast(`${GAME_NAME} needs two players 🙂`);
  room.started = true;
  rememberRoom(room.code);
  players = seatPlayers();
  run = { id, at: Date.now(), gid: Math.random().toString(36).slice(2, 10) };
  send({ t: 'go', id, players, run });
  begin(id);
}

async function createRoom() {
  if (typeof mqtt === 'undefined') return goHome('Could not load the online library. Check your internet 🙏');
  teardown();
  const my = session;
  mode = 'host'; myK = 'a';
  room = { code: genCode('G'), seats: [{ k: 'a', name: me.name, avatar: myAvatar(), look: myLook() }], started: false };
  roomCode = room.code;
  renderRoom(roomPayload());
  show('room');
  if (!(await hostListen({ code: room.code, ns: NS, epoch: 0, alive: alive(my), onLink: handlePlayer })) && my === session) {
    goHome('Could not reach the game server. Check your internet and try again!');
  }
}
function handlePlayer(c) {
  let state = 'new', seat = null;
  const timer = setTimeout(() => { if (state !== 'ok') c.drop(); }, 8000);
  c.on('data', async (d) => {
    if (state === 'checking' || state === 'dead' || !room) return;
    if (state === 'new') {
      state = 'checking';
      const name = d && d.t === 'hello' ? await checkProof(d.user, d.proof) : null;
      const reject = (why) => { state = 'dead'; c.send({ t: 'reject', why }); setTimeout(() => c.drop(), 400); };
      if (!room) return;
      if (!name) return reject('That login didn\'t work 🚫');
      if (name === me.name) return reject('You\'re already in this room on another device 🙂');
      seat = room.seats.find((s) => s.name === name);
      if (!seat) {
        if (room.seats.length >= 2) return reject(`${GAME_NAME} is for two. This room is full 🙅`);
        seat = { k: 'b', name };
        room.seats.push(seat);
      }
      const old = seat.link; seat.link = c; if (old && old !== c) old.drop();
      seat.avatar = AVATARS.includes(d.avatar) ? d.avatar : seat.avatar || '🙂';
      seat.look = cleanLook(d.look, seat.avatar);
      state = 'ok'; clearTimeout(timer); sfx.pop();
      if (room.started && world) {
        players = seatPlayers(); lastQ = -1;
        c.send({ t: 'go', id: stageId, players, run, resume: CP.snapshot(world) });
        toast(`${firstName(name)} is back 👋`);
      } else { sendRoom(); toast(`${firstName(name)} joined 🎉`); }
      return;
    }
    if (state !== 'ok' || seat.link !== c || !d) return;
    if (d.t === 'p') return onPosition(d);
    if (d.t === 'died') return noteDeath(seat.k);
    if (d.t === 'restart') return restartStage();
    if (d.t === 'social') { if (d.m && typeof d.m === 'object') chat.receive({ ...d.m, from: seat.k }); }
  });
  c.on('close', () => {
    if (!room || !seat || seat.link !== c) return;
    seat.link = null;
    if (!room.started) { room.seats.splice(room.seats.indexOf(seat), 1); sendRoom(); return; }
    partnerAway = true;
    $('#cp-wait').textContent = `${firstName(seat.name)} dropped out. Waiting for them to come back…`;
    $('#cp-wait').hidden = !running;
    toast(`${firstName(seat.name)} dropped out. Waiting for them to come back…`, 3500);
  });
}

function joinRoom(code) {
  code = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) { $('#home-error').textContent = 'Room codes are 6 letters or numbers 🙂'; return; }
  if (typeof mqtt === 'undefined') { $('#home-error').textContent = 'Could not load the online library. Check your internet 🙏'; return; }
  teardown();
  const my = session;
  mode = 'guest'; roomCode = code;
  $('#room-title').textContent = 'Joining…'; $('#room-code').textContent = code; $('#code-hint').textContent = 'Room code';
  $('#seats').innerHTML = ''; $('#btn-start').hidden = true; $('#cp-stages-room').innerHTML = '';
  $('#room-wait').hidden = false; $('#room-wait').innerHTML = 'Knocking on the door<span class="dots"><i>.</i><i>.</i><i>.</i></span>';
  show('room');
  const giveUp = setTimeout(() => { if (my === session && !conn) { goHome('No answer from that room 🤔 Is anyone still in it?'); $('#join-code').value = code; } }, 20000);
  knock({
    code, ns: NS, minEpoch: 0, alive: alive(my),
    hello: { user: me.user || me.name, proof: me.proof, avatar: myAvatar(), look: myLook() },
    onConnected(link) {
      conn = link;
      link.on('data', (d) => {
        if (d.t === 'room') { clearTimeout(giveUp); if (Array.isArray(d.seats) && !document.querySelector('#screen-play.active')) { renderRoom(d); show('room'); } }
        else if (d.t === 'go' && Array.isArray(d.players) && LV.byId(d.id)) {
          clearTimeout(giveUp);
          players = d.players.slice(0, 2).map((p) => { const av = AVATARS.includes(p.avatar) ? p.avatar : '🙂'; return { k: p.k === 'a' ? 'a' : 'b', name: String(p.name), avatar: av, look: cleanLook(p.look, av) }; });
          const mine = players.find((p) => p.name === me.name);
          myK = mine ? mine.k : 'b';
          run = d.run || { id: d.id, at: Date.now(), gid: '' };
          rememberRoom(code);
          begin(d.id, d.resume || null);
        }
        else if (d.t === 'p') onPosition(d);
        else if (d.t === 's') onSnapshot(d);
        else if (d.t === 'died') noteDeath(partnerK());
        else if (d.t === 'social' && d.m) chat.receive(d.m);
        else if (d.t === 'reject') { clearTimeout(giveUp); goHome(String(d.why || 'Could not join')); }
      });
      link.on('close', () => { if (mode === 'guest' && conn === link) { goHome(document.querySelector('#screen-end.active') ? '' : 'The host left. Tap Join to hop back in if they come back!'); $('#join-code').value = code; } });
    },
  });
}

/* ---------- chat ---------- */
const chat = createChat({
  send: (m) => send({ t: 'social', m }),
  game: 'sticky', room: () => roomCode || null,
  players: () => (online() ? players.map((p, i) => ({ k: p.k, name: p.name, color: SEAT_COLORS[i], avatar: p.avatar })) : []),
  me: () => myK,
  stage: () => $('#stage'),
  stickers: {
    hold: ['HOLD ON! ✋', '#ffc233'], jump: ['JUMP! ⬆️', '#2bc48a'], wait: ['WAIT FOR ME 🥺', '#3f9bff'],
    sorry: ['SORRY 😭', '#ff9ad0'], stand: ['Stand still, I\'m jumping on you 🙃', '#ffffff'], door: ['To the door! 🚪', '#c9a7ff'],
  },
  dockAt: 0,
  sound: (kind) => (kind === 'in' ? sfx.chat() : sfx.pop()),
});

/* ================= wiring ================= */
$('#btn-couch').onclick = () => { sfx.pop(); couch(); };
$('#btn-create').onclick = () => { sfx.pop(); createRoom(); };
$('#btn-join').onclick = () => { sfx.pop(); joinRoom($('#join-code').value); };
$('#join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(e.target.value); });
$('#btn-resume').onclick = () => { const last = store.get('coop-lastroom', null); if (last) joinRoom(last.code); };
$('#btn-room-back').onclick = leaveToHome;
$('#btn-start').onclick = () => { sfx.pop(); startStage(); };
$('#btn-leave').onclick = () => { if (mode === 'couch' || confirm('Leave the stage?')) leaveToHome(); };
$('#btn-restart').onclick = () => restartStage();
$('#btn-end-home').onclick = leaveToHome;
$('#btn-again').onclick = () => { sfx.pop(); if (mode === 'couch') couch(stageId); else if (mode === 'host') startStage(stageId); };
$('#btn-next').onclick = () => { sfx.pop(); const n = nextStage(stageId); if (!n) return; if (mode === 'couch') couch(n); else if (mode === 'host') startStage(n); };
$('#btn-mute').onclick = (e) => setIcon(e.currentTarget, sfx.toggle() ? 'mute' : 'volume');
$('#btn-help').onclick = () => howTo(true);
$('#btn-share').onclick = async () => {
  const code = $('#room-code').textContent, link = `${location.origin}${location.pathname}?room=${code}`;
  if (navigator.share) { try { await navigator.share({ title: GAME_NAME, text: `Two heroes, one door. Get in here: ${code}`, url: link }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(link); toast('Invite link copied 💌'); } catch (e) { prompt('Copy this link:', link); }
};
// pause drawing while you type in the chat (saves the laptop), and resize with the window
document.addEventListener('focusin', (e) => { const s = window.CoopView && CoopView.getStage(); if (s && /INPUT|TEXTAREA/.test(e.target.tagName)) s.throttle(30); });
document.addEventListener('focusout', () => { const s = window.CoopView && CoopView.getStage(); if (s) s.throttle(0); });
addEventListener('pagehide', () => { if (mode) teardown(); if (window.CoopView) CoopView.dispose(); });
document.addEventListener('profilechange', renderHomeBits);

function howTo(force = false) {
  if (typeof showHowTo !== 'function') return;
  showHowTo('coop', [
    { icon: '🚪', title: 'Both through the door', text: 'Walk into the door and press S (or ↓ / E) to step in. When you\'re both in, the stage is clear.' },
    { icon: '🧍', title: 'Heads are floors', text: 'Stand on your partner to reach high places. Alone you clear 2 blocks; on a head, 3.' },
    { icon: '🔑', title: 'Keys, buttons, crates', text: 'Carry keys to locks. Buttons hold gates open only while someone stands on them. Heavy crates need both of you pushing.' },
    { icon: '⌨️', title: 'Controls', text: 'A/D or ←/→ move · W, ↑ or Space jump · S, ↓ or E door · R restart · 1–4 shout · hold V to talk.' },
  ], { title: `How to play ${GAME_NAME}`, force });
}

document.addEventListener('DOMContentLoaded', () => {
  hydrateIcons();
  if (sfx.muted) setIcon($('#btn-mute'), 'mute');
  applyPalette();
  wireProfileSheet();
  chat.mountTools($('#chat-tools'), { compact: true });
  sfx.load();
  requireLogin().then(() => {
    goHome();
    (window.requestIdleCallback || ((f) => setTimeout(f, 800)))(() => loadView().catch(() => {}), { timeout: 2500 });
    const code = new URLSearchParams(location.search).get('room');
    if (code) { history.replaceState(null, '', location.pathname); $('#join-code').value = code.toUpperCase(); joinRoom(code); }
    else howTo();
  });
});
