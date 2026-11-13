'use strict';
/* Snakes & Ladders: roll, climb, slide, and bonk your friends back down. The host's browser runs the
   rules (snakes/rules.js); everyone else sends it "roll". Every update carries a list of events,
   and each screen plays those as token hops, climbs and slides before settling on the new state.
   If the host leaves, the next player carries on from a private backup of the game. */
const R = window.SnakesRules;
const NS = 'snakes-rr7';
const SEAT_COLORS = ['#ff5a5f', '#4d9de0', '#2bc48a', '#ffc233'];
const BOT_NAMES = ['Bot Bonky', 'Robo Rani', 'Chip'];
const SNAKE_COLORS = ['#2bc48a', '#ff5a5f', '#8f6bff', '#ffc233', '#4d9de0', '#ff8fc8', '#ff9f43', '#2ad0c1'];
const LINES = {
  snake: ['Hissss. Down you go, {n} 🐍', 'Nope noodle. Bye bye, {n} 🐍', 'Slippery! {n} slides to {x} 🐍', '{n} stepped on a snake. Rude. 🐍'],
  ladder: ['Ladder secured. Don\'t look down 🪜', '{n} is going up! 🪜', 'Express lift for {n} to {x} 🪜'],
  bonk: ['BONK! {b} sent {n} back to {x} 💥', 'Revenge served by {b} 😈', '{n} got bonked. Ouch. 💥'],
  six: ['A six! Roll again 🎲', 'Six! {n} is on a roll 🎲'],
  three: ['Three sixes. Calm down, {n} 😅'],
  bounce: ['Too far! {n} bounces back 🏀', 'Overshot! Boing 🏀'],
  win: ['{n} wins! 🏆', '{n} made it to 100! 🏆'],
};
const NOPE = { turn: 'Not your turn yet 🙂' };
const oneOf = (a) => a[Math.floor(Math.random() * a.length)];
const line = (k, o = {}) => oneOf(LINES[k]).replace('{n}', o.n || '').replace('{x}', o.x || '').replace('{b}', o.b || '')
  .replace(/, You/, '').replace('You is', 'You are').replace('by You', 'by you');
const firstName = (name) => String(name).split(' ').pop();
const avHTML = (a) => (typeof avatarHTML === 'function' ? avatarHTML(a) : escapeHtml(a));

/* ================= sounds ================= */
const sfx = (() => {
  const p = createSamplePlayer({ takes: { pop: ['ui-pop-1.ogg', 'ui-pop-2.ogg'], drop: ['ui-drop-1.ogg', 'ui-drop-2.ogg'], pick: ['ui-pick.ogg'], shine: ['ui-shine.ogg'], win: ['ui-levelup.ogg'], slide: ['card-slide-1.ogg', 'card-slide-2.ogg'] } });
  const { sample } = p;
  return {
    load: p.load,
    roll() { sample('drop', { vol: 0.55 }); },
    hop() { sample('pop', { vol: 0.18, rate: 1.15 }); },
    ladder() { sample('shine', { vol: 0.5 }); },
    snake() { sample('slide', { vol: 0.7, rate: 0.75 }); sample('slide', { vol: 0.4, rate: 0.7, when: 0.35 }); },
    bonk() { sample('drop', { vol: 0.9, rate: 0.8 }); sample('pop', { vol: 0.5, when: 0.05 }); },
    win() { sample('win', { vol: 0.6 }); },
    nope() { sample('drop', { vol: 0.25, rate: 0.7 }); },
    pop() { sample('pick', { vol: 0.35 }); },
    chat() { sample('pop', { vol: 0.25 }); },
    get muted() { return p.muted; },
    toggle: p.toggle,
  };
})();

/* ================= app state ================= */
let mode = null;      // 'host' | 'guest' | 'cpu' (host with no network)
let session = 0;      // bumped when leaving, so stale async work bails out
let room = null;      // host: { code, epoch, seats: [{ k, name, avatar, bot, link }], started }
let conn = null;      // guest: link to the host
let myK = null, hostK = null, roomCode = '';
let G = null;         // host: the whole game
let view = null;      // the last state this screen settled on
let backup = null;    // guest next in line to host: a copy of G
let offline = new Set(); // players who dropped mid-game; a bot rolls for them
let timers = [];
const alive = (my) => () => my === session;
const later = (ms, fn) => timers.push(setTimeout(fn, ms));
const isHost = () => mode === 'host' || mode === 'cpu';

function show(screen) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === 'screen-' + screen));
  document.body.classList.toggle('in-game', screen === 'play');
  chat.setInGame(screen === 'play' || screen === 'end');
}
function teardown() {
  session++;
  timers.forEach(clearTimeout); timers = [];
  clearTimeout(botTimer);
  const oldRoom = room, oldConn = conn;
  room = null; conn = null;
  if (oldConn) { try { oldConn.close(); } catch (e) {} }
  if (oldRoom) oldRoom.seats.forEach((s) => { try { s.link && s.link.close(); } catch (e) {} });
  closeAllClients();
  mode = null; G = null; view = null; myK = null; hostK = null; backup = null; offline = new Set();
  queue.length = 0; shown.gid = null; waiting = false;
  chat.reset();
}
function goHome(error = '') {
  teardown();
  show('home');
  renderHomeBits();
  $('#home-error').textContent = error;
}
function leaveToHome() { store.del('snakes-lastroom'); goHome(); }
function renderHomeBits() {
  if (me) $('#me-avatar').innerHTML = avHTML(myAvatar());
  const last = store.get('snakes-lastroom', null), fresh = last && Date.now() - last.at < 3 * 3600e3;
  $('#btn-resume').hidden = !fresh;
  if (fresh) $('#resume-code').textContent = last.code;
}
const rememberRoom = (code) => code && store.set('snakes-lastroom', { code, at: Date.now() });

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
      html += `<div class="seat" style="--c:${SEAT_COLORS[i]}"><span class="av">${avHTML(s.avatar)}</span><span class="nm">${escapeHtml(s.name)}${s.name === me.name && !s.bot ? ' (you)' : ''}</span>${right}</div>`;
    } else if (amHost && i === n) {
      html += `<button class="seat empty" type="button" data-addbot><span class="av">${ic('plus')}</span><span class="nm">Add a bot</span><span class="st">or wait for a friend</span></button>`;
    } else html += `<div class="seat empty"><span class="av"></span><span class="nm">Open seat</span></div>`;
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

/* ================= host: running the game ================= */
const seatOf = (k) => room && room.seats.find((s) => s.k === k);
const connected = (k) => k === myK || !!(seatOf(k) && (seatOf(k).bot || (seatOf(k).link && seatOf(k).link.open)));
const playerOf = (k) => (G || view || { players: [] }).players.find((p) => p.k === k);
const nameOf = (k) => (k === myK ? 'You' : playerOf(k) ? firstName(playerOf(k).name) : '?');
const colorOf = (k) => SEAT_COLORS[Math.max(0, (view || G || { players: [] }).players.findIndex((p) => p.k === k))];

function startGame() {
  if (!room) return;
  const seats = room.seats.filter((s) => connected(s.k));
  if (seats.length < 2) return toast('You need at least 2 players 🙂');
  G = R.newGame(seats.map((s) => ({ k: s.k, name: s.name, avatar: s.avatar, bot: !!s.bot })), (Math.random() * 2 ** 31) | 0);
  G.gid = Math.random().toString(36).slice(2, 10);
  G.at = Date.now();
  G.v = 0;
  G.events.push({ t: 'start' });
  room.started = true;
  offline = new Set();
  rememberRoom(room.code);
  push();
}
const viewOf = () => ({ ...R.viewFor(G), gid: G.gid, at: G.at, v: G.v, offline: [...offline] });
// The first human after the host takes over if the host leaves. Guests work this out the same way.
const successor = () => (G.players.find((p) => !p.bot && p.k !== myK && !offline.has(p.k) && connected(p.k)) || {}).k;

function push() {
  if (!G) return;
  G.v++;
  const evs = G.events;
  G.events = [];
  const s = viewOf();
  if (room) {
    const next = successor();
    room.seats.forEach((seat) => {
      if (!seat.link || !seat.link.open) return;
      const msg = { t: 's', s, ev: evs, you: seat.k, hostK: myK, epoch: room.epoch };
      if (seat.k === next) msg.backup = G;
      seat.link.send(msg);
    });
  }
  receive({ s, ev: evs });
  botReactions(evs);
  driveBots();
}

function hostHandle(k, m) {
  if (!G || !m) return;
  if (m.t !== 'roll') return;
  const r = R.roll(G, k);
  if (r.ok) push();
  else tell(k, r.why);
}
function tell(k, why) {
  if (!NOPE[why]) return;
  if (k === myK) return nope(why);
  const s = seatOf(k);
  if (s && s.link && s.link.open) s.link.send({ t: 'nope', why });
}
function nope(why) {
  toast(NOPE[why] || 'Nope 🙅');
  sfx.nope();
  waiting = false;
  renderDie();
}

/* ---------- bots (and stand-ins for players who dropped) ---------- */
let botTimer = 0;
function driveBots() {
  clearTimeout(botTimer);
  if (!G || G.winner) return;
  const k = R.cur(G), p = G.players.find((x) => x.k === k);
  if (!p.bot && !offline.has(k)) return;
  const { gid, v } = G;
  whenIdle().then(() => {
    if (!G || G.gid !== gid || G.v !== v) return;
    const wait = offline.has(k) && !p.bot ? 5000 : 600 + Math.random() * 600;
    botTimer = setTimeout(() => {
      if (!G || G.gid !== gid || G.v !== v) return;
      hostHandle(k, R.botMove(G, k));
    }, wait);
  });
}

/* ---------- chat (shared/chat.js) ---------- */
const chat = createChat({
  send: (m) => sendSocial(m),
  game: 'snakes', room: () => roomCode || null,
  players: () => ((view || G) ? (view || G).players.map((p, i) => ({ k: p.k, name: p.name, color: SEAT_COLORS[i] })) : []),
  me: () => myK,
  anchor: (k) => rowEl(k),
  stage: () => $('#table'),
  stickers: {
    hiss: ['Hissss 🐍', '#2bc48a'], up: ['Going up 🪜', '#ffc233'], bonk: ['BONK 💥', '#ff5a5f'],
    six: ['Gimme a 6 🎲', '#4d9de0'], gg: ['GG 🤝', '#ffffff'], revenge: ['Revenge is coming', '#c9a7ff'],
  },
  dockAt: 1100,
  sound: (kind) => (kind === 'in' ? sfx.chat() : sfx.pop()),
});
function relaySocial(m, except) {
  if (room) room.seats.forEach((s) => s.link && s.link.open && s.link !== except && s.link.send({ t: 'social', m }));
}
function sendSocial(m) {
  if (isHost()) relaySocial(m, null);
  else if (conn && conn.open) conn.send({ t: 'social', m });
}
// Bots sulk when a snake gets them and gloat when they bonk you.
function botReactions(evs) {
  const bot = (k) => { const p = G.players.find((x) => x.k === k); return p && p.bot; };
  const say = (k, e) => later(900 + Math.random() * 700, () => { const m = { t: 'react', e, from: k }; if (chat.receive(m)) relaySocial(m, null); });
  evs.forEach((e) => {
    if (e.t === 'snake' && bot(e.k) && e.from - e.to > 15 && Math.random() < 0.7) say(e.k, '😭');
    else if (e.t === 'bonk' && bot(e.by) && Math.random() < 0.7) say(e.by, '😈');
    else if (e.t === 'bonk' && bot(e.k) && Math.random() < 0.5) say(e.k, '😱');
  });
}
function act(m) {
  if (isHost()) hostHandle(myK, m);
  else if (conn && conn.open) conn.send(m);
}

/* ---------- hosting ---------- */
async function createRoom() {
  if (typeof mqtt === 'undefined') return goHome('Could not load the online library. Check your internet 🙏');
  teardown();
  const my = session;
  mode = 'host'; myK = 'a'; hostK = 'a';
  room = { code: genCode('S'), epoch: 0, seats: [{ k: 'a', name: me.name, avatar: myAvatar() }], started: false };
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
  startGame();
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
      seat = room.seats.find((s) => !s.bot && s.name === name);
      if (room.started && !seat) return reject('This game already started. Catch the next one 🙂');
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
      if (room.started && G) {
        offline.delete(seat.k);
        c.send({ t: 's', s: viewOf(), ev: [], fresh: true, you: seat.k, hostK: myK, epoch: room.epoch });
        toast(`${firstName(name)} is back 👋`);
        push();
      } else {
        sendRoom();
        toast(`${firstName(name)} joined 🎉`);
      }
      return;
    }
    if (state !== 'ok' || seat.link !== c || !d) return;
    if (d.t === 'social') {
      if (G && d.m && typeof d.m === 'object') { const m = { ...d.m, from: seat.k }; if (chat.receive(m)) relaySocial(m, c); }
      return;
    }
    hostHandle(seat.k, d);
  });
  c.on('close', () => {
    if (!room || !seat || seat.link !== c) return;
    seat.link = null;
    if (!room.started) { room.seats.splice(room.seats.indexOf(seat), 1); sendRoom(); return; }
    if (!G || G.winner) return;
    offline.add(seat.k);
    toast(`${firstName(seat.name)} dropped out. A bot rolls for them until they're back.`, 3500);
    push();
  });
}

// The host left mid-game: the next player in line carries on from their backup copy.
function takeOver(code, epoch, saved) {
  const mine = myK, oldHost = hostK;
  teardown();
  const my = session;
  mode = 'host'; myK = mine; hostK = mine; roomCode = code;
  G = saved;
  G.events = [];
  room = { code, epoch, started: true, seats: G.players.map((p) => ({ k: p.k, name: p.name, avatar: p.avatar, bot: p.bot })) };
  offline = new Set(G.players.filter((p) => !p.bot && p.k !== mine).map((p) => p.k));
  rememberRoom(code);
  toast(`${firstName((G.players.find((p) => p.k === oldHost) || {}).name || 'The host')} left, so you're hosting now 👑`, 3500);
  hostListen({ code, ns: NS, epoch, alive: alive(my), onLink: handlePlayer }).then(() => { if (my === session) push(); });
}

/* ---------- joining ---------- */
function joinRoom(code, { minEpoch = 0, resume = false } = {}) {
  code = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) { $('#home-error').textContent = 'Room codes are 6 letters or numbers 🙂'; return; }
  if (typeof mqtt === 'undefined') { $('#home-error').textContent = 'Could not load the online library. Check your internet 🙏'; return; }
  const keep = resume ? { k: myK, view } : null;
  teardown();
  const my = session;
  mode = 'guest'; roomCode = code;
  if (keep) { myK = keep.k; view = keep.view; }
  if (!resume) {
    $('#room-title').textContent = 'Joining…'; $('#room-code').textContent = code; $('#code-hint').textContent = 'Room code';
    $('#seats').innerHTML = ''; $('#btn-start').hidden = true;
    $('#room-wait').hidden = false; $('#room-wait').innerHTML = 'Knocking on the door<span class="dots"><i>.</i><i>.</i><i>.</i></span>';
    show('room');
  } else toast('The host left. Reconnecting…', 3000);
  const giveUp = setTimeout(() => { if (my === session && !conn) { goHome('No answer from that room 🤔 Is anyone still in it?'); $('#join-code').value = code; } }, resume ? 30000 : 20000);
  knock({
    code, ns: NS, minEpoch, alive: alive(my),
    hello: { user: me.user || me.name, proof: me.proof, avatar: myAvatar() },
    onConnected(link, epoch) { conn = link; wireGuest(link, giveUp, code, epoch); },
  });
}
function wireGuest(link, giveUp, code, epoch) {
  link.on('data', (d) => {
    if (d.t === 'room') {
      clearTimeout(giveUp);
      if (Array.isArray(d.seats) && !document.querySelector('#screen-play.active')) { renderRoom(d); show('room'); }
    } else if (d.t === 's' && d.s && Array.isArray(d.s.players)) {
      clearTimeout(giveUp);
      myK = d.you; hostK = d.hostK;
      backup = d.backup || null;
      rememberRoom(code);
      receive({ s: d.s, ev: Array.isArray(d.ev) ? d.ev : [], fresh: !!d.fresh });
    } else if (d.t === 'social' && d.m) chat.receive(d.m);
    else if (d.t === 'nope') nope(d.why);
    else if (d.t === 'reject') { clearTimeout(giveUp); goHome(String(d.why || 'Could not join')); }
  });
  link.on('close', () => {
    if (mode !== 'guest' || conn !== link) return;
    if (view && !view.winner && hostK) return handOver(code, epoch, view);
    goHome(view && view.winner ? '' : 'Connection dropped. Tap Join to hop back in!');
    $('#join-code').value = code;
  });
}
// Everyone runs the same choice, so they all agree on who hosts next.
function handOver(code, epoch, v) {
  const stay = v.players.filter((p) => !p.bot && p.k !== hostK && !(v.offline || []).includes(p.k)).map((p) => p.k);
  if (stay[0] === myK) {
    if (backup) return takeOver(code, epoch + 1, backup);
    return goHome('The host left before the game could be handed over 😢');
  }
  if (!stay.length) return goHome('The host left 👋');
  joinRoom(code, { minEpoch: epoch + 1, resume: true });
}

/* ================= the board ================= */
// Board units: the board is 1000 x 1000, each square 100. Square centres:
function centre(n) {
  const c = R.coord(n);
  return { x: c.col * 100 + 50, y: (9 - c.row) * 100 + 50 };
}
// A wiggly snake from head to tail, as a list of points (used for drawing and for the slide).
const snakeCache = {};
function snakePoints(head) {
  if (snakeCache[head]) return snakeCache[head];
  const a = centre(head), b = centre(R.SNAKES[head]);
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy), px = -dy / len, py = dx / len;
  const waves = Math.max(1, Math.round(len / 260)), amp = Math.min(42, 14 + len / 14), N = 48, pts = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, off = Math.sin(t * Math.PI * 2 * waves) * amp * Math.sin(Math.PI * Math.min(1, t * 1.15));
    pts.push({ x: a.x + dx * t + px * off, y: a.y + dy * t + py * off });
  }
  return (snakeCache[head] = pts);
}
const d3 = (n) => n.toFixed(1);
function snakeSVG(head, i) {
  const pts = snakePoints(head), col = SNAKE_COLORS[i % SNAKE_COLORS.length];
  const d = 'M' + pts.map((p) => `${d3(p.x)} ${d3(p.y)}`).join(' L');
  const h = pts[0], n = pts[3], ang = Math.atan2(h.y - n.y, h.x - n.x) * 180 / Math.PI;
  const t = pts[pts.length - 1];
  return `<g class="sn-snake">
    <path d="${d}" stroke="#2b2140" stroke-width="40"/>
    <path d="${d}" stroke="${col}" stroke-width="29"/>
    <path d="${d}" stroke="#ffffff66" stroke-width="9" stroke-dasharray="2 22"/>
    <circle cx="${d3(t.x)}" cy="${d3(t.y)}" r="9" fill="${col}" stroke="#2b2140" stroke-width="5"/>
    <g transform="translate(${d3(h.x)} ${d3(h.y)}) rotate(${d3(ang)})">
      <path d="M26 0 l22 0 l7 -7 M48 0 l7 7" stroke="#ff3b5c" stroke-width="5" fill="none"/>
      <ellipse cx="4" cy="0" rx="32" ry="26" fill="${col}" stroke="#2b2140" stroke-width="6"/>
      <circle cx="10" cy="-11" r="9" fill="#fff" stroke="#2b2140" stroke-width="3.5"/><circle cx="13" cy="-11" r="4.2" fill="#2b2140"/>
      <circle cx="10" cy="11" r="9" fill="#fff" stroke="#2b2140" stroke-width="3.5"/><circle cx="13" cy="11" r="4.2" fill="#2b2140"/>
    </g></g>`;
}
function ladderSVG(foot) {
  const a = centre(foot), b = centre(R.LADDERS[foot]);
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len, px = -uy * 24, py = ux * 24;
  const s = { x: a.x - ux * 18, y: a.y - uy * 18 }, e = { x: b.x + ux * 18, y: b.y + uy * 18 };
  const L = (x1, y1, x2, y2) => `M${d3(x1)} ${d3(y1)} L${d3(x2)} ${d3(y2)}`;
  const rails = L(s.x + px, s.y + py, e.x + px, e.y + py) + L(s.x - px, s.y - py, e.x - px, e.y - py);
  let rungs = '';
  const n = Math.max(2, Math.floor((len + 36) / 46));
  for (let i = 1; i < n; i++) {
    const t = i / n, x = s.x + (e.x - s.x) * t, y = s.y + (e.y - s.y) * t;
    rungs += L(x + px, y + py, x - px, y - py);
  }
  return `<g class="sn-ladder">
    <path d="${rungs}" stroke="#2b2140" stroke-width="13"/><path d="${rungs}" stroke="#ffd98a" stroke-width="6"/>
    <path d="${rails}" stroke="#2b2140" stroke-width="16"/><path d="${rails}" stroke="#c98a4b" stroke-width="8"/>
  </g>`;
}
function buildBoard(el) {
  let cells = '';
  for (let row = 9; row >= 0; row--) {
    for (let col = 0; col < 10; col++) {
      const n = row * 10 + (row % 2 === 0 ? col + 1 : 10 - col);
      const special = R.SNAKES[n] ? ' head' : R.LADDERS[n] ? ' foot' : n === 100 ? ' goal' : '';
      cells += `<div class="sn-cell${(row + col) % 2 ? ' alt' : ''}${special}"><b>${n}</b></div>`;
    }
  }
  const ladders = Object.keys(R.LADDERS).map((f) => ladderSVG(+f)).join('');
  const snakes = Object.keys(R.SNAKES).map((h, i) => snakeSVG(+h, i)).join('');
  el.innerHTML = `<div class="sn-grid">${cells}</div>
    <svg class="sn-art" viewBox="0 0 1000 1000" aria-hidden="true">${ladders}${snakes}</svg>
    <div class="sn-tokens"></div>`;
}

/* ================= the table: an animation queue in front of the state =================
   `shown` is what's on screen right now. Animations change it one event at a time, then
   sync() snaps everything to the real state in case anything drifted. */
const shown = { gid: null, pos: {} };
const queue = [];
let running = false, idleWaiters = [], waiting = false;
function receive(m) {
  queue.push(m);
  waiting = false;
  if (!running) run();
}
async function run() {
  running = true;
  renderDie();
  const my = session;
  play: while (queue.length && my === session) {
    const m = queue.shift();
    if (m.s.gid !== shown.gid) enterGame(m.s);
    const fast = m.fresh || queue.length > 2 || document.hidden;
    if (!fast) {
      for (const e of m.ev || []) {
        try { await animate(e, m.s); } catch (err) { console.error(err); }
        if (my !== session) break play;
      }
    }
    view = m.s;
    sync();
  }
  running = false;
  if (queue.length) return run();
  renderDie();
  idleWaiters.splice(0).forEach((f) => f());
}
const whenIdle = () => (running ? new Promise((r) => idleWaiters.push(r)) : Promise.resolve());

function enterGame(v) {
  shown.gid = v.gid;
  shown.pos = { ...v.pos };
  view = view && view.gid === v.gid ? view : v;
  buildBoard($('#board'));
  $('#board .sn-tokens').innerHTML = v.players.map((p, i) =>
    `<div class="sn-tok${p.k === myK ? ' me' : ''}" data-k="${p.k}" style="--c:${SEAT_COLORS[i]}"><span>${avHTML(p.avatar)}</span></div>`).join('');
  $('#room-chip').textContent = mode === 'cpu' ? 'Practice' : roomCode;
  $('#room-chip').hidden = !roomCode && mode !== 'cpu';
  $('#ticker').textContent = '';
  buildPlayers(v);
  show('play');
  layoutTokens();
}

/* ---------- tokens ---------- */
const tokEl = (k) => $(`#board .sn-tok[data-k="${k}"]`);
const OFFS = [[0, 0], [[-17, -14], [17, 14]], [[-18, -14], [18, -14], [0, 16]], [[-17, -15], [17, -15], [-17, 15], [17, 15]]];
// Where token k sits on square n, nudged aside when others share the square.
function spot(k, n) {
  const ks = (view ? view.players : []).map((p) => p.k).filter((x) => shown.pos[x] === n);
  const c = centre(n), i = ks.indexOf(k), o = ks.length > 1 ? OFFS[ks.length - 1][i] || [0, 0] : [0, 0];
  return { x: c.x + o[0], y: c.y + o[1] };
}
function put(k, p, transition = '') {
  const el = tokEl(k);
  if (!el) return;
  el.style.transition = transition;
  el.style.left = p.x / 10 + '%';
  el.style.top = p.y / 10 + '%';
}
function layoutTokens(except) {
  if (!view) return;
  view.players.forEach((p) => { if (p.k !== except && shown.pos[p.k]) put(p.k, spot(p.k, shown.pos[p.k]), 'left .25s ease, top .25s ease'); });
  if (view) view.players.forEach((p) => { const el = tokEl(p.k); if (el) el.classList.toggle('turn', view.turn === p.k && !view.winner); });
}
function lift(k) { const el = tokEl(k); if (el) el.parentNode.appendChild(el); }

/* ---------- the side panel ---------- */
const rowEl = (k) => $(`.sn-pl[data-k="${k}"]`);
function buildPlayers(v) {
  $('#players').innerHTML = v.players.map((p, i) => `<div class="sn-pl" data-k="${p.k}" style="--c:${SEAT_COLORS[i]}">
      <span class="av">${avHTML(p.avatar)}</span>
      <span class="nm">${escapeHtml(p.k === myK ? 'You' : firstName(p.name))}${p.bot ? ` ${ic('bot')}` : ''}</span>
      <span class="sq"></span><span class="mini"></span></div>`).join('');
}
function renderPlayers() {
  const v = view, st = v.stats || {};
  v.players.forEach((p) => {
    const el = rowEl(p.k);
    if (!el) return;
    const s = st[p.k] || {};
    el.classList.toggle('turn', v.turn === p.k && !v.winner);
    el.classList.toggle('away', (v.offline || []).includes(p.k));
    el.querySelector('.sq').textContent = shown.pos[p.k] || 1;
    el.querySelector('.mini').textContent = `🪜${s.ladders || 0} 🐍${s.snakes || 0} 💥${s.bonksGiven || 0}${(v.offline || []).includes(p.k) ? ' 📴' : ''}`;
  });
}
function renderStatus() {
  const v = view, el = $('#status'), mine = v.turn === myK && !v.winner;
  el.classList.toggle('mine', mine);
  el.style.setProperty('--c', colorOf(v.turn));
  if (mine) el.innerHTML = v.streak ? 'Six! <b>Roll again</b> 🎲' : 'Your roll! 🎲';
  else {
    const p = playerOf(v.turn), who = p ? escapeHtml(firstName(p.name)) : '…';
    el.innerHTML = p && (p.bot || (v.offline || []).includes(p.k)) ? `${who} is rolling<span class="dots"><i>.</i><i>.</i><i>.</i></span>` : `${who}'s turn`;
  }
}
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
function faceHTML(d) { return Array.from({ length: 9 }, (_, i) => `<i${PIPS[d].includes(i) ? ' class="on"' : ''}></i>`).join(''); }
function setFace(d) { $('#die-face').innerHTML = faceHTML(d); }
function renderDie() {
  const v = view, ready = !!(v && v.turn === myK && !v.winner && !running && !waiting);
  $('#die').classList.toggle('ready', ready);
  $('#die').style.setProperty('--c', v ? colorOf(v.turn) : '#fff');
  $('#die').disabled = !ready;
}
function ticker(text) {
  const t = $('#ticker');
  t.textContent = text;
  retrigger(t, 'show');
}

/* ---------- settle on the real state ---------- */
function sync() {
  const v = view;
  if (!v) return;
  if (v.winner) { renderEnd(); show('end'); return; }
  if (!document.querySelector('#screen-play.active')) show('play');
  shown.pos = { ...v.pos };
  layoutTokens();
  renderPlayers(); renderStatus(); renderDie();
}

/* ---------- critters react: on the token and in the side panel ---------- */
function react(k, mood, ms) {
  const p = view && view.players.find((x) => x.k === k);
  if (!p) return;
  const tok = tokEl(k), row = rowEl(k);
  critterReact(tok && tok.querySelector('span'), p.avatar, mood, ms);
  critterReact(row && row.querySelector('.av'), p.avatar, mood, ms);
}

/* ---------- animations ---------- */
async function animate(e, v) {
  const n = nameOf(e.k);
  if (e.t === 'roll') {
    sfx.roll();
    const die = $('#die');
    die.style.setProperty('--c', colorOf(e.k));
    retrigger(die, 'tumble');
    for (let i = 0; i < 6; i++) { setFace(1 + Math.floor(Math.random() * 6)); await sleep(60); }
    setFace(e.d);
    await sleep(220);
    if (e.d === 6 && e.streak >= R.MAX_SIXES) ticker(line('three', { n }));
  } else if (e.t === 'move') {
    lift(e.k);
    for (const sq of e.path) {
      shown.pos[e.k] = sq;
      put(e.k, centre(sq), 'left .15s ease-out, top .15s ease-out');
      retrigger(tokEl(e.k), 'hop');
      sfx.hop();
      await sleep(190);
    }
    if (e.bounce) ticker(line('bounce', { n }));
    layoutTokens(); renderPlayers();
    await sleep(120);
  } else if (e.t === 'ladder') {
    sfx.ladder();
    shown.pos[e.k] = e.to;
    put(e.k, centre(e.to), 'left .8s cubic-bezier(.45,0,.25,1), top .8s cubic-bezier(.45,0,.25,1)');
    ticker(line('ladder', { n, x: e.to }));
    await sleep(850);
    sparkle(tokEl(e.k));
    react(e.k, e.to - e.from >= 30 ? 'cheer' : 'smug');
    layoutTokens(); renderPlayers();
  } else if (e.t === 'snake') {
    sfx.snake();
    ticker(line('snake', { n, x: e.to }));
    const el = tokEl(e.k), pts = snakePoints(e.from);
    el.style.transition = 'none';
    const frames = pts.map((p) => ({ left: p.x / 10 + '%', top: p.y / 10 + '%' }));
    const anim = el.animate(frames, { duration: 1300, easing: 'cubic-bezier(.5,0,.6,1)' });
    shown.pos[e.k] = e.to;
    put(e.k, centre(e.to), 'none');
    el.classList.add('dizzy');
    react(e.k, 'sulk', 3200);
    await finished(anim, 1300);
    el.classList.remove('dizzy');
    layoutTokens(); renderPlayers();
    await sleep(150);
  } else if (e.t === 'bonk') {
    const el = tokEl(e.k);
    sfx.bonk();
    burst(el, 'BONK!');
    react(e.by, 'smug');
    react(e.k, 'sulk', 3200);
    retrigger($('#board'), 'shake');
    ticker(line('bonk', { n, b: nameOf(e.by), x: e.to }));
    lift(e.k);
    const a = spot(e.k, e.from);
    shown.pos[e.k] = e.to;
    const b = spot(e.k, e.to), mid = { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - 220 };
    el.style.transition = 'none';
    const pct = (p) => ({ left: p.x / 10 + '%', top: p.y / 10 + '%' });
    const anim = el.animate([{ ...pct(a), transform: 'scale(1) rotate(0)' },
      { ...pct(mid), transform: 'scale(1.7) rotate(360deg)', offset: 0.45 },
      { ...pct(b), transform: 'scale(1) rotate(720deg)' }], { duration: 1000, easing: 'ease-in-out' });
    put(e.k, b, 'none');
    await finished(anim, 1000);
    layoutTokens(); renderPlayers();
    await sleep(200);
  } else if (e.t === 'again') {
    ticker(line('six', { n }));
    if (e.k === myK) retrigger($('#status'), 'bump');
  } else if (e.t === 'win') {
    sfx.win();
    view.players.forEach((p) => react(p.k, p.k === e.k ? 'cheer' : 'sulk', 4000));
    bigConfetti();
    slamText(e.k === myK ? 'YOU WIN! 🏆' : line('win', { n }));
    await sleep(2200);
  } else if (e.t === 'start') {
    ticker('Everyone on square 1. Good luck! 🍀');
  }
}
// Some browsers never settle a finished animation in a background tab, so don't wait forever.
const finished = (anim, ms) => Promise.race([anim.finished.catch(() => {}), sleep(ms + 150)]);
function fxAt(el, cls, html, ms) {
  if (!el) return;
  const [x, y] = centerOf(el), d = document.createElement('div');
  d.className = cls;
  d.innerHTML = html;
  d.style.left = x + 'px'; d.style.top = y + 'px';
  $('#fx').appendChild(d);
  setTimeout(() => d.remove(), ms);
}
const burst = (el, text) => fxAt(el, 'sn-burst', `<b>${escapeHtml(text)}</b>`, 1300);
function sparkle(el) { if (el) { const [x, y] = centerOf(el); confetti(x, y, 14, 70, ['#ffd98a', '#fff', '#ffc233']); } }
function slamText(text) {
  const d = document.createElement('div');
  d.className = 'sn-slam';
  d.textContent = text;
  $('#fx').appendChild(d);
  setTimeout(() => d.remove(), 2200);
}

/* ---------- your input ---------- */
function tryRoll() {
  const v = view;
  if (!v || running || waiting || v.winner) return;
  if (v.turn !== myK) return nope('turn');
  waiting = true;
  renderDie();
  act({ t: 'roll' });
  setTimeout(() => { if (waiting) { waiting = false; renderDie(); } }, 4000);
}
$('#die').onclick = tryRoll;
chat.mountTools($('#chat-tools'), { compact: true });
document.addEventListener('keydown', (e) => {
  if (!document.querySelector('#screen-play.active') || e.ctrlKey || e.metaKey || e.altKey || chat.typing(e)) return;
  if (e.key === ' ' || e.key === 'Enter' || e.key.toLowerCase() === 'r') { e.preventDefault(); tryRoll(); }
});

/* ================= the end ================= */
// Send the finished game to the shared history (shared/records.js). A hit is a bonk.
function saveGame(v, ranked) {
  const nm = (k) => playerOf(k).name;
  records.game({
    kind: 'snakes', gid: v.gid, room: roomCode || null, practice: mode === 'cpu', startedAt: v.at,
    players: v.players.map((p) => ({ name: p.name, bot: !!p.bot, place: ranked.indexOf(p) + 1, score: v.pos[p.k] })),
    winners: [nm(v.winner)],
    stats: Object.fromEntries(v.players.map((p) => [p.name, { ...(v.stats || {})[p.k], square: v.pos[p.k] }])),
    hits: (v.hits || []).map((h) => ({ kind: 'bonk', by: nm(h.by), to: nm(h.to) })),
  });
  if (typeof showRewards === 'function') showRewards($('#awards').parentElement, v.gid); // +XP and new trophies on the end screen
}
let saved = null;
function renderEnd() {
  const v = view, stats = v.stats || {};
  const ranked = v.players.slice().sort((a, b) => (a.k === v.winner ? -1 : b.k === v.winner ? 1 : v.pos[b.k] - v.pos[a.k]));
  if (saved !== v.gid && me) { saved = v.gid; saveGame(v, ranked); }
  const medal = ['🏆', '🥈', '🥉', '🫠'];
  $('#end-title').textContent = v.winner === myK ? 'You won! 🎉' : `${firstName(playerOf(v.winner).name)} won`;
  $('#podium').innerHTML = ranked.map((p, i) => `<div class="sn-pod p${i + 1}" style="--c:${SEAT_COLORS[v.players.indexOf(p)]}">
      <span class="medal">${medal[i]}</span><span class="av">${avHTML(p.avatar)}</span><b>${escapeHtml(firstName(p.name))}${p.k === myK ? ' (you)' : ''}</b>
      <span class="left">${p.k === v.winner ? 'Made it to 100!' : `Square ${v.pos[p.k]}`}</span></div>`).join('');
  const name = (k) => firstName(playerOf(k).name);
  const top = (field) => {
    const best = v.players.slice().sort((a, b) => ((stats[b.k] || {})[field] || 0) - ((stats[a.k] || {})[field] || 0))[0];
    return best && stats[best.k] && stats[best.k][field] > 0 ? best : null;
  };
  const plural = (n, w) => `${n} ${w}${n > 1 ? 's' : ''}`;
  const awards = [
    ['snakes', '🐍', 'Snake Charmer', (n) => `Slid down ${plural(n, 'snake')}`],
    ['ladders', '🪜', 'Ladder Climber', (n, s) => `Climbed ${plural(n, 'ladder')} (longest: ${s.longest})`],
    ['bonksTaken', '💥', 'Bonked Most', (n) => `Got bonked ${plural(n, 'time')}`],
    ['bonksGiven', '😈', 'Revenge Dealer', (n) => `Bonked others ${plural(n, 'time')}`],
    ['sixes', '🎲', 'Lucky Sixes', (n) => `Rolled ${plural(n, 'six')}`.replace('sixs', 'sixes')],
  ].map(([f, icon, title, why]) => { const p = top(f); return p ? { icon, title, who: name(p.k), why: why(stats[p.k][f], stats[p.k]) } : null; }).filter(Boolean);
  $('#awards').innerHTML = awards.map((a) => `<div class="award"><span class="icon">${a.icon}</span><div><b>${escapeHtml(a.title)}</b><span>${escapeHtml(a.who)}</span><small>${escapeHtml(a.why)}</small></div></div>`).join('');
  $('#btn-again').hidden = !isHost();
  $('#end-wait').hidden = isHost();
  $('#end-wait').textContent = `Waiting for ${firstName(playerOf(hostK) ? playerOf(hostK).name : 'the host')} to start a rematch…`;
}

/* ================= wiring ================= */
function heroArt() { buildBoard($('#hero-art')); }
$('#btn-create').onclick = () => { sfx.pop(); createRoom(); };
$('#btn-cpu').onclick = () => { sfx.pop(); practice(); };
$('#btn-join').onclick = () => { sfx.pop(); joinRoom($('#join-code').value); };
$('#join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(e.target.value); });
$('#btn-resume').onclick = () => { const last = store.get('snakes-lastroom', null); if (last) joinRoom(last.code); };
$('#btn-room-back').onclick = leaveToHome;
$('#btn-start').onclick = () => { sfx.pop(); startGame(); };
$('#btn-leave').onclick = () => { if (confirm('Leave the game?')) leaveToHome(); };
$('#btn-end-home').onclick = leaveToHome;
$('#btn-again').onclick = () => { if (isHost() && room) { room.seats = room.seats.filter((s) => connected(s.k)); startGame(); } };
$('#btn-mute').onclick = (e) => setIcon(e.currentTarget, sfx.toggle() ? 'mute' : 'volume');
$('#btn-share').onclick = async () => {
  const code = $('#room-code').textContent, link = `${location.origin}${location.pathname}?room=${code}`;
  if (navigator.share) { try { await navigator.share({ title: 'Snakes & Ladders', text: `Snakes are hungry. Come play: ${code}`, url: link }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(link); toast('Invite link copied 💌'); } catch (e) { prompt('Copy this link:', link); }
};
addEventListener('pagehide', () => { if (mode) teardown(); });
document.addEventListener('profilechange', renderHomeBits);

document.addEventListener('DOMContentLoaded', () => {
  hydrateIcons();
  if (sfx.muted) setIcon($('#btn-mute'), 'mute'); // mute is remembered across pages
  applyPalette();
  wireProfileSheet();
  heroArt();
  setFace(1);
  sfx.load();
  requireLogin().then(() => {
    goHome();
    const code = new URLSearchParams(location.search).get('room');
    if (code) { history.replaceState(null, '', location.pathname); $('#join-code').value = code.toUpperCase(); joinRoom(code); }
    else if (typeof showHowTo === 'function') showHowTo('snakes', [{ icon: "🎲", title: "Roll", text: "Press Space or tap the die. A 6 rolls again." }, { icon: "🪜", title: "Climb and slide", text: "Ladders lift you up, snakes drop you down. Exact roll to land on 100." }, { icon: "💥", title: "Bonk a friend", text: "Land right on someone and they slide back to their last ladder." }], { title: 'How to play Snakes & Ladders' });
  });
});
