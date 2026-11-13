'use strict';
/* Sticky Situation: the game loop, couch mode and online rooms.
   Physics runs at a fixed 60 steps a second; the view draws every frame.
   Online, each browser simulates only its own critter. The partner's position streams in about 20 times
   a second (sticky/physics.js steerRemote eases toward it), and each side applies its own share of the
   rope pull. The host's browser is the referee: it alone decides checkpoints, falls and the win, and
   tells the guest. `life` counts respawns, so positions from before a respawn are thrown away. */
const SP = window.StickyPhysics, LV = window.StickyLevels;
const NS = 'sticky-rr1';
const SEAT_COLORS = ['#ff5a5f', '#4d9de0'];
const SEND_MS = 50;
const firstName = (name) => String(name).split(' ').pop();
const avHTML = (a) => (typeof avatarHTML === 'function' ? avatarHTML(a) : escapeHtml(a));

const sfx = (() => {
  const p = createSamplePlayer({ takes: { pop: ['ui-pop-1.ogg', 'ui-pop-2.ogg'], drop: ['ui-drop-1.ogg', 'ui-drop-2.ogg'], shine: ['ui-shine.ogg'], win: ['ui-levelup.ogg'], slide: ['card-slide-1.ogg', 'card-slide-2.ogg'], pick: ['ui-pick.ogg'], stick: ['card-place-1.ogg', 'card-place-2.ogg'], shove: ['card-shove-1.ogg', 'card-shove-2.ogg'] } });
  return {
    load: p.load,
    jump() { p.sample('pop', { vol: 0.22, rate: 1.3 }); },
    bounce() { p.sample('pop', { vol: 0.5, rate: 0.7 }); },
    grab() { p.sample('stick', { vol: 0.32, rate: 1.25 }); },               // a little frosting slap
    land(hard) { p.sample('drop', { vol: 0.2 + hard * 0.35, rate: 0.75 }); },
    yank() { p.sample('shove', { vol: 0.28, rate: 0.85 }); },              // the rope snapping taut
    checkpoint() { p.sample('shine', { vol: 0.5 }); },
    fall() { p.sample('slide', { vol: 0.7, rate: 0.6 }); p.sample('drop', { vol: 0.6, rate: 0.7, when: 0.3 }); },
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
let players = [];             // [{ k, name, avatar }]
let world = null, running = false, last = 0, acc = 0, fallsShown = '';
let climb = null;             // { gid, at } of the current climb
let incoming = null, sendTimer = 0, partnerAway = false, posSeq = 0, lastQ = -1;
let savedGid = null, lastYank = 0;
const alive = (my) => () => my === session;
const later = (ms, fn) => timers.push(setTimeout(fn, ms));
const online = () => mode === 'host' || mode === 'guest';
const partnerK = () => (myK === 'a' ? 'b' : 'a');
const playerOf = (k) => players.find((p) => p.k === k);
const nameOf = (k) => (mode === 'couch' ? (k === 'a' ? 'Player 1' : 'Player 2') : k === myK ? 'You' : playerOf(k) ? firstName(playerOf(k).name) : 'Your partner');

function show(s) {
  document.querySelectorAll('.screen').forEach((el) => el.classList.toggle('active', el.id === 'screen-' + s));
  document.body.classList.toggle('in-game', s === 'play');
  chat.setInGame(online() && (s === 'play' || s === 'end'));
}

/* ================= keys ================= */
const keys = new Set(), pressed = new Set();
const P1 = { left: ['a'], right: ['d'], jump: ['w'], grab: ['shift-left'] };
const P2 = { left: ['arrowleft'], right: ['arrowright'], jump: ['arrowup'], grab: ['/', 'shift-right'] };
const ME = { left: ['a', 'arrowleft'], right: ['d', 'arrowright'], jump: ['w', 'arrowup', ' '], grab: ['shift-left', 'shift-right', 'j', '/'] };
const SHOUTS = ['hold', 'jump', 'wait', 'sorry'];
const keyName = (e) => (e.key === 'Shift' ? (e.code === 'ShiftRight' ? 'shift-right' : 'shift-left') : e.key.toLowerCase());
addEventListener('keydown', (e) => {
  if (!running || chat.typing(e)) return;
  const k = keyName(e);
  if (!keys.has(k)) pressed.add(k);
  keys.add(k);
  if (online() && !e.repeat && /^[1-4]$/.test(k)) chat.sticker(SHOUTS[+k - 1]);
  if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' ', '/'].includes(k)) e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(keyName(e)));
addEventListener('blur', () => keys.clear());
const inputFor = (map) => ({
  left: map.left.some((k) => keys.has(k)), right: map.right.some((k) => keys.has(k)),
  jump: map.jump.some((k) => pressed.has(k)), grab: map.grab.some((k) => keys.has(k)),
});

/* ================= the climb ================= */
// Start (or restart) a climb. `resume` carries the host's progress when a guest joins mid-climb.
function begin(resume) {
  const level = LV.cake;
  world = SP.newWorld(level);
  if (online()) { world[partnerK()].remote = true; world.referee = mode === 'host'; }
  if (resume) {
    world.t = resume.clock || 0; world.life = resume.life || 0;
    for (const k of ['a', 'b']) {
      world[k].falls = (resume.falls && resume.falls[k]) || 0;
      if (resume.cps && resume.cps[k]) { world[k].checkpoint = { ...resume.cps[k] }; world[k].x = resume.cps[k].x; world[k].y = resume.cps[k].y; }
    }
  }
  fallsShown = ''; incoming = null; partnerAway = false; lastQ = -1; $('#awards').innerHTML = ''; $('#st-wait').hidden = true;
  show('play');
  const looks = { a: (playerOf('a') || {}).avatar || myAvatar(), b: (playerOf('b') || {}).avatar || '🐼' };
  if (!StickyView.inited) { StickyView.init($('#view'), level); StickyView.inited = true; }
  else StickyView.resize();
  StickyView.setCritters(looks);
  running = true; last = performance.now(); acc = 0;
  $('#st-banner').hidden = true;
  if (!resume || !resume.clock) banner('Climb to the cherry!', 'Together. You\'re glued, after all 🍬', 2600);
  else banner('Back on the cake!', 'Picking up at the last candle 🕯️', 2200);
  clearInterval(sendTimer);
  if (online()) sendTimer = setInterval(sendPosition, SEND_MS);
  requestAnimationFrame(frame);
}

function frame(now) {
  if (!running) return;
  acc += Math.max(0, Math.min(0.1, (now - last) / 1000)); last = now; // rAF times can be a bit before `last`
  while (acc >= SP.P.dt) {
    if (mode === 'couch') SP.step(world, inputFor(P1), inputFor(P2));
    else {
      SP.steerRemote(world[partnerK()], incoming, 0.06);
      incoming = null;
      const mine = inputFor(ME);
      SP.step(world, myK === 'a' ? mine : null, myK === 'b' ? mine : null);
    }
    pressed.clear();
    acc -= SP.P.dt;
    world.events.splice(0).forEach(hostOrLocalEvent);
    if (!running) return;
  }
  StickyView.render(world, now / 1000);
  hud();
  requestAnimationFrame(frame);
}

// Events from our own physics. In couch mode they're all real; online, jumps and bounces are ours to
// hear, and the referee's checkpoints, falls and win go to the guest as well.
function hostOrLocalEvent(e) {
  if (mode === 'host' && ['checkpoint', 'fall', 'win'].includes(e.t)) {
    if (e.t === 'fall') world[partnerK()].net = null; // their last position is from before the respawn
    send({ t: 'ev', e, ...progress() });
  }
  onEvent(e);
}
const progress = () => ({ life: world.life, clock: world.t, falls: { a: world.a.falls, b: world.b.falls }, cps: { a: world.a.checkpoint, b: world.b.checkpoint } });

// Guest: the host decided something.
function onRefereeEvent(m) {
  if (!world || !m.e) return;
  for (const k of ['a', 'b']) {
    if (m.falls) world[k].falls = Number(m.falls[k]) || 0;
    if (m.cps && m.cps[k]) world[k].checkpoint = { x: +m.cps[k].x, y: +m.cps[k].y };
  }
  if (m.e.t === 'fall') { SP.respawn(world); world[partnerK()].net = null; }
  world.life = Number(m.life) || 0;
  if (m.e.t === 'win') world.won = true;
  onEvent(m.e);
}

function onEvent(e) {
  const cr = StickyView.critters();
  if (e.t === 'jump') { if (mode === 'couch' || e.k === myK) sfx.jump(); }
  else if (e.t === 'bounce') sfx.bounce();
  else if (e.t === 'grab') { if (mode === 'couch' || e.k === myK) sfx.grab(); }
  else if (e.t === 'land') { if (mode === 'couch' || e.k === myK) { sfx.land(e.hard); StickyView.squash(e.k, e.hard); } }
  else if (e.t === 'yank') { if (performance.now() - lastYank > 900) { lastYank = performance.now(); sfx.yank(); } }
  else if (e.t === 'checkpoint') { sfx.checkpoint(); toast('🕯️ Candle lit! You\'ll come back here if you fall', 2200); }
  else if (e.t === 'fall') {
    sfx.fall();
    const who = nameOf(e.k);
    toast(who === 'You' ? 'You slipped and took you both down 😭' : `${who} slipped and took you both down 😭`, 2400);
    if (cr[e.k]) {
      StickyView.setLook(cr[e.k], cr[e.k].userData.key, 'sulk');
      later(2500, () => cr[e.k] && StickyView.setLook(cr[e.k], cr[e.k].userData.key, 'happy'));
    }
  } else if (e.t === 'win') {
    sfx.win(); bigConfetti();
    ['a', 'b'].forEach((k) => cr[k] && StickyView.setLook(cr[k], cr[k].userData.key, 'cheer'));
    banner('YOU MADE IT! 🍒', 'The cherry is yours. Both of you.', 0);
    const secs = world.t;
    later(3800, () => showEnd(secs));
  }
}

function hud() {
  const top = LV.cake.goal.y, h = Math.max(0, Math.min(world.a.y, world.b.y));
  $('#height').textContent = `${Math.round(h)} m`;
  $('#height-bar').style.transform = `scaleX(${Math.min(1, h / top)})`;
  const layer = LV.cake.layers.find((L) => h < L.y1) || LV.cake.layers[LV.cake.layers.length - 1];
  if ($('#layer').textContent !== layer.name) $('#layer').textContent = layer.name;
  const f = `${world.a.falls}|${world.b.falls}|${mode}`;
  if (f !== fallsShown) {
    fallsShown = f;
    $('#falls').innerHTML = ['a', 'b'].map((k) => `<span>${escapeHtml(nameOf(k))} caused <b>${world[k].falls}</b> fall${world[k].falls === 1 ? '' : 's'}</span>`).join('');
  }
}
function banner(title, sub, ms) {
  const el = $('#st-banner');
  el.innerHTML = `<b>${escapeHtml(title)}</b>${sub ? `<small>${escapeHtml(sub)}</small>` : ''}`;
  el.hidden = false; retrigger(el, 'pop');
  if (ms) later(ms, () => (el.hidden = true));
}

/* ================= the end ================= */
function showEnd(secs) {
  running = false; clearInterval(sendTimer);
  show('end');
  const whole = Math.round(secs), mins = Math.floor(whole / 60), s = whole % 60;
  const total = world.a.falls + world.b.falls;
  // Online climbs go into the history (both browsers save; the database keeps one). Couch mode has a
  // made-up Player 2, so it isn't saved, like practice.
  if (online() && me && climb && climb.gid && savedGid !== climb.gid && players.length === 2) {
    savedGid = climb.gid;
    records.game({ kind: 'sticky', gid: climb.gid, room: roomCode || null, practice: false, startedAt: climb.at,
      players: players.map((p) => ({ name: p.name, bot: false, place: 1, score: world[p.k].falls })),
      winners: players.map((p) => p.name),
      stats: Object.fromEntries(players.map((p) => [p.name, { falls: world[p.k].falls, teamFalls: total, secs: whole }])), hits: [] });
    if (typeof showRewards === 'function') showRewards($('#awards'), climb.gid);
  }
  // Your best climb on this laptop (couch and online kept apart, since online is the harder one).
  const bestKey = mode === 'couch' ? 'sticky-best-couch' : 'sticky-best-online';
  const best = store.get(bestKey, null), isBest = !best || whole < best.secs;
  if (isBest) store.set(bestKey, { secs: whole, falls: total, at: Date.now() });
  const clock = (n) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
  $('#end-title').textContent = total === 0 ? 'Flawless! Not a single slip 🍒' : 'You made it! 🍒';
  const worst = world.a.falls === world.b.falls ? null : world.a.falls > world.b.falls ? 'a' : 'b';
  $('#results').innerHTML = ['a', 'b'].map((k) => {
    const p = playerOf(k), av = p ? p.avatar : k === 'a' ? myAvatar() : '🐼';
    return `<div class="st-res"><span class="av">${avHTML(av)}</span><div><b>${escapeHtml(nameOf(k))}</b><small>${k === worst ? 'Dragged you both down the most 😈' : world[k].falls ? 'Slipped now and then' : 'Rock solid'}</small></div><span class="st-blame" title="falls caused">${world[k].falls} 😭</span><span class="st-grabs" title="times held on">${world[k].grabs || 0} ✋</span></div>`;
  }).join('') + `<p class="st-stat">Climbed in ${mins}:${String(s).padStart(2, '0')} · ${total} fall${total === 1 ? '' : 's'} together</p>`
    + `<p class="st-best${isBest && best ? ' new' : ''}">${!best ? 'Your first climb! That\'s the time to beat 🏁' : isBest ? `🏆 New best! ${clock(best.secs - whole)} faster than before` : `Your best is ${clock(best.secs)}. ${clock(whole - best.secs)} off it`}</p>`;
  $('#btn-again').hidden = mode === 'guest';
  $('#end-wait').hidden = mode !== 'guest';
  $('#end-wait').textContent = 'Waiting for the host to start another climb…';
}

/* ================= couch ================= */
function couch() {
  teardown();
  mode = 'couch'; myK = 'a';
  players = [{ k: 'a', name: 'Player 1', avatar: myAvatar() }, { k: 'b', name: 'Player 2', avatar: '🐼' }];
  begin();
}

/* ================= online: rooms ================= */
function teardown() {
  session++;
  running = false;
  clearInterval(sendTimer);
  timers.forEach(clearTimeout); timers = [];
  const oldRoom = room, oldConn = conn;
  room = null; conn = null;
  if (oldConn) { try { oldConn.close(); } catch (e) {} }
  if (oldRoom) oldRoom.seats.forEach((s) => { try { s.link && s.link.close(); } catch (e) {} });
  closeAllClients();
  mode = null; myK = null; players = []; world = null; climb = null;
  chat.reset();
}
function goHome(error = '') {
  teardown();
  show('home');
  renderHomeBits();
  $('#home-error').textContent = error;
}
function leaveToHome() { store.del('sticky-lastroom'); goHome(); }
function renderHomeBits() {
  if (me) $('#me-avatar').innerHTML = avHTML(myAvatar());
  const last = store.get('sticky-lastroom', null), fresh = last && Date.now() - last.at < 3 * 3600e3;
  $('#btn-resume').hidden = !fresh;
  if (fresh) $('#resume-code').textContent = last.code;
}
const rememberRoom = (code) => code && store.set('sticky-lastroom', { code, at: Date.now() });

function send(m, fast = false) {
  const go = (l) => l && l.open && (fast ? l.sendFast(m) : l.send(m));
  if (mode === 'host') { if (room) room.seats.forEach((s) => go(s.link)); }
  else if (mode === 'guest') go(conn);
}
const r2 = (v) => Math.round(v * 100) / 100;
function sendPosition() {
  if (!world || !running) return;
  const c = world[myK];
  posSeq++;
  // Over the shared public relay (before the direct link opens), every third tick is plenty and polite.
  const link = mode === 'host' ? room && room.seats[1] && room.seats[1].link : conn;
  if (link && !link.direct && posSeq % 3) return;
  send({ t: 'p', q: posSeq, x: r2(c.x), y: r2(c.y), vx: r2(c.vx), vy: r2(c.vy), g: c.ground ? 1 : 0, gr: c.grab ? 1 : 0, gb: c.grabs || 0, l: world.life, tt: r2(world.t) }, true);
}
// The partner's latest position. Old lives (from before a respawn) are dropped.
function onPosition(m) {
  if (!world || !running) return;
  if (mode === 'host' ? m.l !== world.life : m.l < world.life) return;
  if (![m.x, m.y, m.vx, m.vy].every(Number.isFinite)) return;
  if (Number.isFinite(m.q)) { if (m.q <= lastQ && lastQ - m.q < 1000) return; lastQ = m.q; } // unordered: skip older ones
  incoming = { x: m.x, y: m.y, vx: m.vx, vy: m.vy, ground: !!m.g, grab: !!m.gr };
  if (Number.isFinite(m.gb)) world[partnerK()].grabs = m.gb;
  // The guest keeps its moving platforms in time with the host's.
  if (mode === 'guest' && Number.isFinite(m.tt)) {
    const d = m.tt + 0.06 - world.t;
    if (Math.abs(d) > 1) world.t += d; else world.t += d * 0.1;
  }
  if (partnerAway) { partnerAway = false; $('#st-wait').hidden = true; }
}

function roomPayload() { return { t: 'room', code: room.code, host: me.name, seats: room.seats.map((s) => ({ name: s.name, avatar: s.avatar })) }; }
function sendRoom() {
  const p = roomPayload();
  room.seats.forEach((s) => s.link && s.link.open && s.link.send(p));
  renderRoom(p);
}
function renderRoom(p) {
  const amHost = mode === 'host', n = p.seats.length;
  $('#room-title').textContent = amHost ? 'Your room' : `${firstName(p.host)}'s room`;
  $('#code-hint').textContent = amHost ? 'Send this code to your partner' : 'Room code';
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
  wait.innerHTML = amHost ? 'Sticky Situation needs two. Waiting for your partner<span class="dots"><i>.</i><i>.</i><i>.</i></span>'
    : `Waiting for ${escapeHtml(firstName(p.host))} to start the climb<span class="dots"><i>.</i><i>.</i><i>.</i></span>`;
}

const seatPlayers = () => room.seats.map((s) => ({ k: s.k, name: s.name, avatar: s.avatar }));
function startClimb() {
  if (!room) return;
  if (!room.seats.every((s) => s.k === myK || (s.link && s.link.open)) || room.seats.length < 2) return toast('Sticky Situation needs two players 🙂');
  room.started = true;
  rememberRoom(room.code);
  players = seatPlayers();
  climb = { gid: Math.random().toString(36).slice(2, 10), at: Date.now() };
  begin();
  send({ t: 'go', players, climb, resume: null });
}

async function createRoom() {
  if (typeof mqtt === 'undefined') return goHome('Could not load the online library. Check your internet 🙏');
  teardown();
  const my = session;
  mode = 'host'; myK = 'a';
  room = { code: genCode('G'), seats: [{ k: 'a', name: me.name, avatar: myAvatar() }], started: false };
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
        if (room.started) return reject('This climb already started 🙂');
        if (room.seats.length >= 2) return reject('Sticky Situation is for two. This room is full 🙅');
        seat = { k: 'b', name };
        room.seats.push(seat);
      }
      const old = seat.link; seat.link = c; if (old && old !== c) old.drop();
      seat.avatar = AVATARS.includes(d.avatar) ? d.avatar : seat.avatar || '🙂';
      state = 'ok'; clearTimeout(timer); sfx.pop();
      if (room.started && world) {
        players = seatPlayers(); lastQ = -1; // their page restarted its numbering
        c.send({ t: 'go', players, climb, resume: progress(), won: world.won });
        toast(`${firstName(name)} is back 👋`);
      } else { sendRoom(); toast(`${firstName(name)} joined 🎉`); }
      return;
    }
    if (state !== 'ok' || seat.link !== c || !d) return;
    if (d.t === 'p') return onPosition(d);
    if (d.t === 'social') { if (d.m && typeof d.m === 'object') chat.receive({ ...d.m, from: seat.k }); }
  });
  c.on('close', () => {
    if (!room || !seat || seat.link !== c) return;
    seat.link = null;
    if (!room.started) { room.seats.splice(room.seats.indexOf(seat), 1); sendRoom(); return; }
    partnerAway = true;
    $('#st-wait').textContent = `${firstName(seat.name)} dropped out. Waiting for them to come back…`;
    $('#st-wait').hidden = !running;
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
    hello: { user: me.user || me.name, proof: me.proof, avatar: myAvatar() },
    onConnected(link) {
      conn = link;
      link.on('data', (d) => {
        if (d.t === 'room') { clearTimeout(giveUp); if (Array.isArray(d.seats) && !document.querySelector('#screen-play.active')) { renderRoom(d); show('room'); } }
        else if (d.t === 'go' && Array.isArray(d.players)) {
          clearTimeout(giveUp);
          players = d.players.slice(0, 2).map((p) => ({ k: p.k === 'a' ? 'a' : 'b', name: String(p.name), avatar: AVATARS.includes(p.avatar) ? p.avatar : '🙂' }));
          const mine = players.find((p) => p.name === me.name);
          myK = mine ? mine.k : 'b';
          climb = d.climb || { gid: '', at: Date.now() };
          rememberRoom(code);
          if (d.won) { begin(d.resume); world.won = true; showEnd(world.t); }
          else begin(d.resume);
        }
        else if (d.t === 'p') onPosition(d);
        else if (d.t === 'ev') onRefereeEvent(d);
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
    hold: ['HOLD ON! ✋', '#ffc233'], jump: ['JUMP! ⬆️', '#2bc48a'], wait: ['WAIT FOR ME 🥺', '#4d9de0'],
    sorry: ['SORRY 😭', '#ff9ad0'], again: ['Not again 🙄', '#c9a7ff'], nice: ['We\'re SO good 🍒', '#ffffff'],
  },
  dockAt: 0,
  sound: (kind) => (kind === 'in' ? sfx.chat() : sfx.pop()),
});

/* ================= wiring ================= */
$('#btn-couch').onclick = () => { sfx.pop(); couch(); };
$('#btn-create').onclick = () => { sfx.pop(); createRoom(); };
$('#btn-join').onclick = () => { sfx.pop(); joinRoom($('#join-code').value); };
$('#join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(e.target.value); });
$('#btn-resume').onclick = () => { const last = store.get('sticky-lastroom', null); if (last) joinRoom(last.code); };
$('#btn-room-back').onclick = leaveToHome;
$('#btn-start').onclick = () => { sfx.pop(); startClimb(); };
$('#btn-leave').onclick = () => { if (mode === 'couch' || confirm('Leave the climb?')) leaveToHome(); };
$('#btn-end-home').onclick = leaveToHome;
$('#btn-again').onclick = () => { sfx.pop(); if (mode === 'couch') couch(); else if (mode === 'host') startClimb(); };
$('#btn-mute').onclick = (e) => setIcon(e.currentTarget, sfx.toggle() ? 'mute' : 'volume');
$('#btn-share').onclick = async () => {
  const code = $('#room-code').textContent, link = `${location.origin}${location.pathname}?room=${code}`;
  if (navigator.share) { try { await navigator.share({ title: 'Sticky Situation', text: `We're glued together now. Get in here: ${code}`, url: link }); return; } catch (e) { if (e.name === 'AbortError') return; } }
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
    else if (typeof showHowTo === 'function') showHowTo('sticky', [
      { icon: '🍬', title: 'Glued together', text: 'A stretchy gummy rope ties you to your partner. Wander too far and it yanks you both.' },
      { icon: '✋', title: 'Hold on!', text: 'Hold Shift (or J) on a ledge to stick. Your partner can dangle from you and swing up.' },
      { icon: '🕯️', title: 'Candles save you', text: 'Light a candle and a long fall only sends you back there. Press 1–4 to shout, hold V to talk.' },
    ], { title: 'How to play Sticky Situation' });
  });
});
