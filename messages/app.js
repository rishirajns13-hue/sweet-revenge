// Messages: the private chat between the two friends. This file draws the chat and handles every
// gesture; data.js talks to the database, logic.mjs holds the tested pure parts.
// Needs the classic scripts loaded first: shared/core.js, shared/avatars.js, shared/sound.js.
import * as L from './logic.mjs?v=2';
const { WALLS, wallKind } = L;
import { THEMES, THEME_ORDER, themeName, applyTheme } from './themes.js?v=2';
import * as D from './data.js?v=2';
import * as V from './voice.js?v=2';
import { mountPicker, openPicker, closePicker, pickerOpen, stickerHTML } from './picker.js?v=2';

const S = D.S;
// Everything the chat draws lives inside #dm-root, so its theme and classes never leak into the rest of the app.
const ROOT = document.getElementById('dm-root');
let shown = true; // false while the app shows another section (Home, Games…)
D.setHereFn(() => shown && !document.hidden); // "in the chat" only while it is on screen
const coarse = matchMedia('(pointer: coarse)').matches;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const els = {
  app: $('#app'), scroller: $('#scroller'), thread: $('#thread'), typing: $('#typing'), hello: $('#dm-hello'), older: $('#older'),
  input: $('#input'), field: $('.field'), send: $('#btn-send'), ctx: $('#context-bar'), compose: $('#compose-row'), rec: $('#rec-bar'),
  menu: $('#menu'), details: $('#details'), jump: $('#jump-down'), pull: $('#vanish-pull'),
};
const SVG = {
  reply: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 6 6v4"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  more: '<circle cx="5.5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/>',
  pause: '<path d="M8 5v14M16 5v14" stroke-width="3"/>',
  retry: '<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/>',
};
const svg = (name, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${SVG[name] || ICONS[name]}</svg>`;

/* ---------------- sounds: the chat's own soft set (recorded, CC0) ----------------
   Like a DM app: a bubble "blob" when you send, a water drop when a message arrives, a tiny pop for a reaction. */
const player = createSamplePlayer({ volume: 0.6, takes: { send: ['chat-send.ogg'], receive: ['chat-receive.ogg'], react: ['chat-react.ogg'] } });
const sfx = {
  send() { player.sample('send', { vol: 0.32 }); },
  receive() { player.sample('receive', { vol: 0.55 }); },
  react() { player.sample('react', { vol: 0.18, rate: 1.1 }); },
};
['pointerdown', 'keydown'].forEach((ev) => addEventListener(ev, () => setTimeout(() => player.load(), 80), { once: true })); // after the tap has drawn

/* ---------------- names and faces ---------------- */
const nick = (id) => (S.state.nicknames || {})[id];
const nameOf = (id) => nick(id) || (S.players[id] || {}).name || (id ? id.replace(/\b\w/g, (c) => c.toUpperCase()) : '');
const firstName = (id) => nameOf(id).split(' ')[0];
// System lines ("X set Y's nickname to Z") use real names, so they read right after a nickname change.
const realName = (id) => (S.players[id] || {}).name || nameOf(id);
const otherId = () => (S.other ? S.other.id : null);
const picUrls = {};
function critterOf(id) {
  if (id === me.user) return myAvatar();
  const a = (S.players[id] || {}).avatar;
  return AVATARS.includes(a) ? a : DEFAULT_AVATAR[id] || '😎';
}
function faceInner(id) {
  const p = S.players[id];
  if (p && p.pic_mode === 'photo' && p.pic) {
    const u = picUrls[p.pic];
    if (u) return `<img src="${escapeHtml(u)}" alt="" decoding="async">`;
    if (u === undefined) {
      picUrls[p.pic] = null;
      D.fileUrl('pics', p.pic).then((url) => { picUrls[p.pic] = url || false; if (url) paintFaces(); });
    }
  }
  return avatarHTML(critterOf(id), 'happy');
}
function paintFaces() {
  document.querySelectorAll('[data-who]').forEach((el) => { el.innerHTML = faceInner(el.dataset.who); });
}
const hm = (ts) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/* ---------------- drawing the chat ---------------- */
const rowEls = new Map(); // row key → element
const popReacts = new Set();
let painted = false;

function sigOf(r) {
  if (r.type === 'divider') return 'd' + L.dividerLabel(r.at);
  if (r.type === 'seen') return 's' + L.seenLabel(r.at);
  if (r.type === 'system') return 'y' + L.systemText(r.m, me.user, realName, themeName);
  const m = r.m, q = m.reply_to ? S.messages.find((x) => x.id === m.reply_to) : null;
  return JSON.stringify([r.pos, m.kind, m.body, m.edited_at, !!m.pending, !!m.failed, m.vanish, m.meta, m.reply_to && (q ? L.preview(q) + q.sender : '?'),
    S.reactions[m.id], nameOf(m.sender), nameOf(otherId())]);
}

function render({ enter } = {}) {
  const rows = L.buildRows(S.messages);
  const seen = L.seenTarget(S.messages, me.user);
  const want = [];
  for (const r of rows) {
    want.push(r);
    if (seen && r.type === 'msg' && r.m.id === seen.id) want.push({ type: 'seen', key: 'seen', at: seen.at });
  }
  const keep = new Set(want.map((r) => r.key));
  for (const [k, el] of rowEls) if (!keep.has(k)) { el.remove(); rowEls.delete(k); }
  let prev = null;
  for (const r of want) {
    let el = rowEls.get(r.key);
    if (!el) { el = document.createElement('div'); rowEls.set(r.key, el); }
    const sig = sigOf(r);
    if (el._sig !== sig) { paintRow(el, r); el._sig = sig; if (r.type === 'msg' && r.m.kind === 'voice') V.repaint(r.m.id); }
    const spot = prev ? prev.nextSibling : els.thread.firstChild;
    if (el !== spot) els.thread.insertBefore(el, spot);
    if (enter && r.type === 'msg' && enter === r.m.id && !reduced) {
      const cls = r.m.sender === me.user ? 'enter-mine' : 'enter-theirs';
      el.classList.add(cls);
      el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
    }
    prev = el;
  }
  popReacts.clear();
  renderHello();
  painted = true;
}

function paintRow(el, r) {
  if (r.type === 'divider') { el.className = 'divider'; el.textContent = L.dividerLabel(r.at); return; }
  if (r.type === 'seen') { el.className = 'seen'; el.textContent = L.seenLabel(r.at); return; }
  if (r.type === 'system') {
    el.className = 'sysline' + (r.m.meta && r.m.meta.event === 'vanish' && r.m.meta.value ? ' vanish-on' : '');
    el.textContent = L.systemText(r.m, me.user, realName, themeName);
    return;
  }
  const m = r.m, mine = m.sender === me.user;
  el.className = `row msg ${mine ? 'mine' : 'theirs'} pos-${r.pos} k-${m.kind}${m.pending ? ' pending' : ''}${m.failed ? ' failed' : ''}${m.vanish ? ' vanish' : ''}`;
  el.dataset.id = m.id;
  el.innerHTML = `${mine ? '' : `<span class="face sm" data-who="${escapeHtml(m.sender)}">${faceInner(m.sender)}</span>`}
    <div class="stack">${quoteHTML(m, mine)}${bubbleHTML(m)}${reactsHTML(m)}${underHTML(m)}</div>
    <div class="tools">
      <button type="button" data-act="reply" aria-label="Reply">${svg('reply')}</button>
      <button type="button" data-act="react" aria-label="React">${svg('smile')}</button>
      <button type="button" data-act="more" aria-label="More">${svg('more')}</button>
    </div>
    <span class="swipe-hint" aria-hidden="true">${svg('reply')}</span>
    <time class="side-time" datetime="${escapeHtml(m.created_at)}">${hm(m.created_at)}</time>`;
  el.title = coarse ? '' : L.dividerLabel(Date.parse(m.created_at));
}

function bubbleHTML(m) {
  switch (m.kind) {
    case 'like': return '<div class="bub like" aria-label="Heart">❤️</div>';
    case 'sticker': case 'gif': return `<div class="bub media">${stickerHTML(m.meta || {})}</div>`;
    case 'voice': {
      const dur = L.fmtDuration((m.meta && m.meta.dur) || 0);
      const wave = (m.meta && m.meta.wave) || new Array(40).fill(30);
      return `<div class="bub paint voice" data-dur="${dur}">
        <button type="button" class="v-play" data-act="play" aria-label="Play voice message">${svg('play', 'ic-play')}${svg('pause', 'ic-pause')}</button>
        <span class="v-bars" data-act="seek">${wave.map((h) => `<i class="on" style="--h:${+h || 8}"></i>`).join('')}</span>
        <span class="v-time">${dur}</span><button type="button" class="v-rate" data-act="rate">${V.currentRate()}×</button></div>`;
    }
    default: {
      const n = L.emojiOnly(m.body);
      if (n) return `<div class="bub emoji n${n}">${escapeHtml(m.body.replace(/\s+/g, ''))}</div>`;
      return `<div class="bub paint">${L.linkify(escapeHtml(m.body))}</div>`;
    }
  }
}
function quoteHTML(m, mine) {
  if (!m.reply_to) return '';
  const q = S.messages.find((x) => x.id === m.reply_to);
  const to = q ? q.sender : null;
  const label = mine
    ? (to === me.user ? 'You replied to yourself' : `You replied to ${firstName(otherId())}`)
    : (to === me.user ? `${firstName(m.sender)} replied to you` : `${firstName(m.sender)} replied to themself`);
  return `<div class="quote" data-act="quote" data-to="${escapeHtml(m.reply_to)}"><span>${escapeHtml(label)}</span><q>${escapeHtml(q ? L.preview(q) : 'Tap to find the message')}</q></div>`;
}
function reactsHTML(m) {
  const r = S.reactions[m.id];
  const list = r ? Object.values(r) : [];
  if (!list.length) return '';
  const uniq = [...new Set(list)];
  return `<button type="button" class="reacts${popReacts.has(m.id) ? ' pop' : ''}" data-act="reacts" aria-label="Reactions">${uniq.map(escapeHtml).join('')}${list.length > 1 ? `<b>${list.length}</b>` : ''}</button>`;
}
function underHTML(m) {
  if (m.failed) return '<span class="under fail" data-act="retry">Not sent. Tap to try again.</span>';
  if (m.edited_at && m.kind === 'text') return '<span class="under">Edited</span>';
  return '';
}

// The top of the conversation: both faces, how long you've been talking, and a way into a game.
// Shown once the very first message is loaded (or when there are none yet).
function renderHello() {
  const real = S.messages.filter((m) => m.kind !== 'system');
  els.hello.hidden = (real.length && S.hasOlder) || !S.other;
  if (els.hello.hidden) return;
  const o = otherId(), first = real.find((m) => !m.pending);
  const since = first && new Date(first.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  const realName = (S.players[o] || {}).name, nicked = nick(o) && realName && nick(o) !== realName;
  const line = !real.length ? 'Just the two of you. Say hi.'
    : `Chatting since ${since}. ${real.length === 1 ? 'One message' : real.length.toLocaleString() + ' messages'} so far.`;
  els.hello.innerHTML = `<div class="faces"><span class="face xl" data-who="${escapeHtml(o)}">${faceInner(o)}</span><span class="face xl" data-who="${escapeHtml(me.user)}">${faceInner(me.user)}</span></div>
    <b>${escapeHtml(nameOf(o))}</b>${nicked ? `<small>${escapeHtml(realName)}</small>` : ''}<p>${escapeHtml(line)}</p>
    <div class="hi-acts">${real.length ? '' : '<button type="button" id="btn-wave">👋 Send a wave</button>'}<a class="hi-chip" href="#play">🎮 Play a game together</a></div>`;
  const wave = $('#btn-wave');
  if (wave) wave.onclick = () => sendItem({ kind: 'sticker', meta: { pack: 'critter', critter: myAvatar(), mood: 'cheer', text: 'hiii' } });
}

/* ---------------- header ---------------- */
function renderHeader() {
  const o = otherId();
  $('#peer-face').dataset.who = o || '';
  $('#peer-face').innerHTML = o ? faceInner(o) : '';
  $('#typing-face').dataset.who = o || '';
  $('#typing-face').innerHTML = o ? faceInner(o) : '';
  $('#peer-name').textContent = o ? nameOf(o) : 'Messages';
  $('#peer-dot').hidden = !S.online;
  const st = $('#peer-status');
  st.classList.toggle('typing', S.typing);
  st.textContent = !navigator.onLine ? 'Offline. Messages send when you\'re back.'
    : S.typing ? 'typing…'
    : L.activeLabel(S.other && S.other.last_seen, S.online);
}
setInterval(() => { renderHeader(); if (painted) render(); }, 30000);

/* ---------------- scrolling ---------------- */
const sc = els.scroller;
const nearBottom = (px = 120) => sc.scrollHeight - sc.scrollTop - sc.clientHeight < px;
function toBottom(smooth) {
  if (smooth && !reduced) sc.scrollTo({ top: sc.scrollHeight, behavior: 'smooth' });
  else sc.scrollTop = sc.scrollHeight;
}
let missed = 0;
function updateJump() {
  const show = !nearBottom(300);
  els.jump.hidden = !show;
  if (!show) missed = 0;
  $('#jump-count').hidden = !missed;
  $('#jump-count').textContent = missed;
}
els.jump.onclick = () => { missed = 0; toBottom(true); };
sc.addEventListener('scroll', () => {
  updateJump();
  if (sc.scrollTop < 400 && S.hasOlder && painted) loadOlder();
  if (nearBottom(4)) { if (!atBottomSince) atBottomSince = performance.now(); } else atBottomSince = 0;
}, { passive: true });
async function loadOlder() {
  if (els.older.hidden === false) return;
  els.older.hidden = false;
  await D.loadOlder();
  els.older.hidden = true;
}
// Keep the view still while older messages are added above it.
function keepScroll(fn) {
  const h = sc.scrollHeight, t = sc.scrollTop;
  fn();
  sc.scrollTop = t + (sc.scrollHeight - h);
}

/* ---------------- data events ---------------- */
let hiddenUnread = 0;
// The rest of the app (Home's chat card) redraws from peek() when this fires.
let changeT = 0;
D.onData(() => { clearTimeout(changeT); changeT = setTimeout(() => document.dispatchEvent(new CustomEvent('dm:change')), 60); });
D.onData((what, x) => {
  switch (what) {
    case 'sent': render({ enter: x.id }); toBottom(true); break;
    case 'arrived': {
      const near = nearBottom();
      render({ enter: x.id });
      if (x.sender !== me.user && x.kind !== 'system') {
        if (document.hidden) { hiddenUnread++; setTitle(); } else if (shown) sfx.receive(); // on Home the app plays its own sound
        if (near) toBottom(true); else { missed++; updateJump(); }
        readIfLooking();
      } else if (near) toBottom(true);
      if (x.kind === 'system') { applyLook(); if (els.details.classList.contains('open')) renderDetails(); }
      break;
    }
    case 'older': keepScroll(() => render()); break;
    case 'state': applyLook(); render(); renderHeader(); if (els.details.classList.contains('open')) renderDetails(); break;
    case 'people': renderHeader(); paintFaces(); render(); if (els.details.classList.contains('open')) renderDetails(); break;
    case 'typing': showTyping(); renderHeader(); break;
    case 'presence': case 'live': renderHeader(); break;
    case 'reaction': popReacts.add(x); render(); break;
    case 'reacted': if (!document.hidden) sfx.react(); break;
    case 'removed': {
      const el = rowEls.get(x);
      if (el && !reduced) { el.classList.add('unsending'); setTimeout(render, 260); } else render();
      break;
    }
    case 'all': { const near = nearBottom(); render(); if (near || !painted) toBottom(false); renderHeader(); readIfLooking(); break; }
    default: render(); renderHeader();
  }
});
function showTyping() {
  const near = nearBottom();
  els.typing.hidden = !S.typing;
  if (S.typing && near) toBottom(true);
}

/* ---------------- reading, presence, the tab title ---------------- */
const looking = () => shown && !document.hidden && document.hasFocus();
function readIfLooking() { if (looking()) D.markRead(); }
function setTitle() { if (shown) document.title = (hiddenUnread ? `(${hiddenUnread}) ` : '') + 'Messages · Sweet Revenge'; }
addEventListener('focus', () => { readIfLooking(); D.setHere(shown); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    D.setHere(false);
    D.sendTyping(false);
    if (coarse && shown) D.vanishSweepOnLeave(); // on phones, switching away is leaving
  } else {
    hiddenUnread = 0; setTitle();
    D.setHere(shown);
    readIfLooking();
    D.reconnect();
    D.refresh().catch(() => {});
  }
});
addEventListener('pagehide', () => { D.vanishSweepOnLeave(); D.sendTyping(false); });
addEventListener('online', () => { renderHeader(); D.reconnect(); D.flushOutbox(); D.refresh().catch(() => {}); });
addEventListener('offline', renderHeader);

/* ---------------- the composer ---------------- */
let ctx = null; // { type: 'reply' | 'edit', m }
const input = els.input;
function autosize() {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 140) + 'px';
}
function updateSend() {
  const has = input.value.trim().length > 0;
  els.field.classList.toggle('has-text', has);
  els.send.classList.toggle('on', has || (ctx && ctx.type === 'edit'));
  els.send.setAttribute('aria-label', has ? (ctx && ctx.type === 'edit' ? 'Save edit' : 'Send') : 'Send a heart');
}
input.addEventListener('input', () => {
  autosize(); updateSend();
  if (input.value.trim()) D.sendTyping(true); else D.sendTyping(false);
  if (!ctx || ctx.type !== 'edit') store.set('dm-draft', input.value);
});
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !coarse && !e.isComposing) { e.preventDefault(); submit(); }
  if (e.key === 'Escape' && ctx) { e.preventDefault(); clearCtx(); }
  if (e.key === 'ArrowUp' && !input.value) {
    const last = [...S.messages].reverse().find((m) => m.sender === me.user && m.kind !== 'system');
    if (last && L.canEdit(last, me.user)) { e.preventDefault(); startEdit(last); }
  }
});
input.addEventListener('blur', () => D.sendTyping(false));
input.addEventListener('focus', () => { if (matchMedia('(pointer: coarse)').matches) document.body.classList.add('typing'); });
input.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== input) document.body.classList.remove('typing'); }, 120));
// (body.typing on purpose: the app's bottom nav, outside the chat, hides while the keyboard is up)
els.send.addEventListener('click', () => {
  if (input.value.trim() || (ctx && ctx.type === 'edit')) submit();
  else sendLike();
});
function submit() {
  const text = input.value.replace(/\s+$/, '').replace(/^\n+/, '');
  if (ctx && ctx.type === 'edit') {
    const m = ctx.m;
    clearCtx(true);
    if (text.trim() && text !== m.body) D.edit(m.id, text).catch(() => toast('That message can\'t be edited any more'));
    return;
  }
  if (!text.trim()) return;
  D.send('text', text, {}, ctx && ctx.type === 'reply' ? ctx.m.id : null);
  input.value = ''; store.del('dm-draft');
  autosize(); clearCtx(); updateSend();
  D.sendTyping(false);
  sfx.send();
  if (!coarse) input.focus();
}
function sendLike() {
  D.send('like', '❤️', {}, ctx && ctx.type === 'reply' ? ctx.m.id : null);
  clearCtx(); sfx.send();
}
function sendItem(item) {
  D.send(item.kind, '', item.meta, ctx && ctx.type === 'reply' ? ctx.m.id : null);
  clearCtx(); sfx.send();
}
function setCtx(type, m) {
  ctx = { type, m };
  els.ctx.hidden = false;
  $('#ctx-title').textContent = type === 'edit' ? 'Editing message' : `Replying to ${m.sender === me.user ? 'yourself' : nameOf(m.sender)}`;
  $('#ctx-body').textContent = L.preview(m);
  updateSend();
  input.focus();
}
function startReply(m) { if (ctx && ctx.type === 'edit') clearCtx(true); setCtx('reply', m); }
function startEdit(m) {
  setCtx('edit', m);
  input.value = m.body; autosize(); updateSend();
  input.setSelectionRange(input.value.length, input.value.length);
}
function clearCtx(restoreDraft) {
  const wasEdit = ctx && ctx.type === 'edit';
  ctx = null; els.ctx.hidden = true;
  if (wasEdit && restoreDraft) { input.value = store.get('dm-draft', ''); autosize(); }
  updateSend();
}
$('#ctx-close').onclick = () => clearCtx(true);
if (coarse) input.enterKeyHint = 'enter'; // on phones Enter is a new line; the button sends
input.value = store.get('dm-draft', '');
autosize(); updateSend();

$('#btn-emoji').onclick = () => openPicker({ tab: 'emoji', onEmoji: insertText, critter: myAvatar() });
$('#btn-sticker').onclick = () => openPicker({ tab: 'gifs', onPick: sendItem, onEmoji: insertText, critter: myAvatar() });
function insertText(t) {
  const a = input.selectionStart ?? input.value.length, b = input.selectionEnd ?? a;
  input.value = input.value.slice(0, a) + t + input.value.slice(b);
  input.setSelectionRange(a + t.length, a + t.length);
  input.dispatchEvent(new Event('input'));
  if (!coarse) input.focus();
}

/* ---------------- voice notes: hold to record (phones), tap to start and stop (laptops) ---------------- */
let rec = null, recInfo = null;
const recWave = $('#rec-wave');
$('#btn-mic').addEventListener('pointerdown', async (e) => {
  if (rec) return;
  e.preventDefault();
  recInfo = { t0: performance.now(), x0: e.clientX, y0: e.clientY, touch: e.pointerType !== 'mouse', locked: e.pointerType === 'mouse', cancel: false, holding: true };
  els.compose.hidden = true; els.rec.hidden = false;
  els.rec.classList.toggle('locked', recInfo.locked);
  $('#rec-time').textContent = '0:00'; recWave.innerHTML = '';
  $('#rec-hint').textContent = 'Slide left to cancel, up to lock';
  try {
    rec = await V.record((level, secs) => {
      const bar = document.createElement('i');
      bar.style.setProperty('--h', Math.max(10, Math.round(level * 100)));
      recWave.appendChild(bar);
      while (recWave.children.length > 90) recWave.firstChild.remove();
      $('#rec-time').textContent = L.fmtDuration(secs);
      if (secs >= V.MAX_SECONDS) finishRec(true);
    });
    if (!recInfo) { rec.cancel(); rec = null; } // let go before the microphone was ready
  } catch (err) {
    endRecUI();
    toast(err && err.name === 'NotAllowedError' ? 'Allow the microphone to send voice messages' : 'Voice messages don\'t work in this browser');
  }
});
addEventListener('pointermove', (e) => {
  if (!recInfo || !recInfo.touch || recInfo.locked || !recInfo.holding) return;
  const dx = e.clientX - recInfo.x0, dy = e.clientY - recInfo.y0;
  recInfo.cancel = dx < -90;
  els.rec.classList.toggle('cancelling', recInfo.cancel);
  if (dy < -70) { recInfo.locked = true; els.rec.classList.add('locked'); if (navigator.vibrate) navigator.vibrate(10); }
});
addEventListener('pointerup', () => {
  if (!recInfo || !recInfo.holding) return;
  recInfo.holding = false;
  if (!recInfo.touch || recInfo.locked) return;
  if (recInfo.cancel) return cancelRec();
  if (performance.now() - recInfo.t0 < 350) { recInfo.locked = true; els.rec.classList.add('locked'); return; } // a tap: keep recording until Send
  finishRec(true);
});
$('#rec-cancel').onclick = () => cancelRec();
$('#rec-send').onclick = () => finishRec(true);
function endRecUI() {
  els.rec.hidden = true; els.compose.hidden = false;
  els.rec.classList.remove('cancelling', 'locked');
  rec = null; recInfo = null;
}
function cancelRec() { if (rec) rec.cancel(); endRecUI(); }
async function finishRec(send) {
  const r = rec;
  if (!r) { endRecUI(); return; }
  rec = null;
  const { blob, dur, wave } = await r.stop();
  endRecUI();
  if (!send) return;
  if (dur < 0.7 || blob.size < 1200) { toast(coarse ? 'Hold the mic to record' : 'That was too short to send'); return; }
  D.send('voice', '', { dur: Math.round(dur * 10) / 10, wave }, ctx && ctx.type === 'reply' ? ctx.m.id : null, blob, { _url: URL.createObjectURL(blob) });
  clearCtx(); sfx.send();
}
addEventListener('keydown', (e) => { if (e.key === 'Escape' && rec) cancelRec(); });

function voiceEl(id) { return els.thread.querySelector(`.row[data-id="${CSS.escape(id)}"] .voice`); }
function nextVoiceButton(id) {
  const i = S.messages.findIndex((m) => m.id === id);
  const n = S.messages[i + 1];
  if (!n || n.kind !== 'voice' || n.sender !== S.messages[i].sender) return null;
  const el = voiceEl(n.id);
  return el && el.querySelector('.v-play');
}
function playVoice(m) {
  V.toggle(m.id, () => voiceEl(m.id), async () => m._url || find(m.id)._url || D.fileUrl('dm-voice', m.meta.path), () => nextVoiceButton(m.id))
    .catch(() => toast('That voice message couldn\'t play'));
}

/* ---------------- taps, double taps, swipes and long presses on messages ---------------- */
const find = (id) => S.messages.find((m) => m.id === id);
els.thread.addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]'), row = e.target.closest('.row.msg');
  if (!row) return;
  const m = find(row.dataset.id);
  if (!m) return;
  if (!act) return;
  const a = act.dataset.act;
  if (a === 'play') playVoice(m);
  else if (a === 'seek') {
    const r = act.getBoundingClientRect(), frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    if (!V.seek(m.id, frac)) playVoice(m);
  } else if (a === 'rate') { V.cycleRate(); act.closest('.voice').classList.add('rated'); }
  else if (a === 'retry') D.retry(m.id);
  else if (a === 'reply') startReply(m);
  else if (a === 'react') openMenu(row, { reactOnly: true });
  else if (a === 'more') openMenu(row);
  else if (a === 'reacts') openReactions(row, m);
  else if (a === 'quote') jumpTo(act.dataset.to);
});
els.thread.addEventListener('dblclick', (e) => {
  const row = e.target.closest('.row.msg');
  if (!row || e.target.closest('[data-act]')) return;
  heart(row, e.clientX, e.clientY);
});
els.thread.addEventListener('contextmenu', (e) => {
  const row = e.target.closest('.row.msg');
  if (!row || e.target.closest('a')) return;
  e.preventDefault();
  openMenu(row);
});
function heart(row, x, y) {
  const m = find(row.dataset.id);
  if (!m || m.pending || m.kind === 'system') return;
  getSelection && getSelection().removeAllRanges();
  if ((S.reactions[m.id] || {})[me.user] !== '❤️') D.react(m.id, '❤️').catch(() => toast('The heart didn\'t go through'));
  const b = document.createElement('span');
  b.className = 'burst'; b.textContent = '❤️';
  b.style.left = x + 'px'; b.style.top = y + 'px';
  ROOT.appendChild(b);
  setTimeout(() => b.remove(), 900);
  if (navigator.vibrate) navigator.vibrate(8);
  sfx.react();
}

// Touch gestures: swipe right to reply, swipe left to see times, hold for the menu, double tap for a heart.
let g = null, lastTap = { id: null, t: 0 };
els.thread.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse') return;
  const row = e.target.closest('.row.msg');
  g = { x: e.clientX, y: e.clientY, row, mode: null, t0: performance.now(), buzzed: false };
  if (row && !e.target.closest('[data-act]')) {
    g.press = setTimeout(() => {
      if (g && !g.mode) { g.mode = 'press'; if (navigator.vibrate) navigator.vibrate(10); openMenu(row); }
    }, 430);
  }
});
els.thread.addEventListener('pointermove', (e) => {
  if (!g || e.pointerType === 'mouse') return;
  const dx = e.clientX - g.x, dy = e.clientY - g.y;
  if (!g.mode) {
    if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { g.mode = 'scroll'; clearTimeout(g.press); return; }
    if (Math.abs(dx) > 12) { clearTimeout(g.press); g.mode = dx > 0 && g.row ? 'reply' : 'times'; }
    else return;
  }
  if (g.mode === 'reply') {
    const d = Math.min(Math.max(0, dx) * 0.55, 76);
    g.row.style.transform = `translateX(${d}px)`;
    const hint = g.row.querySelector('.swipe-hint');
    if (hint) { hint.style.opacity = Math.min(1, d / 56); hint.style.transform = `scale(${0.4 + Math.min(0.6, d / 90)})`; }
    if (d >= 56 && !g.buzzed) { g.buzzed = true; if (navigator.vibrate) navigator.vibrate(8); }
    g.dx = d;
  } else if (g.mode === 'times') {
    els.thread.classList.add('reveal'); els.thread.classList.remove('snap');
    els.thread.style.setProperty('--rx', Math.max(-64, Math.min(0, dx * 0.6)));
  }
});
function endGesture(e) {
  if (!g || (e && e.pointerType === 'mouse')) return;
  clearTimeout(g.press);
  if (g.mode === 'reply') {
    const row = g.row, m = find(row.dataset.id);
    row.style.transition = 'transform .3s var(--spring)';
    row.style.transform = '';
    const hint = row.querySelector('.swipe-hint'); if (hint) { hint.style.opacity = ''; hint.style.transform = ''; }
    setTimeout(() => { row.style.transition = ''; }, 320);
    if (g.dx >= 56 && m) startReply(m);
  } else if (g.mode === 'times') {
    els.thread.classList.add('snap');
    els.thread.style.setProperty('--rx', 0);
    setTimeout(() => els.thread.classList.remove('reveal', 'snap'), 320);
  } else if (!g.mode && g.row && e && e.type === 'pointerup' && performance.now() - g.t0 < 260 && !e.target.closest('[data-act]')) {
    const id = g.row.dataset.id, now = performance.now();
    if (lastTap.id === id && now - lastTap.t < 320) { heart(g.row, e.clientX, e.clientY); lastTap = { id: null, t: 0 }; }
    else lastTap = { id, t: now };
  }
  g = null;
}
els.thread.addEventListener('pointerup', endGesture);
els.thread.addEventListener('pointercancel', endGesture);

async function jumpTo(id, at) {
  if (!find(id)) {
    toast('Finding that message…', 1200);
    const ok = await D.ensureLoaded(id, at);
    if (!ok) { toast('That message isn\'t here any more'); return; }
  }
  const el = rowEls.get(id);
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
}

/* ---------------- the long-press menu ---------------- */
const menu = els.menu;
function closeMenu() { menu.hidden = true; $('#menu-lift').innerHTML = ''; }
menu.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeMenu(); });
addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) closeMenu(); });
function openMenu(row, { reactOnly = false } = {}) {
  const m = find(row.dataset.id);
  if (!m || m.kind === 'system') return;
  const mine = m.sender === me.user, myR = (S.reactions[m.id] || {})[me.user];
  const react = $('#menu-react'), list = $('#menu-list'), lift = $('#menu-lift');
  react.innerHTML = m.pending ? '' : L.QUICK_REACTIONS.map((em) => `<button type="button" data-emoji="${em}" class="${myR === em ? 'mine' : ''}" aria-label="React ${em}">${em}</button>`).join('')
    + '<button type="button" class="more" data-emoji="+" aria-label="More emoji">＋</button>';
  react.hidden = !!m.pending;
  const items = [];
  if (m.failed) items.push(['retry', 'Try again', 'retry']);
  if (!m.pending) items.push(['reply', 'Reply', 'reply']);
  if (m.kind === 'text') items.push(['copy', 'Copy', 'copy']);
  if (L.canEdit(m, me.user)) items.push(['edit', 'Edit', 'pencil']);
  if (mine) items.push(['unsend', 'Unsend', 'trash', 'danger']);
  list.innerHTML = reactOnly ? '' : items.map(([act, label, icon, cls]) => `<button type="button" role="menuitem" data-do="${act}" class="${cls || ''}">${label}${svg(icon)}</button>`).join('')
    + `<small>${escapeHtml(L.dividerLabel(Date.parse(m.created_at)))}${m.edited_at ? ' · edited' : ''}${m.vanish ? ' · vanish mode' : ''}</small>`;
  list.hidden = reactOnly;

  // Lift a copy of the message above the blur, with the reactions over it and the actions under it.
  const rr = row.getBoundingClientRect(), stack = row.querySelector('.stack').getBoundingClientRect();
  lift.innerHTML = '';
  const clone = row.cloneNode(true);
  clone.classList.remove('enter-mine', 'enter-theirs', 'flash');
  clone.style.transform = '';
  lift.appendChild(clone);
  menu.hidden = false;
  const listH = reactOnly ? 0 : list.offsetHeight, reactH = 56, gap = 8;
  let top = rr.top;
  const overflow = stack.bottom + gap + listH + 12 - innerHeight;
  if (overflow > 0) top -= overflow;
  if (top + (stack.top - rr.top) - reactH - gap < 8) top = 8 + reactH + gap - (stack.top - rr.top);
  const shift = top - rr.top;
  Object.assign(lift.style, { left: rr.left + 'px', top: top + 'px', width: rr.width + 'px' });
  const rw = react.offsetWidth || 340;
  const rLeft = mine ? Math.min(innerWidth - rw - 8, stack.right - rw) : Math.max(8, stack.left);
  Object.assign(react.style, { left: Math.max(8, Math.min(rLeft, innerWidth - rw - 8)) + 'px', top: stack.top + shift - reactH - gap + 'px' });
  const lw = list.offsetWidth || 200;
  Object.assign(list.style, { left: (mine ? Math.max(8, stack.right - lw) : Math.min(stack.left, innerWidth - lw - 8)) + 'px', top: stack.bottom + shift + gap + 'px' });

  react.onclick = (e) => {
    const b = e.target.closest('[data-emoji]'); if (!b) return;
    closeMenu();
    if (b.dataset.emoji === '+') { openPicker({ react: true, onEmoji: (em) => { D.react(m.id, em).catch(() => toast('That reaction didn\'t go through')); sfx.react(); } }); return; }
    D.react(m.id, b.dataset.emoji).catch(() => toast('That reaction didn\'t go through'));
    sfx.react();
  };
  list.onclick = (e) => {
    const b = e.target.closest('[data-do]'); if (!b) return;
    closeMenu();
    const what = b.dataset.do;
    if (what === 'reply') startReply(m);
    else if (what === 'retry') D.retry(m.id);
    else if (what === 'copy') navigator.clipboard.writeText(m.body).then(() => toast('Copied'), () => toast('Copying isn\'t allowed here'));
    else if (what === 'edit') startEdit(m);
    else if (what === 'unsend') {
      const el = rowEls.get(m.id);
      if (el && !reduced) el.classList.add('unsending');
      setTimeout(() => D.unsend(m.id).catch(() => { toast('Couldn\'t unsend. Check the connection.'); render(); }), reduced ? 0 : 220);
    }
  };
  const first = react.querySelector('button') || list.querySelector('button');
  if (first && !coarse) first.focus({ preventScroll: true });
}
// Who reacted with what; tap your own to take it back.
function openReactions(row, m) {
  const r = S.reactions[m.id] || {};
  openMenu(row, { reactOnly: true });
  const list = $('#menu-list');
  list.hidden = false;
  list.innerHTML = Object.entries(r).map(([who, em]) => `<button type="button" data-who-r="${escapeHtml(who)}">${em} ${escapeHtml(who === me.user ? 'You' : nameOf(who))}${who === me.user ? '<small style="border:0;padding:0">Tap to remove</small>' : ''}</button>`).join('');
  const stack = row.querySelector('.stack').getBoundingClientRect(), lift = $('#menu-lift').getBoundingClientRect(), rr = row.getBoundingClientRect();
  const shift = lift.top - rr.top;
  list.style.top = Math.min(innerHeight - list.offsetHeight - 8, stack.bottom + shift + 8) + 'px';
  list.style.left = (m.sender === me.user ? Math.max(8, stack.right - list.offsetWidth) : stack.left) + 'px';
  list.onclick = (e) => {
    const b = e.target.closest('[data-who-r]'); if (!b) return;
    closeMenu();
    if (b.dataset.whoR === me.user) D.react(m.id, r[me.user]).catch(() => {}); // same emoji again = remove
  };
}

/* ---------------- vanish mode: swipe up at the bottom ---------------- */
let pull = 0, wheelAcc = 0, wheelT = 0, touchY0 = null, atBottomSince = 0;
const PULL_PX = 130, WHEEL_PX = 650;
function setPull(p) {
  pull = Math.max(0, Math.min(1, p));
  els.pull.classList.toggle('show', pull > 0.05);
  els.pull.classList.toggle('ready', pull >= 1);
  els.pull.style.setProperty('--pull', pull);
  $('#vanish-pull-txt').textContent = pull >= 1 ? 'Release to ' + (S.state.vanish_on ? 'turn off' : 'turn on') + ' vanish mode'
    : (S.state.vanish_on ? 'Swipe up to turn off vanish mode' : 'Swipe up to turn on vanish mode');
  if (pull > 0.05 && nearBottom(200)) sc.scrollTop = sc.scrollHeight;
}
sc.addEventListener('touchstart', (e) => { touchY0 = nearBottom(4) ? e.touches[0].clientY : null; }, { passive: true });
sc.addEventListener('touchmove', (e) => {
  if (touchY0 === null) return;
  const dy = touchY0 - e.touches[0].clientY;
  if (dy <= 0) { setPull(0); return; }
  setPull(dy / PULL_PX);
}, { passive: true });
sc.addEventListener('touchend', () => {
  if (pull >= 1) toggleVanish();
  touchY0 = null; setPull(0);
});
sc.addEventListener('wheel', (e) => {
  if (e.deltaY <= 0 || !nearBottom(4) || !atBottomSince || performance.now() - atBottomSince < 450) { if (e.deltaY < 0) { wheelAcc = 0; setPull(0); } return; }
  wheelAcc += e.deltaY;
  setPull(wheelAcc / WHEEL_PX);
  clearTimeout(wheelT);
  wheelT = setTimeout(() => {
    if (pull >= 1) toggleVanish();
    wheelAcc = 0; setPull(0);
  }, 260);
}, { passive: true });
$('#btn-vanish-off').onclick = () => toggleVanish(false);
$('#vanish-switch').onclick = () => toggleVanish(!S.state.vanish_on);

function toggleVanish(on = !S.state.vanish_on) {
  if (on === !!S.state.vanish_on) return;
  if (navigator.vibrate) navigator.vibrate([10, 40, 10]);
  ink(on);
  S.state = { ...S.state, vanish_on: on };
  setTimeout(applyLook, reduced ? 0 : 320);
  D.setState({ vanish: on }).catch(() => { S.state = { ...S.state, vanish_on: !on }; applyLook(); toast('Vanish mode didn\'t change. Check the connection.'); });
}
let lastVanish = null;
function ink(on) {
  if (reduced) return;
  const d = document.createElement('div');
  d.className = 'ink' + (on ? '' : ' out');
  d.style.setProperty('--ink-s', Math.ceil((2 * Math.hypot(innerWidth, innerHeight)) / 40) + 1);
  ROOT.appendChild(d);
  setTimeout(() => d.classList.add('done'), 650);
  setTimeout(() => d.remove(), 1050);
}

/* ---------------- theme + vanish look ---------------- */
function applyLook() {
  const v = !!S.state.vanish_on;
  if (lastVanish !== null && lastVanish !== v && !document.querySelector('.ink')) ink(v); // the other person flipped it
  lastVanish = v;
  applyTheme(S.state.theme, v, ROOT, { page: shown });
  ROOT.classList.toggle('vanish', v);
  applyWall();
  $('#vanish-banner').hidden = !v;
  $('#vanish-switch').setAttribute('aria-checked', v);
  setPull(0);
}

// The wallpaper is shared; a photo wallpaper loads through a private link.
// A photo also colours the bubbles, as on Instagram: the colours are worked out from the photo itself
// (logic.mjs paletteFromPixels), so both phones get the same ones without saving anything. Picking a
// theme while a photo is up goes back to theme colours on this device; "From your photo" turns it back on.
let wallFor = '';
const palKey = (w) => 'dm-wall-pal:' + w, palOffKey = (w) => 'dm-wall-pal-off:' + w;
const photoColoursOn = (w) => !store.get(palOffKey(w), false);
function applyWall() {
  const w = String(S.state.wallpaper || 'dots'), kind = wallKind(w);
  ROOT.dataset.wall = kind;
  if (kind !== 'photo') { ROOT.style.removeProperty('--wall-img'); wallFor = ''; return; }
  const known = store.get(palKey(w), null);
  if (known && photoColoursOn(w) && !S.state.vanish_on) paintPalette(known);
  if (wallFor === w) return;
  wallFor = w;
  D.fileUrl('pics', w.slice(6)).then((url) => {
    if (!url || wallFor !== w) return;
    ROOT.style.setProperty('--wall-img', `url("${url}")`);
    if (!known) photoColours(url).then((p) => {
      store.set(palKey(w), p);
      if (wallFor === w && photoColoursOn(w) && !S.state.vanish_on) { paintPalette(p); if (!det.hidden) renderDetails(); }
    }).catch(() => { /* the photo can't be read: theme colours stay */ });
  });
}
// The photo, shrunk to 64×64, gives its colours.
function photoColours(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas'); c.width = c.height = 64;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(img, 0, 0, 64, 64);
        resolve(L.paletteFromPixels(g.getImageData(0, 0, 64, 64).data));
      } catch (e) { reject(e); }
    };
    img.onerror = reject;
    img.src = url;
  });
}
function paintPalette(p) {
  const r = ROOT.style, d = p.dark;
  p.mine.forEach((hex, i) => r.setProperty('--m' + (i + 1), hex));
  r.setProperty('--theirs', p.theirs); r.setProperty('--accent', p.accent); r.setProperty('--text', p.textTheirs);
  r.setProperty('--sub', d ? '#c9c0dc' : '#5f566f');
  r.setProperty('--chat-bg', d ? '#141020' : '#fbf8fd');
  r.setProperty('--sheet', d ? '#1d1830' : '#ffffff');
  r.setProperty('--line', d ? '#ffffff1c' : '#2b21401a');
  r.setProperty('--chip', d ? '#ffffff14' : '#2b214010');
  r.setProperty('--bar', d ? '#141020b3' : '#fbf8fdb8');
  ROOT.classList.toggle('dark', d);
}

// Wallpaper blur: 0 (clear) to 100% (24 px), just on this device.
function applyBlur(v = store.get('dm-wall-blur', 0)) {
  v = Math.max(0, Math.min(100, Math.round(+v || 0)));
  ROOT.style.setProperty('--wall-blur', v);
  $('#wall-blur').value = v;
  $('#wall-blur-val').textContent = v ? v + '%' : 'Clear';
  return v;
}
applyBlur();
$('#wall-blur').addEventListener('input', (e) => applyBlur(e.target.value));
$('#wall-blur').addEventListener('change', (e) => store.set('dm-wall-blur', applyBlur(e.target.value)));

// Bubble shape and text size: a per-device choice.
const look = Object.assign({ shape: 'round', size: 'm' }, store.get('dm-look', {}));
function applyBubbleLook() {
  ROOT.classList.toggle('bub-bouncy', look.shape === 'bouncy');
  ROOT.classList.remove('text-s', 'text-m', 'text-l'); ROOT.classList.add('text-' + look.size);
  document.querySelectorAll('[data-shape]').forEach((b) => b.setAttribute('aria-checked', b.dataset.shape === look.shape));
  document.querySelectorAll('[data-size]').forEach((b) => b.setAttribute('aria-checked', b.dataset.size === look.size));
}
applyBubbleLook();
$('#seg-shape').addEventListener('click', (e) => { const b = e.target.closest('[data-shape]'); if (!b) return; look.shape = b.dataset.shape; store.set('dm-look', look); applyBubbleLook(); });
$('#seg-size').addEventListener('click', (e) => { const b = e.target.closest('[data-size]'); if (!b) return; look.size = b.dataset.size; store.set('dm-look', look); applyBubbleLook(); });

/* ---------------- details panel ---------------- */
const det = els.details;
function openDetails() {
  renderDetails();
  det.hidden = false;
  requestAnimationFrame(() => det.classList.add('open'));
}
function closeDetails() { det.classList.remove('open'); setTimeout(() => { det.hidden = true; }, 300); }
$('#btn-info').onclick = openDetails;
$('#btn-peer').onclick = openDetails;
det.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeDetails(); });
addEventListener('keydown', (e) => { if (e.key === 'Escape' && !det.hidden && menu.hidden && !pickerOpen()) closeDetails(); });

function renderDetails() {
  const o = otherId();
  $('#d-face').dataset.who = o || ''; $('#d-face').innerHTML = o ? faceInner(o) : '';
  $('#d-name').textContent = o ? nameOf(o) : '';
  $('#d-real').textContent = o && nick(o) ? (S.players[o] || {}).name : '';
  const wall = String(S.state.wallpaper || ''), photoPal = wallKind(wall) === 'photo' && store.get(palKey(wall), null);
  const fromPhoto = !!photoPal && photoColoursOn(wall);
  $('#theme-grid').innerHTML = (photoPal ? `<button type="button" data-theme="from-photo" aria-pressed="${fromPhoto}"><span class="pv" style="--a:${photoPal.mine[0]};--b:${photoPal.mine[1]};--c:${photoPal.mine[2]};--bg:var(--wall-img) center / cover, ${photoPal.theirs};--th:${photoPal.theirs}"><i class="p1"></i><i class="p2"></i><i class="p3"></i></span>From your photo</button>` : '') + THEME_ORDER.map((k) => {
    const t = THEMES[k];
    return `<button type="button" data-theme="${k}" aria-pressed="${!fromPhoto && S.state.theme === k}"><span class="pv" style="--a:${t.mine[0]};--b:${t.mine[1]};--c:${t.mine[2]};--bg:${t.bg};--th:${t.theirs}"><i class="p1"></i><i class="p2"></i><i class="p3"></i></span>${t.name}</button>`;
  }).join('');
  const cur = wallKind(S.state.wallpaper);
  $('#wall-grid').innerHTML = Object.keys(WALLS).filter((k) => k !== 'photo' || cur === 'photo').map((k) =>
    `<button type="button" data-wallpick="${k}" aria-pressed="${cur === k}"><span class="wp" data-wall="${k}"${k === 'photo' ? ` style="background-image:var(--wall-img)"` : ''}><i class="p1"></i><i class="p2"></i></span>${k === 'photo' ? 'Your photo' : WALLS[k]}</button>`).join('');
  $('#nick-other-label').textContent = o ? `${(S.players[o] || {}).name || 'Their'}'s nickname` : 'Their nickname';
  const [fo, fm] = document.querySelectorAll('.nick');
  if (document.activeElement !== fo.querySelector('input')) fo.querySelector('input').value = (o && nick(o)) || '';
  if (document.activeElement !== fm.querySelector('input')) fm.querySelector('input').value = nick(me.user) || '';
  $('#d-my-face').dataset.who = me.user; $('#d-my-face').innerHTML = faceInner(me.user);
  const mode = (S.players[me.user] || {}).pic_mode || 'critter';
  document.querySelectorAll('[data-pic]').forEach((b) => b.setAttribute('aria-checked', b.dataset.pic === mode));
  $('#vanish-switch').setAttribute('aria-checked', !!S.state.vanish_on);
}
$('#theme-grid').addEventListener('click', (e) => {
  const b = e.target.closest('[data-theme]'); if (!b) return;
  const wall = String(S.state.wallpaper || ''), isPhoto = wallKind(wall) === 'photo';
  if (b.dataset.theme === 'from-photo') { store.del(palOffKey(wall)); applyLook(); renderDetails(); return; }
  if (isPhoto && photoColoursOn(wall)) { store.set(palOffKey(wall), true); if (b.dataset.theme === S.state.theme) { applyLook(); renderDetails(); return; } }
  if (b.dataset.theme === S.state.theme) return;
  const before = S.state.theme;
  S.state = { ...S.state, theme: b.dataset.theme };
  applyLook(); renderDetails();
  D.setState({ theme: b.dataset.theme }).catch(() => { S.state = { ...S.state, theme: before }; applyLook(); renderDetails(); toast('The theme didn\'t change. Check the connection.'); });
});
$('#wall-grid').addEventListener('click', (e) => {
  const b = e.target.closest('[data-wallpick]'); if (!b) return;
  const k = b.dataset.wallpick;
  if (k === 'photo' || k === wallKind(S.state.wallpaper)) return;
  D.setWall(k).catch(() => toast('The wallpaper didn\'t change. Check the connection.'));
});
$('#wall-file').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    toast('Uploading the wallpaper…', 5000);
    await D.setWallPhoto(await fitPhoto(file, 1600));
    toast('Wallpaper updated');
  } catch (err) { toast('That photo didn\'t upload. Try a different one.'); }
});
async function fitPhoto(file, max) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode'))), 'image/webp', 0.82));
}
document.querySelectorAll('.nick').forEach((f) => f.addEventListener('submit', (e) => {
  e.preventDefault();
  const id = f.dataset.for === 'me' ? me.user : otherId();
  const v = f.querySelector('input').value.trim();
  if ((nick(id) || '') === v) return;
  D.setState({ nickFor: id, nick: v }).then(() => toast(v ? 'Nickname saved' : 'Nickname cleared'), () => toast('The nickname didn\'t save. Check the connection.'));
}));
$('#seg-pic').addEventListener('click', (e) => {
  const b = e.target.closest('[data-pic]'); if (!b) return;
  if (b.dataset.pic === 'photo' && !(S.players[me.user] || {}).pic) { $('#pic-file').click(); return; }
  D.setPicMode(b.dataset.pic).catch(() => toast('That didn\'t save. Check the connection.'));
});
$('#pic-file').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    toast('Uploading your photo…', 4000);
    await D.setPhoto(await squarePhoto(file));
    toast('Profile picture updated');
  } catch (err) { toast('That photo didn\'t upload. Try a different one.'); }
});
async function squarePhoto(file, size = 256) {
  const bmp = await createImageBitmap(file);
  const c = document.createElement('canvas'); c.width = c.height = size;
  const s = Math.min(bmp.width, bmp.height);
  c.getContext('2d').drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, size, size);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode'))), 'image/webp', 0.86));
}

// Search: what's on this device first, then the whole history from the database.
let searchT = 0;
$('#d-search').addEventListener('input', (e) => {
  clearTimeout(searchT);
  const q = e.target.value.trim();
  const out = $('#search-results');
  if (q.length < 2) { out.innerHTML = ''; return; }
  const local = S.messages.filter((m) => m.kind === 'text' && m.body.toLowerCase().includes(q.toLowerCase())).reverse();
  showResults(local, q);
  searchT = setTimeout(() => D.search(q).then((server) => {
    const ids = new Set(local.map((m) => m.id));
    showResults([...local, ...server.filter((m) => !ids.has(m.id))].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)), q);
  }, () => {}), 350);
});
function showResults(list, q) {
  const out = $('#search-results');
  if (!list.length) { out.innerHTML = '<li><small>Nothing found.</small></li>'; return; }
  const mark = (s) => escapeHtml(s).replace(new RegExp(escapeHtml(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), (x) => `<mark>${x}</mark>`);
  out.innerHTML = list.slice(0, 40).map((m) => `<li><button type="button" data-jump="${escapeHtml(m.id)}" data-at="${escapeHtml(m.created_at)}"><small>${escapeHtml(m.sender === me.user ? 'You' : nameOf(m.sender))} · ${escapeHtml(L.dividerLabel(Date.parse(m.created_at)))}</small>${mark(m.body.length > 140 ? m.body.slice(0, 140) + '…' : m.body)}</button></li>`).join('');
}
$('#search-results').addEventListener('click', (e) => {
  const b = e.target.closest('[data-jump]'); if (!b) return;
  closeDetails();
  setTimeout(() => jumpTo(b.dataset.jump, b.dataset.at), 320);
});

/* ---------------- export: a .zip with every message and voice note ---------------- */
$('#btn-export').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  if (btn.disabled) return;
  btn.disabled = true;
  const label = btn.lastChild.textContent;
  btn.lastChild.textContent = 'Getting everything…';
  try {
    if (!window.JSZip) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
    const { messages, reactions } = await D.fetchAll();
    const data = L.exportChat({ messages, reactions, players: Object.values(S.players), nicknames: S.state.nicknames });
    const zip = new JSZip();
    const voice = messages.filter((m) => m.kind === 'voice' && !m.vanish && m.meta && m.meta.path);
    let n = 0;
    for (const m of voice) {
      btn.lastChild.textContent = `Voice notes ${++n}/${voice.length}…`;
      try { zip.file('voice/' + m.meta.path.split('/').pop(), await D.download('dm-voice', m.meta.path)); } catch (err) { /* a missing file is skipped */ }
    }
    zip.file('chat.json', JSON.stringify(data, null, 2));
    zip.file('chat.html', transcript(data));
    const blob = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `sweet-revenge-chat-${new Date().toISOString().slice(0, 10)}.zip`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    toast(`Downloaded ${data.messages.length} messages`);
  } catch (err) {
    toast('The download didn\'t finish. Check the connection and try again.');
  } finally { btn.disabled = false; btn.lastChild.textContent = label; }
});
function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
}
function transcript(data) {
  const line = (m) => {
    const when = new Date(m.at).toLocaleString();
    let body;
    if (m.kind === 'system') body = `<i>${escapeHtml(JSON.stringify(m.event))}</i>`;
    else if (m.kind === 'voice') body = m.voice_file ? `<audio controls preload="none" src="${escapeHtml(m.voice_file)}"></audio>` : 'Voice message';
    else if ((m.kind === 'gif' || m.kind === 'sticker') && m.media && m.media.url) body = `<img src="${escapeHtml(m.media.url)}" alt="${escapeHtml(m.media.title || m.kind)}" height="120">`;
    else if (m.kind === 'sticker') body = `[sticker: ${escapeHtml((m.media && m.media.text) || 'critter')}]`;
    else body = escapeHtml(m.text || '').replace(/\n/g, '<br>');
    const re = m.reactions ? ` <span class="r">${m.reactions.map((r) => escapeHtml(r.emoji)).join('')}</span>` : '';
    return `<p><small>${escapeHtml(when)}</small> <b>${escapeHtml(m.from)}</b>${m.edited_at ? ' <small>(edited)</small>' : ''}<br>${body}${re}</p>`;
  };
  return `<!doctype html><meta charset="utf-8"><title>Our chat</title><style>body{font:15px/1.45 system-ui,sans-serif;max-width:720px;margin:24px auto;padding:0 16px;color:#241c33}small{color:#7a7089}p{margin:0 0 14px}.r{font-size:13px}</style>
<h1>Our chat</h1><p><small>Exported ${escapeHtml(new Date(data.exported_at).toLocaleString())} · ${data.messages.length} messages</small></p>${data.messages.map(line).join('\n')}`;
}

/* ---------------- start ---------------- */
// The app shell calls this once (the chat can be loaded while another section is showing: show = false).
// Returns the controls the shell uses when you switch to and away from Chat.
let mounted = null;
export function mountChat(root = ROOT, { show = true } = {}) {
  if (root !== ROOT) throw new Error('mountChat: the chat markup must be #dm-root');
  shown = show;
  mounted = mounted || start();
  const api = {
    isShown: () => shown,
    // What Home's chat card shows: the last few messages, who's who, and whether they're here or typing.
    peek(n = 3) {
      const msgs = S.messages.filter((m) => m.kind !== 'system' && !(m.vanish && m.sender !== me.user)).slice(-n);
      return {
        messages: msgs.map((m) => ({ id: m.id, mine: m.sender === me.user, kind: m.kind, text: m.kind === 'text' || m.kind === 'like' ? m.body : L.preview(m) })),
        other: otherId(), name: nameOf(otherId()), online: S.online, typing: S.typing,
        status: L.activeLabel(S.other && S.other.last_seen, S.online), unread: L.unread(S.messages, me.user),
        look: { theme: S.state.theme, wall: wallKind(S.state.wallpaper) },
      };
    },
    // Quick reply from Home: the same send as the composer.
    sendText(body) {
      const text = String(body || '').trim();
      if (!text) return false;
      D.send('text', text, {}, null);
      sfx.send();
      return true;
    },
    show() {
      if (shown) return;
      shown = true;
      applyLook(); // the browser bar takes the chat's colour while it's on screen
      hiddenUnread = 0; setTitle();
      D.setHere(true);
      readIfLooking();
      if (!coarse) input.focus({ preventScroll: true });
    },
    // Leaving the chat for another section counts as leaving: vanish-mode messages go, presence and typing stop.
    hide() {
      if (!shown) return;
      shown = false;
      D.vanishSweepOnLeave(); render();
      D.sendTyping(false);
      D.setHere(false);
      if (rec || recInfo) cancelRec(); // the microphone stops with the chat
      closeMenu(); if (pickerOpen()) closePicker(); if (!det.hidden) closeDetails();
      input.blur(); document.body.classList.remove('typing');
    },
  };
  return mounted.then(() => api);
}

async function start() {
  if (!me) await loadMe();
  if (!me) return; // not logged in: the app shell shows the login screen
  document.body.classList.toggle('calm', !!store.get('sr-calm', false));
  hydrateIcons(ROOT);
  mountPicker(ROOT);
  const cached = D.loadCache();
  applyLook();
  renderHeader();
  if (cached) { render(); toBottom(false); }
  else els.older.hidden = false;
  goLive(cached); // the network part carries on by itself; the chat is already drawn from the device
}
async function goLive(cached) {
  D.connect();
  try { await D.refresh(); }
  catch (e) { if (!cached) toast('Can\'t reach the chat right now. Check the connection.', 4000); }
  els.older.hidden = true;
  applyLook();
  D.flushOutbox();
  readIfLooking();
  D.vanishSweep().catch(() => {});
  if (shown && !coarse) input.focus({ preventScroll: true });
}
