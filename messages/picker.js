// The picker sheet: Emoji, GIFs and Stickers (GIPHY search + a critter sticker pack drawn from
// shared/avatars.js). Recently sent GIFs and stickers come first.
// GIPHY needs a key; it's public by nature on a static site (only good for searching GIPHY).
export const GIPHY_KEY = '';
const GIPHY = 'https://api.giphy.com/v1';
const EMOJI_PICKER = 'https://cdn.jsdelivr.net/npm/emoji-picker-element@1.26.3/index.js';

// Critter stickers: [mood, caption]. Each is drawn with a critter (by default the sender's own).
export const CRITTER_STICKERS = [
  ['happy', 'hiii'], ['cheer', 'YAYY'], ['smug', 'told u'], ['sulk', 'hmph'], ['sweat', 'oops'],
  ['happy', 'gm ☀️'], ['happy', 'gn 🌙'], ['sulk', 'miss u'], ['cheer', 'omg'], ['smug', 'lol'],
  ['sweat', 'brb'], ['cheer', 'ily'], ['sulk', 'bored'], ['smug', 'hehe'], ['happy', 'ok ok'], ['sweat', 'wait what'],
];

export function stickerHTML(meta) {
  if (meta.pack === 'critter') {
    const art = typeof avatarHTML === 'function' ? avatarHTML(meta.critter || '😎', meta.mood || 'happy') : '🙂';
    return `<span class="critter-sticker" data-mood="${esc(meta.mood || '')}"><span class="cs-art">${art}</span>${meta.text ? `<b class="cs-cap">${esc(meta.text)}</b>` : ''}</span>`;
  }
  return `<img class="gif-img" src="${esc(meta.url)}" width="${meta.w || 160}" height="${meta.h || 160}" alt="${esc(meta.title || 'Sticker')}" loading="lazy" decoding="async">`;
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

let sheet, body, tabs, searchBox, opts = {}, tab = 'gifs', searchT = 0, emojiLoaded = null;
const recent = () => store.get('dm-recent', []);
function remember(item) {
  const list = recent().filter((r) => JSON.stringify(r.meta) !== JSON.stringify(item.meta));
  list.unshift(item);
  store.set('dm-recent', list.slice(0, 24));
}

export function mountPicker(root) {
  sheet = document.createElement('div');
  sheet.className = 'picker';
  sheet.hidden = true;
  sheet.innerHTML = `
    <div class="picker-scrim" data-close></div>
    <div class="picker-panel" role="dialog" aria-label="Emoji, GIFs and stickers">
      <div class="picker-grab" aria-hidden="true"></div>
      <div class="picker-tabs" role="tablist">
        <button type="button" role="tab" data-tab="emoji">Emoji</button>
        <button type="button" role="tab" data-tab="gifs">GIFs</button>
        <button type="button" role="tab" data-tab="stickers">Stickers</button>
      </div>
      <label class="picker-search"><span class="sr-only">Search</span><input type="search" placeholder="Search GIPHY" autocomplete="off" enterkeyhint="search"></label>
      <div class="picker-body"></div>
    </div>`;
  root.appendChild(sheet);
  body = sheet.querySelector('.picker-body');
  tabs = sheet.querySelector('.picker-tabs');
  searchBox = sheet.querySelector('.picker-search input');
  sheet.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) return closePicker();
    const t = e.target.closest('[data-tab]');
    if (t) return show(t.dataset.tab);
    const it = e.target.closest('[data-item]');
    if (it) pick(JSON.parse(it.dataset.item));
  });
  searchBox.addEventListener('input', () => { clearTimeout(searchT); searchT = setTimeout(() => show(tab), 300); });
  searchBox.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePicker(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !sheet.hidden) closePicker(); });
}

// opts: { tab, react: bool, onEmoji(unicode), onPick({ kind: 'gif'|'sticker', meta }), critter: avatar key }
export function openPicker(o) {
  opts = o;
  sheet.classList.toggle('react-only', !!o.react);
  sheet.hidden = false;
  requestAnimationFrame(() => sheet.classList.add('open'));
  searchBox.value = '';
  show(o.react ? 'emoji' : o.tab || 'gifs');
}
export function closePicker() {
  if (!sheet || sheet.hidden) return;
  sheet.classList.remove('open');
  setTimeout(() => { sheet.hidden = true; }, 220);
  opts.onClose && opts.onClose();
}
export const pickerOpen = () => sheet && !sheet.hidden;

function pick(item) {
  remember(item);
  opts.onPick && opts.onPick(item);
  closePicker();
}

async function show(which) {
  tab = which;
  tabs.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === which));
  sheet.querySelector('.picker-search').hidden = which === 'emoji';
  searchBox.placeholder = which === 'stickers' ? 'Search stickers' : 'Search GIFs';
  const q = searchBox.value.trim();
  if (which === 'emoji') return showEmoji();
  if (which === 'stickers') {
    const mine = opts.critter || '😎';
    const critters = CRITTER_STICKERS.map(([mood, text]) => ({ kind: 'sticker', meta: { pack: 'critter', critter: mine, mood, text } }));
    const others = (typeof AVATAR_ART !== 'undefined' ? AVATAR_ART.order : []).filter((k) => k !== '🤖').slice(0, 12)
      .map((k, i) => ({ kind: 'sticker', meta: { pack: 'critter', critter: k, mood: ['cheer', 'happy', 'smug', 'sulk', 'sweat'][i % 5], text: '' } }));
    const rec = recent().filter((r) => r.kind === 'sticker');
    body.innerHTML = `${q ? '' : section('Recent', rec, 'stickers') + section('Your critter', critters, 'stickers') + section('Critter crew', others, 'stickers')}
      <div class="giphy-slot"></div>`;
    if (GIPHY_KEY) loadGiphy('stickers', q, body.querySelector('.giphy-slot'), q ? null : 'Trending stickers');
    return;
  }
  // GIFs
  const rec = recent().filter((r) => r.kind === 'gif');
  body.innerHTML = `${q ? '' : section('Recent', rec, 'gifs')}<div class="giphy-slot"></div>`;
  if (!GIPHY_KEY) {
    body.querySelector('.giphy-slot').innerHTML = '<p class="picker-note">GIF search turns on once a GIPHY key is added. Critter stickers work already.</p>';
    return;
  }
  loadGiphy('gifs', q, body.querySelector('.giphy-slot'), q ? null : 'Trending');
}

function section(title, items, kind) {
  if (!items.length) return '';
  return `<h4 class="picker-h">${title}</h4><div class="picker-grid ${kind}">${items.map(tile).join('')}</div>`;
}
function tile(item) {
  const data = esc(JSON.stringify(item));
  if (item.meta.pack === 'critter') return `<button type="button" class="pk-tile critter" data-item="${data}" aria-label="${esc(item.meta.text || 'Critter')} sticker">${stickerHTML(item.meta)}</button>`;
  const ratio = (item.meta.h || 1) / (item.meta.w || 1);
  return `<button type="button" class="pk-tile" data-item="${data}" style="--r:${ratio.toFixed(3)}" aria-label="${esc(item.meta.title || item.kind)}"><img src="${esc(item.meta.preview || item.meta.url)}" alt="" loading="lazy" decoding="async"></button>`;
}

const giphyCache = new Map();
async function loadGiphy(kind, q, slot, title) {
  const url = `${GIPHY}/${kind}/${q ? 'search' : 'trending'}?api_key=${GIPHY_KEY}&limit=30&rating=pg-13${q ? '&q=' + encodeURIComponent(q) : ''}`;
  slot.innerHTML = '<p class="picker-note">Loading…</p>';
  try {
    let items = giphyCache.get(url);
    if (!items) {
      const r = await fetch(url);
      if (!r.ok) throw new Error('giphy ' + r.status);
      const j = await r.json();
      items = j.data.map((g) => {
        const im = g.images.fixed_width, sm = g.images.fixed_width_small || im;
        return { kind: kind === 'gifs' ? 'gif' : 'sticker', meta: { pack: 'giphy', id: g.id, url: im.webp || im.url, preview: sm.webp || sm.url, w: +im.width, h: +im.height, title: (g.title || '').slice(0, 60) } };
      });
      giphyCache.set(url, items);
    }
    if (tab !== (kind === 'gifs' ? 'gifs' : 'stickers')) return;
    slot.innerHTML = items.length
      ? `${title ? `<h4 class="picker-h">${title}</h4>` : ''}<div class="picker-grid ${kind} masonry">${items.map(tile).join('')}</div><p class="giphy-credit">Powered by GIPHY</p>`
      : `<p class="picker-note">No ${kind === 'gifs' ? 'GIFs' : 'stickers'} for “${esc(q)}”. Try another word.</p>`;
  } catch (e) {
    slot.innerHTML = '<p class="picker-note">GIPHY isn\'t answering. Check the connection and try again.</p>';
  }
}

async function showEmoji() {
  body.innerHTML = '<p class="picker-note">Loading emoji…</p>';
  try {
    emojiLoaded = emojiLoaded || import(EMOJI_PICKER);
    await emojiLoaded;
  } catch (e) {
    body.innerHTML = '<p class="picker-note">Emoji couldn\'t load. Your keyboard\'s emoji still work.</p>';
    return;
  }
  if (tab !== 'emoji') return;
  body.innerHTML = '';
  const el = document.createElement('emoji-picker');
  el.className = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  el.addEventListener('emoji-click', (e) => {
    opts.onEmoji && opts.onEmoji(e.detail.unicode);
    if (opts.react) closePicker();
  });
  body.appendChild(el);
}
