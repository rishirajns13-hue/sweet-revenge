'use strict';
/* Sugar Rush: a top-down candy kart race. Lag-proof by design: every browser drives its OWN kart
   locally at 60 Hz and sends where it is ~12 times a second. Other karts are drawn smoothly between
   their last two snapshots. The host runs the bots, the item boxes, who got hit by what, the
   finishing order and the results, and tells everyone. Your own driving never waits for the network.
   Physics and rules live in race/physics.js (shared with the tests). */
const P = window.RacePhysics;
const NS = 'race-rr7';
const TRACK = P.makeTrack();
const SEAT_COLORS = ['#ff5a5f', '#4d9de0', '#2bc48a', '#ffc233'];
const BOT_NAMES = ['Gummy Gus', 'Taffy Tess', 'Fudge Pudge'];
const BOT_AVATARS = ['🐻', '🦩', '🐷'];
const ITEM_ICON = { freeze: '🍦', splat: '🍬', boost: '✨' };
const ITEM_NAME = { freeze: 'Brain Freeze', splat: 'Jelly Splat', boost: 'Sprinkle Boost' };
const SEND_MS = 83; // ~12 snapshots a second
const STEP = 1 / 60;
const LINES = {
  freeze: ['Brain freeze! {n} can\'t feel their face 🥶', '{b} gave {n} a brain freeze 🍦', 'Cold one for {n} 🥶'],
  splat: ['Splat! Sticky situation for {n} 🍬', '{n} is stuck in jelly 🍬', 'Jelly time for {n} 🍬'],
  wasted: ['Nobody ahead to freeze. You\'re leading 😎'],
  finish: ['{n} crossed the line! 🏁'],
};
const oneOf = (a) => a[Math.floor(Math.random() * a.length)];
const line = (k, o = {}) => oneOf(LINES[k]).replace('{n}', o.n || '').replace('{b}', o.b || '');
const firstName = (name) => String(name).split(' ').pop();
const avHTML = (a) => (typeof avatarHTML === 'function' ? avatarHTML(a) : escapeHtml(a));
const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10] || 'th');
const fmtTime = (ms) => (ms == null ? '--:--' : `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(Math.floor(ms / 10) % 100).padStart(2, '0')}`);
const coarse = matchMedia('(pointer: coarse)').matches;

/* ================= sounds (real recorded clips only) ================= */
const sfx = (() => {
  const p = createSamplePlayer({ takes: { pop: ['ui-pop-1.ogg', 'ui-pop-2.ogg'], pick: ['ui-pick.ogg'], drop: ['ui-drop-1.ogg', 'ui-drop-2.ogg'], shine: ['ui-shine.ogg'], win: ['ui-levelup.ogg'], trophy: ['ui-trophy.ogg'], slide: ['card-slide-1.ogg', 'card-slide-2.ogg'] } });
  const s = p.sample;
  return {
    load: p.load,
    pop() { s('pop', { vol: 0.4 }); },
    tick() { s('pop', { vol: 0.5, rate: 0.9 }); },
    go() { s('shine', { vol: 0.6 }); },
    pick() { s('pick', { vol: 0.55 }); },
    use() { s('slide', { vol: 0.5 }); },
    boost() { s('shine', { vol: 0.45, rate: 1.2 }); },
    hit() { s('drop', { vol: 0.6 }); },
    bump() { s('drop', { vol: 0.25, rate: 1.3 }); },
    lap() { s('pick', { vol: 0.5, rate: 1.2 }); },
    win() { s('win', { vol: 0.6 }); },
    trophy() { s('trophy', { vol: 0.55 }); },
    chat() { s('pop', { vol: 0.3, rate: 1.2 }); },
    get muted() { return p.muted; },
    toggle: p.toggle,
  };
})();

/* ================= app state ================= */
let mode = null;      // 'host' | 'guest' | 'cpu'
let session = 0;
let room = null;      // host: { code, seats: [{ k, name, avatar, bot, link }], started }
let conn = null;      // guest: link to host
let myK = null, hostK = null, roomCode = '';
let race = null;      // the race on this screen (see newRace)
let H = null;         // host-only race bookkeeping
const alive = (my) => () => my === session;
const isHost = () => mode === 'host' || mode === 'cpu';

function show(screen) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === 'screen-' + screen));
  document.body.classList.toggle('in-game', screen === 'play');
  chat.setInGame(screen === 'play' || screen === 'end');
  if (screen === 'play') resize();
}
function teardown() {
  session++;
  const oldRoom = room, oldConn = conn;
  room = null; conn = null;
  if (oldConn) { try { oldConn.close(); } catch (e) {} }
  if (oldRoom) oldRoom.seats.forEach((s) => { try { s.link && s.link.close(); } catch (e) {} });
  closeAllClients();
  mode = null; race = null; H = null; myK = null; hostK = null;
  chat.reset();
}
function goHome(error = '') {
  teardown();
  show('home');
  renderHomeBits();
  $('#home-error').textContent = error;
}
function renderHomeBits() { if (me) $('#me-avatar').innerHTML = avHTML(myAvatar()); }

/* ================= room screen ================= */
function roomPayload() {
  return { t: 'room', code: room.code, host: me.name, started: room.started, seats: room.seats.map((s) => ({ name: s.name, avatar: s.avatar, bot: !!s.bot })) };
}
function sendRoom() {
  const p = roomPayload();
  room.seats.forEach((s) => s.link && s.link.open && s.link.send(p));
  renderRoom(p);
}
function renderRoom(p) {
  const amHost = isHost(), n = p.seats.length;
  $('#room-title').textContent = amHost ? 'Your room' : `${firstName(p.host)}'s room`;
  $('#code-hint').textContent = amHost ? 'Send this code to your friends' : 'Room code';
  $('#room-code').textContent = p.code;
  let html = '';
  for (let i = 0; i < 4; i++) {
    const s = p.seats[i];
    if (s) {
      const right = s.bot && amHost
        ? `<button class="rm" type="button" data-rmbot="${i}" aria-label="Remove ${escapeHtml(s.name)}">${ic('x')}</button>`
        : `<span class="st">${i === 0 ? 'Host' : s.bot ? `${ic('bot')}Bot` : `${ic('check')}Joined`}</span>`;
      html += `<div class="seat" style="--c:${SEAT_COLORS[i]}"><span class="av">${avHTML(s.avatar)}</span><span class="nm">${escapeHtml(s.name)}${s.name === me.name && !s.bot ? ' (you)' : ''}</span>${right}</div>`;
    } else if (amHost && i === n) {
      html += `<button class="seat empty" type="button" data-addbot><span class="av">${ic('plus')}</span><span class="nm">Add a bot</span><span class="st">or wait for a friend</span></button>`;
    } else html += '<div class="seat empty"><span class="av"></span><span class="nm">Open seat</span></div>';
  }
  $('#seats').innerHTML = html;
  $('#btn-start').hidden = !amHost;
  $('#btn-start').disabled = n < 2;
  const wait = $('#room-wait');
  wait.hidden = amHost && n >= 2;
  wait.innerHTML = amHost ? 'Waiting for a friend (or add a bot)<span class="dots"><i>.</i><i>.</i><i>.</i></span>'
    : `${p.started ? 'Race in progress. You\'re in the next one' : `Waiting for ${escapeHtml(firstName(p.host))} to start`}<span class="dots"><i>.</i><i>.</i><i>.</i></span>`;
}
$('#seats').addEventListener('click', (e) => {
  if (!isHost() || !room || room.started) return;
  const add = e.target.closest('[data-addbot]'), rm = e.target.closest('[data-rmbot]');
  if (add && room.seats.length < 4) {
    const used = room.seats.map((s) => s.name), i = BOT_NAMES.findIndex((b) => !used.includes(b));
    room.seats.push({ k: freeKey(), name: BOT_NAMES[i], avatar: BOT_AVATARS[i], bot: true });
  } else if (rm) {
    const s = room.seats[+rm.dataset.rmbot];
    if (s && s.bot) room.seats.splice(room.seats.indexOf(s), 1);
  } else return;
  sfx.pop();
  sendRoom();
});
const freeKey = () => 'abcd'.split('').find((x) => !room.seats.some((s) => s.k === x));
const seatOf = (k) => room && room.seats.find((s) => s.k === k);
const connected = (k) => k === myK || !!(seatOf(k) && (seatOf(k).bot || (seatOf(k).link && seatOf(k).link.open)));

/* ================= the race (everyone) ================= */
// players: [{ k, name, avatar, bot, color, slot }]
function newRace(info) {
  const r = {
    gid: info.gid, at: info.at, players: info.players,
    karts: {},       // karts this browser simulates: its own, plus bots on the host
    remote: {},      // k -> { prev, last } snapshots of karts driven elsewhere
    items: {}, boxesOff: [], puddles: [],
    phase: 'countdown', goAt: performance.now() + 3000, t: 0, acc: 0, lastSend: 0, lastFrame: performance.now(),
    countShown: null, lapShown: 0, done: false, results: null, cam: null,
  };
  info.players.forEach((p) => {
    if (p.k === myK || (isHost() && p.bot)) {
      const k = P.newKart(TRACK, p.slot);
      if (p.bot) k.skill = 0.82 + Math.random() * 0.12;
      r.karts[p.k] = k;
    }
  });
  return r;
}
const playerOf = (k) => race && race.players.find((p) => p.k === k);
const nameOf = (k) => (k === myK ? 'you' : playerOf(k) ? firstName(playerOf(k).name) : '?');
const colorOf = (k) => (playerOf(k) || {}).color || '#fff';

// What this browser knows about every kart right now (own/bot karts live, others from snapshots).
function kartInfo(k) {
  if (race.karts[k]) return race.karts[k];
  const r = race.remote[k];
  return r ? r.last : null;
}
function currentOrder() {
  const list = race.players.map((p) => { const i = kartInfo(p.k); return i ? { k: p.k, prog: i.prog, done: !!i.done, time: i.time || 0 } : { k: p.k, prog: -1e9, done: false, time: 0 }; });
  return P.raceOrder(list);
}

function enterRace(info) {
  race = newRace(info);
  if (isHost()) {
    H = { stats: {}, hits: [], finish: [], firstDoneAt: 0, botItemAt: {}, puddleId: 0, ended: false };
    info.players.forEach((p) => { H.stats[p.k] = { best: null, total: null, used: 0, freezes: 0, splats: 0, frozen: 0, splatted: 0, place: null }; });
  }
  $('#room-chip').textContent = mode === 'cpu' ? 'Practice' : roomCode;
  renderItem();
  $('#ticker').textContent = '';
  show('play');
  sfx.tick();
}

/* ---------- input ---------- */
const keys = {};
const touch = { left: false, right: false };
function myInput() {
  return {
    left: keys.arrowleft || keys.a || touch.left,
    right: keys.arrowright || keys.d || touch.right,
    gas: keys.arrowup || keys.w || (coarse && !keys.arrowdown && !keys.s),
    brake: keys.arrowdown || keys.s,
  };
}

/* ---------- the loop: fixed 60 Hz physics, draw every frame ---------- */
function frame(now) {
  requestAnimationFrame(frame);
  if (!race || !document.querySelector('#screen-play.active')) return;
  const dt = Math.min(0.25, (now - race.lastFrame) / 1000);
  race.lastFrame = now;
  if (race.phase === 'countdown') {
    const left = Math.ceil((race.goAt - now) / 1000);
    if (left !== race.countShown) {
      race.countShown = left;
      showCount(left > 0 ? String(left) : 'GO!');
      if (left > 0) sfx.tick(); else sfx.go();
    }
    if (now >= race.goAt) race.phase = 'race';
  } else if (race.phase === 'race') {
    race.acc += dt;
    while (race.acc >= STEP) { race.acc -= STEP; tick(); }
    if (now - race.lastSend > SEND_MS) { race.lastSend = now; sendSnapshots(); }
  }
  draw(now);
  hud(now);
}
function tick() {
  race.t += STEP;
  const mine = race.karts[myK];
  if (mine) {
    const lapBefore = mine.lap, bumpBefore = mine.bump;
    P.step(TRACK, mine, myInput(), STEP, race.t);
    if (mine.bump > bumpBefore && mine.v > 60) sfx.bump();
    if (mine.lap !== lapBefore && mine.lap > 1) {
      if (mine.done) { sfx.win(); say(`Finished! ${fmtTime(mine.time * 1000)} 🏁`); }
      else { sfx.lap(); say(mine.lap === P.LAPS ? 'Final lap! 🍭' : `Lap ${mine.lap} of ${P.LAPS}`); }
    }
    // Puddles: I check my own kart, so a splat never waits for the network.
    race.puddles.forEach((pz) => {
      if (pz.gone || (pz.by === myK && race.t - pz.bornT < 1.2) || !P.touches(mine, pz, P.PUDDLE_R)) return;
      pz.gone = true;
      P.applyEffect(mine, 'splat');
      if (isHost()) hostSplat(myK, pz.id); else send({ t: 'hitme', id: pz.id });
    });
  }
  if (isHost()) hostTick();
}

/* ---------- networking: snapshots ---------- */
const snap = (k) => [Math.round(k.x), Math.round(k.y), +k.a.toFixed(3), Math.round(k.v), k.lap, Math.round(k.prog), k.done ? 1 : 0,
  Math.round((k.time || 0) * 1000), k.laps.length ? Math.round(Math.min(...k.laps) * 1000) : 0, k.boostT ? 3 : k.slowKind === 'freeze' ? 1 : k.slowKind === 'splat' ? 2 : 0];
function unsnap(a) {
  return { x: +a[0], y: +a[1], a: +a[2], v: +a[3], lap: +a[4], prog: +a[5], done: !!a[6], time: a[7] / 1000, best: a[8] || null, fx: a[9] | 0 };
}
function takeSnap(k, arr) {
  if (!race || !Array.isArray(arr) || arr.length < 10 || k === myK || race.karts[k]) return;
  const s = unsnap(arr);
  if (!isFinite(s.x) || !isFinite(s.y)) return;
  s.at = performance.now();
  const r = race.remote[k] || (race.remote[k] = { prev: s, last: s });
  r.prev = r.last; r.last = s;
}
function sendSnapshots() {
  if (mode === 'guest') {
    if (race.karts[myK]) send({ t: 'k', gid: race.gid, s: snap(race.karts[myK]) });
  } else if (mode === 'host') {
    const ks = {};
    race.players.forEach((p) => {
      if (race.karts[p.k]) ks[p.k] = snap(race.karts[p.k]);
      else if (race.remote[p.k]) { const l = race.remote[p.k].last; ks[p.k] = [l.x, l.y, l.a, l.v, l.lap, l.prog, l.done ? 1 : 0, Math.round(l.time * 1000), l.best || 0, l.fx]; }
    });
    broadcast({ t: 'w', gid: race.gid, ks, items: race.items, off: race.boxesOff.map((b) => b.id), pz: race.puddles.filter((p) => !p.gone).map((p) => [p.id, Math.round(p.x), Math.round(p.y), p.by]) });
  }
}
function send(m) { if (conn && conn.open) conn.send(m); }
function broadcast(m, except) { if (room) room.seats.forEach((s) => s.link && s.link.open && s.link !== except && s.link.send(m)); }

/* ---------- host: bots, boxes, items, finishing ---------- */
function hostTick() {
  const nowT = race.t;
  // Bots drive (and lift off a little now and then, so they're beatable).
  race.players.forEach((p) => {
    if (!p.bot) return;
    const k = race.karts[p.k];
    const inp = P.botInput(TRACK, k, Math.random, k.skill);
    if (Math.random() > k.skill + 0.05) inp.gas = false;
    P.step(TRACK, k, inp, STEP, race.t);
    race.puddles.forEach((pz) => {
      if (pz.gone || (pz.by === p.k && nowT - pz.bornT < 1.2) || !P.touches(k, pz, P.PUDDLE_R)) return;
      pz.gone = true;
      P.applyEffect(k, 'splat');
      hostSplat(p.k, pz.id);
    });
    if (race.items[p.k]) {
      if (!H.botItemAt[p.k]) H.botItemAt[p.k] = nowT + 1 + Math.random() * 3;
      else if (nowT > H.botItemAt[p.k]) { H.botItemAt[p.k] = 0; hostUse(p.k); }
    }
  });
  // Item boxes come back a few seconds after being taken.
  race.boxesOff = race.boxesOff.filter((b) => b.until > nowT);
  const order = currentOrder();
  race.players.forEach((p) => {
    const k = kartInfo(p.k);
    if (!k || k.done || race.items[p.k]) return;
    const box = TRACK.boxes.find((b) => !race.boxesOff.some((o) => o.id === b.id) && P.touches(k, b, P.BOX_R + 6));
    if (!box) return;
    race.boxesOff.push({ id: box.id, until: nowT + 3 });
    const place = order.findIndex((o) => o.k === p.k) + 1;
    race.items[p.k] = P.rollItem(place, order.length);
    if (p.k === myK) { sfx.pick(); renderItem(); }
    else { const s = seatOf(p.k); if (s && s.link && s.link.open) s.link.send({ t: 'item', item: race.items[p.k] }); }
  });
  race.puddles = race.puddles.filter((pz) => !pz.gone && nowT - pz.bornT < 25);
  // Finishing order and the end of the race.
  race.players.forEach((p) => {
    const k = kartInfo(p.k);
    if (!k || !k.done || H.finish.includes(p.k)) return;
    H.finish.push(p.k);
    const st = H.stats[p.k];
    st.total = Math.round(k.time * 1000);
    st.best = bestLap(k);
    if (!H.firstDoneAt) H.firstDoneAt = nowT;
    if (p.k !== myK) say(line('finish', { n: nameOf(p.k) }));
  });
  const humansLeft = race.players.filter((p) => !p.bot && connected(p.k) && !H.finish.includes(p.k));
  const allIn = H.finish.length === race.players.length;
  const lastHuman = !humansLeft.length && H.lastHumanAt === undefined ? (H.lastHumanAt = nowT) : H.lastHumanAt;
  if (!H.ended && (allIn || (!humansLeft.length && nowT - lastHuman > 8) || (H.firstDoneAt && nowT - H.firstDoneAt > 45))) hostEnd();
}
// Best lap in ms, from a kart driven here (lap list) or a snapshot (best already in ms).
const bestLap = (k) => (!k ? null : k.laps ? (k.laps.length ? Math.round(Math.min(...k.laps) * 1000) : null) : k.best || null);
// Someone pressed their item key.
function hostUse(k) {
  const item = race.items[k];
  if (!item || !H) return;
  race.items[k] = null;
  H.stats[k].used++;
  const user = kartInfo(k);
  if (!user) return;
  if (k === myK) renderItem();
  if (item === 'boost') {
    if (race.karts[k]) P.applyEffect(race.karts[k], 'boost');
    if (k === myK) sfx.boost();
  } else if (item === 'splat') {
    const at = P.dropSpot(user);
    race.puddles.push({ id: ++H.puddleId, x: at.x, y: at.y, by: k, bornT: race.t });
    if (k === myK) sfx.use();
  } else if (item === 'freeze') {
    const order = currentOrder(), me_ = order.find((o) => o.k === k), ahead = P.targetAhead(order, me_);
    if (!ahead) { if (k === myK) say(line('wasted')); return; }
    H.stats[k].freezes++; H.stats[ahead.k].frozen++;
    H.hits.push({ by: k, to: ahead.k, item: 'freeze' });
    const m = { t: 'fx', kind: 'freeze', by: k, to: ahead.k };
    broadcast(m); onFx(m);
  }
}
function hostSplat(k, id) {
  const pz = race.puddles.find((p) => p.id === id);
  if (!pz) return;
  pz.gone = true;
  if (H.hits.some((h) => h.pid === id)) return;
  H.stats[pz.by].splats++; H.stats[k].splatted++;
  H.hits.push({ by: pz.by, to: k, item: 'splat', pid: id });
  const m = { t: 'fx', kind: 'splat', by: pz.by, to: k };
  broadcast(m); onFx(m);
}
// A hit landed (everyone hears about it). Whoever drives the target applies the slowdown.
function onFx(m) {
  if (!race || !playerOf(m.to)) return;
  if (race.karts[m.to] && m.kind === 'freeze') P.applyEffect(race.karts[m.to], 'freeze');
  if (m.to === myK || m.by === myK) sfx.hit();
  say(line(m.kind, { n: m.to === myK ? 'you' : nameOf(m.to), b: m.by === myK ? 'You' : nameOf(m.by) }));
}
function hostEnd() {
  H.ended = true;
  const order = currentOrder();
  const results = order.map((o, i) => {
    const p = playerOf(o.k), st = H.stats[o.k];
    st.place = i + 1;
    if (st.best == null) st.best = bestLap(kartInfo(o.k));
    return { k: o.k, name: p.name, avatar: p.avatar, bot: !!p.bot, color: p.color, place: i + 1, time: H.finish.includes(o.k) ? st.total : null };
  });
  const m = { t: 'end', gid: race.gid, at: race.at, results, stats: H.stats, hits: H.hits.map(({ by, to, item }) => ({ by, to, item })) };
  broadcast(m);
  if (room) room.started = false;
  onEnd(m);
}

/* ---------- starting a race ---------- */
function startRace() {
  if (!room) return;
  const seats = room.seats.filter((s) => connected(s.k));
  if (seats.length < 2) return toast('You need at least 2 racers 🙂');
  // Shuffle the grid, but the revenge rule says whoever came last gets pole next time.
  const order = seats.slice().sort(() => Math.random() - 0.5);
  const info = {
    gid: Math.random().toString(36).slice(2, 10), at: Date.now(),
    players: order.map((s, i) => ({ k: s.k, name: s.name, avatar: s.avatar, bot: !!s.bot, color: SEAT_COLORS[room.seats.indexOf(s)], slot: i })),
  };
  room.started = true;
  room.seats.forEach((s) => s.link && s.link.open && s.link.send({ t: 'start', info, you: s.k, hostK: myK }));
  enterRace(info);
}

/* ---------- chat ---------- */
const chat = createChat({
  send: (m) => sendSocial(m),
  game: 'race', room: () => roomCode || null,
  players: () => (race ? race.players.map((p) => ({ k: p.k, name: p.name, color: p.color })) : []),
  me: () => myK,
  stage: () => $('#track-wrap'),
  stickers: {
    gg: ['GG 🤝', '#ffffff'], slow: ['Sunday driver 🐌', '#4d9de0'], freeze: ['Chill out 🥶', '#bfe9ff'],
    sticky: ['Sticky fingers 🍬', '#ff8fc8'], revenge: ['Revenge is coming', '#c9a7ff'],
  },
  dockAt: 0,
  sound: () => sfx.chat(),
});
function sendSocial(m) {
  if (isHost()) broadcast({ t: 'social', m });
  else send({ t: 'social', m });
}

/* ---------- hosting ---------- */
async function createRoom() {
  if (typeof mqtt === 'undefined') return goHome('Could not load the online library. Check your internet 🙏');
  teardown();
  const my = session;
  mode = 'host'; myK = 'a'; hostK = 'a';
  room = { code: genCode('R'), seats: [{ k: 'a', name: me.name, avatar: myAvatar() }], started: false };
  roomCode = room.code;
  renderRoom(roomPayload());
  show('room');
  if (!(await hostListen({ code: room.code, ns: NS, epoch: 0, alive: alive(my), onLink: handlePlayer })) && my === session) {
    goHome('Could not reach the game server. Check your internet and try again!');
  }
}
function practice() {
  teardown();
  mode = 'cpu'; myK = 'a'; hostK = 'a'; roomCode = '';
  room = { code: '', started: false, seats: [{ k: 'a', name: me.name, avatar: myAvatar() }].concat(BOT_NAMES.map((n, i) => ({ k: 'bcd'[i], name: n, avatar: BOT_AVATARS[i], bot: true }))) };
  startRace();
}
function handlePlayer(c) {
  let state = 'new', seat = null;
  const timer = setTimeout(() => { if (state !== 'ok') c.drop(); }, 8000);
  c.on('data', async (d) => {
    if (state === 'checking' || state === 'dead' || !room || !d) return;
    if (state === 'new') {
      state = 'checking';
      const name = d.t === 'hello' ? await checkProof(d.user, d.proof) : null;
      const reject = (why) => { state = 'dead'; c.send({ t: 'reject', why }); setTimeout(() => c.drop(), 400); };
      if (!room) return;
      if (!name) return reject('That login didn\'t work 🚫');
      if (name === me.name) return reject('You\'re already in this room on another device 🙂');
      seat = room.seats.find((s) => !s.bot && s.name === name);
      if (!seat) {
        if (room.seats.length >= 4) return reject('This room is full 🙅');
        seat = { k: freeKey(), name };
        room.seats.push(seat);
      }
      const old = seat.link;
      seat.link = c;
      if (old && old !== c) old.drop();
      seat.avatar = AVATARS.includes(d.avatar) ? d.avatar : seat.avatar || '🙂';
      state = 'ok'; clearTimeout(timer); sfx.pop();
      sendRoom();
      toast(`${firstName(name)} joined 🎉`);
      return;
    }
    if (state !== 'ok' || seat.link !== c) return;
    if (d.t === 'social') {
      if (race && d.m && typeof d.m === 'object') { const m = { ...d.m, from: seat.k }; if (chat.receive(m)) broadcast({ t: 'social', m }, c); }
      return;
    }
    if (!race || !H || d.gid !== undefined && d.gid !== race.gid) return;
    if (!playerOf(seat.k)) return;
    if (d.t === 'k') takeSnap(seat.k, d.s);
    else if (d.t === 'use') hostUse(seat.k);
    else if (d.t === 'hitme') hostSplat(seat.k, +d.id);
  });
  c.on('close', () => {
    if (!room || !seat || seat.link !== c) return;
    seat.link = null;
    if (!race || !playerOf(seat.k)) { room.seats.splice(room.seats.indexOf(seat), 1); sendRoom(); return; }
    toast(`${firstName(seat.name)} dropped out 👋`, 3000);
  });
}

/* ---------- joining ---------- */
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
    hello: { user: me.user || me.name, proof: me.proof, avatar: myAvatar() },
    onConnected(link) { conn = link; wireGuest(link, giveUp, code); },
  });
}
function wireGuest(link, giveUp, code) {
  link.on('data', (d) => {
    if (!d) return;
    if (d.t === 'room') {
      clearTimeout(giveUp);
      if (Array.isArray(d.seats) && !race) { renderRoom(d); show('room'); }
    } else if (d.t === 'start' && d.info && Array.isArray(d.info.players)) {
      clearTimeout(giveUp);
      myK = d.you; hostK = d.hostK;
      enterRace(d.info);
    } else if (!race) {
      if (d.t === 'reject') { clearTimeout(giveUp); goHome(String(d.why || 'Could not join')); }
    } else if (d.t === 'w' && d.gid === race.gid) {
      Object.entries(d.ks || {}).forEach(([k, a]) => takeSnap(k, a));
      race.boxesOff = (d.off || []).map((id) => ({ id }));
      const was = race.items[myK];
      race.items = { ...(d.items || {}) };
      if (performance.now() - (race.usedAt || 0) < 800) race.items[myK] = null; // the host hasn't heard yet
      // My item can only be cleared by me (I may have used it a moment ago); the host's word wins for new ones.
      if (was !== race.items[myK]) renderItem();
      const gone = new Set(race.puddles.filter((p) => p.gone).map((p) => p.id));
      race.puddles = (d.pz || []).map(([id, x, y, by]) => ({ id, x, y, by, gone: gone.has(id), bornT: race.puddles.find((p) => p.id === id)?.bornT ?? race.t }));
    } else if (d.t === 'item') { race.items[myK] = d.item; sfx.pick(); renderItem(); }
    else if (d.t === 'fx') onFx(d);
    else if (d.t === 'end' && d.gid === race.gid) onEnd(d);
    else if (d.t === 'social' && d.m) chat.receive(d.m);
  });
  link.on('close', () => {
    if (mode !== 'guest' || conn !== link) return;
    const finished = race && race.results;
    goHome(finished ? '' : 'The host left the race 👋 Tap Join to hop back in if they come back.');
    $('#join-code').value = code;
  });
}

/* ---------- using an item ---------- */
function useItem() {
  if (!race || race.phase !== 'race' || !race.items[myK] || (race.karts[myK] && race.karts[myK].done)) return;
  if (isHost()) return hostUse(myK);
  const item = race.items[myK];
  race.items[myK] = null;
  race.usedAt = performance.now();
  // Boost straight away: my kart, my browser.
  if (item === 'boost') { P.applyEffect(race.karts[myK], 'boost'); sfx.boost(); } else sfx.use();
  renderItem();
  send({ t: 'use', gid: race.gid });
}

/* ================= drawing ================= */
const canvas = $('#track'), ctx = canvas.getContext('2d');
let view = { w: 0, h: 0, dpr: 1 };
function resize() {
  const r = canvas.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
  view = { w: r.width, h: r.height, dpr };
  canvas.width = Math.max(1, Math.round(r.width * dpr));
  canvas.height = Math.max(1, Math.round(r.height * dpr));
}
addEventListener('resize', resize);

// The whole track is painted once onto its own canvas; each frame just copies the visible part.
const TRACK_RES = 1.25;
const trackArt = (() => {
  const b = TRACK.bounds, c = document.createElement('canvas');
  c.width = Math.ceil(b.w * TRACK_RES); c.height = Math.ceil(b.h * TRACK_RES);
  const g = c.getContext('2d');
  g.scale(TRACK_RES, TRACK_RES);
  g.translate(-b.x, -b.y);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // Cream ground with scattered sprinkles.
  g.fillStyle = '#fff1df'; g.fillRect(b.x, b.y, b.w, b.h);
  const SPR = ['#ff5a5f', '#4d9de0', '#2bc48a', '#ffc233', '#ff8fc8', '#8f6bff'];
  for (let i = 0; i < 900; i++) {
    g.save(); g.translate(b.x + rnd() * b.w, b.y + rnd() * b.h); g.rotate(rnd() * Math.PI);
    g.fillStyle = SPR[i % SPR.length]; g.globalAlpha = 0.45; roundRect(g, -6, -2, 12, 4, 2); g.fill(); g.restore();
  }
  g.globalAlpha = 1;
  const path = new Path2D();
  TRACK.pts.forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y)));
  path.closePath();
  g.lineJoin = 'round'; g.lineCap = 'round';
  const half = TRACK.width / 2, wall = half + TRACK.verge;
  // Waffle wall.
  const wp = document.createElement('canvas'); wp.width = wp.height = 22;
  const w = wp.getContext('2d');
  w.fillStyle = '#e8a95b'; w.fillRect(0, 0, 22, 22);
  w.fillStyle = '#c98236'; w.fillRect(0, 0, 22, 4); w.fillRect(0, 0, 4, 22);
  w.fillStyle = '#f3c07f'; w.fillRect(6, 6, 12, 12);
  g.strokeStyle = '#2b2140'; g.lineWidth = (wall + 22) * 2 + 6; g.stroke(path);
  g.strokeStyle = g.createPattern(wp, 'repeat'); g.lineWidth = (wall + 22) * 2; g.stroke(path);
  g.strokeStyle = '#2b2140'; g.lineWidth = wall * 2 + 6; g.stroke(path);
  // Frosting verge (slow), then the road.
  g.strokeStyle = '#fdfbff'; g.lineWidth = wall * 2; g.stroke(path);
  g.strokeStyle = '#ffd6ea'; g.lineWidth = half * 2 + 8; g.stroke(path);
  g.strokeStyle = '#ffc2df'; g.lineWidth = half * 2; g.stroke(path);
  // Sprinkle-dotted road edges.
  const steps = Math.floor(TRACK.length / 22);
  for (let i = 0; i < steps; i++) {
    [-1, 1].forEach((side) => {
      const p = P.pointAt(TRACK, i * 22 + (side > 0 ? 11 : 0), side * (half + 6));
      g.save(); g.translate(p.x, p.y); g.rotate(p.angle + (i % 2 ? 0.6 : -0.6));
      g.fillStyle = SPR[(i * 2 + (side > 0 ? 1 : 0)) % SPR.length]; roundRect(g, -6, -2.5, 12, 5, 2.5); g.fill(); g.restore();
    });
  }
  // Dashed centre line.
  g.setLineDash([26, 30]); g.strokeStyle = '#ffffffaa'; g.lineWidth = 5; g.stroke(path); g.setLineDash([]);
  // Checkered start line.
  const s0 = P.pointAt(TRACK, 0);
  g.save(); g.translate(s0.x, s0.y); g.rotate(s0.angle);
  const sq = 12, rows = Math.ceil(TRACK.width / sq);
  for (let r = 0; r < rows; r++) for (let col = 0; col < 2; col++) {
    g.fillStyle = (r + col) % 2 ? '#2b2140' : '#ffffff';
    g.fillRect(-sq + col * sq, -half + r * sq, sq, Math.min(sq, half * 2 - r * sq));
  }
  g.restore();
  return c;
})();
// A small map of the loop for the corner.
const miniArt = (() => {
  const b = TRACK.bounds, size = 150, sc = size / Math.max(b.w, b.h), c = document.createElement('canvas');
  c.width = c.height = size * 2;
  const g = c.getContext('2d');
  g.scale(2, 2);
  g.lineJoin = 'round';
  const path = new Path2D();
  TRACK.pts.forEach(([x, y], i) => { const px = (x - b.x) * sc, py = (y - b.y) * sc; i ? path.lineTo(px, py) : path.moveTo(px, py); });
  path.closePath();
  g.strokeStyle = '#2b2140'; g.lineWidth = 11; g.stroke(path);
  g.strokeStyle = '#ffc2df'; g.lineWidth = 6; g.stroke(path);
  return { c, sc, size };
})();
function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

// Where to draw every kart this frame: mine and bots live, everyone else between their last two snapshots.
function drawnKarts(now) {
  return race.players.map((p) => {
    const local = race.karts[p.k];
    if (local) return { k: p.k, x: local.x, y: local.y, a: local.a, fx: local.boostT ? 3 : local.slowKind === 'freeze' ? 1 : local.slowKind === 'splat' ? 2 : 0, v: local.v };
    const r = race.remote[p.k];
    if (!r) { const g = P.gridSpot(TRACK, p.slot); return { k: p.k, x: g.x, y: g.y, a: g.angle, fx: 0, v: 0 }; }
    const span = Math.max(50, r.last.at - r.prev.at), t = Math.min(1, Math.max(0, (now - r.last.at) / span));
    return { k: p.k, x: r.prev.x + (r.last.x - r.prev.x) * t, y: r.prev.y + (r.last.y - r.prev.y) * t, a: r.prev.a + P.wrapAngle(r.last.a - r.prev.a) * t, fx: r.last.fx, v: r.last.v };
  });
}
function draw(now) {
  const { w, h, dpr } = view;
  if (!w) return;
  const karts = drawnKarts(now), mine = karts.find((k) => k.k === myK) || karts[0];
  const zoom = Math.max(0.5, Math.min(1.15, Math.min(w, h) / 640));
  // Camera follows my kart, looking a little ahead.
  const tx = mine.x + Math.cos(mine.a) * Math.max(0, mine.v) * 0.25, ty = mine.y + Math.sin(mine.a) * Math.max(0, mine.v) * 0.25;
  if (!race.cam) race.cam = { x: tx, y: ty };
  race.cam.x += (tx - race.cam.x) * 0.12; race.cam.y += (ty - race.cam.y) * 0.12;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#f3dcc0'; ctx.fillRect(0, 0, w, h);
  ctx.save();
  ctx.translate(w / 2, h / 2); ctx.scale(zoom, zoom); ctx.translate(-race.cam.x, -race.cam.y);
  const b = TRACK.bounds;
  ctx.drawImage(trackArt, b.x, b.y, b.w, b.h);
  const time = now / 1000;
  // Item boxes: wrapped candies.
  TRACK.boxes.forEach((box) => {
    if (race.boxesOff.some((o) => o.id === box.id)) return;
    drawCandy(box.x, box.y + Math.sin(time * 3 + box.id) * 3, Math.sin(time * 2 + box.id) * 0.4, ['#ff5a5f', '#4d9de0', '#2bc48a', '#ffc233'][box.id % 4]);
  });
  // Jelly puddles.
  race.puddles.forEach((pz) => {
    if (pz.gone) return;
    ctx.save(); ctx.translate(pz.x, pz.y);
    ctx.fillStyle = '#ff6fb5aa'; ctx.strokeStyle = '#2b2140'; ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = 0; i <= 12; i++) { const an = (i / 12) * Math.PI * 2, rr = P.PUDDLE_R * (0.85 + 0.15 * Math.sin(i * 2.3 + pz.id)); i ? ctx.lineTo(Math.cos(an) * rr, Math.sin(an) * rr) : ctx.moveTo(rr, 0); }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ffffffaa'; ctx.beginPath(); ctx.ellipse(-8, -8, 7, 4, -0.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  });
  karts.slice().sort((a, b2) => (a.k === myK) - (b2.k === myK)).forEach((k) => drawKart(k, time));
  ctx.restore();
  // Minimap.
  const m = miniArt, mx = w - m.size - 12, my = h - m.size - (coarse ? 120 : 12);
  ctx.globalAlpha = 0.9; ctx.drawImage(m.c, mx, my, m.size, m.size); ctx.globalAlpha = 1;
  karts.forEach((k) => {
    ctx.fillStyle = colorOf(k.k); ctx.strokeStyle = '#2b2140'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(mx + (k.x - b.x) * m.sc, my + (k.y - b.y) * m.sc, k.k === myK ? 6 : 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  });
}
function drawCandy(x, y, rot, color) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  ctx.strokeStyle = '#2b2140'; ctx.lineWidth = 3; ctx.lineJoin = 'round';
  ctx.fillStyle = color;
  [-1, 1].forEach((s) => { ctx.beginPath(); ctx.moveTo(s * 14, 0); ctx.lineTo(s * 30, -12); ctx.lineTo(s * 30, 12); ctx.closePath(); ctx.fill(); ctx.stroke(); });
  ctx.beginPath(); ctx.ellipse(0, 0, 18, 15, 0, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.stroke();
  ctx.save(); ctx.clip();
  ctx.strokeStyle = color; ctx.lineWidth = 6;
  for (let i = -3; i <= 3; i++) { ctx.beginPath(); ctx.moveTo(i * 10 - 10, -18); ctx.lineTo(i * 10 + 10, 18); ctx.stroke(); }
  ctx.restore();
  ctx.fillStyle = '#2b2140'; ctx.font = '700 16px Fredoka, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('?', 0, 1);
  ctx.restore();
}
function drawKart(k, time) {
  const p = playerOf(k.k);
  ctx.save(); ctx.translate(k.x, k.y);
  // Boost sparkles trail behind.
  if (k.fx === 3) {
    for (let i = 0; i < 6; i++) {
      const d = 26 + i * 9, jit = Math.sin(time * 30 + i * 2) * 8;
      ctx.fillStyle = ['#ffc233', '#ff8fc8', '#4d9de0', '#2bc48a'][i % 4];
      ctx.beginPath(); ctx.arc(-Math.cos(k.a) * d - Math.sin(k.a) * jit, -Math.sin(k.a) * d + Math.cos(k.a) * jit, 4 - i * 0.4, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.save(); ctx.rotate(k.a);
  ctx.strokeStyle = '#2b2140'; ctx.lineWidth = 3;
  // Shadow, wheels, body.
  ctx.fillStyle = '#2b214033'; roundRect(ctx, -20, -13, 44, 30, 12); ctx.fill();
  ctx.fillStyle = '#2b2140';
  [[-14, -16], [10, -16], [-14, 11], [10, 11]].forEach(([x, y]) => { roundRect(ctx, x, y, 11, 6, 3); ctx.fill(); });
  ctx.fillStyle = p ? p.color : '#fff'; roundRect(ctx, -22, -14, 44, 28, 12); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#ffffff88'; roundRect(ctx, 8, -9, 9, 18, 4); ctx.fill();
  if (k.fx === 1) { ctx.fillStyle = '#bfe9ffcc'; roundRect(ctx, -22, -14, 44, 28, 12); ctx.fill(); }
  if (k.fx === 2) { ctx.fillStyle = '#ff6fb5aa'; ctx.beginPath(); ctx.arc(-8, 8, 9, 0, Math.PI * 2); ctx.arc(6, -6, 7, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
  // Avatar sits upright on top.
  ctx.font = '22px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(p ? p.avatar : '🙂', 0, -2);
  if (k.fx === 1) ctx.fillText('❄️', 18, -20);
  if (k.k !== myK && p) {
    ctx.font = '700 13px Fredoka, sans-serif';
    const nm = firstName(p.name), tw = ctx.measureText(nm).width + 14;
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#2b2140'; ctx.lineWidth = 2.5;
    roundRect(ctx, -tw / 2, -44, tw, 20, 10); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#2b2140'; ctx.fillText(nm, 0, -33);
  }
  ctx.restore();
}

/* ---------- HUD ---------- */
function hud(now) {
  const mine = race.karts[myK];
  if (!mine) return;
  const lap = Math.max(1, Math.min(P.LAPS, mine.lap));
  $('#hud-lap').innerHTML = `<small>Lap</small>${lap}<small>/${P.LAPS}</small>`;
  const order = currentOrder(), place = order.findIndex((o) => o.k === myK) + 1;
  $('#hud-pos').innerHTML = `${place}<small>${ordinal(place).slice(String(place).length)}</small>`;
  const t = mine.done ? mine.time : race.phase === 'race' ? race.t : 0;
  $('#hud-time').textContent = fmtTime(t * 1000);
}
function renderItem() {
  const it = race && race.items[myK];
  $('#hud-item').innerHTML = it ? `<span>${ITEM_ICON[it]}</span><small>${ITEM_NAME[it]}</small>` : '';
  $('#hud-item').classList.toggle('full', !!it);
  $('#btn-item').textContent = it ? ITEM_ICON[it] : '·';
  $('#btn-item').disabled = !it;
  if (it) retrigger($('#hud-item'), 'got');
}
function showCount(text) {
  const el = $('#countdown');
  el.textContent = text;
  el.hidden = false;
  retrigger(el, 'pop');
  if (text === 'GO!') setTimeout(() => { if (el.textContent === 'GO!') el.hidden = true; }, 800);
}
function say(text) {
  const el = $('#ticker');
  el.textContent = text;
  retrigger(el, 'show');
}

/* ================= the end ================= */
let saved = null;
function onEnd(m) {
  if (!race || race.results) return;
  race.results = m;
  race.phase = 'end';
  const results = Array.isArray(m.results) ? m.results : [], stats = m.stats || {}, hits = Array.isArray(m.hits) ? m.hits : [];
  const nm = (k) => (results.find((r) => r.k === k) || {}).name || '?';
  if (saved !== race.gid && me) {
    saved = race.gid;
    records.game({
      kind: 'race', gid: race.gid, room: roomCode || null, practice: mode === 'cpu', startedAt: m.at || race.at,
      players: results.map((r) => ({ name: r.name, bot: !!r.bot, place: r.place, score: r.time })),
      winners: results.length ? [results[0].name] : [],
      stats: Object.fromEntries(results.map((r) => [r.name, { ...(stats[r.k] || {}) }])),
      hits: hits.map((h) => ({ kind: h.item === 'freeze' ? 'freeze' : 'splat', by: nm(h.by), to: nm(h.to) })),
    });
  }
  setTimeout(() => renderEnd(results, stats), 1200);
}
function renderEnd(results, stats) {
  if (!race) return;
  const mine = results.find((r) => r.k === myK);
  $('#end-title').textContent = mine && mine.place === 1 ? 'You won! 🏆' : results[0] ? `${firstName(results[0].name)} wins 🏁` : 'Race over';
  const medal = ['🏆', '🥈', '🥉', '🍭'];
  $('#podium').innerHTML = results.map((r, i) => {
    const st = stats[r.k] || {};
    return `<div class="sr-pod p${i + 1}" style="--c:${r.color}">
      <span class="medal">${medal[i] || ''}</span><span class="av">${avHTML(r.avatar)}</span>
      <b>${escapeHtml(firstName(r.name))}${r.k === myK ? ' (you)' : ''}</b>
      <span class="time">${r.time != null ? fmtTime(r.time) : 'DNF'}<small>best lap ${fmtTime(st.best)}</small></span></div>`;
  }).join('');
  const name = (k) => firstName((results.find((r) => r.k === k) || {}).name || '?');
  const by = (score, low = false) => {
    const list = results.filter((r) => score(r.k) != null && (low || score(r.k) > 0)).sort((a, b) => (low ? score(a.k) - score(b.k) : score(b.k) - score(a.k)));
    return list[0] || null;
  };
  const S = (k) => stats[k] || {};
  const speed = by((k) => S(k).best, true), splat = by((k) => (S(k).freezes || 0) + (S(k).splats || 0)), frozen = by((k) => (S(k).frozen || 0) + (S(k).splatted || 0));
  const awards = [
    speed && ['🏎️', 'Speed Demon', name(speed.k), `Best lap ${fmtTime(S(speed.k).best)}`],
    splat && ['🍬', 'Splat Master', name(splat.k), `Landed ${(S(splat.k).freezes || 0) + (S(splat.k).splats || 0)} hits`],
    frozen && ['🥶', 'Frozen Solid', name(frozen.k), `Got hit ${(S(frozen.k).frozen || 0) + (S(frozen.k).splatted || 0)} times`],
  ].filter(Boolean);
  $('#awards').innerHTML = awards.map(([icon, title, who, why]) => `<div class="award"><span class="icon">${icon}</span><div><b>${escapeHtml(title)}</b><span>${escapeHtml(who)}</span><small>${escapeHtml(why)}</small></div></div>`).join('');
  $('#btn-again').hidden = !isHost();
  $('#end-wait').hidden = isHost();
  $('#end-wait').textContent = 'Waiting for the host to start a rematch…';
  show('end');
  if (mine && mine.place === 1) { sfx.trophy(); bigConfetti(); } else sfx.pop();
}

/* ================= wiring ================= */
$('#btn-create').onclick = () => { sfx.pop(); createRoom(); };
$('#btn-cpu').onclick = () => { sfx.pop(); practice(); };
$('#btn-join').onclick = () => { sfx.pop(); joinRoom($('#join-code').value); };
$('#join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(e.target.value); });
$('#btn-room-back').onclick = () => goHome();
$('#btn-start').onclick = () => { sfx.pop(); startRace(); };
$('#btn-leave').onclick = () => { if (confirm('Leave the race?')) goHome(); };
$('#btn-end-home').onclick = () => goHome();
$('#btn-again').onclick = () => { if (isHost() && room) { room.seats = room.seats.filter((s) => connected(s.k)); race = null; startRace(); } };
$('#btn-mute').onclick = (e) => setIcon(e.currentTarget, sfx.toggle() ? 'mute' : 'volume');
$('#btn-share').onclick = async () => {
  const code = $('#room-code').textContent, link = `${location.origin}${location.pathname}?room=${code}`;
  if (navigator.share) { try { await navigator.share({ title: 'Sugar Rush', text: `Engines on. Race me: ${code}`, url: link }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(link); toast('Invite link copied 💌'); } catch (e) { prompt('Copy this link:', link); }
};
$('#hud-item').onclick = useItem;
chat.mountTools($('#chat-tools'), { compact: true });
const DRIVE = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd', ' '];
document.addEventListener('keydown', (e) => {
  if (!document.querySelector('#screen-play.active') || e.ctrlKey || e.metaKey || e.altKey || chat.typing(e)) return;
  const k = e.key.toLowerCase();
  if (DRIVE.includes(k)) e.preventDefault();
  if (k === ' ') { if (!e.repeat) useItem(); return; }
  keys[k] = true;
});
document.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });
addEventListener('blur', () => Object.keys(keys).forEach((k) => (keys[k] = false)));
// Phone buttons: hold to steer (the kart drives itself forward on phones).
document.querySelectorAll('[data-steer]').forEach((b) => {
  const dir = b.dataset.steer;
  const on = (v) => (e) => { e.preventDefault(); touch[dir] = v; b.classList.toggle('down', v); };
  b.addEventListener('pointerdown', on(true));
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => b.addEventListener(ev, on(false)));
  b.addEventListener('contextmenu', (e) => e.preventDefault());
});
$('#btn-item').addEventListener('pointerdown', (e) => { e.preventDefault(); useItem(); });
document.body.classList.toggle('touch', coarse);
addEventListener('pagehide', () => { if (mode) teardown(); });
document.addEventListener('profilechange', renderHomeBits);

document.addEventListener('DOMContentLoaded', () => {
  hydrateIcons();
  if (sfx.muted) setIcon($('#btn-mute'), 'mute');
  applyPalette();
  wireProfileSheet();
  sfx.load();
  requestAnimationFrame(frame);
  requireLogin().then(() => {
    goHome();
    const code = new URLSearchParams(location.search).get('room');
    if (code) { history.replaceState(null, '', location.pathname); $('#join-code').value = code.toUpperCase(); joinRoom(code); }
  });
});
