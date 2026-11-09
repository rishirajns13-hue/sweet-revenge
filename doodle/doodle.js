'use strict';
/* Doodle Duel: one player draws a secret word, everyone else guesses. The host's browser runs
   the rounds (word, timer, hints, scoring); the others send it their strokes and guesses, and it
   relays them to everyone. If the host leaves, the next player takes over from the next round. */
const DL = window.DoodleLogic;
const NS = 'doodleduel-rr7';
const W = 800, H = 600;
const INKS = ['#2b2140', '#ffffff', '#ff5a5f', '#ff9f43', '#ffc233', '#2bc48a', '#4d9de0', '#a77bff', '#ff8fc8', '#8b5a2b'];
const SIZES = [4, 10, 24];
const SEAT_COLORS = ['#ff5a5f', '#4d9de0', '#2bc48a', '#ffc233'];
const PICK_MS = 12000, REVEAL_MS = 8000;
const TWISTS = {
  blind: { icon: '🙈', title: 'Blindfold round', line: (n) => `${n} can't see their own drawing.` },
  mirror: { icon: '🪞', title: 'Mirror pen', line: (n) => `${n}'s pen is flipped left to right.` },
  fade: { icon: '👻', title: 'Disappearing ink', line: () => 'Every line fades away after a few seconds.' },
  wobble: { icon: '🫨', title: 'Wobbly hand', line: (n) => `${n} has had way too much coffee.` },
  straight: { icon: '📏', title: 'Straight lines only', line: () => 'Every stroke turns into a straight line.' },
};
const REACTS = ['😂', '💀', '🤨', '🔥', '👏', '🫠'];
const STAMPS = { master: ['MASTERPIECE', '#ffc233'], what: ['WHAT IS THIS', '#ff8fc8'], eyes: ['MY EYES 🙈', '#7cc4ff'], ten: ['10/10', '#2bc48a'] };
const LINES = {
  pickWait: ['{n} is choosing what to ruin…', '{n} is picking a word. Brace yourselves.', '{n} is warming up their drawing hand…'],
  nobody: ['Nobody got it. Art is dead. 🪦', 'The museum has rejected this piece.', 'That was… a choice.', 'Not even the artist knows what that was.'],
  fast: ['MIND READER 🧠', 'Are you two sharing a brain?', 'Telepathy unlocked 🔮'],
  clutch: ['CLUTCH! ⏱️', 'Just in time 😅'],
  everyone: ['Everybody got it! Suspiciously easy. 🤨', 'Too easy. Next!'],
  idle: ['{n} is staring at the canvas like it owes them money.', '{n} is thinking very, very hard…', 'Blank canvas. Very modern. 🖼️'],
};
const oneOf = (a) => a[Math.floor(Math.random() * a.length)];
const line = (k, n = '') => oneOf(LINES[k]).replace('{n}', n);
const firstName = (name) => String(name).split(' ').pop();

/* ================= sounds (WebAudio, no files) ================= */
const sfx = (() => {
  let ctx = null, muted = false;
  function tone(freq, dur, type = 'sine', vol = 0.12, when = 0, slideTo) {
    if (muted) return;
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      const t = ctx.currentTime + when, o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + dur + 0.02);
    } catch (e) { /* audio not available */ }
  }
  return {
    pop() { tone(600, 0.07, 'sine', 0.1, 0, 1100); },
    tick() { tone(1200, 0.04, 'square', 0.04); },
    ding() { tone(988, 0.12, 'triangle', 0.12); tone(1319, 0.3, 'triangle', 0.12, 0.1); },
    boop() { tone(300, 0.12, 'sine', 0.08, 0, 220); },
    whoosh() { tone(200, 0.35, 'sawtooth', 0.04, 0, 900); },
    twist() { [196, 185, 147].forEach((f, k) => tone(f, k === 2 ? 0.7 : 0.25, 'square', 0.08, k * 0.28)); },
    trombone() { [392, 370, 349].forEach((f, k) => tone(f, 0.3, 'sawtooth', 0.07, k * 0.32)); tone(330, 0.9, 'sawtooth', 0.07, 0.96, 300); },
    fanfare() { [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, k) => tone(f, 0.22, 'square', 0.06, k * 0.13)); },
    stamp() { tone(140, 0.18, 'square', 0.12, 0, 60); },
    toggle() { muted = !muted; return muted; },
  };
})();

/* ================= the canvas: strokes everyone replays the same way =================
   Ops (logical 800x600 coordinates): ['s', ink, size, x, y] start, ['p', x, y] point, ['e'] end,
   ['f', x, y, ink] fill, ['u'] undo, ['c'] clear. */
const canvas = $('#canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true });
const ink = {
  items: [], cur: null, twist: null, raf: 0,
  get simple() { return this.twist !== 'fade' && this.twist !== 'straight'; },
  reset(twist = null) { this.items = []; this.cur = null; this.twist = twist; this.redraw(); this.loop(); },
  apply(ops) {
    let full = false;
    for (const op of ops) {
      if (op[0] === 's') { this.cur = { c: INKS[op[1]], w: SIZES[op[2]], pts: [[op[3], op[4]]], end: 0 }; this.items.push(this.cur); if (this.simple) dot(ctx, this.cur); }
      else if (op[0] === 'p' && this.cur) { const prev = this.cur.pts[this.cur.pts.length - 1]; this.cur.pts.push([op[1], op[2]]); if (this.simple) seg(ctx, this.cur, prev, [op[1], op[2]]); }
      else if (op[0] === 'e') { if (this.cur) this.cur.end = performance.now(); this.cur = null; }
      else if (op[0] === 'f') { this.items.push({ fill: true, x: op[1], y: op[2], c: INKS[op[3]] }); if (this.simple) floodFill(ctx, op[1], op[2], INKS[op[3]]); }
      else if (op[0] === 'u') { this.items.pop(); this.cur = null; full = true; }
      else if (op[0] === 'c') { this.items = []; this.cur = null; full = true; }
    }
    if (full || !this.simple) this.redraw();
  },
  redraw(target = ctx, forSave = false) {
    target.fillStyle = '#fff'; target.fillRect(0, 0, W, H);
    const now = performance.now();
    for (const it of this.items) {
      if (it.fill) { floodFill(target, it.x, it.y, it.c); continue; }
      let alpha = 1;
      if (this.twist === 'fade' && !forSave && it.end) alpha = Math.max(0, 1 - (now - it.end - 2500) / 1200);
      if (alpha <= 0) continue;
      target.globalAlpha = Math.min(1, alpha);
      const pts = this.twist === 'straight' ? [it.pts[0], it.pts[it.pts.length - 1]] : it.pts;
      dot(target, { c: it.c, w: it.w, pts });
      for (let i = 1; i < pts.length; i++) seg(target, it, pts[i - 1], pts[i]);
      target.globalAlpha = 1;
    }
  },
  // Disappearing ink needs a redraw every frame while lines fade.
  loop() {
    cancelAnimationFrame(this.raf);
    if (this.twist !== 'fade') return;
    const tick = () => { this.redraw(); this.raf = requestAnimationFrame(tick); };
    this.raf = requestAnimationFrame(tick);
  },
  snapshot() {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    this.redraw(c.getContext('2d', { willReadFrequently: true }), true);
    return c.toDataURL('image/png');
  },
};
function dot(g, s) { const [x, y] = s.pts[0]; g.fillStyle = s.c; g.beginPath(); g.arc(x, y, s.w / 2, 0, Math.PI * 2); g.fill(); }
function seg(g, s, a, b) { g.strokeStyle = s.c; g.lineWidth = s.w; g.lineCap = g.lineJoin = 'round'; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); }
function floodFill(g, x0, y0, color) {
  x0 = Math.round(x0); y0 = Math.round(y0);
  if (x0 < 0 || y0 < 0 || x0 >= W || y0 >= H) return;
  const img = g.getImageData(0, 0, W, H), d = img.data;
  const at = (x, y) => (y * W + x) * 4, i0 = at(x0, y0);
  const target = [d[i0], d[i0 + 1], d[i0 + 2]];
  const fill = [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16)];
  if (Math.abs(target[0] - fill[0]) + Math.abs(target[1] - fill[1]) + Math.abs(target[2] - fill[2]) < 10) return;
  const same = (i) => Math.abs(d[i] - target[0]) + Math.abs(d[i + 1] - target[1]) + Math.abs(d[i + 2] - target[2]) < 90;
  const stack = [[x0, y0]];
  while (stack.length) {
    const [x, y] = stack.pop();
    let l = x;
    while (l >= 0 && same(at(l, y))) l--;
    let up = false, down = false;
    for (let r = l + 1; r < W && same(at(r, y)); r++) {
      const i = at(r, y); d[i] = fill[0]; d[i + 1] = fill[1]; d[i + 2] = fill[2]; d[i + 3] = 255;
      if (y > 0) { const s = same(at(r, y - 1)); if (s && !up) stack.push([r, y - 1]); up = s; }
      if (y < H - 1) { const s = same(at(r, y + 1)); if (s && !down) stack.push([r, y + 1]); down = s; }
    }
  }
  g.putImageData(img, 0, 0);
}

/* ================= app state ================= */
let mode = null;     // 'host' | 'guest'
let session = 0;     // bumped when leaving, so stale async work bails out
let room = null;     // host: { code, epoch, seats: [{ k, name, avatar, link }], settings, started }
let conn = null;     // guest: link to the host
let myK = null, hostK = null, epochNow = 0, roomCode = '';
let G = null;        // host: the full game, secrets included
let view = null;     // what this player may see (what we render)
let viewAt = 0;      // when `view` arrived, for the countdown
let timers = [];
let localGallery = {}; // round → PNG of the finished drawing, kept on this device
const alive = (my) => () => my === session;

const DEFAULT_SETTINGS = { rounds: 2, seconds: 60, packs: ['easy', 'silly', 'desi'], chaos: true, custom: [] };
const PACK_LABELS = { easy: 'Easy peasy', silly: 'Silly stuff', desi: 'Desi', custom: 'Inside jokes' };

function show(screen) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === 'screen-' + screen));
  document.body.classList.toggle('in-game', screen === 'play');
  chat.setInGame(screen === 'play' || screen === 'end');
}
function teardown() {
  session++;
  timers.forEach(clearTimeout); timers = [];
  const oldRoom = room, oldConn = conn;
  room = null; conn = null;
  if (oldConn) { try { oldConn.close(); } catch (e) {} }
  if (oldRoom) oldRoom.seats.forEach((s) => { try { s.link && s.link.close(); } catch (e) {} });
  closeAllClients();
  mode = null; G = null; view = null; myK = null; hostK = null;
  cancelAnimationFrame(ink.raf);
  chat.reset();
}
function goHome(error = '') {
  teardown();
  show('home');
  renderHomeBits();
  $('#home-error').textContent = error;
}
function leaveToHome() { store.del('doodle-lastroom'); goHome(); }
function renderHomeBits() {
  if (me) $('#me-avatar').textContent = myAvatar();
  const last = store.get('doodle-lastroom', null), fresh = last && Date.now() - last.at < 2 * 3600e3;
  $('#btn-resume').hidden = !fresh;
  if (fresh) $('#resume-code').textContent = last.code;
}
const rememberRoom = (code) => store.set('doodle-lastroom', { code, at: Date.now() });

/* ================= room screen (host and guests) ================= */
function roomPayload() {
  return { t: 'room', code: room.code, host: me.name, settings: room.settings, seats: room.seats.map((s) => ({ name: s.name, avatar: s.avatar })) };
}
function sendRoom() {
  const p = roomPayload();
  room.seats.forEach((s) => s.link && s.link.open && s.link.send(p));
  renderRoom(p);
}
function renderRoom(p) {
  const amHost = mode === 'host', n = p.seats.length, st = p.settings;
  $('#room-title').textContent = amHost ? 'Your room' : `${firstName(p.host)}'s room`;
  $('#code-hint').textContent = amHost ? 'Send this code to your friends' : 'Room code';
  $('#room-code').textContent = p.code;
  let html = '';
  for (let i = 0; i < 4; i++) {
    const s = p.seats[i];
    html += s
      ? `<div class="seat" style="--c:${SEAT_COLORS[i]}"><span class="av">${s.avatar}</span><span class="nm">${escapeHtml(s.name)}${s.name === me.name ? ' (you)' : ''}</span><span class="st">${i === 0 ? 'Host' : `${ic('check')}Joined`}</span></div>`
      : `<div class="seat empty"><span class="av"></span><span class="nm">${i === n ? 'Waiting for a friend…' : 'Open seat'}</span></div>`;
  }
  $('#seats').innerHTML = html;
  const chips = (key, opts) => `<div class="chips" data-set="${key}">${opts.map(([v, label]) => {
    const on = key === 'packs' ? st.packs.includes(v) : st[key] === v;
    return `<button type="button" class="chip-btn" data-v="${v}" aria-pressed="${on}" ${amHost ? '' : 'disabled'}>${label}</button>`;
  }).join('')}</div>`;
  const custom = st.packs.includes('custom');
  $('#settings').innerHTML = `
    <div class="set-row"><b>Turns each</b>${chips('rounds', [[1, '1'], [2, '2'], [3, '3']])}</div>
    <div class="set-row"><b>Time to draw</b>${chips('seconds', [[45, '45s'], [60, '60s'], [90, '90s']])}</div>
    <div class="set-row"><b>Words</b>${chips('packs', Object.entries(PACK_LABELS))}</div>
    ${custom ? (amHost
      ? `<label class="custom">Your inside jokes, one per line or separated by commas<textarea id="custom-words" rows="3" placeholder="Ammu's cooking, Kunju's dance moves, the haunted fridge">${escapeHtml(st.custom.join(', '))}</textarea></label>`
      : `<p class="custom-note">${st.custom.length} inside jokes in the mix 🤫</p>`) : ''}
    <label class="toggle dark"><input id="chaos" type="checkbox" ${st.chaos ? 'checked' : ''} ${amHost ? '' : 'disabled'}><span class="sw" aria-hidden="true"></span>
      <span>Chaos twists<small>Blindfold rounds, mirror pen, disappearing ink…</small></span></label>`;
  $('#btn-start').hidden = !amHost;
  $('#btn-start').disabled = n < 2;
  const wait = $('#room-wait');
  wait.hidden = amHost && n >= 2;
  wait.innerHTML = amHost ? 'Waiting for a friend<span class="dots"><i>.</i><i>.</i><i>.</i></span>'
    : `Waiting for ${escapeHtml(firstName(p.host))} to start<span class="dots"><i>.</i><i>.</i><i>.</i></span>`;
}
$('#settings').addEventListener('click', (e) => {
  const b = e.target.closest('.chip-btn');
  if (!b || mode !== 'host' || !room || room.started) return;
  const key = b.parentElement.dataset.set, st = room.settings;
  if (key === 'packs') {
    const v = b.dataset.v, has = st.packs.includes(v);
    if (has && st.packs.length === 1) return toast('Keep at least one word pack 🙂');
    st.packs = has ? st.packs.filter((p) => p !== v) : st.packs.concat(v);
  } else st[key] = +b.dataset.v;
  store.set('doodle-settings', { ...st, custom: undefined });
  sfx.pop(); sendRoom();
});
$('#settings').addEventListener('change', (e) => {
  if (mode !== 'host' || !room) return;
  if (e.target.id === 'chaos') { room.settings.chaos = e.target.checked; store.set('doodle-settings', { ...room.settings, custom: undefined }); sendRoom(); }
});
$('#settings').addEventListener('input', (e) => {
  if (e.target.id !== 'custom-words' || mode !== 'host' || !room) return;
  const words = e.target.value.split(/[,\n]/).map((w) => w.trim().slice(0, 40)).filter(Boolean).slice(0, 60);
  room.settings.custom = words;
  store.set('doodle-custom', words);
  clearTimeout(room.typing);
  room.typing = setTimeout(() => room.seats.forEach((s) => s.link && s.link.open && s.link.send(roomPayload())), 500);
});

/* ================= host: running the game ================= */
const later = (ms, fn) => timers.push(setTimeout(fn, ms));
const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };
const seatOf = (k) => room && room.seats.find((s) => s.k === k);
const connected = (k) => k === myK || !!(seatOf(k) && seatOf(k).link && seatOf(k).link.open);
const nameOfK = (k) => { const p = (G || view || { players: [] }).players.find((x) => x.k === k); return p ? p.name : '?'; };

function wordList(st) {
  let words = st.packs.flatMap((p) => (p === 'custom' ? st.custom : (WORD_PACKS[p] ? WORD_PACKS[p].words : [])));
  if (words.length < 6) words = words.concat(WORD_PACKS.easy.words);
  return [...new Set(words)];
}
function freshStats(players) { return Object.fromEntries(players.map((p) => [p.k, { fastest: 0, fastestWord: '', wrong: 0, drawPoints: 0, stumped: [], clutch: 0 }])); }

function startGame() {
  const players = room.seats.filter((s) => connected(s.k)).map((s) => ({ k: s.k, name: s.name, avatar: s.avatar }));
  if (players.length < 2) return toast('You need at least 2 players 🙂');
  const st = { ...room.settings };
  G = {
    gid: Math.random().toString(36).slice(2, 10), v: 0, phase: 'pick', players, settings: st, words: wordList(st), used: [],
    scores: Object.fromEntries(players.map((p) => [p.k, 0])), round: 0, total: players.length * st.rounds,
    drawer: null, choices: [], word: null, twist: null, lastTwist: null, deadline: 0, hints: [], guessed: [], wrongs: [],
    ops: [], reveal: null, gallery: [], stats: freshStats(players), awards: null,
  };
  room.started = true;
  rememberRoom(room.code);
  nextRound();
}
function nextRound() {
  clearTimers();
  if (!G) return;
  // Skip anyone who has dropped out as the drawer.
  do { G.round++; } while (G.round <= G.total && !connected(G.players[(G.round - 1) % G.players.length].k));
  if (G.round > G.total) return finish();
  G.drawer = G.players[(G.round - 1) % G.players.length].k;
  G.choices = DL.pickChoices(G.words, G.used, 3);
  const twisty = G.settings.chaos && G.round > 1 && Math.random() < 0.45;
  G.twist = twisty ? oneOf(Object.keys(TWISTS).filter((t) => t !== G.lastTwist)) : null;
  if (G.twist) G.lastTwist = G.twist;
  Object.assign(G, { phase: 'pick', word: null, guessed: [], wrongs: [], hints: [], ops: [], reveal: null, deadline: Date.now() + PICK_MS });
  later(PICK_MS, () => choose(G.drawer, Math.floor(Math.random() * G.choices.length)));
  relayOps([], null, true);
  push();
}
function choose(k, i) {
  if (!G || G.phase !== 'pick' || k !== G.drawer || !G.choices[i]) return;
  clearTimers();
  const ms = G.settings.seconds * 1000;
  Object.assign(G, { word: G.choices[i], choices: [], phase: 'draw', ops: [], startedAt: Date.now(), deadline: Date.now() + ms });
  G.used.push(G.word);
  const order = DL.hintOrder(G.word);
  if (order.length >= 4) { later(ms * 0.5, () => hint(order[0])); later(ms * 0.75, () => hint(order[1])); }
  later(9000, () => { if (G && G.phase === 'draw' && !G.ops.length) feedAll({ kind: 'sys', text: line('idle', firstName(nameOfK(G.drawer))) }); });
  later(ms, endRound);
  push();
}
function hint(i) {
  if (!G || G.phase !== 'draw') return;
  G.hints.push(i);
  feedAll({ kind: 'sys', text: '💡 A letter just appeared' });
  push();
}
function onOps(k, ops) {
  if (!G || G.phase !== 'draw' || k !== G.drawer || !Array.isArray(ops)) return;
  const clean = ops.map(cleanOp).filter(Boolean).slice(0, 400);
  G.ops.push(...clean);
  relayOps(clean, k);
}
// Ops come from other browsers, so only well-formed ones are replayed.
function cleanOp(op) {
  if (!Array.isArray(op)) return null;
  const n = (v, max) => Math.max(0, Math.min(max, Math.round(+v || 0)));
  if (op[0] === 's') return ['s', n(op[1], INKS.length - 1), n(op[2], SIZES.length - 1), n(op[3], W), n(op[4], H)];
  if (op[0] === 'p') return ['p', n(op[1], W), n(op[2], H)];
  if (op[0] === 'f') return ['f', n(op[1], W - 1), n(op[2], H - 1), n(op[3], INKS.length - 1)];
  if (op[0] === 'e' || op[0] === 'u' || op[0] === 'c') return [op[0]];
  return null;
}
function relayOps(ops, from, reset = false) {
  const msg = reset ? { t: 'opsync', ops: G.ops, twist: G.twist } : { t: 'ops', ops };
  room.seats.forEach((s) => s.link && s.link.open && s.k !== from && s.link.send(msg));
  if (reset) ink.reset(G.twist);
  else if (from !== myK) ink.apply(ops);
}
function onGuess(k, raw) {
  if (!G) return;
  const text = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!text) return;
  const knows = k === G.drawer || G.guessed.some((g) => g.k === k);
  if (G.phase !== 'draw' || knows) {
    if (G.phase === 'draw' && G.word && DL.judge(text, G.word) !== 'wrong') return feedTo(k, { kind: 'sys', text: '🤐 No spoilers! Only you saw that.' });
    return feedAll({ kind: 'chat', k, text });
  }
  const verdict = DL.judge(text, G.word);
  if (verdict === 'correct') {
    const now = Date.now(), left = G.deadline - now, took = now - G.startedAt, first = !G.guessed.length;
    const pts = DL.guessPoints(left, G.settings.seconds * 1000, first);
    G.scores[k] += pts;
    G.guessed.push({ k, ms: took, pts });
    const st = G.stats[k];
    if (!st.fastest || took < st.fastest) { st.fastest = took; st.fastestWord = G.word; }
    if (left < 5000) st.clutch++;
    feedAll({ kind: 'correct', k, pts, text: took < 8000 ? line('fast') : left < 5000 ? line('clutch') : '' });
    const guessers = G.players.filter((p) => p.k !== G.drawer && connected(p.k));
    if (guessers.every((p) => G.guessed.some((g) => g.k === p.k))) { clearTimers(); later(900, endRound); }
    push();
  } else if (verdict === 'close') feedTo(k, { kind: 'close', text });
  else {
    G.wrongs.push({ k, text });
    G.stats[k].wrong++;
    feedAll({ kind: 'guess', k, text });
  }
}
function endRound() {
  if (!G || G.phase !== 'draw') return;
  clearTimers();
  const guessers = G.players.filter((p) => p.k !== G.drawer && connected(p.k)), n = G.guessed.length;
  const everyone = n > 0 && n >= guessers.length;
  const dp = DL.drawerPoints(n, everyone);
  G.scores[G.drawer] += dp;
  G.stats[G.drawer].drawPoints += dp;
  if (!n) G.stats[G.drawer].stumped.push(G.word);
  // The best wrong guess is usually the longest one.
  const best = G.wrongs.length ? G.wrongs.reduce((a, b) => (b.text.length > a.text.length ? b : a)) : null;
  G.reveal = { word: G.word, drawer: G.drawer, guessed: G.guessed.map((g) => g.k), best, dp, line: !n ? line('nobody') : everyone ? line('everyone') : '', stamps: {} };
  G.gallery.push({ round: G.round, word: G.word, drawer: G.drawer, best, twist: G.twist, guessed: G.guessed.map((g) => g.k), stamps: {} });
  G.phase = 'reveal';
  G.deadline = Date.now() + REVEAL_MS;
  later(REVEAL_MS, nextRound);
  push();
}
function onStamp(k, id) {
  if (!G || G.phase !== 'reveal' || !STAMPS[id]) return;
  G.reveal.stamps[id] = (G.reveal.stamps[id] || 0) + 1;
  G.gallery[G.gallery.length - 1].stamps = G.reveal.stamps;
  fxAll({ kind: 'stamp', id, k });
  push();
}
function onReact(k, e) { if (REACTS.includes(e)) fxAll({ kind: 'react', e, k }); }
function finish() {
  clearTimers();
  G.phase = 'over';
  G.awards = DL.awards(G.stats, Object.fromEntries(G.players.map((p) => [p.k, firstName(p.name)])));
  push();
}

// What player k may see: no secret word (unless they're drawing or already got it), no other player's choices.
function viewFor(k) {
  const playing = G.phase === 'pick' || G.phase === 'draw';
  const knows = k === G.drawer || G.guessed.some((g) => g.k === k);
  return {
    gid: G.gid, v: G.v, phase: G.phase, players: G.players, scores: G.scores, round: G.round, total: G.total,
    drawer: G.drawer, twist: G.twist, settings: G.settings, left: Math.max(0, G.deadline - Date.now()), hints: G.hints,
    mask: G.word ? DL.mask(G.word, G.hints) : '', word: !playing || knows ? G.word : null,
    choices: k === G.drawer && G.phase === 'pick' ? G.choices : null, guessed: G.guessed, reveal: G.reveal,
    gallery: G.gallery, stats: G.stats, awards: G.awards, usedBefore: G.used.filter((w) => !playing || w !== G.word),
    offline: G.players.filter((p) => !connected(p.k)).map((p) => p.k),
  };
}
function push() {
  if (!G || !room) return;
  G.v++;
  room.seats.forEach((s) => s.link && s.link.open && s.link.send({ t: 's', s: viewFor(s.k), you: s.k, hostK: myK, epoch: room.epoch }));
  applyView(viewFor(myK));
}
function feedAll(item) {
  room.seats.forEach((s) => s.link && s.link.open && s.link.send({ t: 'feed', item }));
  addFeed(item);
}
function feedTo(k, item) {
  if (k === myK) return addFeed(item);
  const s = seatOf(k);
  if (s && s.link && s.link.open) s.link.send({ t: 'feed', item });
}
function fxAll(fx) {
  room.seats.forEach((s) => s.link && s.link.open && s.link.send({ t: 'fx', fx }));
  playFx(fx);
}
// Everything a player can do goes through here: the host's own clicks and messages from guests.
function hostHandle(k, m) {
  if (!G) return;
  if (m.t === 'pick') choose(k, +m.i);
  else if (m.t === 'ops') onOps(k, m.ops);
  else if (m.t === 'guess') onGuess(k, m.text);
  else if (m.t === 'stamp') onStamp(k, m.id);
  else if (m.t === 'react') onReact(k, m.e);
}
function act(m) {
  if (mode === 'host') hostHandle(myK, m);
  else if (conn && conn.open) conn.send(m);
}

/* ---------- hosting ---------- */
async function createRoom() {
  if (typeof mqtt === 'undefined') return goHome('Could not load the online library. Check your internet 🙏');
  teardown();
  const my = session;
  mode = 'host'; myK = 'a'; hostK = 'a';
  const saved = store.get('doodle-settings', {});
  const settings = { ...DEFAULT_SETTINGS, ...saved, custom: store.get('doodle-custom', []) };
  settings.packs = (settings.packs || DEFAULT_SETTINGS.packs).filter((p) => PACK_LABELS[p]);
  if (!settings.packs.length) settings.packs = DEFAULT_SETTINGS.packs.slice();
  room = { code: genCode('D'), epoch: 0, seats: [{ k: 'a', name: me.name, avatar: myAvatar() }], settings, started: false };
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
      if (room.started && !seat) return reject('This game already started. Catch the next one 🙂');
      if (!seat) {
        if (room.seats.length >= 4) return reject('This room is full 🙅');
        const k = 'abcd'.split('').find((x) => !room.seats.some((s) => s.k === x));
        seat = { k, name };
        room.seats.push(seat);
      }
      const old = seat.link;
      seat.link = c;
      if (old && old !== c) old.drop();
      seat.avatar = AVATARS.includes(d.avatar) ? d.avatar : seat.avatar || '🙂';
      state = 'ok'; clearTimeout(timer); sfx.pop();
      if (room.started && G) {
        c.send({ t: 's', s: viewFor(seat.k), you: seat.k, hostK: myK, epoch: room.epoch });
        c.send({ t: 'opsync', ops: G.ops, twist: G.twist });
        feedAll({ kind: 'sys', text: `${firstName(name)} is back 👋` });
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
    if (!G) return;
    feedAll({ kind: 'sys', text: `${firstName(seat.name)} dropped out 📴` });
    if (G.drawer === seat.k && G.phase === 'pick') nextRound();
    else if (G.drawer === seat.k && G.phase === 'draw') endRound();
    else if (G.phase === 'draw') {
      const guessers = G.players.filter((p) => p.k !== G.drawer && connected(p.k));
      if (!guessers.length || guessers.every((p) => G.guessed.some((g) => g.k === p.k))) endRound(); else push();
    } else push();
  });
}

// The host left mid-game: the first player still here carries on from the next round.
function takeOver(code, epoch, v) {
  const mine = myK;
  teardown();
  const my = session;
  mode = 'host'; myK = mine; hostK = mine; roomCode = code;
  room = { code, epoch, settings: v.settings, started: true, seats: v.players.map((p) => ({ k: p.k, name: p.name, avatar: p.avatar })) };
  G = {
    gid: v.gid, v: v.v, phase: 'reveal', players: v.players, settings: v.settings, words: wordList(v.settings), used: v.usedBefore || [],
    scores: v.scores, round: v.phase === 'reveal' ? v.round : v.round - 1, total: v.total, drawer: null, choices: [], word: null,
    twist: null, lastTwist: v.twist, deadline: 0, hints: [], guessed: [], wrongs: [], ops: [], reveal: null,
    gallery: v.gallery || [], stats: v.stats || freshStats(v.players), awards: null,
  };
  rememberRoom(code);
  toast("The host left, so you're hosting now 👑", 3500);
  hostListen({ code, ns: NS, epoch, alive: alive(my), onLink: handlePlayer }).then(() => {
    if (my !== session) return;
    feedAll({ kind: 'sys', text: 'New host. Starting the next drawing…' });
    later(2500, nextRound); // give the others a moment to reconnect
  });
}

/* ---------- joining ---------- */
function joinRoom(code, { minEpoch = 0, resume = false } = {}) {
  code = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) { $('#home-error').textContent = 'Room codes are 6 letters or numbers 🙂'; return; }
  if (typeof mqtt === 'undefined') { $('#home-error').textContent = 'Could not load the online library. Check your internet 🙏'; return; }
  teardown();
  const my = session;
  mode = 'guest'; roomCode = code;
  if (!resume) {
    $('#room-title').textContent = 'Joining…'; $('#room-code').textContent = code; $('#code-hint').textContent = 'Room code';
    $('#seats').innerHTML = ''; $('#settings').innerHTML = ''; $('#btn-start').hidden = true;
    $('#room-wait').hidden = false; $('#room-wait').innerHTML = 'Knocking on the door<span class="dots"><i>.</i><i>.</i><i>.</i></span>';
    show('room');
  } else addFeed({ kind: 'sys', text: 'The host left. Reconnecting…' });
  const giveUp = setTimeout(() => { if (my === session && !conn) { goHome('No answer from that room 🤔 Is anyone still in it?'); $('#join-code').value = code; } }, resume ? 30000 : 20000);
  knock({
    code, ns: NS, minEpoch, alive: alive(my),
    hello: { user: me.user || me.name, proof: me.proof, avatar: myAvatar() },
    onConnected(link, epoch) { conn = link; epochNow = epoch; wireGuest(link, giveUp, code, epoch); },
  });
}
function wireGuest(link, giveUp, code, epoch) {
  link.on('data', (d) => {
    if (d.t === 'room') {
      clearTimeout(giveUp);
      if (!view && Array.isArray(d.seats)) { renderRoom(d); show('room'); }
    } else if (d.t === 's' && d.s && Array.isArray(d.s.players)) {
      clearTimeout(giveUp);
      myK = d.you; hostK = d.hostK;
      rememberRoom(code);
      applyView(d.s);
    } else if (d.t === 'ops' && Array.isArray(d.ops)) ink.apply(d.ops.map(cleanOp).filter(Boolean));
    else if (d.t === 'opsync' && Array.isArray(d.ops)) { ink.reset(TWISTS[d.twist] ? d.twist : null); ink.apply(d.ops.map(cleanOp).filter(Boolean)); }
    else if (d.t === 'feed' && d.item) addFeed(d.item);
    else if (d.t === 'fx' && d.fx) playFx(d.fx);
    else if (d.t === 'social' && d.m) chat.receive(d.m);
    else if (d.t === 'reject') { clearTimeout(giveUp); goHome(String(d.why || 'Could not join')); }
  });
  link.on('close', () => {
    if (mode !== 'guest' || conn !== link) return;
    if (view && view.phase !== 'over' && hostK) return handOver(code, epoch, view);
    goHome(view && view.phase === 'over' ? '' : 'Connection dropped. Tap Join to hop back in!');
    $('#join-code').value = code;
  });
}
// Everyone runs the same choice, so they all agree on who hosts next.
function handOver(code, epoch, v) {
  const stay = v.players.map((p) => p.k).filter((k) => k !== hostK && !(v.offline || []).includes(k));
  if (stay.length < 2) return goHome('The host left, and there aren\'t enough players to keep going.');
  if (stay[0] === myK) return takeOver(code, epoch + 1, v);
  joinRoom(code, { minEpoch: epoch + 1, resume: true });
}

/* ================= rendering the game ================= */
let lastV = { gid: null, round: 0, phase: null }, tickTimer = 0, lastTick = -1;
const iDraw = () => view && view.phase === 'draw' && view.drawer === myK;
function applyView(v) {
  const fresh = v.gid !== lastV.gid;
  const newPhase = fresh || v.round !== lastV.round || v.phase !== lastV.phase;
  view = v; viewAt = performance.now();
  if (v.phase === 'over') { renderEnd(); show('end'); lastV = { gid: v.gid, round: v.round, phase: v.phase }; return; }
  if (!document.querySelector('#screen-play.active')) { show('play'); if (fresh) { $('#feed').innerHTML = ''; localGallery = {}; } }
  if (newPhase) onPhase(v, fresh);
  renderTop(); renderPlayers(); renderOverlay(); renderTools();
  lastV = { gid: v.gid, round: v.round, phase: v.phase };
}
function onPhase(v, fresh) {
  if (v.phase === 'pick') {
    ink.reset(v.twist);
    sfx.whoosh();
    if (v.twist) setTimeout(() => sfx.twist(), 300);
  } else if (v.phase === 'draw') {
    if (lastV.phase !== 'draw') ink.twist = v.twist;
    ink.loop();
  } else if (v.phase === 'reveal') {
    cancelAnimationFrame(ink.raf);
    localGallery[v.round] = ink.snapshot();
    if (v.reveal && !v.reveal.guessed.length) sfx.trombone(); else sfx.ding();
  }
}
function renderTop() {
  const v = view;
  $('#round').innerHTML = `Round <b>${v.round}</b>/${v.total}`;
  const drawerName = escapeHtml(firstName(nameOfK(v.drawer)));
  let word = '';
  if (v.phase === 'pick') word = v.drawer === myK ? '<span class="lbl">Pick a word</span>' : `<span class="lbl">${drawerName} is choosing…</span>`;
  else if (v.phase === 'draw' && v.word) word = `<span class="lbl">${v.drawer === myK ? 'Draw' : 'You got it'}</span><b class="secret">${escapeHtml(v.word)}</b>`;
  else if (v.phase === 'draw') {
    const parts = v.mask.split(' ');
    word = `<span class="mask">${parts.map((p) => `<span class="w">${[...p].map((ch) => `<i>${ch === '_' ? '' : escapeHtml(ch)}</i>`).join('')}</span>`).join('')}</span><span class="len">${parts.map((p) => p.length).join(' ')}</span>`;
  } else if (v.phase === 'reveal' && v.reveal) word = `<span class="lbl">It was</span><b class="secret">${escapeHtml(v.reveal.word)}</b>`;
  else if (v.phase === 'reveal') word = '<span class="lbl">Next drawing coming up…</span>'; // just after a host handover
  $('#word').innerHTML = word;
}
function timeLeft() { return view ? Math.max(0, view.left - (performance.now() - viewAt)) : 0; }
function tickTimerLoop() {
  if (!view || !document.querySelector('#screen-play.active')) return;
  const ms = timeLeft(), secs = Math.ceil(ms / 1000);
  const total = view.phase === 'draw' ? view.settings.seconds * 1000 : view.phase === 'pick' ? PICK_MS : REVEAL_MS;
  $('#timer-num').textContent = secs;
  $('#timer-arc').style.strokeDashoffset = String(106.8 * (1 - ms / total));
  const panic = view.phase === 'draw' && secs <= 10;
  $('#timer').classList.toggle('panic', panic);
  $('#canvas-wrap').classList.toggle('panic', view.phase === 'draw' && secs <= 5 && secs > 0);
  if (panic && secs !== lastTick && secs > 0) { lastTick = secs; sfx.tick(); }
}
setInterval(tickTimerLoop, 200);

function renderPlayers() {
  const v = view, leader = Math.max(...Object.values(v.scores));
  $('#players').innerHTML = v.players.map((p, i) => {
    const got = v.guessed.some((g) => g.k === p.k), drawing = v.drawer === p.k && v.phase !== 'reveal';
    const off = (v.offline || []).includes(p.k);
    return `<li class="pl ${got ? 'got' : ''} ${drawing ? 'drawing' : ''} ${off ? 'off' : ''}" data-k="${p.k}" style="--c:${SEAT_COLORS[i]}">
      <span class="av">${p.avatar}${v.scores[p.k] === leader && leader > 0 ? `<i class="crown">${ic('crown')}</i>` : ''}</span>
      <span class="nm">${escapeHtml(firstName(p.name))}${p.k === myK ? ' (you)' : ''}</span>
      <span class="tag">${drawing ? `${ic('pencil')}drawing` : got ? `${ic('check')}got it` : off ? 'away' : ''}</span>
      <b class="pts">${v.scores[p.k]}</b></li>`;
  }).join('');
}
function renderOverlay() {
  const v = view, o = $('#overlay'), drawerName = escapeHtml(firstName(nameOfK(v.drawer)));
  const tw = v.twist && TWISTS[v.twist];
  const twistCard = tw ? `<div class="twist"><span>${tw.icon}</span><b>${tw.title}!</b><small>${escapeHtml(tw.line(v.drawer === myK ? 'You' : firstName(nameOfK(v.drawer))))}</small></div>` : '';
  $('#blind').hidden = !(v.phase === 'draw' && v.twist === 'blind' && v.drawer === myK);
  if (v.phase === 'pick') {
    o.hidden = false; o.className = 'dd-overlay pick';
    o.innerHTML = v.drawer === myK
      ? `${twistCard}<h3>Pick something to ruin</h3><div class="choices">${v.choices.map((w, i) => `<button type="button" class="btn choice" data-pick="${i}">${escapeHtml(w)}</button>`).join('')}</div><p class="hint">If you don't pick, one gets picked for you.</p>`
      : `${twistCard}<div class="waiting"><span class="pencil">${ic('pencil')}</span><h3>${escapeHtml(line('pickWait', drawerName))}</h3></div>`;
  } else if (v.phase === 'reveal' && v.reveal) {
    const r = v.reveal, got = r.guessed.map((k) => escapeHtml(firstName(nameOfK(k))));
    o.hidden = false; o.className = 'dd-overlay reveal';
    o.innerHTML = `<div class="reveal-card">
      ${r.line ? `<p class="quip">${escapeHtml(r.line)}</p>` : ''}
      <p class="who">${got.length ? `Guessed by <b>${got.join(', ')}</b> · ${escapeHtml(firstName(nameOfK(r.drawer)))} +${r.dp}` : `${escapeHtml(firstName(nameOfK(r.drawer)))} gets nothing. Ouch.`}</p>
      ${r.best ? `<p class="best">Best wrong guess: <q>${escapeHtml(r.best.text)}</q> — ${escapeHtml(firstName(nameOfK(r.best.k)))}</p>` : ''}
      <div class="stamps">${Object.entries(STAMPS).map(([id, [label, bg]]) => `<button type="button" class="stamp-btn" data-stamp="${id}" style="--sbg:${bg}">${label}${r.stamps[id] ? ` <i>×${r.stamps[id]}</i>` : ''}</button>`).join('')}</div>
    </div>`;
  } else if (v.phase === 'draw' && lastV.phase === 'pick' && tw) {
    // flash the twist as the drawing starts
    o.hidden = false; o.className = 'dd-overlay flash'; o.innerHTML = twistCard;
    setTimeout(() => { if (view && view.phase === 'draw') o.hidden = true; }, 2200);
  } else if (v.phase === 'draw' && !o.classList.contains('flash')) o.hidden = true;
  else if (v.phase !== 'draw') o.hidden = true;
}
$('#overlay').addEventListener('click', (e) => {
  const p = e.target.closest('[data-pick]'), s = e.target.closest('[data-stamp]');
  if (p) { sfx.pop(); act({ t: 'pick', i: +p.dataset.pick }); }
  if (s) act({ t: 'stamp', id: s.dataset.stamp });
});

/* ---------- feed, bubbles, reactions, stamps ---------- */
function addFeed(item) {
  const feed = $('#feed'), who = item.k ? escapeHtml(firstName(nameOfK(item.k))) : '';
  const c = item.k && view ? SEAT_COLORS[view.players.findIndex((p) => p.k === item.k)] : '';
  let html = '';
  if (item.kind === 'guess') { html = `<b style="--c:${c}">${who}</b> ${escapeHtml(item.text)}`; bubble(who, item.text, c); sfx.boop(); }
  else if (item.kind === 'chat') html = `<b style="--c:${c}">${who}</b> ${escapeHtml(item.text)}`;
  else if (item.kind === 'correct') {
    html = `🎉 <b style="--c:${c}">${who}</b> got it! <span class="pts">+${item.pts}</span>${item.text ? ` <em>${escapeHtml(item.text)}</em>` : ''}`;
    sfx.ding();
    const r = $('#canvas-wrap').getBoundingClientRect();
    confetti(r.left + r.width / 2, r.top + r.height / 3, 40, 200);
  } else if (item.kind === 'close') { html = `🔥 <q>${escapeHtml(item.text)}</q> is SO close!`; sfx.pop(); }
  else html = escapeHtml(item.text || '');
  feed.insertAdjacentHTML('beforeend', `<li class="f-${escapeHtml(item.kind)}">${html}</li>`);
  while (feed.children.length > 80) feed.firstElementChild.remove();
  feed.scrollTop = feed.scrollHeight;
}
function bubble(who, text, color) {
  const b = document.createElement('div');
  b.className = 'g-bubble';
  b.innerHTML = `<b style="--c:${color}">${who}</b> ${escapeHtml(text)}`;
  b.style.left = 8 + Math.random() * 62 + '%';
  b.style.top = 12 + Math.random() * 70 + '%';
  b.style.setProperty('--r', (Math.random() * 10 - 5).toFixed(1) + 'deg');
  $('#bubbles').appendChild(b);
  setTimeout(() => b.remove(), 2800);
}
function playFx(fx) {
  const wrap = $('#canvas-wrap'), r = wrap.getBoundingClientRect();
  if (fx.kind === 'react' && REACTS.includes(fx.e)) {
    const el = document.createElement('div');
    el.className = 'float-emoji';
    el.textContent = fx.e;
    el.style.left = r.left + r.width * (0.15 + Math.random() * 0.7) + 'px';
    el.style.top = r.bottom - 40 + 'px';
    el.style.setProperty('--dx', (Math.random() - 0.5) * 80 + 'px');
    $('#fx').appendChild(el);
    setTimeout(() => el.remove(), 1900);
    sfx.pop();
  } else if (fx.kind === 'stamp' && STAMPS[fx.id]) {
    const [label, bg] = STAMPS[fx.id], el = document.createElement('div');
    el.className = 'art-stamp';
    el.textContent = label;
    el.style.setProperty('--sbg', bg);
    el.style.left = 15 + Math.random() * 55 + '%';
    el.style.top = 10 + Math.random() * 45 + '%';
    el.style.setProperty('--r', (Math.random() * 30 - 15).toFixed(0) + 'deg');
    $('#bubbles').appendChild(el);
    setTimeout(() => el.remove(), REVEAL_MS);
    sfx.stamp();
    retrigger(wrap, 'thud');
  }
}
$('#reacts').innerHTML = REACTS.map((e) => `<button type="button" aria-label="React ${e}">${e}</button>`).join('');
let lastReact = 0;
$('#reacts').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b || Date.now() - lastReact < 400) return;
  lastReact = Date.now();
  act({ t: 'react', e: b.textContent });
});
$('#guess-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('#guess'), text = input.value.trim();
  if (!text || !view) return;
  act({ t: 'guess', text });
  input.value = '';
});

/* ---------- drawing tools (only for the drawer) ---------- */
const pen = { ink: 0, size: 1, tool: 'pen' };
$('#colors').innerHTML = INKS.map((c, i) => `<button type="button" class="swatch" data-ink="${i}" style="--sw:${c}" aria-label="Colour ${i + 1}" aria-pressed="${i === 0}"></button>`).join('');
$('#sizes').innerHTML = SIZES.map((s, i) => `<button type="button" class="size" data-size="${i}" aria-label="Brush size ${i + 1}" aria-pressed="${i === 1}"><i style="--d:${Math.min(26, s + 4)}px"></i></button>`).join('');
function renderTools() {
  const mine = iDraw();
  $('#tools').hidden = !mine;
  $('#guess').disabled = !!(view && view.phase === 'draw' && view.drawer === myK);
  $('#guess').placeholder = !view ? '' : view.phase !== 'draw' ? 'Say something…' : view.drawer === myK ? 'You\'re drawing! No hints 😉' : view.word ? 'Chat (no spoilers!)…' : 'Type a guess…';
  $('#canvas-wrap').classList.toggle('drawable', mine);
  $$('#colors .swatch').forEach((b) => b.setAttribute('aria-pressed', +b.dataset.ink === pen.ink && pen.tool !== 'eraser'));
  $$('#sizes .size').forEach((b) => b.setAttribute('aria-pressed', +b.dataset.size === pen.size));
  $('#tool-fill').setAttribute('aria-pressed', pen.tool === 'fill');
  $('#tool-eraser').setAttribute('aria-pressed', pen.tool === 'eraser');
}
function $$(sel) { return [...document.querySelectorAll(sel)]; }
$('#colors').addEventListener('click', (e) => { const b = e.target.closest('[data-ink]'); if (!b) return; pen.ink = +b.dataset.ink; if (pen.tool === 'eraser') pen.tool = 'pen'; renderTools(); });
$('#sizes').addEventListener('click', (e) => { const b = e.target.closest('[data-size]'); if (!b) return; pen.size = +b.dataset.size; renderTools(); });
$('#tool-fill').onclick = () => { pen.tool = pen.tool === 'fill' ? 'pen' : 'fill'; renderTools(); };
$('#tool-eraser').onclick = () => { pen.tool = pen.tool === 'eraser' ? 'pen' : 'eraser'; renderTools(); };
$('#tool-undo').onclick = () => emit(['u']);
$('#tool-clear').onclick = () => emit(['c']);

let outbox = [], flushTimer = 0, stroke = null;
function emit(op) {
  if (!iDraw()) return;
  ink.apply([op]);
  outbox.push(op);
  if (!flushTimer) flushTimer = setTimeout(flush, 40);
}
function flush() {
  flushTimer = 0;
  const ops = outbox; outbox = [];
  if (ops.length) act({ t: 'ops', ops });
}
// Screen → logical canvas coordinates, with this round's twist applied to the drawer's hand.
function toLogical(e) {
  const r = canvas.getBoundingClientRect();
  let x = ((e.clientX - r.left) / r.width) * W, y = ((e.clientY - r.top) / r.height) * H;
  if (view.twist === 'mirror') x = W - x;
  if (view.twist === 'wobble') { const t = performance.now(); x += Math.sin(t / 70) * 9 + (Math.random() - 0.5) * 6; y += Math.cos(t / 55) * 9 + (Math.random() - 0.5) * 6; }
  return [Math.round(Math.max(0, Math.min(W, x))), Math.round(Math.max(0, Math.min(H, y)))];
}
canvas.addEventListener('pointerdown', (e) => {
  if (!iDraw()) return;
  e.preventDefault();
  try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
  const [x, y] = toLogical(e);
  if (pen.tool === 'fill') return emit(['f', Math.min(W - 1, x), Math.min(H - 1, y), pen.ink]);
  stroke = { last: [x, y] };
  emit(['s', pen.tool === 'eraser' ? 1 : pen.ink, pen.tool === 'eraser' ? 2 : pen.size, x, y]);
});
canvas.addEventListener('pointermove', (e) => {
  if (!stroke || !iDraw()) return;
  const [x, y] = toLogical(e);
  if (Math.hypot(x - stroke.last[0], y - stroke.last[1]) < 2) return;
  stroke.last = [x, y];
  emit(['p', x, y]);
});
const endStroke = () => { if (stroke) { stroke = null; emit(['e']); } };
canvas.addEventListener('pointerup', endStroke);
canvas.addEventListener('pointercancel', endStroke);
document.addEventListener('keydown', (e) => {
  if (!iDraw() || (e.target instanceof Element && e.target.closest('input, textarea'))) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); emit(['u']); }
  else if (e.key === 'e') $('#tool-eraser').click();
  else if (e.key === 'f') $('#tool-fill').click();
  else if (/^[1-3]$/.test(e.key)) { pen.size = +e.key - 1; renderTools(); }
});

/* ================= the end: podium, awards, gallery ================= */
function renderEnd() {
  const v = view, ranked = v.players.slice().sort((a, b) => v.scores[b.k] - v.scores[a.k]);
  const medal = ['🥇', '🥈', '🥉', '🎗️'];
  $('#podium').innerHTML = ranked.map((p, i) => `<div class="pod p${i + 1}" style="--c:${SEAT_COLORS[v.players.indexOf(p)]}">
    <span class="medal">${medal[i]}</span><span class="av">${p.avatar}</span><b>${escapeHtml(firstName(p.name))}</b><span class="pts">${v.scores[p.k]}</span></div>`).join('');
  $('#awards').innerHTML = (v.awards || []).map((a) => `<div class="award"><span class="icon">${a.icon}</span><div><b>${escapeHtml(a.title)}</b><span>${escapeHtml(a.who)}</span><small>${escapeHtml(a.why)}</small></div></div>`).join('');
  $('#gallery').innerHTML = (v.gallery || []).map((g) => {
    const img = localGallery[g.round];
    const stamps = Object.entries(g.stamps || {}).map(([id, n]) => `<span class="mini-stamp" style="--sbg:${STAMPS[id][1]}">${STAMPS[id][0]} ×${n}</span>`).join('');
    return `<figure class="art">
      ${img ? `<img src="${img}" alt="Drawing of ${escapeHtml(g.word)}">` : '<div class="missing">You missed this one 🙈</div>'}
      <figcaption><b>${escapeHtml(g.word)}</b> <span>by ${escapeHtml(firstName(nameOfK(g.drawer)))}${g.twist ? ` · ${TWISTS[g.twist].icon}` : ''}</span>
      ${g.best ? `<q>${escapeHtml(g.best.text)}</q><small>— ${escapeHtml(firstName(nameOfK(g.best.k)))}'s best guess</small>` : ''}
      ${stamps ? `<div class="stamp-row">${stamps}</div>` : ''}
      ${img ? `<a class="save" href="${img}" download="doodle-${escapeHtml(g.word.replace(/\W+/g, '-'))}.png">${ic('download')}Save</a>` : ''}</figcaption></figure>`;
  }).join('');
  const isHost = mode === 'host';
  $('#btn-again').hidden = !isHost;
  $('#end-wait').hidden = isHost;
  $('#end-wait').textContent = `Waiting for ${firstName(nameOfK(hostK))} to start a rematch…`;
  if (lastV.phase !== 'over') { sfx.fanfare(); bigConfetti(); }
}

/* ================= chat (shared/chat.js) ================= */
// While someone is drawing, anything typed in the chat counts as a guess, so nobody can spoil the word.
const chat = createChat({
  send: (m) => sendSocial(m),
  players: () => (view ? view.players.map((p, i) => ({ k: p.k, name: p.name, color: SEAT_COLORS[i] })) : []),
  me: () => myK,
  anchor: (k) => document.querySelector(`#players li[data-k="${k}"]`),
  stage: () => $('#canvas-wrap'),
  stickers: {
    picasso: ['Picasso who? 🎨', '#ffc233'], what: ['What even is that 🤨', '#ff8fc8'], close: ['SO close!', '#2bc48a'],
    better: ['Draw better 😤', '#4d9de0'], gg: ['GG 🤝', '#ffffff'], revenge: ['Revenge is coming', '#c9a7ff'],
  },
  routeText(text) {
    if (!view || view.phase !== 'draw') return false;
    act({ t: 'guess', text });
    return true;
  },
  sound: () => sfx.pop(),
});
chat.mountTools($('#chat-tools'));
function relaySocial(m, except) {
  if (room) room.seats.forEach((s) => s.link && s.link.open && s.link !== except && s.link.send({ t: 'social', m }));
}
function sendSocial(m) {
  if (mode === 'host') relaySocial(m, null);
  else if (conn && conn.open) conn.send({ t: 'social', m });
}

/* ================= wiring ================= */
$('#btn-create').onclick = () => { sfx.pop(); createRoom(); };
$('#btn-join').onclick = () => { sfx.pop(); joinRoom($('#join-code').value); };
$('#join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(e.target.value); });
$('#btn-resume').onclick = () => { const last = store.get('doodle-lastroom', null); if (last) joinRoom(last.code); };
$('#btn-room-back').onclick = leaveToHome;
$('#btn-start').onclick = () => { sfx.pop(); startGame(); };
$('#btn-leave').onclick = () => { if (confirm('Leave the game?')) leaveToHome(); };
$('#btn-end-home').onclick = leaveToHome;
$('#btn-again').onclick = () => { if (mode === 'host' && room) { room.seats = room.seats.filter((s) => connected(s.k)); startGame(); } };
$('#btn-mute').onclick = (e) => setIcon(e.currentTarget, sfx.toggle() ? 'mute' : 'volume');
$('#btn-share').onclick = async () => {
  const code = $('#room-code').textContent, link = `${location.origin}${location.pathname}?room=${code}`;
  if (navigator.share) { try { await navigator.share({ title: 'Doodle Duel', text: `Come draw badly with me: ${code}`, url: link }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(link); toast('Invite link copied 💌'); } catch (e) { prompt('Copy this link:', link); }
};
addEventListener('pagehide', () => { if (mode) teardown(); });
document.addEventListener('profilechange', renderHomeBits);

document.addEventListener('DOMContentLoaded', () => {
  hydrateIcons();
  applyPalette();
  wireProfileSheet();
  ink.reset();
  requireLogin().then(() => {
    goHome();
    const code = new URLSearchParams(location.search).get('room');
    if (code) { history.replaceState(null, '', location.pathname); $('#join-code').value = code.toUpperCase(); joinRoom(code); }
  });
});
