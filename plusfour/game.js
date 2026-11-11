'use strict';
/* Plus Four: match the colour or the number, get rid of every card. The host's browser runs the
   rules (plusfour/rules.js); everyone else sends it their moves. Every update carries a list of
   events, and each screen plays those as card animations before settling on the new state.
   If the host leaves, the next player carries on from a private backup of the game. */
const R = window.PlusFourRules, C = window.PlusFourCards;
const NS = 'plusfour-rr7';
const SEAT_COLORS = ['#ff5a5f', '#4d9de0', '#2bc48a', '#ffc233'];
const BOT_NAMES = ['Bot Bonky', 'Robo Rani', 'Chip'];
const ORDER = { r: 0, y: 1, g: 2, b: 3, w: 4 };
const VORDER = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'skip', 'rev', 'd2', 'wild', 'w4'];
const LINES = {
  stack: ['📦 Special delivery: {x} cards for {n}', '{n} is collecting cards now 🃏', 'That\'s {x} cards for {n}. Oof. 😬'],
  skip: ['{n} got skipped 🚫', 'Not today, {n} 🙅', 'Sit this one out, {n}'],
  caught: ['{b} caught {n} napping 😴 +2', 'BUSTED! {n} forgot to say Ouch 🚨'],
  reverse: ['Plot twist! 🔄', 'Other way round now 🔄', 'U-turn! 🔄'],
  dud: ['{n} drew a dud 🤷', 'No luck for {n} 🤷'],
  win: ['{n} wins! 🏆', '{n} is out of cards! 🏆'],
};
const NOPE = {
  turn: 'Not your turn yet 🙂', match: 'That card doesn\'t match 🙅', drawn: 'Play the card you drew, or keep it',
  shout: 'Ouch is for when you\'re down to 1 card 😅', catch: 'Too late, they\'re safe now 🏃', color: 'Pick a colour first',
};
const oneOf = (a) => a[Math.floor(Math.random() * a.length)];
const line = (k, o = {}) => oneOf(LINES[k]).replace('{n}', o.n || '').replace('{x}', o.x || '').replace('{b}', o.b || '');
const firstName = (name) => String(name).split(' ').pop();

/* ================= sounds =================
   Real recorded card sounds (shared/sounds, CC0 from Kenney): slides, places, shoves, a riffle
   shuffle and a fan. Each play picks a random take and nudges its pitch so repeats sound natural.
   The few non-card moments (Ouch, caught, win) are soft wooden notes. */
const sfx = (() => {
  const TAKES = { slide: 8, place: 4, shove: 4, fan: 2, shuffle: 1 };
  const p = createSamplePlayer({ takes: Object.fromEntries(Object.entries(TAKES).map(([name, n]) =>
    [name, Array.from({ length: n }, (_, i) => `card-${name}${n > 1 ? '-' + (i + 1) : ''}.ogg`)])) });
  const { sample, note } = p;
  return {
    load: p.load,
    slide() { sample('slide', { vol: 0.55 }); },
    land() { sample('place', { vol: 0.7 }); },
    slam() { sample('shove', { vol: 0.9, rate: 0.92 }); sample('place', { vol: 0.6, when: 0.02 }); },
    draw() { sample('slide', { vol: 0.5, rate: 1.05 }); },
    shuffle() { sample('shuffle', { vol: 0.75 }); },
    fan() { sample('fan', { vol: 0.6 }); },
    skip() { sample('shove', { vol: 0.5, rate: 1.1 }); },
    ouch() { note(659); note(880, 0.08); },
    caught() { sample('shove', { vol: 0.6 }); note(392, 0.08, 0.045); note(330, 0.22, 0.045); },
    win() { sample('fan', { vol: 0.6 }); [523, 659, 784, 1047].forEach((f, k) => note(f, 0.1 + k * 0.11, 0.06)); },
    nope() { sample('place', { vol: 0.3, rate: 0.85 }); },
    pop() { sample('place', { vol: 0.25, rate: 1.3 }); },
    chat() { note(988, 0, 0.03); },
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
let G = null;         // host: the whole game, every hand included
let view = null;      // the last state this screen settled on
let backup = null;    // guest next in line to host: a copy of G
let offline = new Set(); // players who dropped mid-game; a bot plays for them
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
  queue.length = 0; shown.gid = null; predicted = null; closePicker(null);
  chat.reset();
}
function goHome(error = '') {
  teardown();
  show('home');
  renderHomeBits();
  $('#home-error').textContent = error;
}
function leaveToHome() { store.del('plusfour-lastroom'); goHome(); }
function renderHomeBits() {
  if (me) setAvatar($('#me-avatar'), myAvatar());
  const last = store.get('plusfour-lastroom', null), fresh = last && Date.now() - last.at < 3 * 3600e3;
  $('#btn-resume').hidden = !fresh;
  if (fresh) $('#resume-code').textContent = last.code;
}
const rememberRoom = (code) => code && store.set('plusfour-lastroom', { code, at: Date.now() });

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
    } else html += `<div class="seat empty"><span class="av"></span><span class="nm">Open seat</span></div>`;
  }
  $('#seats').innerHTML = html;
  $('#btn-start').hidden = !amHost;
  $('#btn-start').disabled = n < 2;
  const wait = $('#room-wait');
  wait.hidden = amHost && n >= 2;
  wait.innerHTML = amHost ? 'Waiting for a friend (or add a bot)<span class="dots"><i>.</i><i>.</i><i>.</i></span>'
    : `Waiting for ${escapeHtml(firstName(p.host))} to deal<span class="dots"><i>.</i><i>.</i><i>.</i></span>`;
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

function startGame() {
  if (!room) return;
  const seats = room.seats.filter((s) => connected(s.k));
  if (seats.length < 2) return toast('You need at least 2 players 🙂');
  G = R.newGame(seats.map((s) => ({ k: s.k, name: s.name, avatar: s.avatar, bot: !!s.bot })), (Math.random() * 2 ** 31) | 0);
  G.gid = Math.random().toString(36).slice(2, 10);
  G.at = Date.now();
  G.v = 0;
  room.started = true;
  offline = new Set();
  rememberRoom(room.code);
  push();
}
// The view each player gets, plus the bits only the room knows.
const viewOf = (k) => ({ ...R.viewFor(G, k), gid: G.gid, at: G.at, v: G.v, offline: [...offline] });
// The first human after the host takes over if the host leaves. Guests work this out the same way.
const successor = () => (G.players.find((p) => !p.bot && p.k !== myK && !offline.has(p.k) && connected(p.k)) || {}).k;

function push() {
  if (!G) return;
  G.v++;
  const evs = G.events;
  G.events = [];
  if (room) {
    const next = successor();
    room.seats.forEach((s) => {
      if (!s.link || !s.link.open) return;
      const msg = { t: 's', s: viewOf(s.k), ev: R.eventsFor(evs, s.k), you: s.k, hostK: myK, epoch: room.epoch };
      if (s.k === next) msg.backup = G;
      s.link.send(msg);
    });
  }
  receive({ s: viewOf(myK), ev: R.eventsFor(evs, myK) });
  botReactions(evs);
  driveBots();
}

// Everything a player can do goes through here: the host's own clicks and messages from guests.
function hostHandle(k, m) {
  if (!G || !m) return;
  let r;
  if (m.t === 'play') r = R.play(G, k, String(m.id), m.color);
  else if (m.t === 'draw') r = R.draw(G, k);
  else if (m.t === 'pass') r = R.pass(G, k);
  else if (m.t === 'ouch') r = R.shout(G, k);
  else if (m.t === 'catch') r = R.catchOut(G, k, String(m.k));
  else return;
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
  // The host said no to a card that already flew: put the table back the way it really is.
  if (predicted) {
    const p = predicted;
    predicted = null;
    waiting = false;
    p.done.then(() => { if (view && !running) sync(); });
  }
}

/* ---------- bots (and stand-ins for players who dropped) ---------- */
let botTimer = 0;
const planned = new WeakSet();
function driveBots() {
  clearTimeout(botTimer);
  if (!G || G.winner) return;
  const auto = (k) => { const p = G.players.find((x) => x.k === k); return p.bot || offline.has(k); };
  // A bot with one card usually remembers to shout. Bots also try to catch whoever forgot.
  if (G.ouch && !G.ouch.said && !planned.has(G.ouch)) {
    planned.add(G.ouch);
    const vk = G.ouch.k;
    if (auto(vk) && Math.random() < 0.8) later(500 + Math.random() * 700, () => hostHandle(vk, { t: 'ouch' }));
    G.players.filter((p) => p.bot && p.k !== vk).forEach((p) => later(1600 + Math.random() * 2400, () => hostHandle(p.k, { t: 'catch', k: vk })));
  }
  const k = R.cur(G);
  if (!auto(k)) return;
  const { gid, v } = G;
  whenIdle().then(() => {
    if (!G || G.gid !== gid || G.v !== v) return;
    // Leave a moment to catch someone who forgot to shout before the next move closes the window.
    const grace = G.ouch && !G.ouch.said ? 1800 : 0;
    const wait = (offline.has(k) && !playerOf(k).bot ? 5000 : 650 + Math.random() * 550) + grace;
    botTimer = setTimeout(() => {
      if (!G || G.gid !== gid || G.v !== v) return;
      hostHandle(k, R.botMove(G, k));
    }, wait);
  });
}

/* ---------- chat (shared/chat.js) ---------- */
const chat = createChat({
  send: (m) => sendSocial(m),
  game: 'plusfour', room: () => roomCode || null,
  players: () => ((view || G) ? (view || G).players.map((p, i) => ({ k: p.k, name: p.name, color: SEAT_COLORS[i], avatar: p.avatar })) : []),
  me: () => myK,
  anchor: (k) => seatEl(k),
  stage: () => $('#table'),
  stickers: {
    plus4: ['Take that +4 😈', '#ff5a5f'], ouch: ['OUCH 😵', '#ffc233'], slow: ['Any day now… ⏳', '#4d9de0'],
    lucky: ['Lucky draw 🍀', '#2bc48a'], gg: ['GG 🤝', '#ffffff'], revenge: ['Revenge is coming', '#c9a7ff'],
  },
  dockAt: 1150,
  sound: (kind) => (kind === 'in' ? sfx.chat() : sfx.pop()),
});
function relaySocial(m, except) {
  if (room) room.seats.forEach((s) => s.link && s.link.open && s.link !== except && s.link.send({ t: 'social', m }));
}
function sendSocial(m) {
  if (isHost()) relaySocial(m, null);
  else if (conn && conn.open) conn.send({ t: 'social', m });
}
// Bots have feelings too: they gloat over a +4 and sulk when a stack lands on them.
function botReactions(evs) {
  const bot = (k) => { const p = G.players.find((x) => x.k === k); return p && p.bot; };
  const say = (k, e) => later(500 + Math.random() * 700, () => { const m = { t: 'react', e, from: k }; if (chat.receive(m)) relaySocial(m, null); });
  evs.forEach((e) => {
    if (e.t === 'play' && e.card.v === 'w4' && bot(e.k) && Math.random() < 0.6) say(e.k, '😈');
    else if (e.t === 'draw' && e.why === 'stack' && e.ids.length >= 4 && bot(e.k) && Math.random() < 0.7) say(e.k, '😭');
    else if (e.t === 'caught' && bot(e.by)) say(e.by, '😂');
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
  room = { code: genCode('P'), epoch: 0, seats: [{ k: 'a', name: me.name, avatar: myAvatar() }], started: false };
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
        c.send({ t: 's', s: viewOf(seat.k), ev: [], fresh: true, you: seat.k, hostK: myK, epoch: room.epoch });
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
    toast(`${firstName(seat.name)} dropped out. A bot plays for them until they're back.`, 3500);
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

/* ================= the table: an animation queue in front of the state =================
   `shown` is what's on screen right now. Animations change it one event at a time, then
   sync() snaps everything to the real state in case anything drifted. */
const shown = { gid: null, hand: [], counts: {}, pile: [], color: 'r', dir: 1, pending: 0 };
const queue = [];
let running = false, idleWaiters = [], waiting = false;
function receive(m) {
  queue.push(m);
  waiting = false;
  if (!running) run();
}
async function run() {
  running = true;
  renderButtons();
  const my = session;
  // Leaving a room (or taking over as host) mid-animation drops this update; the next one redraws everything.
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
  renderButtons(); layoutHand();
  idleWaiters.splice(0).forEach((f) => f());
}
const whenIdle = () => (running ? new Promise((r) => idleWaiters.push(r)) : Promise.resolve());

function enterGame(v) {
  shown.gid = v.gid;
  shown.hand = []; shown.counts = {}; shown.pile = [];
  $('#hand').innerHTML = '';
  $('#pile').querySelectorAll('.pf-card').forEach((c) => c.remove());
  $('#flight').innerHTML = '';
  buildSeats(v);
  $('#room-chip').textContent = mode === 'cpu' ? 'Practice' : roomCode;
  $('#room-chip').hidden = !roomCode && mode !== 'cpu';
  show('play');
  layoutHand();
}

/* ---------- seats ---------- */
function seatOrder(v) {
  const i = Math.max(0, v.players.findIndex((p) => p.k === myK));
  return v.players.slice(i + 1).concat(v.players.slice(0, i));
}
function buildSeats(v) {
  const others = seatOrder(v);
  const spots = { 1: ['top'], 2: ['tl', 'tr'], 3: ['left', 'top', 'right'] }[others.length] || [];
  const col = (k) => SEAT_COLORS[v.players.findIndex((p) => p.k === k)];
  $('#seats-layer').innerHTML = others.map((p, i) => `<div class="pf-seat pos-${spots[i]}" data-k="${p.k}" style="--c:${col(p.k)}">
      <div class="pf-mini"></div>
      <div class="who"><span class="av">${avatarHTML(p.avatar)}</span><span class="nm">${escapeHtml(firstName(p.name))}</span><span class="count">0</span><span class="tag"></span></div>
      <button class="pf-catch" type="button" data-catch="${p.k}" hidden>Catch! <kbd>C</kbd></button>
    </div>`).join('');
  const mine = v.players.find((p) => p.k === myK);
  $('#me-seat').style.setProperty('--c', col(myK));
  $('#me-seat').innerHTML = mine ? `<div class="who"><span class="av">${avatarHTML(mine.avatar)}</span><span class="nm">You</span><span class="count">0</span></div>` : '';
  shown.counts = {};
}
const seatEl = (k) => (k === myK ? $('#me-seat') : $(`.pf-seat[data-k="${k}"]`));
const miniOf = (k) => seatEl(k) && seatEl(k).querySelector('.pf-mini');
const MAX_BACKS = 12;
// Show n face-down cards in someone's fan. Returns the backs added, hidden if asked (so cards can fly into them).
function setCount(k, n, { hide = false } = {}) {
  shown.counts[k] = n;
  const seat = seatEl(k);
  if (!seat) return [];
  seat.querySelector('.count').textContent = n;
  const mini = miniOf(k);
  if (!mini) return [];
  const want = Math.min(n, MAX_BACKS), added = [];
  while (mini.children.length < want) { const b = C.make(null); if (hide) b.style.visibility = 'hidden'; mini.appendChild(b); added.push(b); }
  while (mini.children.length > want) mini.lastChild.remove();
  C.fan([...mini.children], { width: 190, cw: cssPx(mini, '--cw', 46), maxSpread: 44, bend: -0.0025 });
  return added;
}
const cssPx = (el, name, fallback) => parseFloat(getComputedStyle(el).getPropertyValue(name)) || fallback;

/* ---------- your hand ---------- */
const sortCards = (a) => a.slice().sort((x, y) => ORDER[x.c] - ORDER[y.c] || VORDER.indexOf(x.v) - VORDER.indexOf(y.v) || (x.id < y.id ? -1 : 1));
const handEl = (id) => $('#hand').querySelector(`.pf-card[data-id="${id}"]`);
let hoverId = null, focusIdx = -1;
// Make the hand hold exactly these cards. New ones can start hidden ("ghost") for a card to fly into.
function setHand(cards, { ghost = [] } = {}) {
  shown.hand = sortCards(cards);
  const box = $('#hand'), ids = new Set(shown.hand.map((c) => c.id));
  [...box.children].forEach((el) => { if (!ids.has(el.dataset.id)) el.remove(); });
  shown.hand.forEach((c) => {
    if (handEl(c.id)) return;
    const el = C.make(c);
    if (ghost.includes(c.id)) el.classList.add('ghost');
    box.appendChild(el);
  });
  if (focusIdx >= shown.hand.length) focusIdx = shown.hand.length - 1;
  const mine = seatEl(myK);
  if (mine && mine.querySelector('.count')) mine.querySelector('.count').textContent = shown.hand.length;
  layoutHand();
}
function playableIds() {
  const v = view;
  if (!v || running || waiting || v.winner || v.turn !== myK) return new Set();
  const fake = { pending: v.pending, pendingKind: v.pendingKind, color: v.color, discard: v.top };
  return new Set(shown.hand.filter((c) => (!v.drawn || c.id === v.drawn) && R.canPlay(fake, c)).map((c) => c.id));
}
function layoutHand() {
  const box = $('#hand'), ok = playableIds();
  const els = shown.hand.map((c) => handEl(c.id)).filter(Boolean);
  const hover = els.findIndex((el) => el.dataset.id === hoverId);
  els.forEach((el, i) => { el.classList.toggle('ok', ok.has(el.dataset.id)); el.classList.toggle('focus', i === focusIdx); el.style.setProperty('--i', i); });
  box.classList.toggle('my-turn', !!(view && view.turn === myK && !view.winner && !running));
  C.fan(els, { width: Math.min(box.clientWidth - 40, 1100), cw: cssPx(box, '--cw', 104), hover: hover >= 0 ? hover : focusIdx });
}

/* ---------- the middle: deck, pile, colour, direction ---------- */
function renderDeck(n) {
  const deck = $('#deck'), layers = Math.max(1, Math.min(7, Math.ceil(n / 14)));
  const have = deck.querySelectorAll('.pf-card');
  if (have.length !== layers) {
    have.forEach((c) => c.remove());
    for (let i = 0; i < layers; i++) { const b = C.make(null); b.style.setProperty('--i', i); deck.insertBefore(b, $('#deck-n')); }
  }
  $('#deck-n').textContent = n;
}
const deckTop = () => { const all = $('#deck').querySelectorAll('.pf-card'); return all[all.length - 1]; };
// Every card lands in its own messy spot on the pile, the same on every screen.
function spotFor(id) {
  let h = 2166136261;
  for (const ch of String(id)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return C.pileSpot(() => ((h = Math.imul(h ^ (h >>> 13), 0x5bd1e995)) >>> 0) / 4294967296);
}
function pileTarget(card) {
  const r = $('#pile').getBoundingClientRect(), s = spotFor(card.id);
  return { x: r.left + r.width / 2 + s.dx, y: r.top + r.height / 2 + s.dy, w: r.width, rot: s.rot };
}
function placeOnPile(el, card) {
  const s = spotFor(card.id);
  C.settle(el);
  el.className = 'pf-card';
  el.style.setProperty('--dx', s.dx + 'px'); el.style.setProperty('--dy', s.dy + 'px'); el.style.setProperty('--rot', s.rot + 'deg');
  $('#pile').insertBefore(el, $('#ring'));
  shown.pile.push(card);
  const cards = $('#pile').querySelectorAll('.pf-card');
  if (cards.length > 6) cards[0].remove();
  shown.pile = shown.pile.slice(-6);
}
function syncPile(top) {
  const now = shown.pile.map((c) => c.id).join(), want = top.map((c) => c.id).join();
  if (now === want) return;
  $('#pile').querySelectorAll('.pf-card').forEach((c) => c.remove());
  shown.pile = [];
  top.forEach((c) => placeOnPile(C.make(c), c));
}
function renderCentre() {
  $('#ring').style.setProperty('--ring', C.HEX[shown.color]);
  $('#table').style.setProperty('--active', C.HEX[shown.color]);
  $('#dir').classList.toggle('ccw', shown.dir < 0);
  const p = $('#pending');
  p.hidden = !shown.pending;
  p.textContent = '+' + shown.pending;
}

/* ---------- settle on the real state ---------- */
function sync() {
  const v = view;
  if (!v) return;
  if (v.winner) { renderEnd(); show('end'); return; }
  if (!document.querySelector('#screen-play.active')) show('play');
  if (v.players.some((p) => p.k !== myK && !seatEl(p.k))) buildSeats(v);
  v.players.forEach((p) => { if (p.k !== myK) setCount(p.k, p.n); });
  setHand(v.hand);
  syncPile(v.top);
  Object.assign(shown, { color: v.color, dir: v.dir, pending: v.pending });
  renderDeck(v.drawN);
  renderCentre(); renderSeatsInfo(); renderStatus(); renderButtons();
}
// A soft spotlight glides to whoever's turn it is.
function moveSpot(k) {
  const el = seatEl(k), spot = $('#spot');
  if (!el || !spot) return;
  const r = el.getBoundingClientRect(), t = $('#table').getBoundingClientRect();
  spot.style.left = r.left - t.left + r.width / 2 + 'px';
  spot.style.top = r.top - t.top + r.height / 2 + 'px';
}
function renderSeatsInfo() {
  const v = view;
  moveSpot(v.turn);
  v.players.forEach((p) => {
    const el = seatEl(p.k);
    if (!el) return;
    el.classList.toggle('turn', v.turn === p.k);
    el.classList.toggle('away', (v.offline || []).includes(p.k));
    const tag = el.querySelector('.tag');
    if (tag) tag.textContent = (v.offline || []).includes(p.k) ? '📴' : v.ouch && v.ouch.k === p.k && v.ouch.said ? '😱' : '';
    const btn = el.querySelector('.pf-catch');
    if (btn) btn.hidden = !(v.ouch && !v.ouch.said && v.ouch.k === p.k);
  });
}
function renderStatus() {
  const v = view, el = $('#status');
  const mine = v.turn === myK;
  el.classList.toggle('mine', mine);
  const top = v.top[v.top.length - 1];
  const want = top && top.c !== 'w' && /^\d$/.test(top.v) ? `${C.COLORS[v.color]} or a ${top.v}` : C.COLORS[v.color];
  if (mine) {
    el.innerHTML = v.pending ? `Stack a +${v.pendingKind === 'w4' ? '4' : '2'}, or take <b>${v.pending}</b> 😬`
      : v.drawn ? 'You drew a match! Play it, or keep it'
      : `Your turn! Match <b>${want}</b>`;
  } else {
    const p = playerOf(v.turn);
    const who = p ? escapeHtml(firstName(p.name)) : '…';
    el.innerHTML = p && (p.bot || (v.offline || []).includes(p.k)) ? `${who} is thinking<span class="dots"><i>.</i><i>.</i><i>.</i></span>` : `${who}'s turn`;
  }
}
function renderButtons() {
  const v = view;
  const mine = !!(v && v.turn === myK && !v.winner), busy = running || waiting;
  const handN = shown.hand.length, ok = playableIds();
  $('#btn-draw').hidden = !mine || !!v.drawn;
  $('#btn-draw').disabled = busy;
  $('#btn-draw').innerHTML = v && v.pending ? `Take ${v.pending} <kbd>D</kbd>` : 'Draw <kbd>D</kbd>';
  $('#btn-pass').hidden = !(mine && v.drawn);
  $('#btn-pass').disabled = busy;
  const atRisk = v && v.ouch && v.ouch.k === myK && !v.ouch.said;
  const early = mine && handN === 2 && ok.size > 0 && v.preShout !== myK;
  $('#btn-ouch').hidden = !(atRisk || early) || (busy && !atRisk);
  $('#deck').classList.toggle('can-draw', mine && !busy && !v.drawn && (!ok.size || !!v.pending));
}

/* ================= animations, one event at a time ================= */
const wait = (t) => sleep(C.ms(t));
async function animate(e, v) {
  switch (e.t) {
    case 'deal': return animDeal(v);
    case 'start': return animStart(e);
    case 'play': return animPlay(e);
    case 'draw': return animDraw(e);
    case 'skip': return animSkip(e);
    case 'reverse': return animReverse(e);
    case 'stack': return animStack(e);
    case 'ouch': return animOuch(e);
    case 'caught': return animCaught(e);
    case 'pass': return animPass(e);
    case 'reshuffle': return animReshuffle(e);
    case 'win': return animWin(e, v);
    default: return null;
  }
}
function ticker(text) {
  const t = $('#ticker');
  t.textContent = text;
  retrigger(t, 'show');
}

async function animDeal(v) {
  sfx.shuffle();
  renderDeck(108);
  retrigger($('#deck'), 'riffle');
  ticker('Shuffling…');
  await wait(650);
  const mine = sortCards(v.hand).slice(0, R.HAND);
  setHand(mine, { ghost: mine.map((c) => c.id) });
  const slots = {};
  v.players.forEach((p) => { if (p.k !== myK) slots[p.k] = setCount(p.k, R.HAND, { hide: true }); });
  const flights = [];
  let n = 0;
  for (let r = 0; r < R.HAND; r++) {
    for (const p of v.players) {
      const target = p.k === myK ? handEl(mine[r] && mine[r].id) : slots[p.k][r];
      if (!target) continue;
      const card = p.k === myK ? mine[r] : null;
      flights.push(sleep(C.ms(n++ * 75)).then(() => {
        return C.fly(C.make(null), C.rectOf(deckTop()), C.rectOf(target), { dur: 420, lift: 36, land: false, flipTo: card }).then((f) => {
          f.remove();
          target.classList.remove('ghost');
          target.style.visibility = '';
        });
      }));
    }
  }
  await Promise.all(flights);
  sfx.fan();
  ticker('');
}
async function animStart(e) {
  sfx.slide();
  const f = await C.fly(C.make(null), C.rectOf(deckTop()), pileTarget(e.card), { flipTo: e.card, dur: 520, lift: 50 });
  sfx.land();
  placeOnPile(f, e.card);
  shown.color = e.color;
  renderCentre();
  ticker(`First card: ${C.label(e.card)}`);
  await wait(300);
}
// A guest's own card starts flying the moment they click it; when the host confirms, that
// flight already happened, so it isn't played twice.
let predicted = null;
async function animPlay(e) {
  if (e.k === myK && predicted && predicted.id === e.card.id) {
    const p = predicted;
    predicted = null;
    return p.done;
  }
  return flyPlay(e.k, e.card, e.color);
}
async function flyPlay(k, card, color) {
  let el, from, last;
  if (k === myK) {
    el = handEl(card.id);
    from = el ? C.rectOf(el) : C.rectOf(deckTop());
    if (el) el.remove(); else el = C.make(card);
    hoverId = null;
    setHand(shown.hand.filter((c) => c.id !== card.id));
    el.classList.remove('lift', 'ok', 'focus', 'sending');
    last = !shown.hand.length;
  } else {
    const mini = miniOf(k), back = mini && mini.children[Math.floor(mini.children.length / 2)];
    from = back ? C.rectOf(back) : C.rectOf(seatEl(k));
    setCount(k, Math.max(0, (shown.counts[k] || 1) - 1));
    el = C.make(null);
    last = !shown.counts[k];
  }
  sfx.slide();
  const heavy = card.v === 'd2' || card.v === 'w4';
  const f = await C.fly(el, from, pileTarget(card), {
    flipTo: k === myK ? null : card, spin: k === myK ? 12 : -12,
    dur: last ? 1200 : heavy ? 420 : 520, lift: last ? 150 : heavy ? 90 : 60,
  });
  placeOnPile(f, card);
  if (heavy) { sfx.slam(); retrigger($('#table'), 'thud'); } else sfx.land();
  shown.color = color;
  renderCentre();
  if (card.c === 'w') {
    splash(color);
    ticker(`${nameOf(k)} played ${C.label(card)} → ${C.COLORS[color]}`);
    await wait(380);
  } else ticker(`${nameOf(k)} played ${C.label(card)}`);
  await wait(120);
}
async function animDraw(e) {
  const k = e.k, n = e.n || (e.cards || []).length;
  if (!n) return;
  if (e.why === 'stack' && n > 1) { floatText(seatEl(k), `+${n}`); ticker(line('stack', { n: nameOf(k), x: n })); }
  shown.pending = 0;
  renderCentre();
  let targets;
  if (k === myK) {
    const cards = e.cards || [];
    setHand(shown.hand.concat(cards), { ghost: cards.map((c) => c.id) });
    await new Promise(requestAnimationFrame);
    targets = cards.map((c) => [handEl(c.id), c]);
  } else {
    const before = shown.counts[k] || 0;
    let added = setCount(k, before + n, { hide: true });
    const mini = miniOf(k);
    // A fan only shows a dozen cards; past that, extra cards fly to the last one.
    while (added.length < n) added.push(mini ? mini.lastChild : null);
    targets = added.map((el) => [el, null]);
  }
  const gap = n > 4 ? 90 : 140;
  await Promise.all(targets.map(([target, card], i) => sleep(C.ms(i * gap)).then(() => {
    if (i < 6) sfx.draw();
    const to = target ? C.rectOf(target) : C.rectOf(seatEl(k));
    return C.fly(C.make(null), C.rectOf(deckTop()), to, { flipTo: card, dur: 460, lift: 40, land: false }).then((f) => {
      f.remove();
      if (target) { target.classList.remove('ghost'); target.style.visibility = ''; }
    });
  })));
  if (e.why === 'turn' && k !== myK) ticker(`${nameOf(k)} drew a card`);
}
async function animSkip(e) {
  stampOn(seatEl(e.k), '🚫 SKIPPED');
  sfx.skip();
  ticker(line('skip', { n: nameOf(e.k) }));
  await wait(700);
}
async function animReverse(e) {
  shown.dir = e.dir;
  renderCentre();
  retrigger($('#dir'), 'flip');
  sfx.slide();
  ticker(line('reverse'));
  await wait(650);
}
async function animStack(e) {
  shown.pending = e.total;
  renderCentre();
  retrigger($('#pending'), 'bump');
  retrigger(seatEl(e.k), 'wobble');
  await wait(380);
}
async function animOuch(e) {
  burst(seatEl(e.k), 'OUCH!');
  sfx.ouch();
  ticker(e.k === myK ? 'You shouted Ouch! Safe 😅' : `${nameOf(e.k)} shouted Ouch! 😱`);
  await wait(500);
}
async function animCaught(e) {
  stampOn(seatEl(e.k), 'CAUGHT! 😈', 'caught');
  sfx.caught();
  ticker(line('caught', { n: nameOf(e.k), b: nameOf(e.by) }));
  await wait(800);
}
async function animPass(e) {
  bubbleOn(seatEl(e.k), e.k === myK ? 'pass 🤷' : oneOf(['pass 🤷', 'nope 🙃', 'nothing 😶']));
  await wait(250);
}
async function animReshuffle() {
  const cards = [...$('#pile').querySelectorAll('.pf-card')].slice(0, -1);
  sfx.shuffle();
  ticker('Out of cards! Reshuffling the pile 🔀');
  await Promise.all(cards.map((el, i) => sleep(C.ms(i * 60)).then(() => {
    const from = C.rectOf(el);
    el.remove();
    return C.fly(C.make(null), from, C.rectOf($('#deck')), { dur: 380, lift: 30, land: false }).then((f) => f.remove());
  })));
  shown.pile = shown.pile.slice(-1);
  renderDeck(60);
  retrigger($('#deck'), 'riffle');
  await wait(500);
}
async function animWin(e, v) {
  const p = v.players.find((x) => x.k === e.k);
  $('#status').classList.remove('mine');
  $('#status').textContent = e.k === myK ? 'You did it! 🎉' : `${firstName(p ? p.name : '?')} is out of cards!`;
  ['#btn-draw', '#btn-pass', '#btn-ouch'].forEach((s) => { $(s).hidden = true; });
  $('#deck').classList.remove('can-draw');
  sfx.win();
  bigConfetti();
  slamText(e.k === myK ? 'YOU WIN! 🏆' : line('win', { n: firstName(p ? p.name : '?') }));
  // Everyone else's cards flip face up, so you can see what they got stuck with.
  const hands = v.hands || {};
  const flips = [];
  v.players.forEach((q) => {
    if (q.k === myK || !hands[q.k]) return;
    [...(miniOf(q.k) ? miniOf(q.k).children : [])].forEach((back, i) => {
      const card = hands[q.k][i];
      if (card) flips.push(sleep(C.ms(300 + i * 80)).then(() => C.flip(back, card)));
    });
  });
  await Promise.all(flips);
  await wait(2600);
}

/* ---------- little effects ---------- */
function fxAt(el, cls, html, ms) {
  if (!el) return;
  const [x, y] = centerOf(el), d = document.createElement('div');
  d.className = cls;
  d.innerHTML = html;
  d.style.left = x + 'px'; d.style.top = y + 'px';
  $('#fx').appendChild(d);
  setTimeout(() => d.remove(), ms);
}
const stampOn = (el, text, extra = '') => fxAt(el, `pf-stamp ${extra}`, escapeHtml(text), 1400);
const burst = (el, text) => fxAt(el, 'pf-burst', `<b>${escapeHtml(text)}</b>`, 1300);
const floatText = (el, text) => fxAt(el, 'pf-float', escapeHtml(text), 1500);
const bubbleOn = (el, text) => fxAt(el, 'pf-says', escapeHtml(text), 1600);
function slamText(text) {
  const d = document.createElement('div');
  d.className = 'pf-slam';
  d.textContent = text;
  $('#fx').appendChild(d);
  setTimeout(() => d.remove(), 3200);
}
function splash(c) {
  const d = document.createElement('i'), r = $('#pile').getBoundingClientRect(), t = $('#table').getBoundingClientRect();
  d.className = 'pf-splash';
  d.style.left = r.left - t.left + r.width / 2 + 'px';
  d.style.top = r.top - t.top + r.height / 2 + 'px';
  d.style.setProperty('--sc', C.HEX[c]);
  $('#table').appendChild(d);
  setTimeout(() => d.remove(), 1100);
}

/* ================= your moves ================= */
let pickerDone = null;
function openPicker() {
  return new Promise((done) => { pickerDone = done; $('#picker').hidden = false; sfx.pop(); });
}
function closePicker(c) {
  $('#picker').hidden = true;
  if (pickerDone) { const d = pickerDone; pickerDone = null; d(c); }
}
async function tryPlay(id) {
  const card = shown.hand.find((c) => c.id === id);
  if (!card || !view) return;
  if (view.turn !== myK) return nope('turn');
  if (running || waiting) return;
  const el = handEl(id);
  if (!playableIds().has(id)) { if (el) retrigger(el, 'shake'); return nope(view.drawn ? 'drawn' : 'match'); }
  let color;
  if (card.c === 'w') { color = await openPicker(); if (!color) return; }
  if (el) el.classList.add('sending');
  waiting = true;
  renderButtons();
  act({ t: 'play', id, color });
  if (mode === 'guest') predicted = { id, done: flyPlay(myK, card, color) };
  setTimeout(() => { if (waiting) { waiting = false; renderButtons(); layoutHand(); } }, 4000);
}
function tryDraw() {
  if (!view || view.turn !== myK) return nope('turn');
  if (running || waiting || view.drawn) return;
  waiting = true;
  renderButtons();
  act({ t: 'draw' });
  setTimeout(() => { if (waiting) { waiting = false; renderButtons(); } }, 4000);
}
function tryPass() { if (view && view.drawn && !running && !waiting) { waiting = true; act({ t: 'pass' }); } }
function tryOuch() { act({ t: 'ouch' }); $('#btn-ouch').hidden = true; }
function tryCatch(k) {
  const target = k || (view && view.ouch && !view.ouch.said && view.ouch.k !== myK ? view.ouch.k : null);
  if (target) act({ t: 'catch', k: target });
}

$('#hand').addEventListener('mouseover', (e) => {
  const el = e.target.closest('.pf-card');
  const id = el ? el.dataset.id : null;
  if (id !== hoverId) { hoverId = id; layoutHand(); }
});
$('#hand').addEventListener('mouseleave', () => { hoverId = null; layoutHand(); });
$('#hand').addEventListener('click', (e) => { const el = e.target.closest('.pf-card'); if (el) tryPlay(el.dataset.id); });
$('#deck').addEventListener('click', tryDraw);
$('#deck').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tryDraw(); } });
$('#btn-draw').onclick = tryDraw;
$('#btn-pass').onclick = tryPass;
$('#btn-ouch').onclick = tryOuch;
$('#seats-layer').addEventListener('click', (e) => { const b = e.target.closest('[data-catch]'); if (b) tryCatch(b.dataset.catch); });
$('#picker').addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (b) closePicker(b.dataset.c); });
$('#picker-cancel').onclick = () => closePicker(null);
chat.mountTools($('#chat-tools'), { compact: true });
document.addEventListener('keydown', (e) => {
  if (!document.querySelector('#screen-play.active') || e.ctrlKey || e.metaKey || e.altKey || chat.typing(e)) return;
  if (pickerDone) {
    const i = '1234'.indexOf(e.key);
    if (i >= 0) closePicker('rygb'[i]);
    else if (e.key === 'Escape') closePicker(null);
    return;
  }
  const key = e.key.toLowerCase();
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    e.preventDefault();
    const n = shown.hand.length;
    if (!n) return;
    focusIdx = focusIdx < 0 ? (e.key === 'ArrowRight' ? 0 : n - 1) : Math.max(0, Math.min(n - 1, focusIdx + (e.key === 'ArrowRight' ? 1 : -1)));
    hoverId = null;
    layoutHand();
  } else if ((e.key === 'Enter' || e.key === ' ') && focusIdx >= 0 && !e.target.closest('button')) {
    e.preventDefault();
    if (shown.hand[focusIdx]) tryPlay(shown.hand[focusIdx].id);
  } else if (e.key === 'Enter' && !e.target.closest('button')) {
    e.preventDefault();
    chat.open(true);
  } else if (key === 'd') tryDraw();
  else if (key === 'p') tryPass();
  else if (key === 'o') { if (!$('#btn-ouch').hidden) tryOuch(); }
  else if (key === 'c') tryCatch();
});

/* ================= the end ================= */
let recorded = null;
function recordResult(v) {
  if (recorded === v.gid || !me) return;
  recorded = v.gid;
  const key = 'plusfour-record:' + me.name.toLowerCase(), rec = store.get(key, {});
  v.players.forEach((p) => {
    if (p.k === myK || p.bot) return;
    const r = rec[p.name] || { w: 0, l: 0 };
    if (v.winner === myK) r.w++; else if (v.winner === p.k) r.l++; else return;
    rec[p.name] = r;
  });
  store.set(key, rec);
}
// Send the finished game to the shared history (shared/records.js). A bomb is a stacked +2/+4 pile
// that someone had to take, credited to whoever stacked last.
function saveGame(v, ranked) {
  const nm = (k) => playerOf(k).name, hands = v.hands || {};
  records.game({
    kind: 'plusfour', gid: v.gid, room: roomCode || null, practice: mode === 'cpu', startedAt: v.at,
    players: v.players.map((p) => ({ name: p.name, bot: !!p.bot, place: ranked.indexOf(p) + 1, score: (hands[p.k] || []).length })),
    winners: [nm(v.winner)],
    stats: Object.fromEntries(v.players.map((p) => [p.name, { ...(v.stats || {})[p.k], left: (hands[p.k] || []).length }])),
    hits: (v.hits || []).map((h) => ({ kind: 'bomb', by: nm(h.by), to: nm(h.to), cards: h.n })),
  });
  if (typeof showRewards === 'function') showRewards($('#awards').parentElement, v.gid); // +XP and new trophies on the end screen
}
function renderEnd() {
  const v = view, hands = v.hands || {}, stats = v.stats || {};
  recordResult(v);
  const ranked = v.players.slice().sort((a, b) => (a.k === v.winner ? -1 : b.k === v.winner ? 1 : (hands[a.k] || []).length - (hands[b.k] || []).length));
  saveGame(v, ranked);
  const medal = ['🏆', '🥈', '🥉', '🫠'];
  $('#end-title').textContent = v.winner === myK ? 'You won! 🎉' : `${firstName(playerOf(v.winner).name)} won`;
  $('#podium').innerHTML = ranked.map((p, i) => {
    const left = hands[p.k] || [];
    return `<div class="pf-pod p${i + 1}" style="--c:${SEAT_COLORS[v.players.indexOf(p)]}">
      <span class="medal">${medal[i]}</span><span class="av">${avatarHTML(p.avatar)}</span><b>${escapeHtml(firstName(p.name))}${p.k === myK ? ' (you)' : ''}</b>
      <span class="left">${left.length ? `${left.length} card${left.length > 1 ? 's' : ''} left` : 'Out of cards!'}</span>
      <div class="pf-leftovers" data-k="${p.k}"></div></div>`;
  }).join('');
  ranked.forEach((p) => {
    const box = $(`.pf-leftovers[data-k="${p.k}"]`);
    sortCards(hands[p.k] || []).slice(0, 14).forEach((c) => box.appendChild(C.make(c)));
  });
  const name = (k) => firstName(playerOf(k).name);
  const top = (field) => {
    const best = v.players.slice().sort((a, b) => (stats[b.k] || {})[field] - (stats[a.k] || {})[field])[0];
    return best && stats[best.k] && stats[best.k][field] > 0 ? best : null;
  };
  const awards = [
    ['drawn', '📦', 'Card Hoarder', (n) => `Drew ${n} cards`],
    ['stacked', '📚', 'Stack Lord', (n) => `Stacked ${n} time${n > 1 ? 's' : ''}`],
    ['caught', '😴', 'Caught Napping', (n) => `Forgot to shout ${n} time${n > 1 ? 's' : ''}`],
    ['wilds', '🌈', 'Wild Child', (n) => `Played ${n} wild${n > 1 ? 's' : ''}`],
  ].map(([f, icon, title, why]) => { const p = top(f); return p ? { icon, title, who: name(p.k), why: why(stats[p.k][f]) } : null; }).filter(Boolean);
  $('#awards').innerHTML = awards.map((a) => `<div class="award"><span class="icon">${a.icon}</span><div><b>${escapeHtml(a.title)}</b><span>${escapeHtml(a.who)}</span><small>${escapeHtml(a.why)}</small></div></div>`).join('');
  $('#btn-again').hidden = !isHost();
  $('#end-wait').hidden = isHost();
  $('#end-wait').textContent = `Waiting for ${firstName(playerOf(hostK) ? playerOf(hostK).name : 'the host')} to start a rematch…`;
}

/* ================= wiring ================= */
function ambient() {
  const box = $('#ambient'), colors = ['#ff5a5f', '#ffc233', '#2bc48a', '#4d9de0', '#ff8fc8', '#ffffff'];
  for (let i = 0; i < 18; i++) {
    const d = document.createElement('i'), dur = 26 + Math.random() * 24;
    d.className = 'pf-drift' + (i % 4 === 0 ? ' dot' : '');
    d.style.setProperty('--x', Math.random() * 100 + '%');
    d.style.setProperty('--c', colors[i % colors.length]);
    d.style.setProperty('--d', dur + 's');
    d.style.setProperty('--delay', -Math.random() * dur + 's');
    d.style.setProperty('--r', Math.random() * 360 + 'deg');
    d.style.setProperty('--sway', (Math.random() - 0.5) * 120 + 'px');
    d.style.setProperty('--o', (0.12 + Math.random() * 0.18).toFixed(2));
    box.appendChild(d);
  }
}
function heroArt() {
  const art = $('#hero-art');
  [{ id: 'h1', c: 'b', v: 'rev' }, { id: 'h2', c: 'r', v: '7' }, { id: 'h3', c: 'w', v: 'w4' }, null].forEach((c) => art.appendChild(C.make(c)));
}
$('#btn-create').onclick = () => { sfx.pop(); createRoom(); };
$('#btn-cpu').onclick = () => { sfx.pop(); practice(); };
$('#btn-join').onclick = () => { sfx.pop(); joinRoom($('#join-code').value); };
$('#join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(e.target.value); });
$('#btn-resume').onclick = () => { const last = store.get('plusfour-lastroom', null); if (last) joinRoom(last.code); };
$('#btn-room-back').onclick = leaveToHome;
$('#btn-start').onclick = () => { sfx.pop(); startGame(); };
$('#btn-leave').onclick = () => { if (confirm('Leave the game?')) leaveToHome(); };
$('#btn-end-home').onclick = leaveToHome;
$('#btn-again').onclick = () => { if (isHost() && room) { room.seats = room.seats.filter((s) => connected(s.k)); startGame(); } };
$('#btn-mute').onclick = (e) => setIcon(e.currentTarget, sfx.toggle() ? 'mute' : 'volume');
$('#btn-share').onclick = async () => {
  const code = $('#room-code').textContent, link = `${location.origin}${location.pathname}?room=${code}`;
  if (navigator.share) { try { await navigator.share({ title: 'Plus Four', text: `Cards are dealt. Come lose: ${code}`, url: link }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(link); toast('Invite link copied 💌'); } catch (e) { prompt('Copy this link:', link); }
};
// The hand re-fans whenever its space changes: a resize, or the chat docking beside the table.
new ResizeObserver(() => layoutHand()).observe($('#hand'));
addEventListener('resize', () => { if (view) view.players.forEach((p) => { if (p.k !== myK) setCount(p.k, shown.counts[p.k] || 0); }); });
addEventListener('pagehide', () => { if (mode) teardown(); });
document.addEventListener('profilechange', renderHomeBits);

document.addEventListener('DOMContentLoaded', () => {
  hydrateIcons();
  if (sfx.muted) setIcon($('#btn-mute'), 'mute'); // mute is remembered across pages
  applyPalette();
  wireProfileSheet();
  heroArt();
  ambient();
  sfx.load();
  requireLogin().then(() => {
    goHome();
    const code = new URLSearchParams(location.search).get('room');
    if (code) { history.replaceState(null, '', location.pathname); $('#join-code').value = code.toUpperCase(); joinRoom(code); }
  });
});
