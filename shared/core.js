'use strict';
/* Sweet Revenge shared core: login, your look (avatar + colours), icons and little effects.
   Loaded first on every page; each page adds its own game script after it. */
const $ = (sel) => document.querySelector(sel);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ================= accounts =================
   Only sha256(proof) is stored, where proof = sha256(lower(name) + ':' + password).
   A joining friend must send the proof itself, which can't be derived from this file. */
const ACCOUNTS = {
  'panchara kunju': { name: 'Panchara Kunju', hash: '1c760216a90d9924ba7ea7afe921cce796b25e5a6e4ba08a27dcb8d39ddab814' },
  ammu: { name: 'Ammu', hash: 'be56b7ac72bc7a13c0c7134ac0275310dd0c56a004adc0975a72623c2cc35210' },
};
async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const makeProof = (user, pass) => sha256(user.trim().toLowerCase() + ':' + pass);
async function checkProof(user, proof) {
  const acc = typeof user === 'string' && ACCOUNTS[user.trim().toLowerCase()];
  return acc && typeof proof === 'string' && acc.hash === (await sha256(proof)) ? acc.name : null;
}

/* ================= icons (one stroke family, 24px grid) ================= */
const DOT = (x, y) => `<circle cx="${x}" cy="${y}" r="1.5" fill="currentColor" stroke="none"/>`;
const ICONS = {
  pencil: '<path d="M4 20l1-4L16 5l3 3L8 19z"/><path d="M14 7l3 3"/>',
  eraser: '<path d="M8 20h12"/><path d="M4.5 15.5l9-9a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L12 18H7z"/><path d="M9 11l5 5"/>',
  bucket: '<path d="M5 11l7-7 7 7-6.5 6.5a2 2 0 0 1-2.8 0L5 13.8a2 2 0 0 1 0-2.8z"/><path d="M5 11h14M20 15s2 2.5 2 3.5a2 2 0 0 1-4 0c0-1 2-3.5 2-3.5z"/>',
  undo: '<path d="M9 7L4 12l5 5"/><path d="M4 12h10a6 6 0 0 1 0 12h-2" transform="translate(0 -6)"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
  download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5"/><path d="M5 19h14"/>',
  users: '<circle cx="9" cy="9" r="3.5"/><path d="M3 19a6 6 0 0 1 12 0"/><path d="M15.5 5.5a3.5 3.5 0 0 1 0 7M18 19a6 6 0 0 0-2.5-4.9"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  dice: `<rect x="4" y="4" width="16" height="16" rx="4"/>${DOT(9, 9)}${DOT(15, 15)}${DOT(12, 12)}`,
  chat: '<path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H10l-5 4v-4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
  smile: `<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5s1.3 1.8 3.5 1.8 3.5-1.8 3.5-1.8"/>${DOT(9, 10)}${DOT(15, 10)}`,
  send: '<path d="M5 12l14-7-5 15-2.5-6z"/><path d="M11.5 14L19 5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  share: '<path d="M12 4v11M7.5 8.5L12 4l4.5 4.5"/><path d="M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  volume: '<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/>',
  mute: '<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M16.5 9.5l5 5M21.5 9.5l-5 5"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5.5a2.5 2.5 0 0 0 2.5 4M16 6h2.5a2.5 2.5 0 0 1-2.5 4M12 13v4M8.5 20h7M10 17h4"/>',
  crown: '<path d="M4 18L3 8l5 4 4-6 4 6 5-4-1 10z" fill="currentColor"/>',
  bot: `<rect x="5" y="8" width="14" height="11" rx="3.5"/><path d="M12 4.5V8M3 13v2M21 13v2"/>${DOT(9.5, 13)}${DOT(14.5, 13)}`,
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
};
const ic = (name) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]:not([data-iconed])').forEach((el) => {
    el.insertAdjacentHTML('afterbegin', ic(el.dataset.icon));
    el.dataset.iconed = '';
  });
}
function setIcon(el, name) { const svg = el.querySelector('svg.ic'); if (svg) svg.innerHTML = ICONS[name]; }

/* ================= your look: avatar + colours ================= */
const AVATARS = ['😎', '🥰', '🤓', '🤠', '😺', '🐼', '🦊', '👻', '🐸', '🦄', '🐯', '🐙'];
const PALETTES = [['sunset', 'Sunset'], ['lagoon', 'Lagoon'], ['lemonade', 'Lemonade']];
const THEME_COLOR = { sunset: '#8f6bff', lagoon: '#2ad0c1', lemonade: '#ffb03b' };
const store = {
  get(k, fallback) { try { const v = localStorage.getItem(k); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* storage blocked */ } },
};
const DEFAULT_AVATAR = { 'panchara kunju': '😎', ammu: '🥰' };
function myAvatar() {
  const name = me ? me.name.toLowerCase() : '';
  const a = store.get('ludo-avatar:' + name, null);
  return AVATARS.includes(a) ? a : DEFAULT_AVATAR[name] || '😎';
}
function applyPalette(p = store.get('ludo-palette', 'sunset')) {
  if (!PALETTES.some(([k]) => k === p)) p = 'sunset';
  document.body.className = document.body.className.replace(/\bpal-\S+/g, '').trim() + ` pal-${p}`;
  document.querySelector('meta[name="theme-color"]').content = THEME_COLOR[p];
  return p;
}
function renderMeSheet() {
  const mine = myAvatar(), pal = store.get('ludo-palette', 'sunset');
  const art = (a) => (typeof avatarHTML === 'function' ? avatarHTML(a) : a);
  $('#avatars').innerHTML = AVATARS.map((a) => `<button type="button" data-av="${a}" aria-pressed="${a === mine}" aria-label="Avatar ${typeof AVATAR_ART !== 'undefined' ? AVATAR_ART.name(a) : a}">${art(a)}</button>`).join('');
  $('#palettes').innerHTML = PALETTES.map(([k, label]) => `<button type="button" class="pal-${k}" data-pal="${k}" aria-pressed="${k === pal}"><span></span>${label}</button>`).join('');
}
/* ================= login session (shared by every page) ================= */
let me = null; // { name, proof, user }
const ME_KEY = 'ludo-me';
async function loadMe() {
  const saved = store.get(ME_KEY, null);
  if (!saved) return null;
  const name = await checkProof(saved.user || saved.name, saved.proof);
  if (!name) return null;
  me = { name, proof: saved.proof, user: saved.user };
  return me;
}
function saveMe(m) { me = m; store.set(ME_KEY, m); }
// Game pages call this first; without a valid login they send you to the front door.
async function requireLogin() {
  if (await loadMe()) return me;
  const page = location.pathname.split('/').pop() || 'index.html';
  const q = new URLSearchParams(location.search);
  q.set('next', page);
  location.replace('index.html?' + q);
  return new Promise(() => {});
}
function logout() { store.del(ME_KEY); me = null; location.href = 'index.html'; }

/* ================= little effects ================= */
function confetti(x, y, n = 30, spread = 220, palette = ['#ff5a5f', '#2bc48a', '#ffc233', '#4d9de0', '#fff', '#8f6bff']) {
  const fx = $('#fx');
  for (let k = 0; k < n; k++) {
    const p = document.createElement('i');
    p.className = 'confetti';
    p.style.left = x + 'px'; p.style.top = y + 'px';
    p.style.background = palette[k % palette.length];
    p.style.setProperty('--dx', (Math.random() - 0.5) * spread * 2 + 'px');
    p.style.setProperty('--dy', (Math.random() * 1.2 - 0.7) * spread + 'px');
    p.style.setProperty('--rot', Math.random() * 720 + 'deg');
    p.style.animationDuration = 0.9 + Math.random() * 0.8 + 's';
    fx.appendChild(p);
    setTimeout(() => p.remove(), 1800);
  }
}
function bigConfetti() {
  for (let k = 0; k < 5; k++) setTimeout(() => confetti(Math.random() * innerWidth, innerHeight * 0.3, 50, 320), k * 250);
}
let toastTimer;
function toast(msg, ms = 1900) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}
function retrigger(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
function centerOf(el) { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`); }

/* ================= profile sheet (avatar, colours, log out) ================= */
// Pages listen for 'profilechange' to redraw anything that shows your avatar.
function wireProfileSheet() {
  const sheet = $('#me-sheet');
  if (!sheet) return;
  const pop = () => typeof sfx !== 'undefined' && sfx.pop();
  $('#avatars').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || !me) return;
    store.set('ludo-avatar:' + me.name.toLowerCase(), b.dataset.av);
    renderMeSheet(); pop();
    document.dispatchEvent(new Event('profilechange'));
  });
  $('#palettes').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    store.set('ludo-palette', applyPalette(b.dataset.pal));
    renderMeSheet(); pop();
  });
  $('#btn-me').onclick = () => { renderMeSheet(); sheet.hidden = false; };
  $('#btn-me-close').onclick = () => { sheet.hidden = true; };
  $('#btn-logout').onclick = logout;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') sheet.hidden = true; });
}
