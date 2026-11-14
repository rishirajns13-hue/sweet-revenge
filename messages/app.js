// Messages: the private chat between the two friends. This file draws the chat and handles every
// gesture; data.js talks to the database, logic.mjs holds the tested pure parts.
// Needs the classic scripts loaded first: shared/core.js, shared/avatars.js, shared/sound.js.
import * as L from './logic.mjs?v=12';
const { WALLS, wallKind } = L;
import { THEMES, THEME_ORDER, themeName, applyTheme } from './themes.js?v=5';
import * as D from './data.js?v=15';
import * as V from './voice.js?v=8';
import { mountPicker, openPicker, closePicker, pickerOpen, stickerHTML } from './picker.js?v=5';
import { openDraw, closeDraw, drawing } from './draw.js?v=1';

const S = D.S;
// Everything the chat draws lives inside #dm-root, so its theme and classes never leak into the rest of the app.
const ROOT = document.getElementById('dm-root');
let shown = true; // false while the app shows another section (Home, Games…)
// Inside Chat there are two views, as on Instagram: the inbox (one row: the other person) and the
// conversation. Only the open conversation counts as "in the chat" (seen receipts, presence).
let view = 'inbox';
const inThread = () => shown && view === 'thread';
D.setHereFn(() => inThread() && !document.hidden);
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
  document.querySelectorAll('[data-who]').forEach((el) => setHTML(el, faceInner(el.dataset.who)));
}
// Only touch the page when the markup really changed: redrawing a critter restarts its blink and
// makes the browser lay the chat out again, and the header and inbox redraw on every update.
function setHTML(el, html) { if (el._html !== html) { el.innerHTML = html; el._html = html; } }
function setText(el, text) { if (el.textContent !== text) el.textContent = text; }
// Long nicknames ("PANCHARA KUNJUU💗🐒") shrink to fit their line instead of being cut off, down to 13px.
function fitName(el) {
  if (!el || !el.isConnected || !el.clientWidth) return;
  const key = el.textContent + '|' + el.clientWidth;
  if (el._fit === key) return;
  el.style.fontSize = '';
  let size = parseFloat(getComputedStyle(el).fontSize);
  while (el.scrollWidth > el.clientWidth + 1 && size > 13) { size -= 1; el.style.fontSize = size + 'px'; }
  el._fit = el.textContent + '|' + el.clientWidth;
}
function refitNames() { fitName(document.getElementById('peer-name')); fitName(document.getElementById('inbox-name')); }
addEventListener('resize', refitNames);
if (document.fonts) document.fonts.ready.then(() => { document.querySelectorAll('#peer-name, #inbox-name').forEach((el) => { el._fit = ''; }); refitNames(); });
const HM = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' });
const hm = (ts) => HM.format(new Date(ts));

/* ---------------- drawing the chat ---------------- */
const rowEls = new Map(); // row key → element
const popReacts = new Set();
let painted = false;

function sigOf(r) {
  if (r.type === 'pin') return 'p' + JSON.stringify([r.m.meta, !!r.m._url, r.lost, !!r.m.pending]);
  if (r.type === 'divider') return 'd' + L.dividerLabel(r.at);
  if (r.type === 'igline') return 'ig';
  if (r.type === 'seen') return 's' + L.seenLabel(r.at);
  if (r.type === 'system') return 'y' + L.systemText(r.m, me.user, realName, themeName);
  const m = r.m, q = m.reply_to ? S.messages.find((x) => x.id === m.reply_to) : null;
  return JSON.stringify([r.pos, m.kind, m.body, m.edited_at, !!m.pending, !!m.failed, m.vanish, m.meta, m.reply_to && (q ? L.preview(q) + q.sender : '?'),
    S.reactions[m.id], nameOf(m.sender), nameOf(otherId()), openReels.has(m.id)]);
}

function render({ enter } = {}) {
  const rows = L.buildRows(S.messages);
  const seen = S.hasNewer ? null : L.seenTarget(S.messages, me.user); // a window back in time has no 'Seen'
  const want = [], pins = new Map(), ids = new Set(rows.map((r) => r.key));
  // Drawings sit over the chat: each is pinned just above the message that was under its top edge.
  for (const r of rows) if (r.type === 'msg' && r.m.kind === 'doodle' && r.m.meta && (r.m.meta.path || r.m._url)) {
    const at = ids.has(r.m.meta.anchor) ? r.m.meta.anchor : r.m.id;
    if (!pins.has(at)) pins.set(at, []);
    pins.get(at).push({ type: 'pin', key: 'pin:' + r.m.id, m: r.m, lost: at === r.m.id });
  }
  for (const r of rows) {
    if (pins.has(r.key)) want.push(...pins.get(r.key));
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
  hydratePhotos();
  renderHello();
  painted = true;
}

function paintRow(el, r) {
  if (r.type === 'pin') { paintPin(el, r); return; }
  if (r.type === 'divider') { el.className = 'divider'; el.textContent = L.dividerLabel(r.at); return; }
  if (r.type === 'igline') { el.className = 'igline'; el.innerHTML = '<span>Above: our old chats from Instagram and the games</span>'; return; }
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
    <div class="stack">${quoteHTML(m, mine)}<div class="bline">${bubbleHTML(m)}<div class="tools">
      <button type="button" data-act="reply" aria-label="Reply">${svg('reply')}</button>
      <button type="button" data-act="react" aria-label="React">${svg('smile')}</button>
      <button type="button" data-act="more" aria-label="More">${svg('more')}</button>
    </div></div>${reactsHTML(m)}${underHTML(m, r.pos)}</div>
    <span class="swipe-hint" aria-hidden="true">${svg('reply')}</span>
    <time class="side-time" datetime="${escapeHtml(m.created_at)}">${hm(m.created_at)}</time>`;
  el.title = coarse ? '' : L.dividerLabel(Date.parse(m.created_at));
}

function bubbleHTML(m) {
  switch (m.kind) {
    case 'like': return '<div class="bub like" aria-label="Heart">❤️</div>';
    case 'photo': return photoBubble(m);
    case 'doodle': return doodleBubble(m);
    case 'video': return videoBubble(m);
    case 'share': return shareBubble(m);
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
// Photos: unlimited ones show in the chat; once/twice ones are a "tap to view" pill until the views are used.
const CAM = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.8l1.4-2h4.6l1.4 2h1.8A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z"/><circle cx="12" cy="12.5" r="3.4"/></svg>';
function photoBubble(m) {
  const { state, left } = L.photoState(m, me.user), views = (m.meta && m.meta.views) || 0;
  const kindLabel = views === 1 ? 'View once' : views === 2 ? 'View twice' : 'Photo';
  if (state === 'show') {
    const w = (m.meta && m.meta.w) || 4, h = (m.meta && m.meta.h) || 3;
    return `<div class="bub media photo-bub"><button type="button" class="ph-thumb" data-act="photo" aria-label="Open photo" style="aspect-ratio:${w} / ${h}"><img alt="" data-photo-img="${escapeHtml(m.id)}"${m._url ? ` src="${escapeHtml(m._url)}"` : ''}></button></div>`;
  }
  const line = state === 'ready' ? (left === 1 && views === 2 ? 'Tap to view · last view' : 'Tap to view')
    : state === 'sent' ? (m.pending ? 'Sending…' : 'Delivered') : state === 'opened' ? (left ? 'Opened once' : 'Opened') : 'No longer available';
  return `<div class="bub paint once-bub" data-state="${state}"><button type="button" class="once" data-act="photo"${state === 'ready' ? '' : ' disabled'}>${CAM}<span><b>${kindLabel}</b><small>${line}</small></span></button></div>`;
}
// A drawing on the chat: the ink itself is a pin over the messages; in the timeline it's a small note.
const PENCIL = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19l1.2-4.3L16.4 4.5a2 2 0 0 1 2.9 0l.2.2a2 2 0 0 1 0 2.9L9.3 17.8z"/><path d="M14.5 6.4l3.1 3.1"/></svg>';
function doodleBubble(m) {
  const who = m.sender === me.user ? 'You drew on the chat' : `${escapeHtml(firstName(m.sender))} drew on the chat`;
  return `<div class="bub paint doodle-bub"><button type="button" class="doodle-note" data-act="doodle">${PENCIL}<span><b>${who}</b><small>${m.pending ? 'Sending…' : 'Tap to see it'}</small></span></button></div>`;
}
function paintPin(el, r) {
  const m = r.m, d = m.meta || {}, tw = +d.tw || 360, w = +d.w || 100, h = +d.h || 100;
  el.className = 'dpin' + (r.lost ? ' lost' : '') + (m.pending ? ' pending' : '');
  el.dataset.pin = m.id;
  // Across screens: the same place across the chat's width, scaled with it (within reason); the same height from the message.
  el.style.cssText = `--xf:${+d.xf || 0};--wf:${w / tw};--w:${w};--ar:${w} / ${h};--dy:${r.lost ? -h - 6 : +d.dy || 0}`;
  el.innerHTML = `<img alt="" data-doodle-img="${escapeHtml(m.id)}"${m._url ? ` src="${escapeHtml(m._url)}"` : ''}>`;
}
// Videos (only in the Instagram archive so far): the browser's own player, loaded once drawn.
function videoBubble(m) {
  const w = (m.meta && m.meta.w) || 9, h = (m.meta && m.meta.h) || 16;
  return `<div class="bub media video-bub" style="aspect-ratio:${w} / ${h}"><video controls playsinline preload="metadata" data-video="${escapeHtml(m.id)}"></video></div>`;
}
// A shared reel, post or story: a card that opens it on Instagram (it works while the post is still up).
const IG_GLYPH = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r="1" fill="currentColor" stroke="none"/></svg>';
const openReels = new Set(); // reels/posts playing inline (tap the card again to close)
function shareBubble(m) {
  const meta = m.meta || {}, url = /^https:\/\/(www\.)?instagram\.com\//.test(meta.url || '') ? meta.url : '';
  const embed = L.igEmbed(url), open = !!embed && openReels.has(m.id);
  const hint = embed ? (open ? 'Tap to close' : '▶ Tap to play here') : url ? 'Open on Instagram' : 'Link unavailable';
  const card = `<span class="sc-ic">${IG_GLYPH}</span><span class="sc-txt"><b>${escapeHtml(L.shareLabel(meta))}</b>${meta.caption && !open ? `<small>${escapeHtml(meta.caption)}</small>` : ''}<em>${hint}</em></span>`;
  const head = embed ? `<button type="button" class="share-card" data-act="reel" aria-expanded="${open}">${card}</button>`
    : url ? `<a class="share-card" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${card}</a>` : `<span class="share-card">${card}</span>`;
  const player = open ? `<div class="reel-embed${meta.what === 'post' ? ' post' : ''}"><iframe src="${escapeHtml(embed)}" title="${escapeHtml(L.shareLabel(meta))}" loading="lazy" allow="autoplay; encrypted-media; picture-in-picture; clipboard-write" allowfullscreen></iframe><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Open on Instagram ↗</a></div>` : '';
  return `<div class="bub paint share-bub${open ? ' open' : ''}">${head}${player}${m.body ? `<p>${L.linkify(escapeHtml(m.body))}</p>` : ''}</div>`;
}
// Unlimited photos load their picture after they're drawn (a private link, kept a few days).
function hydratePhotos() {
  els.thread.querySelectorAll('video[data-video]:not([src])').forEach((v) => {
    const m = find(v.dataset.video);
    if (!m || !m.meta || !m.meta.path) return;
    v.setAttribute('src', '');
    D.fileUrl(L.bucketOf(m), m.meta.path).then((url) => { if (url) v.src = url + '#t=0.1'; }); // first frame
    // Pressing play swaps in the downloaded copy, which plays without stalling.
    v.addEventListener('play', async () => {
      if (v.dataset.local) return;
      v.pause(); v.dataset.local = '1';
      const bub = v.closest('.video-bub'); if (bub) bub.classList.add('loading');
      const local = await D.mediaUrl(L.bucketOf(m), m.meta.path);
      if (bub) bub.classList.remove('loading');
      if (local) { v.src = local; v.play().catch(() => {}); } else { delete v.dataset.local; toast('That video didn\'t load. Check the connection.'); }
    });
  });
  els.thread.querySelectorAll('img[data-doodle-img]:not([src])').forEach((img) => {
    const m = find(img.dataset.doodleImg);
    if (!m || !m.meta || !m.meta.path) return;
    img.setAttribute('src', '');
    D.mediaUrl(L.bucketOf(m), m.meta.path).then((url) => { if (url) img.src = url; });
  });
  els.thread.querySelectorAll('img[data-photo-img]:not([src])').forEach((img) => {
    const m = find(img.dataset.photoImg);
    if (!m || !m.meta || !m.meta.path) return;
    img.setAttribute('src', '');
    D.fileUrl(L.bucketOf(m), m.meta.path).then((url) => { if (url) img.src = url; else img.closest('.ph-thumb').classList.add('missing'); });
  });
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
function underHTML(m, pos) {
  const game = L.gameLabel(m); // once per group: under its last bubble
  if (game && (pos === 'single' || pos === 'last')) return `<span class="under">${escapeHtml(game)}</span>`;
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
  setHTML(els.hello, `<div class="faces"><span class="face xl" data-who="${escapeHtml(o)}">${faceInner(o)}</span><span class="face xl" data-who="${escapeHtml(me.user)}">${faceInner(me.user)}</span></div>
    <b>${escapeHtml(nameOf(o))}</b>${nicked ? `<small>${escapeHtml(realName)}</small>` : ''}<p>${escapeHtml(line)}</p>
    <div class="hi-acts">${real.length ? '' : '<button type="button" id="btn-wave">👋 Send a wave</button>'}<a class="hi-chip" href="#play">🎮 Play a game together</a></div>`);
  const wave = $('#btn-wave');
  if (wave) wave.onclick = () => sendItem({ kind: 'sticker', meta: { pack: 'critter', critter: myAvatar(), mood: 'cheer', text: 'hiii' } });
}

/* ---------------- header ---------------- */
function renderHeader() {
  const o = otherId();
  $('#peer-face').dataset.who = o || '';
  setHTML($('#peer-face'), o ? faceInner(o) : '');
  $('#typing-face').dataset.who = o || '';
  setHTML($('#typing-face'), o ? faceInner(o) : '');
  setText($('#peer-name'), o ? nameOf(o) : 'Messages'); fitName($('#peer-name'));
  $('#peer-dot').hidden = !S.online;
  const st = $('#peer-status');
  st.classList.toggle('typing', S.typing);
  setText(st, !navigator.onLine ? 'Offline. Messages send when you\'re back.'
    : S.typing ? 'typing…'
    : L.activeLabel(S.other && S.other.last_seen, S.online));
}
setInterval(() => { renderHeader(); if (painted) render(); }, 30000);

/* ---------------- scrolling ---------------- */
const sc = els.scroller;
const nearBottom = (px = 120) => sc.scrollHeight - sc.scrollTop - sc.clientHeight < px;
function toBottom(smooth) {
  // A long way up, a smooth glide gets interrupted as rows settle (off-screen rows have estimated heights): snap,
  // then snap again once the rows just drawn have their real size.
  const far = sc.scrollHeight - sc.scrollTop - sc.clientHeight > sc.clientHeight * 3;
  if (smooth && !reduced && !far) { sc.scrollTo({ top: sc.scrollHeight, behavior: 'smooth' }); return; }
  sc.scrollTop = sc.scrollHeight;
  if (far) requestAnimationFrame(() => requestAnimationFrame(() => { sc.scrollTop = sc.scrollHeight; }));
}
let missed = 0;
const jumpCount = $('#jump-count');
function updateJump() {
  const show = S.hasNewer || !nearBottom(300);
  if (els.jump.hidden === show) els.jump.hidden = !show;
  if (!show) missed = 0;
  if (jumpCount.hidden !== !missed) jumpCount.hidden = !missed;
  setText(jumpCount, String(missed));
}
els.jump.onclick = () => {
  missed = 0;
  if (S.hasNewer) D.backToLatest().then(() => toBottom(false)).catch(() => toast('Couldn\'t load the latest messages. Check the connection.'));
  else toBottom(true);
};
sc.addEventListener('scroll', () => {
  updateJump();
  if (sc.scrollTop < 2500 && S.hasOlder && painted) loadOlder(); // early, so the next page is in before you reach the top
  if (S.hasNewer && painted && nearBottom(2500)) D.loadNewer(); // jumped back in time: newer pages as you scroll down
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
D.onData((what) => { if (what !== 'typing-local') renderInbox(); });
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
    case 'newer': render(); updateJump(); break;
    case 'jump': render(); updateJump(); break;
    case 'away': if (x.sender !== me.user && x.kind !== 'system') { missed++; updateJump(); } break;
    case 'state': applyLook(); render(); renderHeader(); renderInbox(); if (els.details.classList.contains('open')) renderDetails(); break;
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
const looking = () => inThread() && !document.hidden && document.hasFocus();
function readIfLooking() { if (looking()) D.markRead(); }
// The app shell owns the tab title (it shows the unread count everywhere); this just asks it to update.
function setTitle() { if (window.srSetTitle) window.srSetTitle(); else if (shown) document.title = (hiddenUnread ? `(${hiddenUnread}) ` : '') + 'Messages · Sweet Revenge'; }
addEventListener('focus', () => { readIfLooking(); D.setHere(inThread()); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    D.setHere(false);
    D.sendTyping(false);
    if (coarse && inThread()) D.vanishSweepOnLeave(); // on phones, switching away is leaving
  } else {
    hiddenUnread = 0; setTitle();
    D.setHere(inThread());
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
let sizedLen = 0;
function autosize() {
  // Measuring means collapsing the box first, which lays the whole chat out again. Typing on one
  // line never changes the height, so only measure when the text got shorter or outgrew the box.
  const len = input.value.length, grew = input.scrollHeight > input.clientHeight + 1;
  if (len >= sizedLen && !grew && input.style.height) { sizedLen = len; return; }
  sizedLen = len;
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

// The hover buttons (reply, react, more) live in the bubble's own line (.bline), so CSS keeps them level with it.
function nextVoiceButton(id) {
  const i = S.messages.findIndex((m) => m.id === id);
  const n = S.messages[i + 1];
  if (!n || n.kind !== 'voice' || n.sender !== S.messages[i].sender) return null;
  const el = voiceEl(n.id);
  return el && el.querySelector('.v-play');
}
function playVoice(m) {
  V.toggle(m.id, () => voiceEl(m.id), async () => m._url || find(m.id)._url || D.mediaUrl(L.bucketOf(m), m.meta.path), () => nextVoiceButton(m.id))
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
  else if (a === 'photo') { fromGallery = false; viewPhoto(m); }
  else if (a === 'doodle') showDoodle(m.id);
  else if (a === 'reel') { if (openReels.has(m.id)) openReels.delete(m.id); else openReels.add(m.id); render(); }
});

/* ---------------- the viewer: photos, and (from Details → Shared) videos and Instagram reels/posts ---------------- */
const viewer = document.createElement('div');
viewer.className = 'ph-view'; viewer.hidden = true;
viewer.innerHTML = `<img alt=""><video controls playsinline preload="metadata"></video><iframe title="Instagram" allow="autoplay; encrypted-media; picture-in-picture; clipboard-write" allowfullscreen></iframe><div class="ph-top"><span id="ph-note"></span><button type="button" class="ph-goto" id="ph-goto" hidden>Show in chat</button><button type="button" class="dm-icon" id="ph-close" aria-label="Close">${svg('x')}</button></div>`;
ROOT.appendChild(viewer);
let viewing = null, fromGallery = false; // opened from Details → Shared: offer "Show in chat"
function showViewer(kind) {
  viewer.dataset.kind = kind;
  $('#ph-goto').hidden = !fromGallery;
  viewer.hidden = false;
  requestAnimationFrame(() => viewer.classList.add('open'));
}
async function viewPhoto(m) {
  if (viewing) return;
  const st = L.photoState(m, me.user).state;
  if (st !== 'show' && st !== 'ready') return;
  viewing = { m };
  try {
    const got = await D.openPhoto(m);
    if (!got) { viewing = null; toast('That photo is no longer available'); render(); return; }
    viewing = { m, ...got };
    viewer.querySelector('img').src = got.url;
    const views = (m.meta && m.meta.views) || 0;
    $('#ph-note').textContent = !views || m.sender === me.user ? '' : got.last ? 'Last view. It disappears when you close it.' : '1 view left after this';
    showViewer('photo');
  } catch (e) { viewing = null; toast('The photo didn\'t open. Check the connection.'); }
}
async function viewVideo(m) {
  if (viewing || !m.meta || !m.meta.path) return;
  viewing = { m };
  const v = viewer.querySelector('video');
  $('#ph-note').textContent = 'Loading…';
  showViewer('video');
  const url = await D.mediaUrl(L.bucketOf(m), m.meta.path); // the whole file first: no stalls while playing
  if (!viewing || viewing.m !== m) return; // closed (or another opened) while loading
  if (!url) { closePhoto(); toast('That video didn\'t open. Check the connection.'); return; }
  v.src = url; $('#ph-note').textContent = '';
  v.play().catch(() => {});
}
// A reel or post in Instagram's own player; a story (no player) opens on Instagram instead.
function viewShare(m) {
  if (viewing) return;
  const embed = L.igEmbed(m.meta && m.meta.url);
  if (!embed) { if (m.meta && /^https:\/\//.test(m.meta.url || '')) window.open(m.meta.url, '_blank', 'noopener'); return; }
  viewing = { m };
  viewer.querySelector('iframe').src = embed;
  $('#ph-note').textContent = L.shareLabel(m.meta);
  showViewer('share');
}
function closePhoto() {
  if (!viewing) return;
  const v = viewing; viewing = null; fromGallery = false;
  viewer.classList.remove('open');
  const vid = viewer.querySelector('video'); vid.pause();
  setTimeout(() => {
    viewer.hidden = true;
    viewer.querySelector('img').removeAttribute('src'); vid.removeAttribute('src'); vid.load();
    viewer.querySelector('iframe').removeAttribute('src');
    if (v.url && v.url.startsWith('blob:') && v.url !== v.m._url) URL.revokeObjectURL(v.url);
  }, 220);
  if (v.last) D.finishPhoto(v.path); // the last allowed view: the file goes now
  render();
}
viewer.addEventListener('click', (e) => {
  if (e.target.closest('#ph-goto') && viewing) { const m = viewing.m; closePhoto(); showInChat(m); return; }
  if (e.target === viewer || e.target.closest('#ph-close')) closePhoto();
});
// Shared → the message in the chat (a window around it is loaded if it's far back).
function showInChat(m) {
  stopMgAudio(); closeDetails();
  setTimeout(() => jumpTo(m.id, m.created_at), 320);
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && viewing) { e.stopPropagation(); closePhoto(); } }, true);

/* ---------------- sending photos: paste, pick or drop; choose unlimited / once / twice ---------------- */
let tray = [], trayViews = 0;
function addPhotos(files) {
  const imgs = [...files].filter((f) => f && /^image\//.test(f.type)).slice(0, 10 - tray.length);
  if (!imgs.length) return false;
  for (const f of imgs) tray.push({ file: f, url: URL.createObjectURL(f) });
  renderTray();
  return true;
}
function renderTray() {
  $('#photo-tray').hidden = !tray.length;
  $('#pt-thumbs').innerHTML = tray.map((p, i) => `<span class="pt-thumb"><img src="${p.url}" alt=""><button type="button" data-drop="${i}" aria-label="Remove this photo">${svg('x')}</button></span>`).join('');
  document.querySelectorAll('#pt-mode [data-views]').forEach((b) => b.setAttribute('aria-checked', +b.dataset.views === trayViews));
  $('#pt-send').textContent = tray.length > 1 ? `Send ${tray.length}` : 'Send';
}
function clearTray() { tray.forEach((p) => URL.revokeObjectURL(p.url)); tray = []; trayViews = 0; renderTray(); }
async function sendTray() {
  const list = tray.slice(), views = trayViews;
  tray = []; trayViews = 0; renderTray();
  for (const p of list) {
    try {
      const blob = await fitPhoto(p.file, 1600), bmp = await createImageBitmap(blob);
      D.send('photo', '', { w: bmp.width, h: bmp.height, views }, ctx && ctx.type === 'reply' ? ctx.m.id : null, blob, views ? {} : { _url: URL.createObjectURL(blob) });
    } catch (e) { toast('One photo couldn\'t be read. Try another.'); }
    URL.revokeObjectURL(p.url);
  }
  clearCtx(); sfx.send();
}
$('#pt-thumbs').addEventListener('click', (e) => { const b = e.target.closest('[data-drop]'); if (!b) return; const [p] = tray.splice(+b.dataset.drop, 1); URL.revokeObjectURL(p.url); renderTray(); });
$('#pt-mode').addEventListener('click', (e) => { const b = e.target.closest('[data-views]'); if (!b) return; trayViews = +b.dataset.views; renderTray(); });
$('#pt-send').addEventListener('click', sendTray);
$('#pt-cancel').addEventListener('click', clearTray);
$('#btn-photo').addEventListener('click', () => $('#photo-file').click());

/* ---------------- drawing on the chat ---------------- */
let drawOpen = false;
$('#btn-draw').addEventListener('click', startDraw);
function startDraw() {
  if (drawing() || !inThread()) return;
  closeMenu(); if (pickerOpen()) closePicker();
  input.blur();
  drawOpen = true; els.app.classList.add('drawing'); syncLayers(); // the phone's tab bar steps aside first
  openDraw({ host: els.scroller, app: els.app, onSend: sendDoodle, onClose: () => { drawOpen = false; els.app.classList.remove('drawing'); syncLayers(); } });
}
// Where the drawing sat: the message under its top edge, how far below that message's top, and across the chat's width.
function sendDoodle({ blob, box }) {
  const tr = els.thread.getBoundingClientRect(), tw = Math.round(tr.width);
  const rows = [...els.thread.querySelectorAll(':scope > .row.msg[data-id]')].filter((el) => !el.classList.contains('pending'));
  let anchor = null;
  for (const el of rows) { const t = el.getBoundingClientRect().top; if (t <= box.y) anchor = el; else break; }
  if (!anchor) anchor = rows[0];
  const meta = {
    // measured from the top of the row's margin, which is where its pin starts
    anchor: anchor ? anchor.dataset.id : null, dy: Math.round(box.y - (anchor ? anchor.getBoundingClientRect().top - (parseFloat(getComputedStyle(anchor).marginTop) || 0) : tr.top)),
    xf: +((box.x - tr.left) / tw).toFixed(4), tw, w: Math.round(box.w), h: Math.round(box.h),
  };
  D.send('doodle', '', meta, null, blob, { _url: URL.createObjectURL(blob) });
}
// Tapping "drew on the chat" scrolls the drawing into view and makes it wiggle.
function showDoodle(id) {
  const pin = els.thread.querySelector(`.dpin[data-pin="${CSS.escape(id)}"] img`);
  if (!pin) return;
  const r = pin.getBoundingClientRect(), s = els.scroller.getBoundingClientRect();
  els.scroller.scrollBy({ top: r.top - s.top - Math.max(16, (s.height - r.height) / 2), behavior: reduced ? 'auto' : 'smooth' });
  pin.classList.remove('flash'); void pin.offsetWidth; pin.classList.add('flash');
}
$('#photo-file').addEventListener('change', (e) => { addPhotos(e.target.files); e.target.value = ''; });
// Pasting a photo anywhere in the open conversation (Ctrl+V, or paste on a phone) puts it in the tray.
document.addEventListener('paste', (e) => {
  if (!inThread() || !e.clipboardData) return;
  const t = e.target;
  if (t && t.closest && t.closest('input, textarea') && t !== input) return; // other fields keep their paste
  const files = [...(e.clipboardData.files || [])];
  if (!files.length && e.clipboardData.items) for (const it of e.clipboardData.items) if (it.kind === 'file') { const f = it.getAsFile(); if (f) files.push(f); }
  if (addPhotos(files)) e.preventDefault();
});
els.scroller.addEventListener('dragover', (e) => { if ([...(e.dataTransfer && e.dataTransfer.items || [])].some((i) => i.kind === 'file')) e.preventDefault(); });
els.scroller.addEventListener('drop', (e) => { if (e.dataTransfer && addPhotos(e.dataTransfer.files)) e.preventDefault(); });
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
    let ok = false;
    try { ok = await D.jumpAround(id, at); } catch (e) { /* below */ }
    if (!ok) { toast('That message isn\'t here any more'); return; }
  }
  const el = rowEls.get(id);
  if (!el) return;
  const r = el.getBoundingClientRect(), box = sc.getBoundingClientRect();
  const far = Math.abs(r.top - box.top) > box.height * 2;
  el.scrollIntoView({ block: 'center', behavior: reduced || far ? 'auto' : 'smooth' });
  if (far) requestAnimationFrame(() => requestAnimationFrame(() => el.scrollIntoView({ block: 'center' }))); // after rows settle
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
  D.setState({ vanish: on })
    // Turning it off clears what was seen in vanish mode, for both of you (as on Instagram).
    .then(() => { if (!on) return D.vanishSweep(false).then(() => D.refresh()); })
    .catch(() => { S.state = { ...S.state, vanish_on: !on }; applyLook(); toast('Vanish mode didn\'t change. Check the connection.'); });
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
const palKey = (w) => 'dm-wall-pal3:' + w, palOffKey = (w) => 'dm-wall-pal-off:' + w;
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
  openMedia(mgKind); // Shared: fresh each time Details opens
  det.hidden = false; ROOT.classList.add('details-open'); // a class, not :has(): :has() re-styled the whole chat on every change
  requestAnimationFrame(() => det.classList.add('open'));
}
// body.dm-layer while a full-screen layer of the chat is open (details, long-press menu, photo viewer, picker).
// The shell's CSS keys off this class; :has() rules there re-styled the whole page on every change in the chat.
const layerWatch = new MutationObserver(syncLayers);
function syncLayers() {
  const open = drawOpen || !det.hidden || !els.menu.hidden || !viewer.hidden || !!ROOT.querySelector(':scope > .picker.open');
  document.body.classList.toggle('dm-layer', open);
}
[det, els.menu, viewer].forEach((el) => layerWatch.observe(el, { attributes: true, attributeFilter: ['hidden'] }));
new MutationObserver((list) => list.forEach((m) => m.addedNodes.forEach((n) => {
  if (n.classList && n.classList.contains('picker')) layerWatch.observe(n, { attributes: true, attributeFilter: ['class'] });
}))).observe(ROOT, { childList: true });
/* ---------------- Details → Shared: every photo, video, voice message, reel and post, newest first ---------------- */
const MG_KINDS = [['photo', 'Photos'], ['video', 'Videos'], ['voice', 'Voice'], ['share', 'Reels & posts']];
const MG_FIRST = 9, MG_PAGE = 30;
let mgKind = 'photo', mgItems = [], mgDone = false, mgCounts = null, mgBusy = 0, mgAudio = null;
const mgGrid = $('#mg-grid');
function renderMediaTabs() {
  $('#mg-tabs').innerHTML = MG_KINDS.map(([k, label]) => `<button type="button" data-mg="${k}" aria-pressed="${k === mgKind}">${label}${mgCounts && mgCounts[k] != null ? `<b>${mgCounts[k].toLocaleString()}</b>` : ''}</button>`).join('');
}
function openMedia(kind) {
  mgKind = kind; mgItems = []; mgDone = false; stopMgAudio();
  mgGrid.innerHTML = ''; mgGrid.classList.toggle('list', kind === 'voice');
  renderMediaTabs();
  D.mediaCounts().then((c) => { mgCounts = c; renderMediaTabs(); }).catch(() => {});
  moreMedia(MG_FIRST);
}
async function moreMedia(n = MG_PAGE) {
  if (mgDone) return;
  const ticket = ++mgBusy, kind = mgKind;
  $('#mg-more').disabled = true;
  try {
    const rows = await D.media(kind, mgItems.length, n);
    if (ticket !== mgBusy || kind !== mgKind) return; // a tab changed meanwhile
    if (rows.length < n) mgDone = true;
    mgItems.push(...rows);
    mgGrid.insertAdjacentHTML('beforeend', rows.map(mediaTile).join(''));
    hydrateMedia();
  } catch (e) { if (ticket === mgBusy) toast('Couldn\'t load the shared media. Check the connection.'); }
  finally { if (ticket === mgBusy) { $('#mg-more').disabled = false; $('#mg-more').hidden = mgDone; $('#mg-empty').hidden = mgItems.length > 0 || !mgDone; } }
}
const mmss = (sec) => L.fmtDuration(sec || 0);
function mediaTile(m) {
  const id = escapeHtml(m.id), meta = m.meta || {};
  if (m.kind === 'photo') return `<button type="button" class="mg-t" data-mgid="${id}" aria-label="Photo"><img alt="" data-mgsrc></button>`;
  if (m.kind === 'video') return `<button type="button" class="mg-t vid" data-mgid="${id}" aria-label="Video"><video muted playsinline preload="metadata" data-mgsrc></video><span class="mg-badge">▶ ${mmss(meta.dur)}</span></button>`;
  if (m.kind === 'voice') {
    const wave = meta.wave || new Array(40).fill(30);
    return `<div class="mg-voice" data-mgid="${id}"><button type="button" class="pl" aria-label="Play voice message from ${escapeHtml(firstName(m.sender))}">${svg('play', 'ic-play')}${svg('pause', 'ic-pause')}</button><span class="wv">${wave.map((h) => `<i style="height:${Math.max(10, +h || 10)}%"></i>`).join('')}</span><small>${mmss(meta.dur)}</small><button type="button" class="mg-goto" data-mggoto aria-label="Show in chat">${svg('reply')}</button></div>`;
  }
  return `<button type="button" class="mg-t mg-reel" data-mgid="${id}" aria-label="${escapeHtml(L.shareLabel(meta))}"><span class="sc-ic">${IG_GLYPH}</span><b>${escapeHtml(meta.owner ? '@' + meta.owner : L.shareLabel(meta))}</b>${meta.caption || m.body ? `<small>${escapeHtml(meta.caption || m.body)}</small>` : ''}</button>`;
}
function hydrateMedia() {
  mgGrid.querySelectorAll('[data-mgsrc]').forEach((el) => {
    el.removeAttribute('data-mgsrc');
    const m = mgItems.find((x) => x.id === el.closest('[data-mgid]').dataset.mgid);
    if (!m || !m.meta || !m.meta.path) return;
    D.fileUrl(L.bucketOf(m), m.meta.path).then((url) => { if (url) el.src = el.tagName === 'VIDEO' ? url + '#t=0.5' : url; });
  });
}
function stopMgAudio() {
  if (mgAudio) { mgAudio.a.pause(); mgAudio = null; }
  mgGrid.querySelectorAll('.mg-voice.playing').forEach((b) => b.classList.remove('playing'));
}
async function playMgVoice(m, btn) {
  if (mgAudio && mgAudio.id === m.id) { stopMgAudio(); return; }
  stopMgAudio();
  btn.classList.add('loading');
  const url = await D.mediaUrl(L.bucketOf(m), m.meta.path);
  btn.classList.remove('loading');
  if (!url) { toast('That voice message couldn\'t play'); return; }
  if (mgAudio) return; // another note was started while this one loaded
  const a = new Audio(url);
  mgAudio = { id: m.id, a };
  btn.classList.add('playing');
  a.onended = () => { if (mgAudio && mgAudio.a === a) stopMgAudio(); };
  a.play().catch(() => { stopMgAudio(); toast('That voice message couldn\'t play'); });
}
$('#mg-tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-mg]'); if (b && b.dataset.mg !== mgKind) openMedia(b.dataset.mg); });
$('#mg-more').addEventListener('click', () => moreMedia());
mgGrid.addEventListener('click', (e) => {
  const b = e.target.closest('[data-mgid]'); if (!b) return;
  const m = mgItems.find((x) => x.id === b.dataset.mgid); if (!m) return;
  if (e.target.closest('[data-mggoto]')) { showInChat(m); return; }
  if (m.kind !== 'voice') fromGallery = true;
  if (m.kind === 'photo') viewPhoto(m);
  else if (m.kind === 'video') viewVideo(m);
  else if (m.kind === 'voice') playMgVoice(m, b);
  else viewShare(m);
});
function closeDetails() { stopMgAudio(); det.classList.remove('open'); setTimeout(() => { det.hidden = true; ROOT.classList.remove('details-open'); }, 300); }
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
      try { zip.file('voice/' + m.meta.path.split('/').pop(), await D.download(L.bucketOf(m), m.meta.path)); } catch (err) { /* a missing file is skipped */ }
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

/* ---------------- the inbox ---------------- */
let totals = { total: null, since: null };
function renderInbox() {
  const o = otherId();
  if (!o) return;
  const all = S.messages.filter((m) => m.kind !== 'system');
  const unread = L.unread(S.messages, me.user), last = all[all.length - 1];
  const fmtAgo = (t) => { const m = Math.max(0, Math.round((Date.now() - Date.parse(t)) / 60000)); return m < 1 ? 'now' : m < 60 ? m + 'm' : m < 1440 ? Math.round(m / 60) + 'h' : Math.round(m / 1440) + 'd'; };
  $('#inbox-face').dataset.who = o; setHTML($('#inbox-face'), faceInner(o));
  $('#inbox-online').hidden = !S.online;
  setText($('#inbox-name'), nameOf(o)); fitName($('#inbox-name'));
  const what = !last ? 'Say hi' : last.vanish && last.sender !== me.user ? 'Sent a message' : (last.sender === me.user ? 'You: ' : '') + L.preview(last);
  setText($('#inbox-line'), S.typing ? 'typing…'
    : unread ? `${unread > 9 ? '9+' : unread} new message${unread === 1 ? '' : 's'}${last ? ' · ' + fmtAgo(last.created_at) : ''}`
    : what + (last ? ' · ' + fmtAgo(last.created_at) : ''));
  $('#inbox-row').classList.toggle('unread', !!unread);
  $('#inbox-row').classList.toggle('active', view === 'thread');
  $('#inbox-dot').hidden = !unread;
  const total = totals.total ?? (S.hasOlder ? null : all.length), since = totals.since || (!S.hasOlder && all[0] && all[0].created_at);
  setText($('#inbox-total'), total == null ? '' : `${total.toLocaleString()} message${total === 1 ? '' : 's'}${since ? ' · since ' + new Date(since).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : ''}`);
  $('#inbox-reply-input').placeholder = S.state.vanish_on ? `Vanish mode · message ${firstName(o)}…` : `Message ${firstName(o)}…`;
}
async function loadTotals() {
  try { totals = await D.totals(); renderInbox(); } catch (e) { /* counts stay as loaded */ }
}
D.onData((what, m) => {
  if (totals.total == null) return;
  if ((what === 'arrived' || what === 'sent') && m && m.kind !== 'system') totals.total++;
  else if (what === 'removed') totals.total = Math.max(0, totals.total - 1);
});

// The conversation slides in over the inbox (phones) or opens beside it (laptops).
function setView(v) {
  view = v;
  ROOT.dataset.view = v;
  renderInbox();
  if (v === 'inbox' && totals.total != null) loadTotals(); // unsends and vanished messages lower the count
  requestAnimationFrame(refitNames); // a hidden header measured 0 wide
}
function openThread({ push = true } = {}) {
  if (view === 'thread') return;
  if (push && shown) { // a leftover entry (after a reload or Forward) is reused, so Back is always one tap
    if (history.state && history.state.dmThread) history.replaceState({ dmThread: true }, '', location.hash || '#chat');
    else history.pushState({ dmThread: true }, '', location.hash || '#chat');
  }
  setView('thread');
  applyLook();
  hiddenUnread = 0; setTitle();
  D.setHere(true);
  toBottom(false);
  readIfLooking();
  if (!coarse) input.focus({ preventScroll: true });
}
// Leaving the conversation counts as leaving it: vanish-mode messages go, presence and typing stop.
function leaveThread() {
  closeDraw();
  D.vanishSweepOnLeave(); render();
  D.sendTyping(false);
  D.setHere(false);
  if (rec || recInfo) cancelRec(); // the microphone stops with the chat
  closeMenu(); if (pickerOpen()) closePicker(); if (!det.hidden) closeDetails();
  input.blur(); document.body.classList.remove('typing');
}
function showInbox() {
  if (view === 'thread') leaveThread();
  setView('inbox');
}
// The inbox with a history entry still marked "conversation" (left over from before a reload or a Forward):
// mark it as the inbox, so the next Back goes where it should.
function tidyHistory() { if (history.state && history.state.dmThread) history.replaceState(null, '', location.hash || '#chat'); }
$('#inbox-row').addEventListener('click', () => openThread());
$('#btn-back').addEventListener('click', (e) => {
  e.preventDefault();
  if (history.state && history.state.dmThread) history.back(); else showInbox();
});
// The browser's Back from the conversation lands on the inbox; Forward reopens it.
addEventListener('popstate', (e) => {
  if (!shown) return;
  const want = e.state && e.state.dmThread ? 'thread' : 'inbox';
  if (want === 'inbox' && view === 'thread') showInbox();
  else if (want === 'thread' && view === 'inbox') openThread({ push: false });
});
$('#inbox-reply').addEventListener('submit', (e) => {
  e.preventDefault();
  const box = $('#inbox-reply-input'), text = box.value.trim();
  if (!text) return;
  D.send('text', text, {}, null); sfx.send();
  box.value = '';
});

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
      const all = S.messages.filter((m) => m.kind !== 'system');
      const msgs = all.filter((m) => !(m.vanish && m.sender !== me.user)).slice(-n);
      return {
        lastAt: all.length ? all[all.length - 1].created_at : null,
        total: S.hasOlder ? null : all.length, since: !S.hasOlder && all[0] ? all[0].created_at : null, // only when every message is loaded
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
    view: () => view,
    openThread: () => openThread(),
    showInbox: () => showInbox(),
    // Coming into Chat always lands on the inbox (the user doesn't want the conversation to open by itself).
    show() {
      const was = shown;
      shown = true;
      if (view === 'thread') showInbox(); else setView('inbox');
      tidyHistory();
      applyLook(); // the browser bar takes the chat's colour while it's on screen
      if (!was) { hiddenUnread = 0; setTitle(); }
    },
    // Leaving Chat for another section: if the conversation was open, that counts as leaving it.
    hide() {
      if (!shown) return;
      if (view === 'thread') leaveThread();
      shown = false;
      setView('inbox');
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
  setView('inbox');
  if (shown) tidyHistory();
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
  D.expirePhotos().catch(() => {}); // used-up view-once/twice photos whose file was missed
  loadTotals();
}
