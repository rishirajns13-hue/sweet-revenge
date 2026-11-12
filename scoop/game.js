'use strict';
/* Scoop Stack: everyone stacks their own ice-cream tower at once. Each browser simulates its own
   tower (scoop/rules.js) so drops never lag; it only tells the host its height, lives and perfects.
   The host runs the bots, keeps the scoreboard, passes Wobbles along to their target, and decides
   when the 90 seconds are up. If the host leaves mid-round, the round just ends where it stands. */
const R = window.ScoopRules;
const NS = 'scoop-rr7';
const SEAT_COLORS = ['#ff71ce', '#7ee8d8', '#ffce5c', '#9ab8ff'];
const BOT_NAMES = ['Bot Bonky', 'Robo Rani', 'Chip'];
const COUNTDOWN = 3000;
const INK = '#2b2140';
const LINES = {
  splat: ['SPLAT. That scoop had a family 😭', 'SPLAT! Floor gets dessert 🫠', 'Gone. Like it was never there 💀', 'SPLAT. Five-second rule? 🙈'],
  perfect: ['Perfect! Chef\'s kiss 🤌', 'PERFECT! Mamma mia 🤌', 'Perfect! Michelin star ⭐', 'Perfect! Bakery-grade 🧁'],
  charged: ['Wobble charged! Press W 🌀', 'Revenge is ready. Press W 🌀'],
  hit: ['{n} sent you a WOBBLE 🌀', '{n} shook your cone 🌀 Hold on!'],
  saw: ['{n} wobbled {m} 🌀', '{m} is getting wobbled by {n} 🌀'],
  out: ['Out of scoops! 🍦💔', 'The cone has spoken. You\'re out 😵'],
};
const oneOf = (a) => a[Math.floor(Math.random() * a.length)];
const line = (k, o = {}) => oneOf(LINES[k]).replace('{n}', o.n || '').replace('{m}', o.m || '');
const firstName = (name) => String(name).split(' ').pop();

/* ================= sounds (real recorded clips only) ================= */
const sfx = (() => {
  const p = createSamplePlayer({ takes: {
    drop: ['ui-drop-1.ogg', 'ui-drop-2.ogg'], pop: ['ui-pop-1.ogg', 'ui-pop-2.ogg'], pick: ['ui-pick.ogg'],
    shine: ['ui-shine.ogg'], win: ['ui-levelup.ogg'], trophy: ['ui-trophy.ogg'], splat: ['card-shove-1.ogg', 'card-shove-2.ogg'],
  } });
  return {
    load: p.load,
    drop() { p.sample('drop', { vol: 0.55 }); },
    perfect() { p.sample('drop', { vol: 0.45 }); p.sample('shine', { vol: 0.4, when: 0.03 }); },
    splat() { p.sample('splat', { vol: 0.8, rate: 0.8 }); },
    charged() { p.sample('trophy', { vol: 0.4 }); },
    wobble() { p.sample('pick', { vol: 0.6, rate: 0.8 }); },
    win() { p.sample('win', { vol: 0.55 }); },
    pop() { p.sample('pop', { vol: 0.4 }); },
    chat() { p.sample('pick', { vol: 0.3, rate: 1.2 }); },
    get muted() { return p.muted; },
    toggle: p.toggle,
  };
})();

/* ================= app state ================= */
let mode = null;      // 'host' | 'guest' | 'cpu'
let session = 0;
let room = null;      // host: { code, epoch, seats: [{ k, name, avatar, bot, link }], started }
let conn = null;      // guest: link to the host
let myK = null, hostK = null, roomCode = '';
let RD = null;        // the round: { gid, at, players, board: { k: summary }, t0, over }
let T = null;         // my tower
let H = null;         // host only: { bots: { k: { t, skill, next, wobAt } }, hits: [], dirty, last }
let hostTimer = 0;
const alive = (my) => () => my === session;
const isHost = () => mode === 'host' || mode === 'cpu';
const now = () => performance.now();

function show(screen) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === 'screen-' + screen));
  document.body.classList.toggle('in-game', screen === 'play');
  chat.setInGame(screen === 'play' || screen === 'end');
}
function teardown() {
  session++;
  clearInterval(hostTimer);
  const oldRoom = room, oldConn = conn;
  room = null; conn = null;
  if (oldConn) { try { oldConn.close(); } catch (e) {} }
  if (oldRoom) oldRoom.seats.forEach((s) => { try { s.link && s.link.close(); } catch (e) {} });
  closeAllClients();
  mode = null; RD = null; T = null; H = null; myK = null; hostK = null;
  chat.reset();
}
function goHome(error = '') {
  teardown();
  show('home');
  renderHomeBits();
  $('#home-error').textContent = error;
}
function leaveToHome() { store.del('scoop-lastroom'); goHome(); }
function renderHomeBits() {
  if (me) setAvatar($('#me-avatar'), myAvatar());
  const last = store.get('scoop-lastroom', null), fresh = last && Date.now() - last.at < 3 * 3600e3;
  $('#btn-resume').hidden = !fresh;
  if (fresh) $('#resume-code').textContent = last.code;
}
const rememberRoom = (code) => code && store.set('scoop-lastroom', { code, at: Date.now() });

/* ================= room screen ================= */
function roomPayload() {
  return { t: 'room', code: room.code, host: me.name, seats: room.seats.map((s) => ({ name: s.name, avatar: s.avatar, bot: !!s.bot })) };
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
      html += `<div class="seat" style="--c:${SEAT_COLORS[i]}"><span class="av">${avatarHTML(s.avatar)}</span><span class="nm">${escapeHtml(s.name)}${s.name === me.name && !s.bot ? ' (you)' : ''}</span>${right}</div>`;
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
    : `Waiting for ${escapeHtml(firstName(p.host))} to start<span class="dots"><i>.</i><i>.</i><i>.</i></span>`;
}
$('#seats').addEventListener('click', (e) => {
  if (!isHost() || !room || room.started) return;
  const add = e.target.closest('[data-addbot]'), rm = e.target.closest('[data-rmbot]');
  if (add && room.seats.length < 4) {
    const used = room.seats.map((s) => s.name);
    room.seats.push({ k: freeKey(), name: BOT_NAMES.find((b) => !used.includes(b)), avatar: '🤖', bot: true });
  } else if (rm) {
    const s = room.seats[+rm.dataset.rmbot];
    if (s && s.bot) room.seats.splice(room.seats.indexOf(s), 1);
  } else return;
  sfx.pop();
  sendRoom();
});
const freeKey = () => 'abcd'.split('').find((x) => !room.seats.some((s) => s.k === x));

/* ================= host: running the round ================= */
const seatOf = (k) => room && room.seats.find((s) => s.k === k);
const connected = (k) => k === myK || !!(seatOf(k) && (seatOf(k).bot || (seatOf(k).link && seatOf(k).link.open)));
const playerOf = (k) => (RD ? RD.players.find((p) => p.k === k) : null);
const nameOf = (k) => (k === myK ? 'You' : playerOf(k) ? firstName(playerOf(k).name) : '?');
function broadcast(m, except = null) {
  if (room) room.seats.forEach((s) => s.link && s.link.open && s.link !== except && s.link.send(m));
}

function startRound() {
  if (!room) return;
  const seats = room.seats.filter((s) => connected(s.k));
  if (seats.length < 2) return toast('You need at least 2 players 🙂');
  room.started = true;
  const round = {
    gid: Math.random().toString(36).slice(2, 10), at: Date.now(),
    players: seats.map((s) => ({ k: s.k, name: s.name, avatar: s.avatar, bot: !!s.bot })),
  };
  H = { bots: {}, hits: [], dirty: true, last: now() };
  round.players.filter((p) => p.bot).forEach((p, i) => {
    H.bots[p.k] = { t: R.newTower(), skill: 0.45 + Math.random() * 0.25 - i * 0.03, next: now() + COUNTDOWN + 700 + Math.random() * 600, wobAt: 0 };
  });
  rememberRoom(room.code);
  room.seats.forEach((s) => s.link && s.link.open && s.link.send({ t: 'start', round, you: s.k, hostK: myK }));
  enterRound(round);
  clearInterval(hostTimer);
  hostTimer = setInterval(hostTick, 100);
}

function hostTick() {
  if (!RD || !H || RD.over) return;
  const t = now(), dt = Math.min(250, t - H.last), el = t - RD.t0;
  H.last = t;
  // Bots stack too.
  Object.entries(H.bots).forEach(([k, b]) => {
    R.step(b.t, dt, t);
    if (b.t.out || el < 0 || el >= R.DURATION) return;
    if (t >= b.next) {
      const r = R.drop(b.t, R.botAim(b.t, Math.random, b.skill, R.wobbling(b.t, t)));
      b.next = t + 650 + Math.random() * 850 + (R.wobbling(b.t, t) ? 400 : 0);
      RD.board[k] = R.summary(b.t); H.dirty = true;
      if (r.charged) b.wobAt = t + 900 + Math.random() * 2200;
      if (r.kind === 'splat' && Math.random() < 0.45) botSay(k, oneOf(['😭', '😱', '💀']));
      else if (r.kind === 'perfect' && Math.random() < 0.15) botSay(k, oneOf(['😎', '🔥']));
    }
    if (b.wobAt && t >= b.wobAt) { b.wobAt = 0; if (R.useWobble(b.t)) { RD.board[k] = R.summary(b.t); hostWobble(k); } }
  });
  // Anyone who dropped out of the room is out of the round, keeping their height.
  RD.players.forEach((p) => { if (!p.bot && p.k !== myK && !connected(p.k) && RD.board[p.k] && !RD.board[p.k].out) { RD.board[p.k].out = true; H.dirty = true; } });
  if (H.dirty) {
    H.dirty = false;
    broadcast({ t: 'board', b: RD.board });
    renderBoard();
  }
  const scores = RD.players.map((p) => ({ k: p.k, ...RD.board[p.k] }));
  if (R.roundOver(scores, el - 400)) endRound();
}
function hostWobble(from) {
  const to = R.wobbleTarget(RD.players.map((p) => ({ k: p.k, ...RD.board[p.k] })), from);
  if (!to) return;
  H.hits.push({ by: from, to });
  if (H.bots[to]) R.hitByWobble(H.bots[to].t, now());
  const m = { t: 'wob', from, to };
  broadcast(m);
  gotWobble(m);
  H.dirty = true;
}
function hostUpdate(k, s) {
  if (!RD || RD.over || !s || typeof s !== 'object') return;
  const old = RD.board[k] || {};
  RD.board[k] = {
    h: Math.max(0, Math.min(999, +s.h || 0)), lives: Math.max(0, Math.min(R.LIVES, +s.lives || 0)), perfects: +s.perfects || 0,
    splats: +s.splats || 0, wob: +s.wob || 0, out: !!s.out || !!old.out, charged: !!s.charged,
  };
  H.dirty = true;
}
function endRound() {
  if (!RD || RD.over) return;
  const scores = RD.players.map((p) => ({ k: p.k, ...RD.board[p.k] }));
  const res = { gid: RD.gid, at: RD.at, players: RD.players, board: RD.board, hits: H.hits, ranked: R.rank(scores) };
  clearInterval(hostTimer);
  if (room) room.started = false;
  broadcast({ t: 'end', res });
  finish(res);
}
function botSay(k, e) {
  setTimeout(() => { if (!RD) return; const m = { t: 'react', e, from: k }; if (chat.receive(m)) broadcast({ t: 'social', m }); }, 300 + Math.random() * 600);
}

/* ---------- chat (shared/chat.js) ---------- */
const chat = createChat({
  send: (m) => sendSocial(m),
  game: 'scoop', room: () => roomCode || null,
  players: () => (RD ? RD.players.map((p, i) => ({ k: p.k, name: p.name, color: SEAT_COLORS[i], avatar: p.avatar })) : []),
  me: () => myK,
  anchor: (k) => (k === myK ? $('#field') : $(`.sc-row[data-k="${k}"]`)),
  stage: () => $('#stage'),
  stickers: {
    brain: ['Brain freeze 🥶', '#9ab8ff'], melt: ['You\'re melting 🫠', '#ffce5c'], cone: ['Cone-gratulations 🍦', '#ff71ce'],
    sprinkle: ['Sprinkle of revenge 🌀', '#7ee8d8'], gg: ['GG 🤝', '#ffffff'],
  },
  dockAt: 1200,
  sound: (kind) => (kind === 'in' ? sfx.chat() : sfx.pop()),
});
function sendSocial(m) {
  if (isHost()) broadcast({ t: 'social', m });
  else if (conn && conn.open) conn.send({ t: 'social', m });
}

/* ---------- hosting ---------- */
async function createRoom() {
  if (typeof mqtt === 'undefined') return goHome('Could not load the online library. Check your internet 🙏');
  teardown();
  const my = session;
  mode = 'host'; myK = 'a'; hostK = 'a';
  room = { code: genCode('K'), epoch: 0, seats: [{ k: 'a', name: me.name, avatar: myAvatar() }], started: false };
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
  room = { code: '', epoch: 0, started: false, seats: [{ k: 'a', name: me.name, avatar: myAvatar() }, { k: 'b', name: BOT_NAMES[0], avatar: '🤖', bot: true }] };
  startRound();
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
      if (room.started) return reject('A round is on right now. Try again in a minute 🍦');
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
    if (state !== 'ok' || seat.link !== c || !d) return;
    if (d.t === 'social') {
      if (RD && d.m && typeof d.m === 'object') { const m = { ...d.m, from: seat.k }; if (chat.receive(m)) broadcast({ t: 'social', m }, c); }
    } else if (d.t === 'up') hostUpdate(seat.k, d.s);
    else if (d.t === 'wob' && RD && !RD.over) {
      const b = RD.board[seat.k];
      if (b) { b.wob = (b.wob || 0) + 1; b.charged = false; }
      hostWobble(seat.k);
    }
  });
  c.on('close', () => {
    if (!room || !seat || seat.link !== c) return;
    seat.link = null;
    const inRound = RD && !RD.over && RD.players.some((p) => p.k === seat.k);
    room.seats.splice(room.seats.indexOf(seat), 1);
    if (inRound) { toast(`${firstName(seat.name)} left. Their tower stays standing.`, 3000); if (RD.board[seat.k]) RD.board[seat.k].out = true; H.dirty = true; }
    else if (!RD || RD.over) sendRoom();
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
      rememberRoom(code);
      if (Array.isArray(d.seats) && !document.querySelector('#screen-play.active') && !document.querySelector('#screen-end.active')) { renderRoom(d); show('room'); }
    } else if (d.t === 'start' && d.round && Array.isArray(d.round.players)) {
      clearTimeout(giveUp);
      myK = d.you; hostK = d.hostK;
      enterRound(d.round);
    } else if (d.t === 'board' && RD && d.b && typeof d.b === 'object') {
      Object.entries(d.b).forEach(([k, s]) => { if (k !== myK) RD.board[k] = s; else if (RD.board[k]) RD.board[k].out = RD.board[k].out || s.out; });
      renderBoard();
    } else if (d.t === 'wob' && RD) gotWobble(d);
    else if (d.t === 'end' && d.res && RD && d.res.gid === RD.gid) finish(d.res);
    else if (d.t === 'social' && d.m) chat.receive(d.m);
    else if (d.t === 'reject') { clearTimeout(giveUp); goHome(String(d.why || 'Could not join')); }
  });
  link.on('close', () => {
    if (mode !== 'guest' || conn !== link) return;
    // The host left mid-round: end it here with the last scores we heard.
    if (RD && !RD.over) {
      const scores = RD.players.map((p) => ({ k: p.k, ...RD.board[p.k] }));
      toast('The host left, so that\'s the final score 🍦', 3500);
      finish({ gid: RD.gid, at: RD.at, players: RD.players, board: RD.board, hits: [], ranked: R.rank(scores), hostLeft: true });
      conn = null;
      return;
    }
    if (document.querySelector('#screen-end.active')) { conn = null; $('#end-wait').textContent = 'The host left 👋'; return; }
    goHome('Connection dropped. Tap Join to hop back in!');
    $('#join-code').value = code;
  });
}

/* ================= my tower ================= */
function enterRound(round) {
  T = R.newTower();
  T.phase = -Math.PI / 2;
  RD = { ...round, board: {}, t0: now() + COUNTDOWN, over: false };
  RD.players.forEach((p) => { RD.board[p.k] = R.summary(R.newTower()); });
  view.reset();
  buildBoard();
  renderHud();
  $('#room-chip').textContent = mode === 'cpu' ? 'Practice' : roomCode;
  $('#out-note').hidden = true;
  $('#banner').textContent = '';
  show('play');
  resize();
}
function myUpdate() {
  const s = R.summary(T);
  RD.board[myK] = s;
  if (isHost()) { if (H) H.dirty = true; } else if (conn && conn.open) conn.send({ t: 'up', s });
  renderHud();
}
const playing = () => RD && !RD.over && T && !T.out && now() >= RD.t0 && now() - RD.t0 < R.DURATION;
function tryDrop() {
  if (!playing() || view.fall) return;
  const x = view.swingX, from = view.swingY();
  const r = R.drop(T, x);
  const top = T.stack[T.stack.length - 1];
  view.fall = { kind: r.kind, x: r.kind === 'splat' ? x : top.x, w: r.kind === 'splat' ? T.w : top.w, f: r.kind === 'splat' ? T.height % 5 : top.f,
    from, to: r.kind === 'splat' ? from : (T.height - 1) * R.SCOOP_H, start: now(), cut: r.cut, idx: T.height - 1 };
  if (r.kind === 'splat') {
    view.debris.push({ x, y: from, w: T.w, f: T.height % 5, vx: (Math.random() - 0.5) * 60, vy: 0, rot: 0, vr: (Math.random() - 0.5) * 6 });
    view.fall = null;
    sfx.splat();
    banner(line('splat'), 'bad');
    retrigger($('#field'), 'shake');
    if (T.out) { setTimeout(() => { if (RD && T && T.out) { $('#out-note').hidden = false; banner(line('out'), 'bad'); } }, 500); }
  } else if (r.kind === 'perfect') {
    sfx.perfect();
    banner(line('perfect'), 'good');
    const [cx, cy] = centerOf($('#field'));
    confetti(cx, cy - 40, 14, 120, R.FLAVOURS.map((f) => f.c));
  } else sfx.drop();
  if (r.charged) setTimeout(() => { sfx.charged(); banner(line('charged'), 'good'); }, 450);
  myUpdate();
}
function tryWobble() {
  if (!RD || RD.over || !T || !T.charged || now() < RD.t0) return;
  if (!R.useWobble(T)) return;
  sfx.wobble();
  if (isHost()) { hostWobble(myK); }
  else if (conn && conn.open) conn.send({ t: 'wob' });
  myUpdate();
}
function gotWobble(m) {
  if (!RD) return;
  if (m.to === myK && T) {
    R.hitByWobble(T, now());
    banner(line('hit', { n: nameOf(m.from) }), 'bad');
    sfx.wobble();
    retrigger($('#field'), 'wobbled');
  } else if (m.from !== myK) banner(line('saw', { n: nameOf(m.from), m: nameOf(m.to) }), '');
  else banner(`Wobble sent to ${nameOf(m.to)} 😈`, 'good');
  const row = $(`.sc-row[data-k="${m.to}"]`);
  if (row) retrigger(row, 'wobbled');
}
let bannerTimer = 0;
function banner(text, kind) {
  const b = $('#banner');
  b.textContent = text;
  b.className = 'sc-banner show ' + (kind || '');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => b.classList.remove('show'), 1600);
}

/* ---------- HUD and the scoreboard of towers ---------- */
function renderHud() {
  if (!T) return;
  $('#lives').innerHTML = Array.from({ length: R.LIVES }, (_, i) => `<i class="${i < T.lives ? '' : 'gone'}">🍦</i>`).join('');
  $('#height').textContent = T.height;
  $('#streak').innerHTML = Array.from({ length: R.STREAK }, (_, i) => `<i class="${T.charged || i < T.streak ? 'on' : ''}"></i>`).join('');
  $('#btn-wobble').disabled = !T.charged || T.out;
  $('#btn-wobble').classList.toggle('ready', T.charged && !T.out);
}
function buildBoard() {
  $('#board').innerHTML = RD.players.map((p, i) => `<div class="sc-row${p.k === myK ? ' me' : ''}" data-k="${p.k}" style="--c:${SEAT_COLORS[i]}">
      <span class="av">${avatarHTML(p.avatar)}</span>
      <div class="info"><b>${p.k === myK ? 'You' : escapeHtml(firstName(p.name))}</b><span class="lv"></span></div>
      <div class="mini"></div><b class="h">0</b><span class="tag" hidden>OUT</span>
    </div>`).join('');
  renderBoard();
}
function renderBoard() {
  if (!RD) return;
  const order = R.rank(RD.players.map((p) => ({ k: p.k, ...RD.board[p.k] })));
  const lead = order[0] && order[0].h > 0 ? order[0].k : null;
  order.forEach((s, i) => {
    const row = $(`.sc-row[data-k="${s.k}"]`);
    if (!row) return;
    row.style.order = i;
    row.classList.toggle('lead', s.k === lead);
    row.querySelector('.h').textContent = s.h || 0;
    row.querySelector('.lv').textContent = '🍦'.repeat(s.lives || 0) || '💔';
    row.querySelector('.tag').hidden = !s.out;
    row.classList.toggle('out', !!s.out);
    const mini = row.querySelector('.mini'), want = Math.min(16, s.h || 0);
    while (mini.children.length < want) { const d = document.createElement('i'); d.style.background = R.flavourAt(mini.children.length).c; mini.appendChild(d); }
    while (mini.children.length > want) mini.lastChild.remove();
  });
}

/* ================= drawing (canvas, requestAnimationFrame) ================= */
const canvas = $('#canvas'), ctx = canvas.getContext('2d');
const CONE_H = 96, CONE_W = 92;
const view = {
  cw: 0, ch: 0, s: 1, camY: -CONE_H - 20, swingX: 0, fall: null, debris: [], last: 0,
  reset() { this.camY = -CONE_H - 20; this.fall = null; this.debris = []; this.swingX = 0; },
  vh() { return this.ch / this.s; },
  swingY() { return (T ? T.height : 0) * R.SCOOP_H + R.SCOOP_H * 2.6; },
};
function resize() {
  const r = $('#field').getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
  if (!r.width) return;
  canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
  view.cw = canvas.width; view.ch = canvas.height;
  view.s = Math.min(view.cw / (R.FIELD + 20), view.ch / 420);
}
// Pseudo-random from a number, for sprinkles that stay put.
const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const SPRINKLES = ['#ff5a5f', '#2bc48a', '#4d9de0', '#ffc233', '#ffffff', '#8f6bff'];
// One scoop: a domed blob with a drippy bottom edge, a shine and some sprinkles. bx, by = bottom centre (px).
function drawScoop(c, bx, by, w, h, colour, seed, lw) {
  const l = bx - w / 2, r = bx + w / 2, t = by - h, rad = Math.min(h * 0.95, w / 2);
  c.beginPath();
  c.moveTo(l, by - h * 0.15);
  c.lineTo(l, t + rad);
  c.quadraticCurveTo(l, t, l + rad, t);
  c.lineTo(r - rad, t);
  c.quadraticCurveTo(r, t, r, t + rad);
  c.lineTo(r, by - h * 0.15);
  const n = Math.max(2, Math.round(w / (h * 0.8))), seg = w / n;
  for (let i = 0; i < n; i++) {
    const x0 = r - i * seg, drip = (hash(seed * 7 + i) > 0.6 ? 0.42 : 0.16) * h;
    c.quadraticCurveTo(x0 - seg / 2, by + drip, x0 - seg, by - h * 0.15);
  }
  c.closePath();
  c.fillStyle = colour; c.fill();
  c.lineWidth = lw; c.strokeStyle = INK; c.lineJoin = 'round'; c.stroke();
  c.save(); c.clip();
  c.fillStyle = '#ffffff70';
  c.beginPath(); c.ellipse(l + w * 0.28, t + h * 0.32, Math.max(2, w * 0.12), h * 0.14, -0.3, 0, Math.PI * 2); c.fill();
  const k = Math.min(7, Math.floor(w / (h * 0.55)));
  for (let i = 0; i < k; i++) {
    const sx = l + w * (0.12 + 0.76 * hash(seed * 13 + i)), sy = t + h * (0.25 + 0.5 * hash(seed * 29 + i));
    c.save(); c.translate(sx, sy); c.rotate(hash(seed * 3 + i) * Math.PI);
    c.fillStyle = SPRINKLES[Math.floor(hash(seed * 17 + i) * SPRINKLES.length)];
    const sl = Math.max(3, h * 0.2), sw = Math.max(1.5, h * 0.07);
    c.fillRect(-sl / 2, -sw / 2, sl, sw);
    c.restore();
  }
  c.restore();
}
function drawCone(c, cx, topY, w, h, lw) {
  c.beginPath(); c.moveTo(cx - w / 2, topY); c.lineTo(cx + w / 2, topY); c.lineTo(cx, topY + h); c.closePath();
  c.fillStyle = '#f0b465'; c.fill();
  c.save(); c.clip();
  c.strokeStyle = '#c47f35'; c.lineWidth = lw * 0.8;
  for (let i = -6; i <= 6; i++) {
    c.beginPath(); c.moveTo(cx + i * w * 0.16, topY); c.lineTo(cx + i * w * 0.16 + h * 0.8, topY + h); c.stroke();
    c.beginPath(); c.moveTo(cx + i * w * 0.16, topY); c.lineTo(cx + i * w * 0.16 - h * 0.8, topY + h); c.stroke();
  }
  c.restore();
  c.beginPath(); c.moveTo(cx - w / 2, topY); c.lineTo(cx + w / 2, topY); c.lineTo(cx, topY + h); c.closePath();
  c.lineWidth = lw; c.strokeStyle = INK; c.lineJoin = 'round'; c.stroke();
}
const sx = (x) => view.cw / 2 + x * view.s;
const sy = (y) => view.ch - (y - view.camY) * view.s;

function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min(50, t - (view.last || t));
  view.last = t;
  if (!RD || !T || !document.querySelector('#screen-play.active')) return;
  if (!view.cw) resize();
  const el = t - RD.t0;
  // countdown and clock
  const cnt = $('#count');
  if (el < 0) { cnt.hidden = false; cnt.textContent = Math.ceil(-el / 1000); }
  else if (el < 700) { cnt.hidden = false; cnt.textContent = 'Scoop!'; }
  else cnt.hidden = true;
  const left = Math.max(0, Math.ceil((R.DURATION - Math.max(0, el)) / 1000));
  $('#clock').textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  $('#clock').classList.toggle('hurry', left <= 10);
  if (el >= 0 && !T.out && el < R.DURATION && !view.fall) view.swingX = R.step(T, dt, t);
  const wob = R.wobbling(T, t);
  $('#field').classList.toggle('wobbling', wob);

  // camera follows the top of the tower
  const want = Math.max(-CONE_H - 20, view.swingY() + R.SCOOP_H - view.vh() * 0.78);
  view.camY += (want - view.camY) * Math.min(1, dt / 160);

  const c = ctx, s = view.s, lw = Math.max(1.5, 2.6 * s), hpx = R.SCOOP_H * s;
  c.clearRect(0, 0, view.cw, view.ch);
  drawCone(c, sx(0), sy(0) - hpx * 0.1, CONE_W * s, CONE_H * s, lw);
  // the tower (only the scoops on screen)
  const lo = Math.max(0, Math.floor(view.camY / R.SCOOP_H) - 1), hi = T.stack.length;
  for (let i = lo; i < hi; i++) {
    const sc = T.stack[i];
    let y = i * R.SCOOP_H;
    if (view.fall && view.fall.idx === i) {
      const p = Math.min(1, (t - view.fall.start) / 130);
      y = view.fall.from + (view.fall.to - view.fall.from) * p * p;
      if (p >= 1) {
        if (view.fall.cut) view.debris.push({ x: view.fall.cut.x, y: view.fall.to, w: view.fall.cut.w, f: sc.f, vx: Math.sign(view.fall.cut.x - sc.x) * 50, vy: 0, rot: 0, vr: Math.sign(view.fall.cut.x - sc.x) * 4 });
        view.fall = null;
      }
    }
    if (sy(y) - hpx > view.ch + hpx) continue;
    drawScoop(c, sx(sc.x), sy(y) + hpx * 0.12, sc.w * s, hpx * 1.12, R.flavourAt(sc.f).c, i + 1, lw);
  }
  // the swinging scoop on its spoon string
  if (!T.out && el < R.DURATION && !view.fall) {
    const y = sy(view.swingY()), x = sx(view.swingX);
    c.save();
    c.setLineDash([4 * s, 4 * s]); c.strokeStyle = '#2b214066'; c.lineWidth = Math.max(1, 1.6 * s);
    c.beginPath(); c.moveTo(sx(0), 0); c.lineTo(x, y - hpx); c.stroke();
    c.restore();
    if (wob) { c.save(); c.translate(x, y); c.rotate(Math.sin(t / 60) * 0.12); c.translate(-x, -y); }
    drawScoop(c, x, y, T.w * s, hpx * 1.12, R.flavourAt(T.height).c, T.height + 1, lw);
    if (wob) c.restore();
    // a faint guide where the scoop below sits
    c.fillStyle = '#2b214018';
    c.fillRect(sx(T.x - T.w / 2), sy(T.height * R.SCOOP_H) - 2, T.w * s, 3);
  }
  // falling bits
  view.debris = view.debris.filter((d) => {
    d.vy -= 900 * dt / 1000; d.y += d.vy * dt / 1000; d.x += d.vx * dt / 1000; d.rot += d.vr * dt / 1000;
    const px = sx(d.x), py = sy(d.y);
    if (py > view.ch + 200) return false;
    c.save(); c.translate(px, py); c.rotate(d.rot);
    drawScoop(c, 0, 0, d.w * s, hpx * 1.12, R.flavourAt(d.f).c, 99, lw);
    c.restore();
    return true;
  });
}
requestAnimationFrame(frame);

function heroArt() {
  const cv = $('#hero-art'), c = cv.getContext('2d'), w = cv.width;
  drawCone(c, w / 2, 120, 64, 70, 2.5);
  [[0, 84], [4, 78], [-6, 70], [3, 62]].forEach(([dx, sw], i) => drawScoop(c, w / 2 + dx, 124 - i * 22, sw, 25, R.flavourAt(i).c, i + 1, 2.5));
  drawScoop(c, w / 2 + 52, 24, 58, 25, R.flavourAt(4).c, 9, 2.5);
}

/* ================= the end ================= */
let saved = null;
function finish(res) {
  if (!RD) return;
  RD.over = true;
  RD.board = res.board || RD.board;
  clearInterval(hostTimer);
  setTimeout(() => { if (RD && RD.gid === res.gid) renderEnd(res); }, 900);
  banner('Time! Spoons down 🥄', '');
}
function renderEnd(res) {
  const pl = (k) => res.players.find((p) => p.k === k) || { name: '?', avatar: '🙂' };
  const idx = (k) => res.players.findIndex((p) => p.k === k);
  const ranked = res.ranked, b = res.board || {};
  const winK = R.winners(ranked).map((s) => s.k);
  const iWon = winK.includes(myK);
  $('#end-title').textContent = iWon ? (winK.length > 1 ? 'A tie at the top! 🍦' : 'Tower Boss! You won 🎉') : `${firstName(pl(ranked[0].k).name)} wins`;
  const medal = ['🏆', '🥈', '🥉', '🫠'];
  const last = ranked[ranked.length - 1].place;
  $('#podium').innerHTML = ranked.map((s) => {
    const p = pl(s.k), mood = s.place === 1 ? 'cheer' : s.place === last ? 'sulk' : 'happy';
    return `<div class="sc-pod p${s.place}" style="--c:${SEAT_COLORS[idx(s.k)] || '#fff'}">
      <span class="medal">${medal[s.place - 1] || '🍦'}</span><span class="av">${avatarHTML(p.avatar, mood)}</span>
      <b>${escapeHtml(firstName(p.name))}${s.k === myK ? ' (you)' : ''}</b>
      <span class="left">${s.h || 0} scoop${s.h === 1 ? '' : 's'} · ${s.perfects || 0} perfect${s.perfects === 1 ? '' : 's'}</span></div>`;
  }).join('');
  const top = (f) => { const best = ranked.slice().sort((x, y) => (y[f] || 0) - (x[f] || 0))[0]; return best && best[f] > 0 ? best : null; };
  const awards = [
    ['h', '🍦', 'Tower Boss', (n) => `${n} scoop${n === 1 ? '' : 's'} high`],
    ['perfects', '🤌', 'Perfectionist', (n) => `${n} perfect drop${n > 1 ? 's' : ''}`],
    ['wob', '🌀', 'Wobble Master', (n) => `Sent ${n} wobble${n > 1 ? 's' : ''}`],
    ['splats', '🫠', 'Floor Dessert', (n) => `${n} splat${n > 1 ? 's' : ''}`],
  ].map(([f, icon, title, why]) => { const s = top(f); return s ? { icon, title, who: s.k === myK ? 'You' : firstName(pl(s.k).name), why: why(s[f]) } : null; }).filter(Boolean);
  $('#awards').innerHTML = awards.map((a) => `<div class="award"><span class="icon">${a.icon}</span><div><b>${escapeHtml(a.title)}</b><span>${escapeHtml(a.who)}</span><small>${escapeHtml(a.why)}</small></div></div>`).join('');
  const canRematch = isHost() && room;
  $('#btn-again').hidden = !canRematch;
  $('#end-wait').hidden = canRematch;
  $('#end-wait').textContent = res.hostLeft ? 'The host left 👋' : `Waiting for ${firstName(pl(hostK).name)} to start a rematch…`;
  show('end');
  if (iWon) { sfx.win(); bigConfetti(); }
  saveRound(res, winK);
  if (isHost() && mode === 'host') sendRoom();
}
function saveRound(res, winK) {
  if (saved === res.gid || !me || typeof records === 'undefined') return;
  saved = res.gid;
  const nm = (k) => (res.players.find((p) => p.k === k) || {}).name || '?';
  const b = res.board || {};
  records.game({
    kind: 'scoop', gid: res.gid, room: roomCode || null, practice: mode === 'cpu', startedAt: res.at,
    players: res.ranked.map((s) => ({ name: nm(s.k), bot: !!(res.players.find((p) => p.k === s.k) || {}).bot, place: s.place, score: s.h || 0 })),
    winners: winK.map(nm),
    stats: Object.fromEntries(res.players.map((p) => { const s = b[p.k] || {}; return [p.name, { height: s.h || 0, perfects: s.perfects || 0, splats: s.splats || 0, wobblesSent: s.wob || 0 }]; })),
    hits: (res.hits || []).map((h) => ({ kind: 'splat', by: nm(h.by), to: nm(h.to) })),
  });
  if (typeof showRewards === 'function') showRewards($('#awards').parentElement, res.gid);
}

/* ================= wiring ================= */
$('#btn-create').onclick = () => { sfx.pop(); createRoom(); };
$('#btn-cpu').onclick = () => { sfx.pop(); practice(); };
$('#btn-join').onclick = () => { sfx.pop(); joinRoom($('#join-code').value); };
$('#join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(e.target.value); });
$('#btn-resume').onclick = () => { const last = store.get('scoop-lastroom', null); if (last) joinRoom(last.code); };
$('#btn-room-back').onclick = leaveToHome;
$('#btn-start').onclick = () => { sfx.pop(); startRound(); };
$('#btn-leave').onclick = () => { if (confirm('Leave the game?')) leaveToHome(); };
$('#btn-end-home').onclick = leaveToHome;
$('#btn-again').onclick = () => { if (isHost() && room) { sfx.pop(); startRound(); } };
$('#btn-mute').onclick = (e) => setIcon(e.currentTarget, sfx.toggle() ? 'mute' : 'volume');
$('#btn-wobble').onclick = (e) => { e.stopPropagation(); tryWobble(); };
$('#btn-share').onclick = async () => {
  const code = $('#room-code').textContent, link = `${location.origin}${location.pathname}?room=${code}`;
  if (navigator.share) { try { await navigator.share({ title: 'Scoop Stack', text: `Bring a spoon: ${code}`, url: link }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(link); toast('Invite link copied 💌'); } catch (e) { prompt('Copy this link:', link); }
};
// Tap or click anywhere on your tower to drop.
$('#field').addEventListener('pointerdown', (e) => { if (e.target.closest('button')) return; e.preventDefault(); tryDrop(); });
chat.mountTools($('#chat-tools'), { compact: true });
document.addEventListener('keydown', (e) => {
  if (!document.querySelector('#screen-play.active') || e.ctrlKey || e.metaKey || e.altKey || chat.typing(e)) return;
  if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); if (!e.repeat) tryDrop(); }
  else if (e.key.toLowerCase() === 'w') tryWobble();
  else if (e.key === 'Enter' && !e.target.closest('button')) { e.preventDefault(); chat.open(true); }
});
new ResizeObserver(resize).observe($('#field'));
addEventListener('pagehide', () => { if (mode) teardown(); });
document.addEventListener('profilechange', renderHomeBits);

document.addEventListener('DOMContentLoaded', () => {
  hydrateIcons();
  if (sfx.muted) setIcon($('#btn-mute'), 'mute');
  applyPalette();
  wireProfileSheet();
  heroArt();
  sfx.load();
  requireLogin().then(() => {
    goHome();
    const code = new URLSearchParams(location.search).get('room');
    if (code) { history.replaceState(null, '', location.pathname); $('#join-code').value = code.toUpperCase(); joinRoom(code); }
    else if (typeof showHowTo === 'function') showHowTo('scoop', [{ icon: "🍦", title: "Drop", text: "Press Space or tap when the swinging scoop is over your tower." }, { icon: "🎯", title: "Aim for Perfect", text: "Only the overlap stays. A dead-centre drop grows it back." }, { icon: "🌀", title: "Wobble them", text: "3 perfects in a row charge a Wobble: press W to shake your rival." }], { title: 'How to play Scoop Stack' });
  });
});
