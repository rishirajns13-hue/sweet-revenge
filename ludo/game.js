'use strict';
const R = window.LudoRules;

const COLORS = { red: '#ff5a5f', green: '#2bc48a', yellow: '#ffc233', blue: '#4d9de0' };
const INK = '#2b2140';
// Seat order → colours. Two players sit opposite each other; teams pair seats 1+3 and 2+4.
const COLOR_SETS = { 2: ['red', 'yellow'], 3: ['red', 'green', 'yellow'], 4: ['red', 'green', 'yellow', 'blue'] };
const BOT_NAMES = ['Bot Bonky', 'Robo Rani', 'Chip', 'Dice-o-tron'];

/* ================= board geometry (cell units, 15x15) ================= */
const TRACK = [];
function seg(c0, r0, c1, r1) {
  const dc = Math.sign(c1 - c0), dr = Math.sign(r1 - r0);
  for (let c = c0, r = r0; ; c += dc, r += dr) { TRACK.push([c, r]); if (c === c1 && r === r1) break; }
}
seg(1, 6, 5, 6); seg(6, 5, 6, 0); seg(7, 0, 7, 0); seg(8, 0, 8, 5); seg(9, 6, 14, 6); seg(14, 7, 14, 7);
seg(14, 8, 9, 8); seg(8, 9, 8, 14); seg(7, 14, 7, 14); seg(6, 14, 6, 9); seg(5, 8, 0, 8); seg(0, 7, 0, 7); seg(0, 6, 0, 6);

const HOME_COL = {
  red: [1, 2, 3, 4, 5].map((c) => [c, 7]),
  green: [1, 2, 3, 4, 5].map((r) => [7, r]),
  yellow: [13, 12, 11, 10, 9].map((c) => [c, 7]),
  blue: [13, 12, 11, 10, 9].map((r) => [7, r]),
};
const BASE = { red: [0, 0], green: [9, 0], yellow: [9, 9], blue: [0, 9] };
const FINISH = { red: [6.6, 7.5], green: [7.5, 6.6], yellow: [8.4, 7.5], blue: [7.5, 8.4] };

// The board turns so your own base is always bottom-left, nearest your thumb.
const ROT = { red: -90, green: 180, yellow: 90, blue: 0 };
const CORNERS = ['tl', 'tr', 'br', 'bl'], BASE_CORNER = { red: 0, green: 1, yellow: 2, blue: 3 };
const cornerOf = (c) => CORNERS[(BASE_CORNER[c] + (ROT[myColors[0]] / 90 + 4)) % 4];

function pointFor(color, pos, i) {
  if (pos === -1) { const [bx, by] = BASE[color]; return [bx + 2 + (i % 2) * 2, by + 2 + Math.floor(i / 2) * 2]; }
  if (pos <= R.LAST_TRACK) { const [c, r] = TRACK[R.absIndex(color, pos)]; return [c + 0.5, r + 0.5]; }
  if (pos < R.HOME) { const [c, r] = HOME_COL[color][pos - 51]; return [c + 0.5, r + 0.5]; }
  return FINISH[color];
}

function buildBoard() {
  let s = '';
  const rect = (x, y, w, h, fill, extra = '') =>
    (s += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" ${extra}/>`);
  const cell = (c, r, fill) => rect(c, r, 1, 1, fill, `stroke="${INK}" stroke-width="0.05"`);
  const star = (c, r, fill) =>
    (s += `<text x="${c + 0.5}" y="${r + 0.78}" font-size="0.8" text-anchor="middle" fill="${fill}">★</text>`);

  for (const [color, [bx, by]] of Object.entries(BASE)) {
    rect(bx, by, 6, 6, COLORS[color], `stroke="${INK}" stroke-width="0.08"`);
    rect(bx + 0.9, by + 0.9, 4.2, 4.2, '#fff', `rx="0.7" stroke="${INK}" stroke-width="0.08"`);
    for (let i = 0; i < 4; i++) {
      const [x, y] = pointFor(color, -1, i);
      s += `<circle cx="${x}" cy="${y}" r="0.62" fill="${COLORS[color]}" fill-opacity="0.3" stroke="${INK}" stroke-width="0.06"/>`;
    }
  }
  TRACK.forEach(([c, r]) => cell(c, r, '#fff'));
  for (const color of Object.keys(COLORS)) {
    HOME_COL[color].forEach(([c, r]) => cell(c, r, COLORS[color]));
    const [c, r] = TRACK[R.START[color]];
    cell(c, r, COLORS[color]);
    star(c, r, '#ffffffcc');
    const [sc, sr] = TRACK[(R.START[color] + 8) % 52];
    star(sc, sr, '#c9c2d8');
  }
  const tri = (pts, color) => (s += `<polygon points="${pts}" fill="${COLORS[color]}" stroke="${INK}" stroke-width="0.06"/>`);
  tri('6,6 6,9 7.5,7.5', 'red'); tri('6,6 9,6 7.5,7.5', 'green');
  tri('9,6 9,9 7.5,7.5', 'yellow'); tri('6,9 9,9 7.5,7.5', 'blue');
  $('#board-svg').innerHTML = s;
}

/* ================= dice ================= */
const PIPS = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
const FACE_ROT = { 1: [0, 0], 2: [-90, 0], 3: [0, -90], 4: [0, 90], 5: [90, 0], 6: [0, 180] };
let diceRot = [0, 0];
function buildDice() {
  $('#dice-cube').innerHTML = [1, 2, 3, 4, 5, 6].map((n) =>
    `<div class="face f${n}">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => `<i class="${PIPS[n].includes(k) ? 'on' : ''}"></i>`).join('')}</div>`
  ).join('');
}
// Always rotate forwards to the target face (plus two full turns when spinning), never backwards.
function showDice(value, spin) {
  const mod = (a) => ((a % 360) + 360) % 360;
  diceRot = FACE_ROT[value].map((target, k) => {
    const cur = diceRot[k];
    return cur + mod(target - cur) + (spin ? 720 : 0);
  });
  $('#dice-cube').style.transform = `rotateX(${diceRot[0]}deg) rotateY(${diceRot[1]}deg)`;
}

/* ================= sounds (WebAudio, no files) ================= */
const sfx = (() => {
  let ctx = null, muted = false;
  function tone(freq, dur, type = 'sine', vol = 0.15, when = 0, slideTo) {
    if (muted) return;
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      const t = ctx.currentTime + when, o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g).connect(ctx.destination);
      o.start(t); o.stop(t + dur + 0.02);
    } catch (e) { /* audio not available */ }
  }
  return {
    roll() { for (let k = 0; k < 7; k++) tone(180 + Math.random() * 320, 0.05, 'square', 0.05, k * 0.09); },
    hop() { tone(520, 0.08, 'triangle', 0.12, 0, 800); },
    six() { tone(880, 0.12, 'triangle', 0.1); tone(1320, 0.18, 'triangle', 0.1, 0.1); },
    capture() { tone(700, 0.4, 'sawtooth', 0.1, 0, 80); tone(120, 0.25, 'square', 0.1, 0.05, 50); },
    home() { [523, 659, 784, 1047].forEach((f, k) => tone(f, 0.16, 'triangle', 0.12, k * 0.09)); },
    win() { [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, k) => tone(f, 0.25, 'square', 0.07, k * 0.14)); },
    pop() { tone(600, 0.07, 'sine', 0.12, 0, 1100); },
    sad() { tone(400, 0.3, 'triangle', 0.1, 0, 200); },
    gasp() { tone(300, 0.5, 'sine', 0.1, 0, 900); },
    toggle() { muted = !muted; return muted; },
  };
})();

/* ================= effects ================= */
function boardLabel(text) { const l = $('#board-label'); l.textContent = text; retrigger(l, 'show'); }
function floatEmoji(e, color) {
  const anchor = isMine(color) ? $('#dice') : chipFor(color) || $('#board-wrap');
  const [x, y] = centerOf(anchor);
  const el = document.createElement('div');
  el.className = 'float-emoji';
  el.textContent = e;
  el.style.left = x + 'px'; el.style.top = y + 'px';
  el.style.setProperty('--dx', (Math.random() - 0.5) * 80 + 'px');
  $('#fx').appendChild(el);
  setTimeout(() => el.remove(), 1900);
}

/* ================= app state ================= */
let mode = null;          // 'host' | 'guest' | 'cpu'
let myColors = [];
let conn = null;          // guest: link to the host
let room = null;          // host: { code, seats: [{ name, avatar, bot, link, color }], teams, started }
let hostName = '';        // guest: whose room this is
let roomCode = '';        // the room this game is in, for the saved history ('' in practice)
let game = null;          // last fully-rendered state
let display = null;       // token positions currently drawn (lags game during animations)
let busy = false;
let queue = Promise.resolve();
let aiTimer = null;
let session = 0;          // bumped on teardown so stale async work can bail out
let offline = new Set();  // colours whose player dropped mid-game (a bot covers for them)
let hostColor = null;     // guest: which colour is hosting, so we know who left if the link drops
let latest = null;        // guest: newest state from the host (game lags it while animating)

const isMine = (color) => myColors.includes(color);
const nameOf = (color) => (game && game.names[color]) || color;
const shortName = (color) => (isMine(color) ? 'You' : nameOf(color).split(' ').pop());
const avatarOf = (color) => (game && game.avatars && game.avatars[color]) || '🙂';
const isBot = (color) => !!(game && game.bots && game.bots.includes(color));

function show(screen) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === 'screen-' + screen));
  document.body.classList.toggle('in-game', screen === 'game');
  chat.setInGame(screen === 'game');
}

/* ================= host controller (source of truth) ================= */
const host = {
  state: null,
  cfg: null,
  // cfg: { players, names, avatars, bots, teams }
  start(cfg) {
    this.cfg = cfg;
    const s = R.newGame(cfg.players, cfg.names, { teams: cfg.teams });
    s.avatars = cfg.avatars; s.bots = cfg.bots; s.at = Date.now();
    this.state = s;
    this.push();
  },
  handle(color, msg) {
    const s = this.state;
    if (!s || !msg) return;
    if (msg.t === 'restart') {
      if (s.phase === 'over') this.start(this.cfg); // only the host's own button sends this
      return;
    }
    if (s.phase === 'over' || R.current(s) !== color) return;
    let next;
    try {
      if (msg.t === 'roll' && s.phase === 'roll') next = R.rollAuto(s, randomDie());
      else if (msg.t === 'move' && s.phase === 'move' && Number.isInteger(msg.i)) next = R.move(s, msg.i);
      else return;
    } catch (e) { return; }
    next.v = s.v + 1;
    this.state = next;
    this.push();
  },
  push(sync = false) {
    onState(this.state, sync);
    if (room) room.seats.forEach((seat) => seat.link && seat.link.open && seat.link.send(stateMsg(seat, sync)));
  },
};
const stateMsg = (seat, sync) => ({ t: 'state', s: host.state, sync, you: seat.color, hostColor: myColors[0], epoch: room.epoch });
function randomDie() {
  const a = new Uint8Array(1);
  do crypto.getRandomValues(a); while (a[0] >= 252);
  return (a[0] % 6) + 1;
}
function act(msg) {
  if (mode === 'guest') { if (conn && conn.open) conn.send({ t: 'act', a: msg.t, i: msg.i }); }
  else host.handle(myColors[0], msg);
}

/* ================= rendering ================= */
function buildTokens(players) {
  $('#tokens').innerHTML = players.map((c) =>
    [0, 1, 2, 3].map((i) =>
      `<button class="token" data-c="${c}" data-i="${i}" style="--c:${COLORS[c]}" aria-label="${escapeHtml(shortName(c))}, piece ${i + 1}">`
      + '<div class="tb"><i class="x sweat">💧</i><i class="x stars">💫</i><i class="x hat">🥳</i></div></button>'
    ).join('')
  ).join('');
}
const tokenEl = (c, i) => $(`.token[data-c="${c}"][data-i="${i}"]`);

// A piece is nervous when an opponent sits 1-6 squares behind it on an unsafe square.
function threatened(tokens, players, color, a, teams) {
  const team = teams || [color];
  return players.some((c) => !team.includes(c) && tokens[c].some((p) => {
    if (p < 0 || p > R.LAST_TRACK) return false;
    const d = (a - R.absIndex(c, p) + 52) % 52;
    return d >= 1 && d <= 6;
  }));
}

/* ================= critters in their yards ================= */
// Each player's critter sits in the middle of their yard, watching. It cheers when its player bonks
// someone, sulks when bonked, and throws a party when its player wins.
function renderCritters() {
  const board = $('#board');
  if (!board || !game) return;
  for (const color of Object.keys(COLORS)) {
    let el = board.querySelector(`.yard-critter[data-color="${color}"]`);
    if (!game.players.includes(color)) { if (el) el.remove(); continue; }
    if (!el) {
      el = document.createElement('span');
      el.className = 'yard-critter';
      el.dataset.color = color;
      const [bx, by] = BASE[color];
      el.style.left = ((bx + 3) / 15) * 100 + '%';
      el.style.top = ((by + 3) / 15) * 100 + '%';
      board.appendChild(el);
    }
    if (el.dataset.av !== avatarOf(color)) setAvatar(el, avatarOf(color));
  }
}
function critterMood(color, mood, ms = 2600) {
  const el = $(`.yard-critter[data-color="${color}"]`);
  if (!el) return;
  setAvatar(el, avatarOf(color), mood);
  retrigger(el, mood === 'cheer' ? 'hype' : 'droop');
  clearTimeout(el._t);
  el._t = setTimeout(() => { setAvatar(el, avatarOf(color)); el.classList.remove('hype', 'droop'); }, ms);
}

function renderTokens() {
  renderCritters();
  const groups = {};
  for (const c of game.players) display[c].forEach((p, i) => {
    const pt = pointFor(c, p, i), key = pt.join(',');
    (groups[key] = groups[key] || []).push({ c, i, pt, p });
  });
  for (const list of Object.values(groups)) {
    const n = list.length;
    list.forEach(({ c, i, pt, p }, k) => {
      let [x, y] = pt;
      if (n > 1) {
        const ang = (k / n) * Math.PI * 2 - Math.PI / 4;
        x += Math.cos(ang) * 0.2; y += Math.sin(ang) * 0.2;
      }
      const el = tokenEl(c, i);
      el.style.left = (x / 15) * 100 + '%';
      el.style.top = (y / 15) * 100 + '%';
      el.style.setProperty('--s', n > 1 ? 0.7 : 1);
      el.style.zIndex = Math.round(y * 2) + k;
      const onTrack = p >= 0 && p <= R.LAST_TRACK, a = onTrack ? R.absIndex(c, p) : -1;
      el.classList.toggle('worried', onTrack && !R.SAFE.has(a) && threatened(display, game.players, c, a, R.teamOf(game, c)));
      el.classList.toggle('party', p === R.HOME);
    });
  }
}

function renderPlayers() {
  document.querySelectorAll('.corner').forEach((el) => (el.innerHTML = ''));
  const partner = R.teamOf(game, myColors[0]).find((c) => !isMine(c));
  for (const c of game.players) {
    if (isMine(c)) continue;
    const home = game.tokens[c].filter((p) => p === R.HOME).length;
    const active = game.phase !== 'over' && R.current(game) === c;
    const tag = offline.has(c) ? 'offline' : isBot(c) ? 'bot' : c === partner ? 'partner' : `${home}/4 home`;
    const slot = document.querySelector(`.corner[data-corner="${cornerOf(c)}"]`);
    if (slot) slot.insertAdjacentHTML('beforeend', `<div class="chip ${active ? 'active' : ''} ${offline.has(c) ? 'offline' : ''}" data-c="${c}" style="--c:${COLORS[c]}">
      <span class="av">${avatarHTML(avatarOf(c))}</span><span class="tx"><span class="nm">${escapeHtml(shortName(c))}</span><small>${tag}</small></span></div>`);
  }
}

function canRoll() {
  return !busy && game && game.phase === 'roll' && isMine(R.current(game));
}
function movable() {
  if (busy || !game || game.phase !== 'move') return [];
  const c = R.current(game);
  if (!isMine(c)) return [];
  return R.legalMoves(game).map((i) => [c, i]);
}

function renderControls() {
  const dice = $('#dice');
  dice.disabled = !canRoll();
  dice.classList.toggle('ready', canRoll());
  document.querySelectorAll('.token.can').forEach((el) => el.classList.remove('can'));
  movable().forEach(([c, i]) => tokenEl(c, i).classList.add('can'));
  if (game) $('#dice-cube').style.setProperty('--dc', COLORS[R.current(game)]);
  if (busy || !game) return;

  let text = '';
  if (game.phase !== 'over') {
    const c = R.current(game), partner = !isMine(c) && R.teamOf(game, myColors[0]).includes(c);
    if (isMine(c) && game.phase === 'roll') text = 'Your turn! Tap the dice';
    else if (isMine(c)) text = 'Pick a piece to move';
    else text = `${partner ? 'Your partner' : shortName(c)} is ${game.phase === 'roll' ? 'rolling' : 'thinking'}…`;
  }
  const mine = game.tokens[myColors[0]] || [];
  const home = mine.filter((p) => p === R.HOME).length, out = mine.filter((p) => p >= 0 && p < R.HOME).length;
  $('#status').innerHTML = `${escapeHtml(text)}<small>${home} home · ${out} out</small>`;
}

function renderWin() {
  const win = $('#win');
  if (game.phase !== 'over') { win.hidden = true; return; }
  recordResult(game);
  saveGame(game);
  const winners = game.winners || [game.winner], iWon = winners.some(isMine);
  $('#win-title').textContent = iWon ? (winners.length > 1 ? 'Your team wins!' : 'You win!')
    : `${winners.map(shortName).join(' & ')} ${winners.length > 1 ? 'win' : 'wins'}!`;
  const rivals = game.players.filter((c) => !R.teamOf(game, myColors[0]).includes(c) && !isBot(c));
  $('#win-vs').innerHTML = rivals.length === 1 && mode !== 'cpu' ? rivalLine(nameOf(rivals[0])) : '';
  const st = game.stats ? game.stats[myColors[0]] : { bonks: 0, sixes: 0 };
  $('#win-stats').innerHTML = `<div><b>${st.bonks}</b><small>Your bonks</small></div><div><b>${st.sixes}</b><small>Your sixes</small></div><div><b>${game.turns || 0}</b><small>Turns</small></div>`;
  const per = winners.length > 1 ? 2 : 4;
  $('#dancers').innerHTML = winners.flatMap((c) => Array.from({ length: per }, () => c))
    .map((c, k) => `<i style="--c:${COLORS[c]};--k:${k}"></i>`).join('');
  const isHost = mode !== 'guest';
  $('#btn-again').hidden = !isHost;
  $('#win-wait').hidden = isHost;
  $('#win-wait').textContent = `Waiting for ${hostName ? hostName.split(' ').pop() : 'the host'} to start a rematch…`;
  win.hidden = false;
}

// Send the finished game to the shared history (shared/records.js). Every player's browser sends it;
// the server keeps one copy per game id.
function saveGame(s) {
  if (!s.winners) return;
  const nm = (c) => s.names[c], bots = s.bots || [];
  records.game({
    kind: 'ludo', gid: s.gid, room: roomCode || null, practice: mode === 'cpu', startedAt: s.at,
    players: s.players.map((c) => ({ name: nm(c), bot: bots.includes(c), place: s.winners.includes(c) ? 1 : null, team: s.teams ? s.teams.findIndex((t) => t.includes(c)) : null })),
    winners: s.winners.map(nm),
    stats: Object.fromEntries(s.players.map((c) => [nm(c), { ...s.stats[c], color: c, home: s.tokens[c].filter((p) => p === R.HOME).length, turns: s.turns }])),
    hits: (s.hits || []).map(([by, to]) => ({ kind: 'bonk', by: nm(by), to: nm(to) })),
  });
  if (typeof showRewards === 'function') showRewards($('#win-stats').parentElement, s.gid); // +XP and new trophies on the end screen
}

function renderAll() {
  renderTokens();
  renderPlayers();
  renderControls();
  renderWin();
}

/* ================= state application + animation ================= */
function onState(s, sync) { queue = queue.then(() => applyState(s, sync)).catch((e) => console.error(e)); }

async function applyState(s, sync) {
  const fresh = !game || game.gid !== s.gid;
  if (!fresh && s.v <= game.v) return;
  if (fresh || sync) {
    game = s;
    display = JSON.parse(JSON.stringify(s.tokens));
    $('#board-wrap').style.setProperty('--rot', ROT[myColors[0]] + 'deg');
    buildTokens(s.players);
    if (s.dice) showDice(s.dice, false);
    renderAll();
    maybeAI();
    return;
  }
  busy = true;
  renderControls();
  const my = session;
  for (const ev of s.events) {
    if (my !== session) return;
    if (ev.type === 'roll') await animateRoll(ev);
    else if (ev.type === 'move') await animateMove(ev);
  }
  if (my !== session) return; // left or switched host while animating
  const wasOver = game.phase === 'over';
  game = s;
  display = JSON.parse(JSON.stringify(s.tokens));
  busy = false;
  renderAll();
  if (s.phase === 'over' && !wasOver) { sfx.win(); bigConfetti(); }
  maybeAI();
}

async function animateRoll(ev) {
  $('#dice-cube').style.setProperty('--dc', COLORS[ev.color]);
  sfx.roll();
  showDice(ev.value, true);
  $('#status').textContent = `${shortName(ev.color)} rolled…`;
  await sleep(850);
  $('#status').textContent = `${ev.value}!`;
  if (ev.value === 6) sfx.six();
  if (ev.note === 'three6') { toast('Three 6s in a row! Turn skipped 😵'); sfx.sad(); await sleep(900); }
  else if (ev.note === 'nomove') { toast(ev.value === 6 ? 'No moves, but roll again! 🎲' : 'No moves… 😅', 1300); await sleep(900); }
  else await sleep(250);
}

// The mover stops right behind an opponent's piece: a near miss for the piece in front.
function nearMiss(ev) {
  if (ev.captured.length || ev.to > R.LAST_TRACK) return false;
  const target = (R.absIndex(ev.color, ev.to) + 1) % 52;
  if (R.SAFE.has(target)) return false;
  const team = R.teamOf(game, ev.color);
  return game.players.some((c) => !team.includes(c) && display[c].some((p) => p >= 0 && p <= R.LAST_TRACK && R.absIndex(c, p) === target));
}

async function animateMove(ev) {
  const steps = ev.from === -1 ? [0] : Array.from({ length: ev.to - ev.from }, (_, k) => ev.from + 1 + k);
  const el = tokenEl(ev.color, ev.token);
  const close = nearMiss(ev);
  for (const [k, p] of steps.entries()) {
    display[ev.color][ev.token] = p;
    renderTokens();
    el.style.zIndex = 60;
    const slow = close && k === steps.length - 1;
    retrigger(el, slow ? 'slow' : 'hop');
    sfx.hop();
    await sleep(slow ? 560 : 175);
  }
  if (ev.captured.length) {
    await sleep(60);
    retrigger($('#board-wrap'), 'shake');
    sfx.capture();
    boardLabel('BONK!');
    confetti(...centerOf(el), 40, 160);
    for (const c of ev.captured) {
      display[c.color][c.token] = -1;
      const victim = tokenEl(c.color, c.token);
      victim.classList.add('flying', 'dizzy');
      setTimeout(() => victim.classList.remove('dizzy'), 2200);
    }
    renderTokens();
    const victims = [...new Set(ev.captured.map((c) => c.color))];
    critterMood(ev.color, 'cheer');
    victims.forEach((v) => critterMood(v, 'sulk', 3200));
    if (victims.some(isMine)) toast(`💥 ${shortName(ev.color)} bonked you!`);
    else toast(`💥 ${shortName(ev.color)} bonked ${victims.map(shortName).join(' & ')}!`);
    if (mode === 'cpu') floatEmoji(isBot(ev.color) ? '😈' : '😭', game.players.find(isBot));
    await sleep(700);
    ev.captured.forEach((c) => tokenEl(c.color, c.token).classList.remove('flying'));
  } else if (close) {
    $('#board-wrap').classList.add('vignette');
    boardLabel('SO CLOSE!');
    sfx.gasp();
    await sleep(1000);
    $('#board-wrap').classList.remove('vignette');
  }
  if (ev.home) {
    sfx.home();
    boardLabel(ev.finished ? 'ALL HOME!' : 'HOME!');
    const [x, y] = centerOf(el), col = [COLORS[ev.color], '#fff', COLORS[ev.color], '#ffc233'];
    confetti(x, y, 40, 150, col);
    setTimeout(() => confetti(x, y, 30, 220, col), 200);
    if (ev.finished) toast(`${shortName(ev.color)} ${isMine(ev.color) ? 'are' : 'is'} all home! Partner, finish the job 💪`, 2600);
    else toast('🏠 Piece home! Bonus roll!');
    await sleep(450);
  } else if (ev.bonus && !ev.captured.length) toast('Rolled a 6! Roll again 🎉', 1300);
}

/* ================= bots (and stand-ins for players who dropped) ================= */
function maybeAI() {
  clearTimeout(aiTimer);
  if (mode === 'guest' || !game || game.phase === 'over') return;
  const c = R.current(game);
  if (!isBot(c) && !offline.has(c)) return;
  aiTimer = setTimeout(() => {
    if (busy || !game || R.current(game) !== c) return;
    if (game.phase === 'roll') host.handle(c, { t: 'roll' });
    else if (game.phase === 'move') host.handle(c, { t: 'move', i: aiPick(game) });
  }, offline.has(c) ? 5000 : game.phase === 'roll' ? 750 : 550); // give a dropped player time to reconnect
}
function aiPick(s) {
  const color = R.current(s), team = R.teamOf(s, color);
  let best = null, bestScore = -Infinity;
  for (const i of R.legalMoves(s)) {
    const next = R.move(s, i), ev = next.events[0];
    let score = ev.to / 10 + ev.captured.length * 100 + (ev.home ? 60 : 0) + (ev.from === -1 ? 45 : 0);
    if (ev.to <= R.LAST_TRACK) {
      const a = R.absIndex(color, ev.to);
      if (R.SAFE.has(a)) score += 25;
      else if (threatened(s.tokens, s.players, color, a, team)) score -= 35;
    }
    if (ev.from >= 0 && ev.from <= R.LAST_TRACK && threatened(s.tokens, s.players, color, R.absIndex(color, ev.from), team)) score += 20;
    score += Math.random() * 3;
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return best;
}

function teardown() {
  session++;
  clearTimeout(aiTimer);
  const oldRoom = room, oldConn = conn;
  room = null; conn = null; // so the close handlers below see we're leaving on purpose
  if (oldConn) { try { oldConn.close(); } catch (e) {} }
  if (oldRoom) oldRoom.seats.forEach((s) => { try { s.link && s.link.close(); } catch (e) {} });
  const old = clients;
  setTimeout(() => old.forEach((cl) => { try { cl.end(true); } catch (e) {} }), 400);
  clients = [];
  conn = null; mode = null; game = null; host.state = null; room = null; hostName = ''; hostColor = null; latest = null; roomCode = '';
  queue = Promise.resolve(); busy = false; offline = new Set();
  $('#win').hidden = true;
  $('#toast').classList.remove('show');
  $('#board-wrap').classList.remove('vignette');
}
function goHome(error = '') {
  teardown();
  show('home');
  renderHome();
  renderResume();
  $('#home-error').textContent = error;
}
// Leaving on purpose: don't offer "Back to your game" afterwards.
function leaveToHome() { forgetRoom(); goHome(); }
function startGameScreen() {
  show('game');
  resetSocial();
}

/* ---------- room screen (shared by host and guests) ---------- */
function roomPayload() {
  return { t: 'room', code: room.code, host: me.name, teams: room.teams, seats: room.seats.map((s) => ({ name: s.name, avatar: s.avatar, bot: !!s.bot })) };
}
function sendRoom() {
  const p = roomPayload();
  room.seats.forEach((s) => s.link && s.link.open && s.link.send(p));
  renderRoom(p);
}
function renderRoom(p) {
  const amHost = mode === 'host', n = p.seats.length, colors = COLOR_SETS[Math.max(2, n)] || COLOR_SETS[4];
  const teams = p.teams && n === 4;
  $('#room-title').textContent = amHost ? 'Your room' : `${p.host.split(' ').pop()}'s room`;
  $('#code-card').hidden = false;
  $('#code-hint').textContent = amHost ? 'Send this code to your friends' : 'Room code';
  $('#room-code').textContent = p.code;
  let html = '';
  for (let i = 0; i < 4; i++) {
    const s = p.seats[i];
    if (s) {
      const you = s.name === me.name && !s.bot;
      const status = i === 0 ? 'Host' : s.bot ? '' : `${ic('check')}Joined`;
      html += `<div class="seat" style="--c:${COLORS[colors[i]]}"><span class="av">${avatarHTML(s.avatar)}</span><span class="nm">${escapeHtml(s.name)}${you ? ' (you)' : ''}</span>`
        + (teams ? `<span class="team">Team ${i % 2 ? 'B' : 'A'}</span>` : '')
        + (s.bot && amHost ? `<button class="rm" type="button" data-rmbot="${i}" aria-label="Remove ${escapeHtml(s.name)}">${ic('x')}</button>` : `<span class="st">${s.bot ? 'Bot' : status}</span>`)
        + '</div>';
    } else if (amHost) {
      html += `<button class="seat empty" type="button" data-addbot><span class="av">${ic('plus')}</span><span class="nm">Add a bot</span><span class="st">or wait for a friend</span></button>`;
    } else {
      html += '<div class="seat empty"><span class="av"></span><span class="nm">Open seat</span></div>';
    }
  }
  $('#seats').innerHTML = html;
  $('#teams').checked = teams;
  $('#teams').disabled = !amHost || n !== 4;
  $('#teams-hint').textContent = n === 4 ? 'Seats 1 and 3 against seats 2 and 4' : 'Turns on with 4 players';
  $('#btn-start').hidden = !amHost;
  $('#btn-start').disabled = n < 2;
  const wait = $('#room-wait');
  wait.hidden = amHost && n >= 2;
  wait.innerHTML = amHost ? 'Waiting for a friend<span class="dots"><i>.</i><i>.</i><i>.</i></span>'
    : `Waiting for ${escapeHtml(p.host.split(' ').pop())} to start<span class="dots"><i>.</i><i>.</i><i>.</i></span>`;
}
function renderJoining(code) {
  $('#room-title').textContent = 'Joining…';
  $('#code-card').hidden = false;
  $('#code-hint').textContent = 'Room code';
  $('#room-code').textContent = code;
  $('#seats').innerHTML = '';
  $('#btn-start').hidden = true;
  $('#teams').disabled = true;
  $('#room-wait').hidden = false;
  $('#room-wait').innerHTML = 'Knocking on the door<span class="dots"><i>.</i><i>.</i><i>.</i></span>';
  $('#room-error').textContent = '';
}

/* ---------- host ----------
   The room code gives the topic and key. `epoch` counts host handovers: each host listens on
   its own epoch's topics, so a host that dropped out and came back can't talk over the new one. */
const PROBE = 6; // how many epochs a joining player listens on
// hostTopic / guestTopic come from shared/net.js

async function listenAsHost() {
  const my = session, keys = await roomKeys(room.code);
  let client;
  try { client = await firstBroker(); } catch (e) {
    if (my === session) goHome('Could not reach the game server. Check your internet and try again!');
    return;
  }
  if (my !== session) return;
  const hostId = randomId(), links = new Map(), epoch = room.epoch;
  client.subscribe(hostTopic(keys, epoch), { qos: 1 });
  client.on('message', async (topic, payload) => {
    const m = await unseal(keys.key, payload);
    if (!m || my !== session || typeof m.from_ !== 'string' || (m.to && m.to !== hostId)) return;
    let link = links.get(m.from_);
    if (!link) {
      if (m.t !== 'hello') return;
      link = makeLink(client, keys, hostId, m.from_, guestTopic(keys, epoch));
      links.set(m.from_, link);
      link.on('close', () => links.delete(m.from_));
      handleGuest(link);
    }
    link.receive(m);
  });
}

async function createRoom() {
  if (typeof mqtt === 'undefined') return goHome('Could not load the online library. Check your internet 🙏');
  teardown();
  mode = 'host'; myColors = ['red'];
  room = { code: genCode('L'), epoch: 0, seats: [{ name: me.name, avatar: myAvatar() }], teams: false, started: false };
  hostName = me.name;
  $('#room-error').textContent = '';
  renderRoom(roomPayload());
  show('room');
  await listenAsHost();
}

// The host left mid-game: the first player still here (in seat order) carries on hosting
// from the last state everyone saw. The others reconnect to them on the next epoch.
function takeOverAsHost(code, epoch, s) {
  const mine = myColors[0];
  teardown();
  mode = 'host'; myColors = [mine]; hostName = me.name;
  room = {
    code, epoch, started: true, teams: !!s.teams,
    seats: s.players.map((c) => ({ color: c, name: s.names[c], avatar: (s.avatars || {})[c] || '🙂', bot: (s.bots || []).includes(c) })),
  };
  offline = new Set(room.seats.filter((x) => !x.bot && x.color !== mine).map((x) => x.color));
  host.cfg = { players: s.players, names: s.names, avatars: s.avatars, bots: s.bots, teams: !!s.teams };
  host.state = s;
  onState(s, true);
  rememberRoom(code);
  toast("The host left, so you're hosting now 👑", 3500);
  listenAsHost();
}

function handleGuest(c) {
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
      if (room.started && !seat) return reject('This game already started. Ask for a new room 🙂');
      if (!seat) {
        if (room.seats.length >= 4) return reject('This room is full 🙅');
        seat = { name };
        room.seats.push(seat);
      }
      const old = seat.link;
      seat.link = c;
      if (old && old !== c) old.drop();
      seat.avatar = AVATARS.includes(d.avatar) ? d.avatar : seat.avatar || '🙂';
      state = 'ok';
      clearTimeout(timer);
      sfx.pop();
      if (room.started) {
        offline.delete(seat.color);
        sendPresence();
        c.send(stateMsg(seat, true));
        toast(`${name.split(' ').pop()} is back 👋`);
      } else {
        sendRoom();
        toast(`${name} joined 🎉`);
      }
      return;
    }
    if (state !== 'ok' || seat.link !== c || !d) return;
    if (d.t === 'act' && room.started && (d.a === 'roll' || d.a === 'move')) host.handle(seat.color, { t: d.a, i: d.i });
    else if (d.t === 'social' && room.started && d.m && typeof d.m === 'object') {
      const m = { ...d.m, from: seat.color };
      if (receiveSocial(m)) relaySocial(m, c);
    }
  });
  c.on('close', () => {
    if (!room || !seat || seat.link !== c) return;
    seat.link = null;
    if (room.started) {
      offline.add(seat.color);
      sendPresence();
      toast(`${seat.name.split(' ').pop()} dropped out. A bot plays for them until they're back.`, 3500);
      maybeAI();
    } else {
      room.seats.splice(room.seats.indexOf(seat), 1);
      sendRoom();
    }
  });
}
function sendPresence() {
  const off = [...offline];
  room.seats.forEach((s) => s.link && s.link.open && s.link.send({ t: 'presence', offline: off }));
  if (game) renderPlayers();
}
function relaySocial(m, except) {
  if (room) room.seats.forEach((s) => s.link && s.link.open && s.link !== except && s.link.send({ t: 'social', m }));
}
// Called by social.js with a message this device just sent and showed.
function sendSocial(m) {
  if (mode === 'host') relaySocial(m, null);
  else if (mode === 'guest' && conn && conn.open) conn.send({ t: 'social', m });
}

function startOnline() {
  const n = room.seats.length;
  if (n < 2 || room.started) return;
  const players = COLOR_SETS[n];
  room.seats.forEach((s, i) => (s.color = players[i]));
  room.started = true;
  myColors = [players[0]];
  const by = (f) => Object.fromEntries(room.seats.map((s) => [s.color, f(s)]));
  startGameScreen();
  rememberRoom(room.code);
  host.start({
    players, names: by((s) => s.name), avatars: by((s) => s.avatar),
    bots: room.seats.filter((s) => s.bot).map((s) => s.color), teams: room.teams && n === 4,
  });
}

/* ---------- guest ---------- */
// resume: we were already in this game (the host changed), so stay on the game screen.
async function joinRoom(code, { minEpoch = 0, resume = false } = {}) {
  code = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) { $('#home-error').textContent = 'Room codes are 6 letters or numbers 🙂'; return; }
  if (typeof mqtt === 'undefined') { $('#home-error').textContent = 'Could not load the online library. Check your internet 🙏'; return; }
  teardown();
  const my = session;
  mode = 'guest'; myColors = [];
  if (resume) { $('#status').textContent = 'Reconnecting…'; $('#dice').disabled = true; }
  else { renderJoining(code); show('room'); }
  const keys = await roomKeys(code);
  if (my !== session) return;
  const myId = randomId(), epochs = Array.from({ length: PROBE }, (_, k) => minEpoch + k);
  const giveUp = setTimeout(() => {
    if (my === session && !conn) { goHome('No answer from that room 🤔 Is anyone still in it?'); $('#join-code').value = code; }
  }, resume ? 30000 : 20000);
  let chosen = null, pickTimer = null;
  const offers = [];
  const sayHello = async (cl) => {
    if (chosen || my !== session) return;
    const p = await seal(keys.key, { t: 'hello', user: me.user || me.name, proof: me.proof, avatar: myAvatar(), from_: myId });
    epochs.forEach((e) => cl.publish(hostTopic(keys, e), p, { qos: 1 }));
  };
  // Wait a moment after the first answer and go with the newest host, in case an old one is still around.
  const pick = () => {
    if (chosen || my !== session) return;
    chosen = offers.reduce((a, b) => (b.epoch > a.epoch ? b : a));
    clients.filter((o) => o !== chosen.cl).forEach((o) => o.end(true));
    conn = makeLink(chosen.cl, keys, myId, chosen.from, hostTopic(keys, chosen.epoch), { dial: true });
    wireGuest(conn, giveUp, code, chosen.epoch);
    chosen.queue.forEach((m) => conn.receive(m));
  };
  // Try every broker at once; whichever one a host answers on wins.
  for (const url of BROKERS) {
    const cl = connectBroker(url);
    let helloTimer;
    cl.on('connect', () => {
      cl.subscribe(epochs.map((e) => guestTopic(keys, e)), { qos: 1 }, () => {
        sayHello(cl);
        clearInterval(helloTimer);
        helloTimer = setInterval(() => (chosen || my !== session ? clearInterval(helloTimer) : sayHello(cl)), 3000);
      });
    });
    cl.on('message', async (topic, payload) => {
      const m = await unseal(keys.key, payload);
      if (!m || m.to !== myId || my !== session) return;
      const epoch = +topic.slice(topic.lastIndexOf('/g') + 2);
      if (chosen) {
        if (cl === chosen.cl && epoch === chosen.epoch && conn && m.from_ === conn.peerId) conn.receive(m);
        return;
      }
      let offer = offers.find((o) => o.cl === cl && o.epoch === epoch && o.from === m.from_);
      if (!offer) offers.push((offer = { cl, epoch, from: m.from_, queue: [] }));
      offer.queue.push(m);
      if (!pickTimer) pickTimer = setTimeout(pick, 1200);
    });
  }
}

function wireGuest(link, giveUp, code, epoch) {
  link.on('data', (d) => {
    if (d.t === 'room') {
      clearTimeout(giveUp);
      hostName = String(d.host || '');
      if (!game && Array.isArray(d.seats)) { renderRoom(d); show('room'); }
    } else if (d.t === 'state') {
      clearTimeout(giveUp);
      if (!(d.you in R.START) || !d.s || !d.s.names) return;
      myColors = [d.you];
      latest = d.s;
      if (d.hostColor in R.START) { hostColor = d.hostColor; hostName = d.s.names[hostColor] || hostName; }
      if (!document.querySelector('#screen-game.active')) startGameScreen();
      rememberRoom(code);
      onState(d.s, d.sync);
    } else if (d.t === 'social' && d.m) receiveSocial(d.m);
    else if (d.t === 'presence' && Array.isArray(d.offline)) { offline = new Set(d.offline); if (game) renderPlayers(); }
    else if (d.t === 'reject') { clearTimeout(giveUp); goHome(String(d.why || 'Could not join')); }
  });
  link.on('close', () => {
    if (mode !== 'guest' || conn !== link) return;
    if (latest && hostColor) return handOver(code, epoch, latest);
    goHome('Connection dropped. Tap Join to hop back in!');
    $('#join-code').value = code;
  });
}

// Everyone runs the same choice, so they all agree on who hosts next.
function handOver(code, epoch, s) {
  const stay = s.players.filter((c) => c !== hostColor && !(s.bots || []).includes(c) && !offline.has(c));
  if (!stay.length) return goHome('The host left the game.');
  if (stay[0] === myColors[0]) return takeOverAsHost(code, epoch + 1, s);
  toast(`The host left. Moving the game to ${shortName(stay[0])}…`, 3500);
  joinRoom(code, { minEpoch: epoch + 1, resume: true });
}

/* ---------- getting back into a game after closing the app ---------- */
function rememberRoom(code) { roomCode = code; store.set('ludo-lastroom', { code, at: Date.now() }); }
function forgetRoom() { store.del('ludo-lastroom'); }
function renderResume() {
  const last = store.get('ludo-lastroom', null), fresh = last && Date.now() - last.at < 3 * 3600e3;
  $('#btn-resume').hidden = !fresh;
  if (fresh) $('#resume-code').textContent = last.code;
}

function startCpu() {
  teardown();
  mode = 'cpu'; myColors = ['red']; hostName = me.name;
  startGameScreen();
  host.start({
    players: ['red', 'yellow'], names: { red: me.name, yellow: 'Robo-Bonk' },
    avatars: { red: myAvatar(), yellow: '🤖' }, bots: ['yellow'], teams: false,
  });
}

/* ================= wiring ================= */
function enterHome() {
  goHome();
  const roomParam = new URLSearchParams(location.search).get('room');
  if (roomParam) {
    history.replaceState(null, '', location.pathname);
    $('#join-code').value = roomParam.toUpperCase();
    joinRoom(roomParam);
  }
}

$('#btn-create').onclick = () => { sfx.pop(); createRoom(); };
$('#btn-join').onclick = () => { sfx.pop(); joinRoom($('#join-code').value); };
$('#join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(e.target.value); });
$('#btn-cpu').onclick = () => { sfx.pop(); startCpu(); };
$('#btn-room-back').onclick = leaveToHome;
$('#btn-resume').onclick = () => { sfx.pop(); const last = store.get('ludo-lastroom', null); if (last) joinRoom(last.code); };
$('#btn-start').onclick = () => { sfx.pop(); startOnline(); };
$('#teams').onchange = (e) => { if (mode === 'host' && room) { room.teams = e.target.checked; sendRoom(); } };
$('#seats').addEventListener('click', (e) => {
  if (mode !== 'host' || !room || room.started) return;
  const add = e.target.closest('[data-addbot]'), rm = e.target.closest('[data-rmbot]');
  if (add && room.seats.length < 4) {
    const used = room.seats.map((s) => s.name);
    room.seats.push({ name: BOT_NAMES.find((b) => !used.includes(b)), avatar: '🤖', bot: true });
  } else if (rm) {
    const i = +rm.dataset.rmbot;
    if (room.seats[i] && room.seats[i].bot) room.seats.splice(i, 1);
  } else return;
  sfx.pop();
  sendRoom();
});
$('#btn-share').onclick = async () => {
  const code = $('#room-code').textContent;
  const link = `${location.origin}${location.pathname}?room=${code}`;
  if (navigator.share) {
    try { await navigator.share({ title: 'Sweet Revenge', text: `Join my Ludo room: ${code}`, url: link }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(link); toast('Invite link copied! Send it to your friends 💌'); }
  catch (e) { prompt('Copy this link:', link); }
};
const leave = () => {
  if (mode !== 'cpu' && game && game.phase !== 'over' && !confirm('Leave the game? A bot will play for you until you come back.')) return;
  leaveToHome();
};
$('#btn-leave').onclick = leave;
$('#btn-win-leave').onclick = leaveToHome;
$('#btn-again').onclick = () => { if (game) host.handle(game.players[0], { t: 'restart' }); };
$('#btn-mute').onclick = (e) => setIcon(e.currentTarget, sfx.toggle() ? 'mute' : 'volume');
$('#dice').onclick = () => { if (canRoll()) { $('#dice').disabled = true; act({ t: 'roll' }); } };
$('#tokens').addEventListener('click', (e) => {
  const el = e.target.closest('.token.can');
  if (!el) return;
  const c = el.dataset.c, i = +el.dataset.i;
  if (!movable().some(([mc, mi]) => mc === c && mi === i)) return;
  document.querySelectorAll('.token.can').forEach((t) => t.classList.remove('can'));
  act({ t: 'move', i });
});
// Laptop shortcuts: Space rolls, 1-4 moves that piece, Enter jumps to the chat box.
document.addEventListener('keydown', (e) => {
  if (!document.querySelector('#screen-game.active') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target instanceof Element && e.target.closest('input, textarea, button')) return;
  if (e.key === ' ' && canRoll()) { e.preventDefault(); $('#dice').click(); }
  else if (/^[1-4]$/.test(e.key)) {
    const el = tokenEl(myColors[0], +e.key - 1);
    if (el && el.classList.contains('can')) el.click();
  } else if (e.key === 'Enter') { e.preventDefault(); chat.open(true); }
});
// Closing the app: say goodbye so the others react now instead of after the 15 s heartbeat.
// teardown() clears `room` first, so the host doesn't announce anyone as offline on the way out.
addEventListener('pagehide', () => { if (mode === 'host' || mode === 'guest') teardown(); });

// Scripts run in order, so shared/core.js and social.js are ready by the time the page has loaded.
document.addEventListener('DOMContentLoaded', () => {
  hydrateIcons();
  applyPalette();
  buildBoard();
  buildDice();
  showDice(6, false);
  wireProfileSheet();
  requireLogin().then(enterHome);
});
