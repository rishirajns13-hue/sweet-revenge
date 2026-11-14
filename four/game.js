'use strict';
/* Plonk! (four in a row): practice bot (three levels), couch (one laptop) and online rooms.
   Online, the host's browser checks every move (four/rules.js) and sends the new board; the guest only
   asks to drop in a column. The first game's starter is random; after that it alternates. The room keeps
   a running score, so "best of" arguments are settled. */
const F = window.FourRules;
const NS = 'four-1';
const GAME_NAME = 'Plonk!';
const SEAT_COLORS = { a: '#ff5fa8', b: '#3f9bff' };
const firstName = (name) => String(name).split(' ').pop();
const avHTML = (a) => (typeof avatarHTML === 'function' ? avatarHTML(a) : escapeHtml(a));
let viewLoad = null;
const loadView = () => (viewLoad ||= import('./view.js?v=1').catch((e) => { viewLoad = null; throw e; }));

const sfx = (() => {
  const p = createSamplePlayer({ takes: { place: ['card-place-1.ogg', 'card-place-2.ogg', 'card-place-3.ogg'], hit: ['die-hit-1.ogg', 'die-hit-2.ogg', 'die-hit-3.ogg', 'die-hit-4.ogg'], pop: ['ui-pop-1.ogg', 'ui-pop-2.ogg'], pick: ['ui-pick.ogg'], win: ['ui-levelup.ogg'], nope: ['ui-drop-1.ogg'] } });
  return {
    load: p.load,
    clack(n) { p.sample('hit', { vol: n ? 0.18 : 0.42, rate: 1.35 }); },
    win() { p.sample('win', { vol: 0.7 }); },
    nope() { p.sample('nope', { vol: 0.25, rate: 0.8 }); },
    pop() { p.sample('pick', { vol: 0.35 }); },
    chat() { p.sample('pop', { vol: 0.25 }); },
    get muted() { return p.muted; }, toggle: p.toggle,
  };
})();

/* ================= state ================= */
let mode = null, session = 0, timers = [], room = null, conn = null, myK = null, roomCode = '';
let players = [], g = null, busy = false, score = { a: 0, b: 0 }, nextFirst = null, level = 2, keyCol = 3;
const alive = (my) => () => my === session;
const later = (ms, fn) => timers.push(setTimeout(fn, ms));
const online = () => mode === 'host' || mode === 'guest';
const playerOf = (k) => players.find((p) => p.k === k);
const nameOf = (k) => (mode === 'couch' ? (k === 'a' ? 'Pink' : 'Blue') : mode === 'bot' && k === 'b' ? 'Bot Bonk' : k === myK ? 'You' : playerOf(k) ? firstName(playerOf(k).name) : 'Partner');
const myTurn = () => g && !g.winner && !g.draw && !busy && (mode === 'couch' || g.turn === myK);
function show(s) {
  document.querySelectorAll('.screen').forEach((el) => el.classList.toggle('active', el.id === 'screen-' + s));
  document.body.classList.toggle('in-game', s === 'play');
  chat.setInGame(online() && (s === 'play'));
}
const validGame = (x) => x && Array.isArray(x.board) && x.board.length === F.COLS && x.board.every((c) => Array.isArray(c) && c.length === F.ROWS && c.every((v) => v === 0 || v === 'a' || v === 'b')) && (x.turn === 'a' || x.turn === 'b');

/* ================= a game ================= */
async function begin(game, last = null) {
  g = game; busy = false;
  show('play');
  $('#fo-loading').hidden = false;
  try { await loadView(); } catch (e) { $('#fo-loading').hidden = true; goHome('The 3D part didn\'t load. Check your internet and try again 🙏'); return; }
  await FourView.init($('#view'), { a: (playerOf('a') || {}).avatar || myAvatar(), b: (playerOf('b') || {}).avatar || '🐼' }, (c) => tryDrop(c));
  FourView.setBoard(g.board);
  $('#fo-loading').hidden = true;
  $('#fo-end').hidden = true;
  renderHud();
  if (last) FourView.win(null);
  loop();
  maybeBot();
}
function loop() {
  if (!g) return;
  const who = mode === 'couch' ? g.turn : myK;
  const c = FourView.hovered() >= 0 ? FourView.hovered() : keyCol;
  FourView.hover(c, who, myTurn());
  requestAnimationFrame(loop);
}
async function playMove(mv) {
  busy = true; renderHud();
  await FourView.drop(mv.c, mv.r, mv.who, (n) => sfx.clack(n));
  busy = false;
  if (g.winner || g.draw) return finish();
  renderHud();
  maybeBot();
}
function tryDrop(c) {
  if (!myTurn()) return;
  if (!F.canDrop(g, c)) { sfx.nope(); return; }
  if (mode === 'guest') { busy = true; send({ t: 'drop', c, n: g.moves.length }); later(4000, () => { busy = false; }); return; }
  const mv = F.drop(g, c);
  if (!mv) return;
  if (mode === 'host') send({ t: 'state', g, mv });
  playMove(mv);
}
function maybeBot() {
  if (mode !== 'bot' || !g || g.winner || g.draw || g.turn !== 'b' || busy) return;
  busy = true; renderHud();
  later(450 + Math.random() * 450, () => { busy = false; const c = F.botMove(g, level); const mv = F.drop(g, c); if (mv) playMove(mv); });
}
function finish() {
  if (g.winner) { score[g.winner]++; FourView.win(g.line); sfx.win(); if (mode === 'couch' || g.winner === myK || mode === 'host' || mode === 'guest') bigConfetti(); }
  nextFirst = g.first === 'a' ? 'b' : 'a';
  renderHud();
  later(1600, () => {
    $('#fo-end-title').textContent = g.draw ? 'A draw! The board is full 😮' : mode === 'couch' ? `${nameOf(g.winner)} wins! 🎉` : g.winner === myK ? 'You win! 🎉' : `${nameOf(g.winner)} wins this one`;
    $('#fo-end-score').textContent = `${nameOf('a')} ${score.a} – ${score.b} ${nameOf('b')}`;
    $('#btn-again').hidden = mode === 'guest';
    $('#fo-end-wait').hidden = mode !== 'guest';
    $('#fo-end').hidden = false;
  });
}
function renderHud() {
  if (!g) return;
  $('#fo-players').innerHTML = ['a', 'b'].map((k) => {
    const p = playerOf(k), av = p ? p.avatar : k === 'a' ? myAvatar() : '🐼';
    return `<div class="fo-p${g.turn === k && !g.winner && !g.draw ? ' on' : ''}" style="--c:${SEAT_COLORS[k]}"><span class="av">${avHTML(av)}</span><b>${escapeHtml(nameOf(k))}</b><span class="sc">${score[k]}</span></div>`;
  }).join('<span class="fo-vs">vs</span>');
  $('#fo-status').textContent = g.winner ? `${nameOf(g.winner)} got four! 🎉` : g.draw ? 'Full board. A draw!' : busy && mode === 'bot' && g.turn === 'b' ? 'Bot Bonk is thinking…' : myTurn() ? (mode === 'couch' ? `${nameOf(g.turn)}: drop a disc` : 'Your move: click a column (or 1–7)') : g.turn === myK && mode !== 'couch' ? 'Your move…' : `${nameOf(g.turn)}'s move…`;
}

/* ================= modes ================= */
function starter() { const f = nextFirst || (SR_RNG.int(2) ? 'a' : 'b'); return f; }
function practice(lv = level) {
  teardown(); mode = 'bot'; myK = 'a'; level = lv;
  players = [{ k: 'a', name: me.name, avatar: myAvatar() }, { k: 'b', name: 'Bot Bonk', avatar: '🤖' }];
  begin(F.newGame(starter()));
}
function couch() {
  teardown(); mode = 'couch'; myK = 'a';
  players = [{ k: 'a', name: 'Pink', avatar: myAvatar() }, { k: 'b', name: 'Blue', avatar: '🐼' }];
  begin(F.newGame(starter()));
}
function again() {
  if (mode === 'bot') { g = F.newGame(starter()); begin(g); }
  else if (mode === 'couch') begin(F.newGame(starter()));
  else if (mode === 'host') { const ng = F.newGame(starter()); send({ t: 'go', players, g: ng, score }); begin(ng); }
}

/* ================= online ================= */
function teardown() {
  session++;
  timers.forEach(clearTimeout); timers = [];
  const oldRoom = room, oldConn = conn; room = null; conn = null;
  if (oldConn) { try { oldConn.close(); } catch (e) {} }
  if (oldRoom) oldRoom.seats.forEach((s) => { try { s.link && s.link.close(); } catch (e) {} });
  if (typeof closeAllClients === 'function') closeAllClients();
  mode = null; myK = null; players = []; g = null; busy = false; score = { a: 0, b: 0 }; nextFirst = null;
  chat.reset();
}
function goHome(error = '') { teardown(); show('home'); renderHomeBits(); $('#home-error').textContent = error; }
function leaveToHome() { store.del('four-lastroom'); goHome(); }
function renderHomeBits() {
  if (me) $('#me-avatar').innerHTML = avHTML(myAvatar());
  const last = store.get('four-lastroom', null), fresh = last && Date.now() - last.at < 3 * 3600e3;
  $('#btn-resume').hidden = !fresh; if (fresh) $('#resume-code').textContent = last.code;
}
function send(m) {
  const go = (l) => l && l.open && l.send(m);
  if (mode === 'host') { if (room) room.seats.forEach((s) => go(s.link)); } else if (mode === 'guest') go(conn);
}
function roomPayload() { return { t: 'room', code: room.code, host: me.name, seats: room.seats.map((s) => ({ name: s.name, avatar: s.avatar })) }; }
function sendRoom() { const p = roomPayload(); room.seats.forEach((s) => s.link && s.link.open && s.link.send(p)); renderRoom(p); }
function renderRoom(p) {
  const amHost = mode === 'host', n = p.seats.length;
  $('#room-title').textContent = amHost ? 'Your room' : `${firstName(p.host)}'s room`;
  $('#code-hint').textContent = amHost ? 'Send this code to your partner' : 'Room code';
  $('#room-code').textContent = p.code;
  $('#seats').innerHTML = ['a', 'b'].map((k, i) => { const s = p.seats[i]; return s ? `<div class="seat" style="--c:${SEAT_COLORS[k]}"><span class="av">${avHTML(s.avatar)}</span><span class="nm">${escapeHtml(s.name)}${s.name === me.name ? ' (you)' : ''}</span><span class="st">${i === 0 ? 'Pink · host' : `${ic('check')}Blue`}</span></div>` : '<div class="seat empty"><span class="av"></span><span class="nm">Waiting for your partner</span></div>'; }).join('');
  $('#btn-start').hidden = !amHost; $('#btn-start').disabled = n < 2;
  const wait = $('#room-wait'); wait.hidden = amHost && n >= 2;
  wait.innerHTML = amHost ? `Waiting for your partner<span class="dots"><i>.</i><i>.</i><i>.</i></span>` : `Waiting for ${escapeHtml(firstName(p.host))} to start<span class="dots"><i>.</i><i>.</i><i>.</i></span>`;
}
function startMatch() {
  if (!room || room.seats.length < 2 || !room.seats.every((s) => s.k === myK || (s.link && s.link.open))) return toast(`${GAME_NAME} needs two players 🙂`);
  room.started = true; store.set('four-lastroom', { code: room.code, at: Date.now() });
  players = room.seats.map((s) => ({ k: s.k, name: s.name, avatar: s.avatar }));
  const ng = F.newGame(starter());
  send({ t: 'go', players, g: ng, score });
  begin(ng);
}
async function createRoom() {
  if (typeof mqtt === 'undefined') return goHome('Could not load the online library. Check your internet 🙏');
  teardown(); const my = session;
  mode = 'host'; myK = 'a';
  room = { code: genCode('F'), seats: [{ k: 'a', name: me.name, avatar: myAvatar() }], started: false }; roomCode = room.code;
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
      if (!seat) { if (room.seats.length >= 2) return reject('This room is full 🙅'); seat = { k: 'b', name }; room.seats.push(seat); }
      const old = seat.link; seat.link = c; if (old && old !== c) old.drop();
      seat.avatar = AVATARS.includes(d.avatar) ? d.avatar : seat.avatar || '🙂';
      st = 'ok'; clearTimeout(timer); sfx.pop();
      if (room.started && g) { players = room.seats.map((s) => ({ k: s.k, name: s.name, avatar: s.avatar })); c.send({ t: 'go', players, g, score }); toast(`${firstName(name)} is back 👋`); }
      else { sendRoom(); toast(`${firstName(name)} joined 🎉`); }
      return;
    }
    if (st !== 'ok' || seat.link !== c || !d) return;
    if (d.t === 'social') { if (d.m && typeof d.m === 'object') chat.receive({ ...d.m, from: seat.k }); return; }
    if (d.t === 'drop' && g && Number.isInteger(d.c) && d.n === g.moves.length && !busy) {
      const mv = F.drop(g, d.c, seat.k);
      if (mv) { send({ t: 'state', g, mv }); playMove(mv); } else send({ t: 'state', g, mv: null });
    }
  });
  c.on('close', () => { if (!room || !seat || seat.link !== c) return; seat.link = null; if (!room.started) { room.seats.splice(room.seats.indexOf(seat), 1); sendRoom(); return; } toast(`${firstName(seat.name)} dropped out. Waiting for them to come back…`, 3500); });
}
function joinRoom(code) {
  code = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) { $('#home-error').textContent = 'Room codes are 6 letters or numbers 🙂'; return; }
  if (typeof mqtt === 'undefined') { $('#home-error').textContent = 'Could not load the online library. Check your internet 🙏'; return; }
  teardown(); const my = session;
  mode = 'guest'; roomCode = code;
  $('#room-title').textContent = 'Joining…'; $('#room-code').textContent = code; $('#seats').innerHTML = ''; $('#btn-start').hidden = true;
  $('#room-wait').hidden = false; $('#room-wait').innerHTML = 'Knocking on the door<span class="dots"><i>.</i><i>.</i><i>.</i></span>';
  show('room');
  const giveUp = setTimeout(() => { if (my === session && !conn) { goHome('No answer from that room 🤔 Is anyone still in it?'); $('#join-code').value = code; } }, 20000);
  knock({
    code, ns: NS, minEpoch: 0, alive: alive(my), hello: { user: me.user || me.name, proof: me.proof, avatar: myAvatar() },
    onConnected(link) {
      conn = link;
      link.on('data', (d) => {
        if (d.t === 'room') { clearTimeout(giveUp); if (Array.isArray(d.seats) && !document.querySelector('#screen-play.active')) { renderRoom(d); show('room'); } }
        else if (d.t === 'go' && Array.isArray(d.players) && validGame(d.g)) {
          clearTimeout(giveUp);
          players = d.players.slice(0, 2).map((p) => ({ k: p.k === 'a' ? 'a' : 'b', name: String(p.name), avatar: AVATARS.includes(p.avatar) ? p.avatar : '🙂' }));
          const mine = players.find((p) => p.name === me.name); myK = mine ? mine.k : 'b';
          if (d.score && Number.isInteger(d.score.a) && Number.isInteger(d.score.b)) score = { a: d.score.a, b: d.score.b };
          store.set('four-lastroom', { code, at: Date.now() });
          begin(d.g);
        } else if (d.t === 'state' && validGame(d.g) && g) {
          busy = false; g = d.g;
          if (d.mv && Number.isInteger(d.mv.c) && Number.isInteger(d.mv.r)) playMove(d.mv); else { FourView.setBoard(g.board); renderHud(); }
        } else if (d.t === 'social' && d.m) chat.receive(d.m);
        else if (d.t === 'reject') { clearTimeout(giveUp); goHome(String(d.why || 'Could not join')); }
      });
      link.on('close', () => { if (mode === 'guest' && conn === link) { goHome('The host left. Tap Join to hop back in if they come back!'); $('#join-code').value = code; } });
    },
  });
}

/* ---------- chat ---------- */
const chat = createChat({
  send: (m) => send({ t: 'social', m }),
  game: null, room: () => roomCode || null, // not saved yet: the database needs this game's kind first
  players: () => (online() ? players.map((p) => ({ k: p.k, name: p.name, color: SEAT_COLORS[p.k], avatar: p.avatar })) : []),
  me: () => myK, stage: () => $('#stage'),
  stickers: { nice: ['Nice one 😏', '#2bc48a'], sneaky: ['SNEAKY 👀', '#ffc233'], nooo: ['NOOO 😭', '#ff9ad0'], gg: ['GG 🤝', '#3f9bff'] },
  dockAt: 0, sound: (kind) => (kind === 'in' ? sfx.chat() : sfx.pop()),
});

/* ================= wiring ================= */
$('#btn-practice').onclick = () => { sfx.pop(); practice(+$('#fo-level').value || 2); };
$('#btn-couch').onclick = () => { sfx.pop(); couch(); };
$('#btn-create').onclick = () => { sfx.pop(); createRoom(); };
$('#btn-join').onclick = () => { sfx.pop(); joinRoom($('#join-code').value); };
$('#join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(e.target.value); });
$('#btn-resume').onclick = () => { const last = store.get('four-lastroom', null); if (last) joinRoom(last.code); };
$('#btn-room-back').onclick = leaveToHome;
$('#btn-start').onclick = () => { sfx.pop(); startMatch(); };
$('#btn-leave').onclick = () => { if (!online() || confirm('Leave the game?')) leaveToHome(); };
$('#btn-again').onclick = () => { sfx.pop(); again(); };
$('#btn-end-home').onclick = leaveToHome;
$('#btn-mute').onclick = (e) => setIcon(e.currentTarget, sfx.toggle() ? 'mute' : 'volume');
$('#btn-share').onclick = async () => {
  const code = $('#room-code').textContent, link = `${location.origin}${location.pathname}?room=${code}`;
  if (navigator.share) { try { await navigator.share({ title: GAME_NAME, text: `Four in a row. You're going down. Room ${code}`, url: link }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(link); toast('Invite link copied 💌'); } catch (e) { prompt('Copy this link:', link); }
};
addEventListener('keydown', (e) => {
  if (!g || chat.typing(e)) return;
  const k = e.key.toLowerCase();
  if (online() && !e.repeat && /^[8-9]$/.test(k)) chat.sticker(k === '8' ? 'nice' : 'gg');
  if (/^[1-7]$/.test(k)) { keyCol = +k - 1; tryDrop(keyCol); }
  else if (k === 'arrowleft') { keyCol = Math.max(0, keyCol - 1); e.preventDefault(); }
  else if (k === 'arrowright') { keyCol = Math.min(6, keyCol + 1); e.preventDefault(); }
  else if (k === 'arrowdown' || k === ' ' || k === 'enter') { tryDrop(keyCol); e.preventDefault(); }
});
addEventListener('pagehide', () => { if (mode) teardown(); if (window.FourView) FourView.dispose(); });
document.addEventListener('profilechange', renderHomeBits);
document.addEventListener('DOMContentLoaded', () => {
  hydrateIcons();
  if (sfx.muted) setIcon($('#btn-mute'), 'mute');
  applyPalette(); wireProfileSheet();
  chat.mountTools($('#chat-tools'), { compact: true });
  sfx.load();
  requireLogin().then(() => {
    goHome();
    (window.requestIdleCallback || ((f) => setTimeout(f, 800)))(() => loadView().catch(() => {}), { timeout: 2500 });
    const code = new URLSearchParams(location.search).get('room');
    if (code) { history.replaceState(null, '', location.pathname); $('#join-code').value = code.toUpperCase(); joinRoom(code); }
  });
});
