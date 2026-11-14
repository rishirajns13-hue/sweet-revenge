'use strict';
/* Island Duel: turns, aiming, practice bot, couch (one laptop, take turns) and online rooms.
   Every turn both screens rebuild the physics from the same settled state and play the same shot
   (duel/sim.js is deterministic), so online only the shot (weapon, angle, power) is sent, then the
   shooter's final state, which the other screen adopts to iron out any tiny drift. While you aim, your
   partner sees your slingshot being pulled. */
const S = window.DuelSim;
const NS = 'duel-1';
const GAME_NAME = 'Island Duel';                 // working title until the user picks one
const SEAT_COLORS = { a: '#ff5fa8', b: '#3f9bff' };
const LOOK_KEY = 'li-look';
const firstName = (name) => String(name).split(' ').pop();
const avHTML = (a) => (typeof avatarHTML === 'function' ? avatarHTML(a) : escapeHtml(a));
const VIEW_SRC = './view.js?v=1';                 // import() in a classic script resolves from this file's folder
let viewLoad = null;
const loadView = () => (viewLoad ||= import(VIEW_SRC).catch((e) => { viewLoad = null; throw e; }));

const sfx = (() => {
  const p = createSamplePlayer({ takes: { pop: ['ui-pop-1.ogg', 'ui-pop-2.ogg'], drop: ['ui-drop-1.ogg', 'ui-drop-2.ogg'], shine: ['ui-shine.ogg'], win: ['ui-levelup.ogg'], slide: ['card-slide-1.ogg', 'card-slide-2.ogg'], pick: ['ui-pick.ogg'], shove: ['card-shove-1.ogg', 'card-shove-2.ogg'], place: ['card-place-1.ogg', 'card-place-2.ogg'], swish: ['ui-swish.ogg'], hit: ['die-hit-1.ogg', 'die-hit-2.ogg', 'die-hit-3.ogg'] } });
  return {
    load: p.load,
    fire() { p.sample('swish', { vol: 0.5, rate: 0.85 }); },
    boom() { p.sample('drop', { vol: 0.8, rate: 0.55 }); p.sample('shove', { vol: 0.5, rate: 0.6, when: 0.03 }); },
    brk(kind) { p.sample(kind === 'glass' ? 'pick' : 'hit', { vol: kind === 'glass' ? 0.4 : 0.35, rate: kind === 'stone' ? 0.6 : kind === 'glass' ? 1.6 : 0.9 }); },
    splash() { p.sample('slide', { vol: 0.5, rate: 0.7 }); },
    hurt() { p.sample('place', { vol: 0.45, rate: 0.7 }); },
    win() { p.sample('win', { vol: 0.7 }); },
    turn() { p.sample('shine', { vol: 0.3 }); },
    pop() { p.sample('pick', { vol: 0.35 }); },
    chat() { p.sample('pop', { vol: 0.25 }); },
    get muted() { return p.muted; }, toggle: p.toggle,
  };
})();

/* ================= state ================= */
let mode = null;              // 'bot' | 'couch' | 'host' | 'guest'
let session = 0, timers = [];
let room = null, conn = null, myK = null, roomCode = '';
let players = [];             // [{ k, name, avatar, look }]
let state = null;             // the settled match state
let W = null;                 // the live world while a shot plays out
let acc = 0, last = 0, running = false, pendingFinal = null, waitingFinal = false;
let aim = { a: { angle: 0.72, power: 0.78, weapon: 'rock' }, b: { angle: 0.72, power: 0.78, weapon: 'rock' } };
let theirAim = null, aimSendT = 0, stats = null;
const alive = (my) => () => my === session;
const later = (ms, fn) => timers.push(setTimeout(fn, ms));
const online = () => mode === 'host' || mode === 'guest';
const playerOf = (k) => players.find((p) => p.k === k);
const nameOf = (k) => (mode === 'couch' ? (k === 'a' ? 'Pink' : 'Blue') : mode === 'bot' && k === 'b' ? 'Bot Bonk' : k === myK ? 'You' : playerOf(k) ? firstName(playerOf(k).name) : 'Partner');
const myTurn = () => state && !state.over && !W && (mode === 'couch' || state.shooter === myK);

function show(s) {
  document.querySelectorAll('.screen').forEach((el) => el.classList.toggle('active', el.id === 'screen-' + s));
  document.body.classList.toggle('in-game', s === 'play');
  chat.setInGame(online() && (s === 'play' || s === 'end'));
}
function myLook() {
  const l = store.get(LOOK_KEY, null);
  if (l && (l.kind === 'human' || l.kind === 'critter')) return { ...l, critter: l.critter || myAvatar() };
  return { kind: 'critter', critter: myAvatar() };
}
function cleanLook(l, fallback) {
  if (!l || typeof l !== 'object') return { kind: 'critter', critter: fallback };
  const n = (v, max) => (Number.isInteger(v) && v >= 0 && v < max ? v : 0);
  if (l.kind === 'human') return { kind: 'human', style: String(l.style || '').slice(0, 20), skin: n(l.skin, 12), hair: n(l.hair, 20), top: n(l.top, 20), bottom: n(l.bottom, 20), acc: n(l.acc, 4) };
  return { kind: 'critter', critter: AVATARS.includes(l.critter) ? l.critter : fallback };
}
function validState(s) {
  return s && Array.isArray(s.terrain) && s.terrain.length === S.N && Array.isArray(s.blocks) && s.critters && s.critters.a && s.critters.b && (s.shooter === 'a' || s.shooter === 'b') && s.ammo && s.ammo.a && s.ammo.b;
}

/* ================= a match ================= */
async function begin(s) {
  state = s; W = null; pendingFinal = null; waitingFinal = false; theirAim = null;
  stats = { shots: { a: 0, b: 0 }, dmg: { a: 0, b: 0 }, breaks: { a: 0, b: 0 } };
  show('play');
  $('#du-loading').hidden = false;
  try { await loadView(); } catch (e) { $('#du-loading').hidden = true; goHome('The 3D part didn\'t load. Check your internet and try again 🙏'); return; }
  if (!DuelView.getStage()) await DuelView.init($('#view'));
  const looks = { a: (playerOf('a') || {}).look || myLook(), b: (playerOf('b') || {}).look || { kind: 'critter', critter: mode === 'bot' ? '🤖' : '🐼' } };
  await DuelView.build(state, looks, { a: nameOf('a'), b: nameOf('b') });
  $('#du-loading').hidden = true;
  running = true; last = performance.now(); acc = 0;
  renderHud(); renderWeapons();
  announceTurn();
  requestAnimationFrame(loop);
}

function loop(now) {
  if (!running) return;
  const dt = Math.max(0, Math.min(0.1, (now - last) / 1000)); last = now;
  if (W) {
    acc += dt;
    while (W && acc >= S.C.dt) {
      const going = S.step(W);
      acc -= S.C.dt;
      W.events.splice(0).forEach(onEvent);
      if (!going) { settled(); break; }
    }
  }
  const a = currentAim();
  DuelView.frame(W || state, dt, a);
  if (online() && myTurn() && now - aimSendT > 110) { aimSendT = now; const m = aim[myK]; send({ t: 'aim', turn: state.turn, a: +m.angle.toFixed(3), p: +m.power.toFixed(3), w: m.weapon }, true); }
  requestAnimationFrame(loop);
}
// What the view should draw as "being aimed": mine while it's my turn, theirs (live) while they aim.
function currentAim() {
  if (!state || state.over || W) return null;
  const k = state.shooter;
  if (mode === 'couch' || k === myK) return { seat: k, ...aim[k], show: true };
  if (theirAim) return { seat: k, angle: theirAim.a, power: theirAim.p, show: false };
  return null;
}

function fireNow(seat, weapon, angle, power, fromNet = false) {
  if (!state || state.over || W || state.shooter !== seat) return;
  if (state.ammo[seat][weapon] === 0) weapon = 'rock';
  W = S.build(state);
  try { S.fire(W, seat, weapon, angle, power); } catch (e) { W = null; return; }
  acc = 0; stats.shots[seat]++;
  if (online() && !fromNet) send({ t: 'shot', turn: state.turn, w: weapon, a: angle, p: power });
  renderWeapons(); renderHud();
  $('#du-turn').textContent = `${nameOf(seat)} fired ${S.WEAPONS[weapon].emoji}`;
}

function onEvent(e) {
  DuelView.event(e, W);
  const shooter = W ? W.state.shooter : state.shooter;
  if (e.t === 'fire') sfx.fire();
  else if (e.t === 'boom') sfx.boom();
  else if (e.t === 'break') { sfx.brk(e.kind); stats.breaks[shooter]++; }
  else if (e.t === 'splash') sfx.splash();
  else if (e.t === 'hurt') { sfx.hurt(); if (e.seat !== shooter) stats.dmg[shooter] += e.amount; renderHud(W.state); if (e.why === 'sea') toast(`${nameOf(e.seat)} fell in the sea! 🌊`, 2000); }
}

function settled() {
  const end = W.state; W = null;
  // Online, the shooter's result is the one both keep (it irons out any tiny difference between laptops).
  const shooterWas = end.turn === state.turn ? end.shooter : (end.shooter === 'a' ? 'b' : 'a');
  if (online()) {
    if (shooterWas === myK) { send({ t: 'final', turn: state.turn, s: end }); adopt(end); }
    else if (pendingFinal && pendingFinal.turn === state.turn) { const f = pendingFinal; pendingFinal = null; adopt(f.s); }
    else { waitingFinal = true; adopt(end, true); later(4000, () => { waitingFinal = false; }); }
  } else adopt(end);
}
function adopt(s, provisional = false) {
  state = s;
  renderHud(); renderWeapons();
  if (state.over) return gameOver();
  announceTurn(); // (a provisional result is replaced by the shooter's when it arrives)
}
function announceTurn() {
  if (!state || state.over) return;
  const k = state.shooter;
  const wind = state.wind, windTxt = Math.abs(wind) < 0.3 ? 'calm' : `${wind > 0 ? '→' : '←'} ${Math.abs(wind).toFixed(1)}`;
  $('#du-wind').innerHTML = `<b>Wind</b> <span class="${Math.abs(wind) < 0.3 ? 'calm' : ''}">${windTxt}</span>`;
  $('#du-wind').style.setProperty('--w', Math.min(1, Math.abs(wind) / S.C.maxWind));
  if (mode === 'couch') banner(`${nameOf(k)}'s shot`, 'Drag back from anywhere and let go', 1400);
  else if (k === myK) { banner('Your shot!', 'Drag back and let go · or ←/→ ↑/↓ and Space', 1500); sfx.turn(); }
  else $('#du-turn').textContent = `${nameOf(k)} is aiming…`;
  if (k === myK || mode === 'couch') $('#du-turn').textContent = mode === 'couch' ? `${nameOf(k)}: your shot` : 'Your shot';
  renderWeapons();
  if (mode === 'bot' && k === 'b') later(1100, botTurn);
}
function botTurn() {
  if (!state || state.over || W || state.shooter !== 'b') return;
  const shot = S.botShot(state, 'b', { tries: 22, error: 0.06 });
  // show the bot "aiming" for a moment
  aim.b = { angle: shot.angle, power: shot.power, weapon: shot.weapon };
  later(500, () => fireNow('b', shot.weapon, shot.angle, shot.power));
}

/* ================= aiming ================= */
let drag = null;
const canvasEl = () => $('#view');
function onDown(e) {
  if (!myTurn() || e.button > 0) return;
  drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
  canvasEl().setPointerCapture?.(e.pointerId);
}
function onMove(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const k = state.shooter, dx = (drag.x - e.clientX) * (k === 'a' ? 1 : -1), dy = e.clientY - drag.y;
  const len = Math.hypot(dx, dy);
  if (len < 6) return;
  const scale = Math.min(innerWidth, innerHeight) * 0.32;
  aim[k].angle = Math.max(-0.15, Math.min(1.45, Math.atan2(dy, Math.max(0.01, dx))));
  aim[k].power = Math.max(0.1, Math.min(1, len / scale));
  renderAimReadout();
}
function onUp(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const moved = Math.hypot(e.clientX - drag.x, e.clientY - drag.y);
  drag = null;
  if (moved > 14 && myTurn()) fireMine();
}
function fireMine() { const k = state.shooter, a = aim[k]; fireNow(k, a.weapon, a.angle, a.power); }
function renderAimReadout() {
  if (!state) return;
  const a = aim[state.shooter];
  $('#du-aim').textContent = `${Math.round((a.angle * 180) / Math.PI)}° · ${Math.round(a.power * 100)}%`;
}
addEventListener('keydown', (e) => {
  if (!running || chat.typing(e)) return;
  const k = e.key.toLowerCase();
  if (online() && !e.repeat && /^[6-9]$/.test(k)) chat.sticker(['nice', 'ouch', 'lucky', 'mine'][+k - 6]);
  if (!myTurn()) return;
  const a = aim[state.shooter];
  if (k === 'arrowleft' || k === 'a') { a.angle = Math.min(1.45, a.angle + 0.02); e.preventDefault(); }
  else if (k === 'arrowright' || k === 'd') { a.angle = Math.max(-0.15, a.angle - 0.02); e.preventDefault(); }
  else if (k === 'arrowup' || k === 'w') { a.power = Math.min(1, a.power + 0.015); e.preventDefault(); }
  else if (k === 'arrowdown' || k === 's') { a.power = Math.max(0.1, a.power - 0.015); e.preventDefault(); }
  else if (k === ' ' || k === 'enter') { if (!e.repeat) fireMine(); e.preventDefault(); }
  else if (/^[1-5]$/.test(k)) pickWeapon(Object.keys(S.WEAPONS)[+k - 1]);
  if (state.shooter === 'b' && (k === 'arrowleft' || k === 'arrowright')) { /* the right island aims the other way: same keys, mirrored meaning is fine */ }
  renderAimReadout();
});

/* ================= HUD ================= */
function renderHud(st = state) {
  if (!st) return;
  $('#du-players').innerHTML = ['a', 'b'].map((k) => {
    const p = playerOf(k), av = p ? p.avatar : k === 'a' ? myAvatar() : mode === 'bot' ? '🤖' : '🐼', hp = Math.max(0, st.critters[k].hp);
    return `<div class="du-p${st.shooter === k && !st.over ? ' on' : ''}" style="--c:${SEAT_COLORS[k]}"><span class="av">${avHTML(av)}</span><div><b>${escapeHtml(nameOf(k))}</b><i><em style="width:${hp}%"></em></i></div><span class="hp">${hp}</span></div>`;
  }).join('<span class="du-vs">vs</span>');
}
function renderWeapons() {
  if (!state) return;
  const k = mode === 'couch' ? state.shooter : myK, mine = myTurn();
  const sel = aim[k] ? aim[k].weapon : 'rock';
  $('#du-weapons').innerHTML = Object.entries(S.WEAPONS).map(([id, w], i) => {
    const left = state.ammo[k] ? state.ammo[k][id] : 0, out = left === 0;
    return `<button type="button" class="du-w${sel === id ? ' on' : ''}" data-w="${id}" ${out || !mine ? 'disabled' : ''} title="${w.name} (${i + 1})"><span>${w.emoji}</span><b>${w.name}</b><small>${left < 0 ? '∞' : '×' + left}</small></button>`;
  }).join('');
  $('#du-fire').disabled = !mine;
  $('#du-dock').classList.toggle('waiting', !mine);
  renderAimReadout();
}
function pickWeapon(id) {
  if (!myTurn() || !S.WEAPONS[id]) return;
  const k = state.shooter;
  if (state.ammo[k][id] === 0) return toast('None left of that one 🙃');
  aim[k].weapon = id; sfx.pop(); renderWeapons();
}
function banner(title, sub, ms) {
  const el = $('#du-banner');
  el.innerHTML = `<b>${escapeHtml(title)}</b>${sub ? `<small>${escapeHtml(sub)}</small>` : ''}`;
  el.hidden = false; retrigger(el, 'pop');
  if (ms) later(ms, () => (el.hidden = true));
}

/* ================= the end ================= */
function gameOver() {
  const w = state.winner;
  if (w) { sfx.win(); bigConfetti(); }
  banner(w ? `${nameOf(w)} ${nameOf(w) === 'You' ? 'win' : 'wins'}! 🏆` : 'A draw!', w ? '' : 'Both critters went down together', 0);
  later(2600, showEnd);
}
function showEnd() {
  running = false;
  show('end');
  $('#du-banner').hidden = true;
  const w = state.winner;
  $('#end-title').textContent = !w ? 'A draw! 🌊' : mode === 'couch' ? `${nameOf(w)} wins! 🏆` : w === myK ? 'You won! 🏆' : `${nameOf(w)} won 🏝️`;
  $('#results').innerHTML = ['a', 'b'].map((k) => {
    const p = playerOf(k), av = p ? p.avatar : k === 'a' ? myAvatar() : mode === 'bot' ? '🤖' : '🐼';
    return `<div class="du-res" style="--c:${SEAT_COLORS[k]}"><span class="av">${avHTML(av)}</span><div><b>${escapeHtml(nameOf(k))}${w === k ? ' 👑' : ''}</b><small>${stats.shots[k]} shots · ${stats.dmg[k]} damage · ${stats.breaks[k]} blocks smashed</small></div><span class="du-hpleft">${Math.max(0, state.critters[k].hp)} ❤</span></div>`;
  }).join('');
  $('#btn-again').hidden = mode === 'guest';
  $('#end-wait').hidden = mode !== 'guest';
  $('#end-wait').textContent = 'Waiting for the host to start a rematch…';
}

/* ================= starting matches ================= */
function freshState() {
  const s = S.newMatch(SR_RNG.seed31());
  s.shooter = SR_RNG.int(2) ? 'a' : 'b'; // fair: a random first shot
  return s;
}
function practice() {
  teardown(); mode = 'bot'; myK = 'a';
  players = [{ k: 'a', name: me.name, avatar: myAvatar(), look: myLook() }, { k: 'b', name: 'Bot Bonk', avatar: '🤖', look: { kind: 'critter', critter: '🤖' } }];
  begin(freshState());
}
function couch() {
  teardown(); mode = 'couch'; myK = 'a';
  players = [{ k: 'a', name: 'Pink', avatar: myAvatar(), look: myLook() }, { k: 'b', name: 'Blue', avatar: '🐼', look: { kind: 'critter', critter: '🐼' } }];
  begin(freshState());
}

/* ================= online ================= */
function teardown() {
  session++;
  running = false; W = null; drag = null;
  timers.forEach(clearTimeout); timers = [];
  const oldRoom = room, oldConn = conn;
  room = null; conn = null;
  if (oldConn) { try { oldConn.close(); } catch (e) {} }
  if (oldRoom) oldRoom.seats.forEach((s) => { try { s.link && s.link.close(); } catch (e) {} });
  if (typeof closeAllClients === 'function') closeAllClients();
  mode = null; myK = null; players = []; state = null;
  chat.reset();
}
function goHome(error = '') { teardown(); show('home'); renderHomeBits(); $('#home-error').textContent = error; }
function leaveToHome() { store.del('duel-lastroom'); goHome(); }
function renderHomeBits() {
  if (me) $('#me-avatar').innerHTML = avHTML(myAvatar());
  const last = store.get('duel-lastroom', null), fresh = last && Date.now() - last.at < 3 * 3600e3;
  $('#btn-resume').hidden = !fresh;
  if (fresh) $('#resume-code').textContent = last.code;
}
const rememberRoom = (code) => code && store.set('duel-lastroom', { code, at: Date.now() });
function send(m, fast = false) {
  const go = (l) => l && l.open && (fast ? l.sendFast(m) : l.send(m));
  if (mode === 'host') { if (room) room.seats.forEach((s) => go(s.link)); }
  else if (mode === 'guest') go(conn);
}
function onNet(d, fromK) {
  if (!d || !state) return;
  const theirs = myK === 'a' ? 'b' : 'a';
  if (d.t === 'aim' && d.turn === state.turn && state.shooter === theirs && !W) {
    if ([d.a, d.p].every(Number.isFinite)) theirAim = { a: d.a, p: d.p, w: S.WEAPONS[d.w] ? d.w : 'rock' };
  } else if (d.t === 'shot' && d.turn === state.turn && state.shooter === theirs && !W) {
    if (![d.a, d.p].every(Number.isFinite) || !S.WEAPONS[d.w]) return;
    theirAim = null;
    fireNow(theirs, d.w, Math.max(-0.2, Math.min(1.5, d.a)), Math.max(0, Math.min(1, d.p)), true);
  } else if (d.t === 'final' && validState(d.s)) {
    if (W) { if (d.turn === state.turn) pendingFinal = { turn: d.turn, s: d.s }; return; }
    // our own replay already finished (we kept it provisionally): swap in the shooter's exact result
    if (waitingFinal || d.s.turn >= state.turn) { waitingFinal = false; state = d.s; renderHud(); renderWeapons(); if (state.over && !document.querySelector('#screen-end.active')) gameOver(); }
  }
}

function roomPayload() { return { t: 'room', code: room.code, host: me.name, seats: room.seats.map((s) => ({ name: s.name, avatar: s.avatar })) }; }
function sendRoom() { const p = roomPayload(); room.seats.forEach((s) => s.link && s.link.open && s.link.send(p)); renderRoom(p); }
function renderRoom(p) {
  const amHost = mode === 'host', n = p.seats.length;
  $('#room-title').textContent = amHost ? 'Your room' : `${firstName(p.host)}'s room`;
  $('#code-hint').textContent = amHost ? 'Send this code to your partner' : 'Room code';
  $('#room-code').textContent = p.code;
  $('#seats').innerHTML = ['a', 'b'].map((k, i) => {
    const s = p.seats[i];
    return s ? `<div class="seat" style="--c:${SEAT_COLORS[k]}"><span class="av">${avHTML(s.avatar)}</span><span class="nm">${escapeHtml(s.name)}${s.name === me.name ? ' (you)' : ''}</span><span class="st">${i === 0 ? 'Left island · host' : `${ic('check')}Right island`}</span></div>`
      : '<div class="seat empty"><span class="av"></span><span class="nm">Waiting for your partner</span></div>';
  }).join('');
  $('#btn-start').hidden = !amHost; $('#btn-start').disabled = n < 2;
  const wait = $('#room-wait'); wait.hidden = amHost && n >= 2;
  wait.innerHTML = amHost ? `${GAME_NAME} needs two. Waiting for your partner<span class="dots"><i>.</i><i>.</i><i>.</i></span>` : `Waiting for ${escapeHtml(firstName(p.host))} to start<span class="dots"><i>.</i><i>.</i><i>.</i></span>`;
}
const seatPlayers = () => room.seats.map((s) => ({ k: s.k, name: s.name, avatar: s.avatar, look: s.look }));
function startMatch() {
  if (!room) return;
  if (!room.seats.every((s) => s.k === myK || (s.link && s.link.open)) || room.seats.length < 2) return toast(`${GAME_NAME} needs two players 🙂`);
  room.started = true; rememberRoom(room.code);
  players = seatPlayers();
  const s = freshState();
  send({ t: 'go', players, s });
  begin(s);
}
async function createRoom() {
  if (typeof mqtt === 'undefined') return goHome('Could not load the online library. Check your internet 🙏');
  teardown();
  const my = session;
  mode = 'host'; myK = 'a';
  room = { code: genCode('I'), seats: [{ k: 'a', name: me.name, avatar: myAvatar(), look: myLook() }], started: false };
  roomCode = room.code;
  renderRoom(roomPayload()); show('room');
  if (!(await hostListen({ code: room.code, ns: NS, epoch: 0, alive: alive(my), onLink: handlePlayer })) && my === session) goHome('Could not reach the game server. Check your internet and try again!');
}
function handlePlayer(c) {
  let st = 'new', seat = null;
  const timer = setTimeout(() => { if (st !== 'ok') c.drop(); }, 8000);
  c.on('data', async (d) => {
    if (st === 'checking' || st === 'dead' || !room) return;
    if (st === 'new') {
      st = 'checking';
      const name = d && d.t === 'hello' ? await checkProof(d.user, d.proof) : null;
      const reject = (why) => { st = 'dead'; c.send({ t: 'reject', why }); setTimeout(() => c.drop(), 400); };
      if (!room) return;
      if (!name) return reject('That login didn\'t work 🚫');
      if (name === me.name) return reject('You\'re already in this room on another device 🙂');
      seat = room.seats.find((s) => s.name === name);
      if (!seat) { if (room.seats.length >= 2) return reject(`${GAME_NAME} is for two. This room is full 🙅`); seat = { k: 'b', name }; room.seats.push(seat); }
      const old = seat.link; seat.link = c; if (old && old !== c) old.drop();
      seat.avatar = AVATARS.includes(d.avatar) ? d.avatar : seat.avatar || '🙂';
      seat.look = cleanLook(d.look, seat.avatar);
      st = 'ok'; clearTimeout(timer); sfx.pop();
      if (room.started && state) { players = seatPlayers(); c.send({ t: 'go', players, s: state }); toast(`${firstName(name)} is back 👋`); }
      else { sendRoom(); toast(`${firstName(name)} joined 🎉`); }
      return;
    }
    if (st !== 'ok' || seat.link !== c || !d) return;
    if (d.t === 'social') { if (d.m && typeof d.m === 'object') chat.receive({ ...d.m, from: seat.k }); return; }
    onNet(d, seat.k);
  });
  c.on('close', () => {
    if (!room || !seat || seat.link !== c) return;
    seat.link = null;
    if (!room.started) { room.seats.splice(room.seats.indexOf(seat), 1); sendRoom(); return; }
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
  $('#seats').innerHTML = ''; $('#btn-start').hidden = true;
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
        else if (d.t === 'go' && Array.isArray(d.players) && validState(d.s)) {
          clearTimeout(giveUp);
          players = d.players.slice(0, 2).map((p) => { const av = AVATARS.includes(p.avatar) ? p.avatar : '🙂'; return { k: p.k === 'a' ? 'a' : 'b', name: String(p.name), avatar: av, look: cleanLook(p.look, av) }; });
          const mine = players.find((p) => p.name === me.name); myK = mine ? mine.k : 'b';
          rememberRoom(code);
          begin(d.s);
        }
        else if (d.t === 'social' && d.m) chat.receive(d.m);
        else if (d.t === 'reject') { clearTimeout(giveUp); goHome(String(d.why || 'Could not join')); }
        else onNet(d, myK === 'a' ? 'b' : 'a');
      });
      link.on('close', () => { if (mode === 'guest' && conn === link) { goHome(document.querySelector('#screen-end.active') ? '' : 'The host left. Tap Join to hop back in if they come back!'); $('#join-code').value = code; } });
    },
  });
}

/* ---------- chat ---------- */
const chat = createChat({
  send: (m) => send({ t: 'social', m }),
  game: null, room: () => roomCode || null, // not saved yet: the database needs the 'duel' kind first (ask before adding it)
  players: () => (online() ? players.map((p) => ({ k: p.k, name: p.name, color: SEAT_COLORS[p.k], avatar: p.avatar })) : []),
  me: () => myK,
  stage: () => $('#stage'),
  stickers: { nice: ['NICE SHOT 🎯', '#2bc48a'], ouch: ['OUCH 😭', '#ff9ad0'], lucky: ['LUCKY. 🙄', '#ffc233'], mine: ['My island now 🏝️', '#3f9bff'] },
  dockAt: 0,
  sound: (kind) => (kind === 'in' ? sfx.chat() : sfx.pop()),
});

/* ================= wiring ================= */
$('#btn-practice').onclick = () => { sfx.pop(); practice(); };
$('#btn-couch').onclick = () => { sfx.pop(); couch(); };
$('#btn-create').onclick = () => { sfx.pop(); createRoom(); };
$('#btn-join').onclick = () => { sfx.pop(); joinRoom($('#join-code').value); };
$('#join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(e.target.value); });
$('#btn-resume').onclick = () => { const last = store.get('duel-lastroom', null); if (last) joinRoom(last.code); };
$('#btn-room-back').onclick = leaveToHome;
$('#btn-start').onclick = () => { sfx.pop(); startMatch(); };
$('#btn-leave').onclick = () => { if (mode !== 'host' && mode !== 'guest' || confirm('Leave the duel?')) leaveToHome(); };
$('#btn-end-home').onclick = leaveToHome;
$('#btn-again').onclick = () => { sfx.pop(); if (mode === 'bot') practice(); else if (mode === 'couch') couch(); else if (mode === 'host') startMatch(); };
$('#btn-mute').onclick = (e) => setIcon(e.currentTarget, sfx.toggle() ? 'mute' : 'volume');
$('#btn-help').onclick = () => howTo(true);
$('#du-fire').onclick = () => { if (myTurn()) fireMine(); };
$('#du-weapons').addEventListener('click', (e) => { const b = e.target.closest('.du-w'); if (b) pickWeapon(b.dataset.w); });
$('#btn-share').onclick = async () => {
  const code = $('#room-code').textContent, link = `${location.origin}${location.pathname}?room=${code}`;
  if (navigator.share) { try { await navigator.share({ title: GAME_NAME, text: `Bring your slingshot. Room ${code}`, url: link }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(link); toast('Invite link copied 💌'); } catch (e) { prompt('Copy this link:', link); }
};
canvasEl().addEventListener('pointerdown', onDown);
addEventListener('pointermove', onMove);
addEventListener('pointerup', onUp);
addEventListener('pointercancel', () => { drag = null; });
document.addEventListener('focusin', (e) => { const s = window.DuelView && DuelView.getStage(); if (s && /INPUT|TEXTAREA/.test(e.target.tagName)) s.throttle(30); });
document.addEventListener('focusout', () => { const s = window.DuelView && DuelView.getStage(); if (s) s.throttle(0); });
addEventListener('pagehide', () => { if (mode) teardown(); if (window.DuelView) DuelView.dispose(); });
document.addEventListener('profilechange', renderHomeBits);

function howTo(force = false) {
  if (typeof showHowTo !== 'function') return;
  showHowTo('duel', [
    { icon: '🎯', title: 'Pull and let go', text: 'On your turn, drag backwards anywhere on the screen and let go. The dots show the start of the flight; the wind does the rest.' },
    { icon: '💣', title: 'Five shots', text: 'Rocks never run out. Bombs blow craters, Splitters burst into three, Bouncers bounce then pop, the Anvil flattens towers. Keys 1–5 pick one.' },
    { icon: '🏝️', title: 'Knock them out', text: 'Hit their critter, drop their fort on them, or knock them into the sea. First to zero hearts loses.' },
    { icon: '⌨️', title: 'Keys', text: '←/→ angle · ↑/↓ power · Space fire · 6–9 trash-talk stickers · hold V to talk.' },
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
