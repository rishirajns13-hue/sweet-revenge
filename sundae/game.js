'use strict';
/* Sundae Bomb: two-player co-op. The Operator sees the machine, the Reader has the rulebook.
   The host's browser judges every action (sundae/rules.js); both screens build the same bomb from its
   seed, so only small updates travel: which modules are done, strikes, and the time left.
   Talking happens in the chat: 📣 on a part of the machine sends it as a message, tapping a rule pings it. */
const R = window.SundaeRules;
const NS = 'sundae-rr1';
const SEAT_COLORS = ['#ff5a5f', '#4d9de0'];
const FL = { pink: ['🍓', 'strawberry', '#ff7aa8'], mint: ['🌿', 'mint', '#7ee8c0'], vanilla: ['🍦', 'vanilla', '#fff3d6'], choc: ['🍫', 'chocolate', '#8a5a3b'], blue: ['🫐', 'blueberry', '#6f8fe8'] };
const firstName = (name) => String(name).split(' ').pop();
const avHTML = (a) => (typeof avatarHTML === 'function' ? avatarHTML(a) : escapeHtml(a));

/* ================= sounds ================= */
const sfx = (() => {
  const p = createSamplePlayer({ takes: { pop: ['ui-pop-1.ogg', 'ui-pop-2.ogg'], drop: ['ui-drop-1.ogg', 'ui-drop-2.ogg'], pick: ['ui-pick.ogg'], shine: ['ui-shine.ogg'], win: ['ui-levelup.ogg'], slide: ['card-slide-1.ogg', 'card-slide-2.ogg'] } });
  const { sample } = p;
  return {
    load: p.load,
    tick(fast) { sample('pop', { vol: fast ? 0.16 : 0.08, rate: fast ? 1.6 : 1.3 }); },
    right() { sample('shine', { vol: 0.5 }); },
    wrong() { sample('drop', { vol: 0.9, rate: 0.7 }); },
    boom() { sample('drop', { vol: 1, rate: 0.5 }); sample('slide', { vol: 0.8, rate: 0.6, when: 0.1 }); },
    win() { sample('win', { vol: 0.6 }); },
    pop() { sample('pick', { vol: 0.35 }); },
    chat() { sample('pop', { vol: 0.25 }); },
    get muted() { return p.muted; },
    toggle: p.toggle,
  };
})();

/* ================= app state ================= */
let mode = null;            // 'host' | 'guest' | 'solo'
let session = 0, timers = [];
let room = null, conn = null, myK = null, hostK = null, roomCode = '';
let G = null;               // host: the match
let view = null;            // the last state this screen has
let deadline = 0;           // local performance.now() when the bomb blows
let bombCache = { seed: null, B: null };
let ui = { tube: null, dial: 0, page: 'tubes' };
const alive = (my) => () => my === session;
const later = (ms, fn) => timers.push(setTimeout(fn, ms));
const isHost = () => mode === 'host' || mode === 'solo';
const bombOf = (seed) => (bombCache.seed === seed ? bombCache.B : ((bombCache = { seed, B: R.makeBomb(seed) }), bombCache.B));

function show(screen) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === 'screen-' + screen));
  document.body.classList.toggle('in-game', screen === 'play');
  chat.setInGame(mode !== 'solo' && (screen === 'play' || screen === 'end'));
}
function teardown() {
  session++;
  timers.forEach(clearTimeout); timers = [];
  const oldRoom = room, oldConn = conn;
  room = null; conn = null;
  if (oldConn) { try { oldConn.close(); } catch (e) {} }
  if (oldRoom) oldRoom.seats.forEach((s) => { try { s.link && s.link.close(); } catch (e) {} });
  closeAllClients();
  mode = null; G = null; view = null; myK = null; hostK = null; deadline = 0;
  chat.reset();
}
function goHome(error = '') {
  teardown();
  show('home');
  renderHomeBits();
  $('#home-error').textContent = error;
}
function leaveToHome() { store.del('sundae-lastroom'); goHome(); }
function renderHomeBits() {
  if (me) $('#me-avatar').innerHTML = avHTML(myAvatar());
  const last = store.get('sundae-lastroom', null), fresh = last && Date.now() - last.at < 3 * 3600e3;
  $('#btn-resume').hidden = !fresh;
  if (fresh) $('#resume-code').textContent = last.code;
}
const rememberRoom = (code) => code && store.set('sundae-lastroom', { code, at: Date.now() });

/* ================= room ================= */
function roomPayload() { return { t: 'room', code: room.code, host: me.name, seats: room.seats.map((s) => ({ name: s.name, avatar: s.avatar })) }; }
function sendRoom() {
  const p = roomPayload();
  room.seats.forEach((s) => s.link && s.link.open && s.link.send(p));
  renderRoom(p);
}
function renderRoom(p) {
  const amHost = isHost(), n = p.seats.length;
  $('#room-title').textContent = amHost ? 'Your room' : `${firstName(p.host)}'s room`;
  $('#code-hint').textContent = amHost ? 'Send this code to your friend' : 'Room code';
  $('#room-code').textContent = p.code;
  $('#seats').innerHTML = [0, 1].map((i) => {
    const s = p.seats[i];
    return s ? `<div class="seat" style="--c:${SEAT_COLORS[i]}"><span class="av">${avHTML(s.avatar)}</span><span class="nm">${escapeHtml(s.name)}${s.name === me.name ? ' (you)' : ''}</span><span class="st">${i === 0 ? 'Host' : `${ic('check')}Joined`}</span></div>`
      : '<div class="seat empty"><span class="av"></span><span class="nm">Waiting for your partner</span></div>';
  }).join('');
  $('#btn-start').hidden = !amHost;
  $('#btn-start').disabled = n < 2;
  const wait = $('#room-wait');
  wait.hidden = amHost && n >= 2;
  wait.innerHTML = amHost ? 'Sundae Bomb needs two. Waiting for your partner<span class="dots"><i>.</i><i>.</i><i>.</i></span>'
    : `Waiting for ${escapeHtml(firstName(p.host))} to light the fuse<span class="dots"><i>.</i><i>.</i><i>.</i></span>`;
}

/* ================= host: running the match ================= */
const seatOf = (k) => room && room.seats.find((s) => s.k === k);
const playerOf = (k) => ((view || G || { players: [] }).players || []).find((p) => p.k === k);
const nameOf = (k) => (k === myK ? 'You' : playerOf(k) ? firstName(playerOf(k).name) : '?');

function startMatch() {
  if (!room) return;
  const seats = mode === 'solo' ? room.seats : room.seats.filter((s) => s.k === myK || (s.link && s.link.open));
  if (mode !== 'solo' && seats.length < 2) return toast('Sundae Bomb needs two players 🙂');
  G = R.newMatch(seats.map((s) => ({ k: s.k, name: s.name, avatar: s.avatar })), (Math.random() * 2 ** 31) | 0);
  G.gid = Math.random().toString(36).slice(2, 10);
  G.at = Date.now();
  room.started = true;
  rememberRoom(room.code);
  R.nextBomb(G, Date.now());
  push();
  hostTicker();
}
// The host checks the clock twice a second, so a bomb blows on time even if nobody touches it.
function hostTicker() {
  const my = session;
  const loop = () => {
    if (my !== session || !G) return;
    const was = G.bomb && G.bomb.over;
    R.tick(G, Date.now());
    if (G.bomb && G.bomb.over && !was) { push(); afterBomb(); }
    later(500, loop);
  };
  loop();
}
function afterBomb() {
  if (R.matchOver(G)) { later(4200, () => { G.over = true; push(); }); return; }
  later(4500, () => { if (!G) return; R.nextBomb(G, Date.now()); push(); });
}
function viewOf() {
  const b = G.bomb;
  return { players: G.players, gid: G.gid, at: G.at, results: G.results, over: !!G.over,
    bomb: b && { no: b.no, seed: b.seed, operator: b.operator, reader: b.reader, solved: b.solved, strikes: b.strikes, over: b.over, why: b.why, left: b.endsAt - Date.now() } };
}
function push() {
  if (!G) return;
  const evs = G.events; G.events = [];
  const s = viewOf();
  if (room) room.seats.forEach((seat) => { if (seat.link && seat.link.open) seat.link.send({ t: 's', s, ev: evs, you: seat.k, hostK: myK }); });
  receive(s, evs);
}
function hostHandle(k, m) {
  if (!G || !m || m.t !== 'act') return;
  // In solo training you play both roles, so act as whoever the operator is.
  const who = mode === 'solo' ? G.bomb.operator : k;
  const was = G.bomb && G.bomb.over;
  const r = R.act(G, who, String(m.m), Number(m.v), Date.now());
  if (!r.ok) return;
  push();
  if (G.bomb.over && !was) afterBomb();
}
function act(m) {
  if (isHost()) hostHandle(myK, m);
  else if (conn && conn.open) conn.send(m);
}

/* ---------- chat ---------- */
const chat = createChat({
  send: (m) => sendSocial(m),
  game: 'sundae', room: () => roomCode || null,
  players: () => ((view && view.players) || []).map((p, i) => ({ k: p.k, name: p.name, color: SEAT_COLORS[i], avatar: p.avatar })),
  me: () => myK,
  stage: () => $('#stage'),
  stickers: {
    pull: ['PULL IT! 👉', '#ff5a5f'], wait: ['WAIT ✋', '#ffc233'], again: ['Say again? 🤔', '#4d9de0'],
    done: ['Done ✅', '#2bc48a'], batch: ['Batch code? 🏷️', '#c9a7ff'], panic: ['AAAAAA 😱', '#ffffff'],
  },
  dockAt: 980,
  sound: (kind) => (kind === 'in' ? sfx.chat() : sfx.pop()),
});
function sendSocial(m) {
  if (isHost()) { if (room) room.seats.forEach((s) => s.link && s.link.open && s.link.send({ t: 'social', m })); }
  else if (conn && conn.open) conn.send({ t: 'social', m });
}
// One tap sends what you see (or a rule) as a chat message.
function callout(text) { if (mode === 'solo') { toast(text, 2200); return; } chat.say(text); sfx.pop(); }

/* ---------- hosting and joining ---------- */
async function createRoom() {
  if (typeof mqtt === 'undefined') return goHome('Could not load the online library. Check your internet 🙏');
  teardown();
  const my = session;
  mode = 'host'; myK = 'a'; hostK = 'a';
  room = { code: genCode('B'), seats: [{ k: 'a', name: me.name, avatar: myAvatar() }], started: false };
  roomCode = room.code;
  renderRoom(roomPayload());
  show('room');
  if (!(await hostListen({ code: room.code, ns: NS, epoch: 0, alive: alive(my), onLink: handlePlayer })) && my === session) {
    goHome('Could not reach the game server. Check your internet and try again!');
  }
}
function solo() {
  teardown();
  mode = 'solo'; myK = 'a'; hostK = 'a'; roomCode = '';
  room = { code: '', started: false, seats: [{ k: 'a', name: me.name, avatar: myAvatar() }, { k: 'b', name: 'Also you', avatar: myAvatar() }] };
  startMatch();
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
        if (room.started) return reject('This match already started 🙂');
        if (room.seats.length >= 2) return reject('Sundae Bomb is for two. This room is full 🙅');
        seat = { k: 'b', name };
        room.seats.push(seat);
      }
      const old = seat.link; seat.link = c; if (old && old !== c) old.drop();
      seat.avatar = AVATARS.includes(d.avatar) ? d.avatar : seat.avatar || '🙂';
      state = 'ok'; clearTimeout(timer); sfx.pop();
      if (room.started && G) { c.send({ t: 's', s: viewOf(), ev: [], you: seat.k, hostK: myK }); toast(`${firstName(name)} is back 👋`); }
      else { sendRoom(); toast(`${firstName(name)} joined 🎉`); }
      return;
    }
    if (state !== 'ok' || seat.link !== c || !d) return;
    if (d.t === 'social') { if (d.m && typeof d.m === 'object') { const m = { ...d.m, from: seat.k }; if (chat.receive(m)) sendSocialExcept(m, c); } return; }
    hostHandle(seat.k, d);
  });
  c.on('close', () => {
    if (!room || !seat || seat.link !== c) return;
    seat.link = null;
    if (!room.started) { room.seats.splice(room.seats.indexOf(seat), 1); sendRoom(); return; }
    toast(`${firstName(seat.name)} dropped out. Waiting for them to come back…`, 3500);
  });
}
function sendSocialExcept(m, except) { if (room) room.seats.forEach((s) => s.link && s.link.open && s.link !== except && s.link.send({ t: 'social', m })); }

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
    onConnected(link) {
      conn = link;
      link.on('data', (d) => {
        if (d.t === 'room') { clearTimeout(giveUp); if (Array.isArray(d.seats) && !document.querySelector('#screen-play.active')) { renderRoom(d); show('room'); } }
        else if (d.t === 's' && d.s) { clearTimeout(giveUp); myK = d.you; hostK = d.hostK; rememberRoom(code); receive(d.s, Array.isArray(d.ev) ? d.ev : []); }
        else if (d.t === 'social' && d.m) chat.receive(d.m);
        else if (d.t === 'reject') { clearTimeout(giveUp); goHome(String(d.why || 'Could not join')); }
      });
      link.on('close', () => { if (mode === 'guest' && conn === link) { goHome(view && view.over ? '' : 'The host left. Tap Join to hop back in if they come back!'); $('#join-code').value = code; } });
    },
  });
}

/* ================= showing the state ================= */
function receive(s, evs) {
  const fresh = !view || !view.bomb || !s.bomb || view.bomb.no !== (s.bomb && s.bomb.no);
  view = s;
  if (s.over) return showEnd();
  if (!s.bomb) return;
  deadline = performance.now() + Math.max(0, s.bomb.left);
  if (fresh) { ui = { tube: null, dial: 0, page: 'tubes' }; buildPlay(); }
  else update();
  evs.forEach(play);
}
function myRole() { if (mode === 'solo') return 'both'; return view.bomb.operator === myK ? 'operator' : 'reader'; }

function buildPlay() {
  show('play');
  const role = myRole(), b = view.bomb, partner = view.players.find((p) => p.k !== myK);
  $('#role-chip').innerHTML = role === 'both' ? `💣 Bomb ${b.no} · Solo training`
    : role === 'operator' ? `💣 Bomb ${b.no} · You're the <b>Operator</b>: you see the machine` : `💣 Bomb ${b.no} · You're the <b>Reader</b>: you have the rulebook`;
  $('#stage').className = 'sb-stage role-' + role;
  $('#machine').hidden = role === 'reader';
  $('#book').hidden = role === 'operator';
  $('#banner').hidden = true;
  if (role !== 'reader') renderMachine();
  if (role !== 'operator') renderBook();
  update();
  const intro = role === 'operator' ? `Tap 📣 to tell ${partner ? firstName(partner.name) : 'your partner'} what you see. They'll tell you what to pull.`
    : role === 'reader' ? `Ask ${partner ? firstName(partner.name) : 'your partner'} what they see, then find the rule. Tap a rule to ping it.` : 'Read the rule, then do it. No pressure. (There is pressure.)';
  banner(`Bomb ${b.no} of ${R.BOMBS_PER_MATCH}`, intro, 'start', 2600);
  scheduleFreeze();
}
function update() {
  const b = view.bomb;
  $('#strikes').innerHTML = Array.from({ length: R.STRIKES }, (_, i) => `<i class="${i < b.strikes ? 'hit' : ''}">${i < b.strikes ? '💥' : '🍦'}</i>`).join('');
  document.querySelectorAll('.sb-mod').forEach((el) => el.classList.toggle('done', b.solved.includes(el.dataset.m)));
  document.querySelectorAll('.sb-page-tab').forEach((el) => el.classList.toggle('done', b.solved.includes(el.dataset.page)));
}
// The clock: drawn every frame from the deadline; it drips faster near the end.
let lastSec = -1;
function clockLoop() {
  requestAnimationFrame(clockLoop);
  if (!view || !view.bomb || view.over) return;
  const b = view.bomb;
  if (b.over) { document.body.classList.remove('sb-hurry'); return; } // the clock stops where the bomb was defused or blew
  const left = Math.max(0, deadline - performance.now()), sec = Math.ceil(left / 1000);
  $('#clock').textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  $('#clock-bar').style.transform = `scaleX(${Math.min(1, left / (R.BOMB_SECONDS * 1000))})`;
  document.body.classList.toggle('sb-hurry', sec <= 30);
  if (sec !== lastSec && document.querySelector('#screen-play.active')) { lastSec = sec; if (sec <= 30 || sec % 5 === 0) sfx.tick(sec <= 30); }
}
requestAnimationFrame(clockLoop);

/* ---------- the machine (Operator) ---------- */
function renderMachine() {
  const B = bombOf(view.bomb.seed), c = B.case, m = B.machine;
  const tube = (f, i) => `<button type="button" class="sb-tube${ui.tube === i ? ' sel' : ''}" data-tube="${i}" style="--f:${FL[f][2]}" aria-label="Tube ${i + 1}: ${FL[f][1]}"><span class="cap"></span><span class="syrup"></span><b>${i + 1}</b></button>`;
  $('#machine').innerHTML = `
    <div class="sb-case">
      <span class="tag">🏷️ Batch <b>${c.batch}</b></span><span class="tag">${c.cone === 'waffle' ? '🧇' : '🍦'} ${c.cone} cone</span><span class="tag">🍒 × ${c.cherries}</span>
      <button type="button" class="sb-call" data-call="case" aria-label="Call out the case labels">📣</button>
    </div>
    <div class="sb-mod" data-m="tubes"><h3>Syrup Tubes <small>pull exactly one</small></h3>
      <div class="sb-tubes">${m.tubes.map(tube).join('')}</div>
      <div class="sb-row"><button type="button" class="btn cta" data-pull ${ui.tube === null ? 'disabled' : ''}>Pull tube ${ui.tube === null ? '…' : ui.tube + 1}</button><button type="button" class="sb-call" data-call="tubes" aria-label="Call out the tubes">📣</button></div>
      <span class="sb-done">✔ Done!</span></div>
    <div class="sb-mod" data-m="stack"><h3>Scoop Stack <small>pull the right lever</small></h3>
      <div class="sb-stack">${m.stack.slice().reverse().map((f) => `<i style="--f:${FL[f][2]}" title="${FL[f][1]}">${FL[f][0]}</i>`).join('')}<span class="cone"></span></div>
      <div class="sb-row sb-levers">${[1, 2, 3, 4].map((n) => `<button type="button" class="btn" data-lever="${n}">Lever ${n}</button>`).join('')}<button type="button" class="sb-call" data-call="stack" aria-label="Call out the stack">📣</button></div>
      <span class="sb-done">✔ Done!</span></div>
    <div class="sb-mod" data-m="thermo"><h3>Thermostat <small>set the right temperature</small></h3>
      <div class="sb-thermo"><span class="label" style="--f:${FL[m.thermo.label][2]}">${FL[m.thermo.label][0]} ${FL[m.thermo.label][1]}</span><span class="now">Now: <b>${m.thermo.temp}°</b></span></div>
      <div class="sb-row"><button type="button" class="btn" data-dial="-1" aria-label="Colder">−</button><b class="sb-dial" id="dial">${ui.dial}°</b><button type="button" class="btn" data-dial="1" aria-label="Warmer">+</button>
        <button type="button" class="btn cta" data-set>SET</button><button type="button" class="sb-call" data-call="thermo" aria-label="Call out the thermostat">📣</button></div>
      <span class="sb-done">✔ Done!</span></div>`;
  update();
}
function describe(what) {
  const B = bombOf(view.bomb.seed), c = B.case, m = B.machine;
  if (what === 'case') return `🏷️ Batch ${c.batch} (last digit ${Number(c.batch.slice(-1)) % 2 ? 'odd' : 'even'}) · ${c.cone} cone · ${c.cherries} cherr${c.cherries === 1 ? 'y' : 'ies'}`;
  if (what === 'tubes') return `🧪 ${m.tubes.length} tubes: ${m.tubes.map((f, i) => `${i + 1} ${FL[f][0]} ${FL[f][1]}`).join(', ')}`;
  if (what === 'stack') return `🍨 Stack bottom→top: ${m.stack.map((f) => `${FL[f][0]} ${FL[f][1]}`).join(', ')}`;
  return `🌡️ Thermostat label ${FL[m.thermo.label][0]} ${FL[m.thermo.label][1]}, showing ${m.thermo.temp}°`;
}
$('#machine').addEventListener('click', (e) => {
  if (!view || !view.bomb || view.bomb.over) return;
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.call) return callout(describe(t.dataset.call));
  if (t.dataset.tube !== undefined) { ui.tube = +t.dataset.tube; sfx.pop(); return renderMachine(); }
  if (t.dataset.pull !== undefined && ui.tube !== null) return act({ t: 'act', m: 'tubes', v: ui.tube });
  if (t.dataset.lever) return act({ t: 'act', m: 'stack', v: +t.dataset.lever });
  if (t.dataset.dial) { ui.dial = Math.max(-40, Math.min(20, ui.dial + Number(t.dataset.dial))); $('#dial').textContent = ui.dial + '°'; sfx.pop(); return; }
  if (t.dataset.set !== undefined) return act({ t: 'act', m: 'thermo', v: ui.dial });
});

/* ---------- the rulebook (Reader) ---------- */
function renderBook() {
  const B = bombOf(view.bomb.seed), dot = (f) => `<i class="dot" style="--f:${FL[f][2]}" title="${FL[f][1]}">${FL[f][0]}</i>`;
  const pages = {
    tubes: `<h3>🧪 Syrup Tubes</h3><p class="sb-note">Count the tubes first, then read only that section, top to bottom. Tubes are numbered left to right.</p>
      ${[3, 4, 5, 6].map((n) => `<section class="sb-sec"><h4>${n} tubes</h4>${R.TUBE_RULES[n].map(([text]) => `<button type="button" class="sb-rule">${escapeHtml(text)}</button>`).join('')}</section>`).join('')}`,
    stack: `<h3>🍨 Scoop Stack: recipe card</h3><p class="sb-note">Find the stack (bottom → top) on the card and pull that lever.</p>
      <div class="sb-recipes">${B.book.recipes.map((r) => `<button type="button" class="sb-rule sb-recipe">${r.stack.map(dot).join('<b>›</b>')}<span>Lever <b>${r.lever}</b></span></button>`).join('')}</div>
      <button type="button" class="sb-rule">${escapeHtml(B.book.stackFallback)}</button>`,
    thermo: `<h3>🌡️ Thermostat</h3>
      <div class="sb-temps">${Object.entries(B.book.thermoBase).map(([f, t]) => `<button type="button" class="sb-rule sb-temp">${dot(f)} ${FL[f][1]} <b>${t}°</b></button>`).join('')}</div>
      ${B.book.thermoRules.map((text) => `<button type="button" class="sb-rule">${escapeHtml(text)}</button>`).join('')}`,
  };
  $('#book').innerHTML = `<nav class="sb-pages">${Object.keys(pages).map((k) => `<button type="button" class="sb-page-tab${ui.page === k ? ' on' : ''}" data-page="${k}">${{ tubes: '🧪 Tubes', stack: '🍨 Scoops', thermo: '🌡️ Thermo' }[k]}</button>`).join('')}</nav>
    <div class="sb-page">${pages[ui.page]}</div>`;
  update();
}
$('#book').addEventListener('click', (e) => {
  const tab = e.target.closest('[data-page]');
  if (tab) { ui.page = tab.dataset.page; sfx.pop(); return renderBook(); }
  const rule = e.target.closest('.sb-rule');
  if (rule) { retrigger(rule, 'pinged'); callout('📌 ' + rule.textContent.replace(/\s+/g, ' ').trim()); }
});

/* ---------- moments ---------- */
function banner(title, sub, kind, ms) {
  const el = $('#banner');
  el.className = 'sb-banner ' + kind;
  el.innerHTML = `<b>${escapeHtml(title)}</b>${sub ? `<small>${escapeHtml(sub)}</small>` : ''}`;
  el.hidden = false;
  retrigger(el, 'pop');
  if (ms) later(ms, () => { if (el.classList.contains(kind)) el.hidden = true; });
}
function play(e) {
  if (e.t === 'solved') { sfx.right(); const el = $(`.sb-mod[data-m="${e.m}"]`); if (el) { const [x, y] = centerOf(el); confetti(x, y, 24, 120); } }
  else if (e.t === 'strike') { sfx.wrong(); retrigger($('#stage'), 'shake'); toast(`💥 Wrong! ${R.STRIKES - e.n} mistake${R.STRIKES - e.n === 1 ? '' : 's'} left, and 15 s melted off`, 2600); }
  else if (e.t === 'defused') { sfx.win(); bigConfetti(); banner('DEFUSED! 🎉', 'Sweet teamwork. Swapping roles…', 'win', 0); }
  else if (e.t === 'splat') { sfx.boom(); retrigger($('#stage'), 'shake'); $('#stage').classList.add('splatted'); later(4000, () => $('#stage').classList.remove('splatted')); banner('SPLAT! 🍨💥', e.why === 'time' ? 'Out of time. You\'re both wearing it now.' : 'Three strikes. The machine wins this one.', 'boom', 0); }
}
// From bomb 2, the Operator's screen fogs over for 3 seconds every so often.
function scheduleFreeze() {
  if (!view || !view.bomb || view.bomb.no < 2 || myRole() !== 'operator') return;
  const no = view.bomb.no;
  later(30000 + Math.random() * 20000, () => {
    if (!view || !view.bomb || view.bomb.no !== no || view.bomb.over) return;
    const fog = $('#fog'); fog.hidden = false; retrigger(fog, 'pop');
    later(3000, () => { fog.hidden = true; scheduleFreeze(); });
  });
}

/* ================= the end ================= */
let savedGid = null;
function showEnd() {
  show('end');
  const v = view, n = v.results.filter((r) => r.how === 'defused').length;
  $('#end-title').textContent = n >= 2 ? `Defused ${n} of ${v.results.length}! 🎉` : n === 1 ? 'One out of three…' : 'The machine wins 💥';
  $('#results').innerHTML = v.results.map((r) => `<div class="sb-res ${r.how}"><b>Bomb ${r.no}</b><span>${r.how === 'defused' ? '✔ Defused' : '💥 Splat'}</span>
    <small>${escapeHtml(nameOf(r.operator))} operated · ${escapeHtml(nameOf(r.reader))} read</small></div>`).join('');
  if (mode !== 'solo' && savedGid !== v.gid && me) {
    savedGid = v.gid;
    const team = v.players.map((p) => p.name);
    records.game({ kind: 'sundae', gid: v.gid, room: roomCode || null, practice: false, startedAt: v.at,
      players: v.players.map((p) => ({ name: p.name, bot: false, place: 1, score: n })), winners: n >= 2 ? team : [],
      stats: Object.fromEntries(v.players.map((p) => [p.name, { defused: n, bombs: v.results.length }])), hits: [] });
    if (typeof showRewards === 'function') showRewards($('#awards'), v.gid);
  }
  $('#btn-again').hidden = !isHost();
  $('#end-wait').hidden = isHost();
  $('#end-wait').textContent = 'Waiting for the host to start another match…';
}

/* ================= wiring ================= */
$('#btn-create').onclick = () => { sfx.pop(); createRoom(); };
$('#btn-cpu').onclick = () => { sfx.pop(); solo(); };
$('#btn-join').onclick = () => { sfx.pop(); joinRoom($('#join-code').value); };
$('#join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(e.target.value); });
$('#btn-resume').onclick = () => { const last = store.get('sundae-lastroom', null); if (last) joinRoom(last.code); };
$('#btn-room-back').onclick = leaveToHome;
$('#btn-start').onclick = () => { sfx.pop(); startMatch(); };
$('#btn-leave').onclick = () => { if (confirm('Leave the game?')) leaveToHome(); };
$('#btn-end-home').onclick = leaveToHome;
$('#btn-again').onclick = () => { if (isHost() && room) { savedGid = null; startMatch(); } };
$('#btn-mute').onclick = (e) => setIcon(e.currentTarget, sfx.toggle() ? 'mute' : 'volume');
$('#btn-share').onclick = async () => {
  const code = $('#room-code').textContent, link = `${location.origin}${location.pathname}?room=${code}`;
  if (navigator.share) { try { await navigator.share({ title: 'Sundae Bomb', text: `The machine is ticking. Get in here: ${code}`, url: link }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(link); toast('Invite link copied 💌'); } catch (e) { prompt('Copy this link:', link); }
};
addEventListener('pagehide', () => { if (mode) teardown(); });
document.addEventListener('profilechange', renderHomeBits);

document.addEventListener('DOMContentLoaded', () => {
  hydrateIcons();
  if (sfx.muted) setIcon($('#btn-mute'), 'mute');
  applyPalette();
  wireProfileSheet();
  chat.mountTools($('#chat-tools'), { compact: true });
  sfx.load();
  requireLogin().then(() => {
    goHome();
    const code = new URLSearchParams(location.search).get('room');
    if (code) { history.replaceState(null, '', location.pathname); $('#join-code').value = code.toUpperCase(); joinRoom(code); }
    else if (typeof showHowTo === 'function') showHowTo('sundae', [
      { icon: '👀', title: 'One sees, one reads', text: 'The Operator sees the machine. The Reader has the rulebook. Swap every bomb.' },
      { icon: '📣', title: 'Talk without a call', text: 'Tap 📣 to send what you see. Tap a rule to ping it. Stickers for PULL IT! and WAIT.' },
      { icon: '💥', title: 'Three strikes', text: 'Three mistakes or the timer hits zero: SPLAT. Each mistake melts 15 seconds.' },
    ], { title: 'How to play Sundae Bomb' });
  });
});
