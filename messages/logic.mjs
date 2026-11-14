// Messages: the pure parts (no DOM, no network), so they can be tested in tests/messages.test.js.
// A message row looks like the dm_messages table:
//   { id, sender, kind, body, meta, reply_to, created_at, edited_at, vanish, seen_at }
// plus `pending` / `failed` on messages this browser is still sending.

export const EDIT_WINDOW_MS = 15 * 60 * 1000;
export const GROUP_GAP_MS = 5 * 60 * 1000;   // messages closer than this join one bubble group
export const DIVIDER_GAP_MS = 60 * 60 * 1000; // a time divider after an hour of quiet
export const QUICK_REACTIONS = ['❤️', '😂', '😮', '😢', '😡', '👍'];

const t = (m) => (typeof m.created_at === 'number' ? m.created_at : Date.parse(m.created_at));

// Sorted by time (ties by id so every browser agrees), without duplicates; later copies of an id win.
export function merge(list, incoming) {
  const byId = new Map(list.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, { ...byId.get(m.id), ...m });
  return [...byId.values()].sort((a, b) => t(a) - t(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// 1 to 3 emoji and nothing else → how many (shown big, like a sticker); otherwise 0.
const EMOJI_RE = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u{1F3FB}-\u{1F3FF}‍️⃣#*0-9])+$/u;
export function emojiOnly(text) {
  const s = String(text || '').replace(/\s+/g, '');
  if (!s || !EMOJI_RE.test(s) || !/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(s)) return 0;
  const n = typeof Intl !== 'undefined' && Intl.Segmenter
    ? [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(s)].length
    : [...s].length;
  return n <= 3 ? n : 0;
}

// Turns links in already-escaped text into <a> tags.
export function linkify(escaped) {
  return escaped.replace(/\b((?:https?:\/\/|www\.)[^\s<]+[^\s<.,;:!?)\]'"&])/gi, (url) => {
    const href = /^www\./i.test(url) ? 'https://' + url : url;
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">${url}</a>`;
  });
}

// The chat as rows to draw: time dividers, system lines and messages with their place in a group
// ('single' | 'first' | 'middle' | 'last'), which decides the bubble's corners.
export function buildRows(messages) {
  const rows = [];
  let prev = null, sawIg = false, igLine = false;
  for (const m of messages) {
    if (m.kind === 'doodle') continue; // drawn over the chat, not a bubble in it (app.js pins it)
    const at = t(m);
    // The old chats (Instagram, meta.ig; game rooms, meta.game) sit above one line, placed where this chat's own first message is.
    if (isOld(m)) sawIg = true;
    else if (sawIg && !igLine && !m.pending) { rows.push({ type: 'igline', key: 'igline' }); igLine = true; }
    if (!prev || at - t(prev) > DIVIDER_GAP_MS) rows.push({ type: 'divider', at, key: 'd' + m.id });
    if (m.kind === 'system') { rows.push({ type: 'system', m, key: m.id }); prev = m; continue; }
    rows.push({ type: 'msg', m, pos: 'single', key: m.id });
    prev = m;
  }
  // Second pass: neighbours from the same sender, close in time, with nothing between them, join up.
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.type !== 'msg') continue;
    const a = rows[i - 1], b = rows[i + 1];
    const joinsPrev = a && a.type === 'msg' && a.m.sender === r.m.sender && t(r.m) - t(a.m) <= GROUP_GAP_MS && !big(a.m) && !big(r.m);
    const joinsNext = b && b.type === 'msg' && b.m.sender === r.m.sender && t(b.m) - t(r.m) <= GROUP_GAP_MS && !big(b.m) && !big(r.m);
    r.pos = joinsPrev && joinsNext ? 'middle' : joinsPrev ? 'last' : joinsNext ? 'first' : 'single';
  }
  return rows;
}
// Imported from Instagram (14 Nov 2026): its photos, videos and voice notes live in the dm-archive bucket for good.
export const isIg = (m) => !!(m && m.meta && m.meta.ig);
// Copied in from an older chat: Instagram, or a game room's chat (meta.game, 12-13 Nov 2026).
export const isOld = (m) => isIg(m) || !!(m && m.meta && m.meta.imported);
export const GAME_NAMES = { snakes: 'Snakes & Ladders', plusfour: 'Plus Four', ludo: 'Ludo', doodle: 'Doodle Duel', sticky: 'Two Peas', sundae: 'Sundae' };
// "in Snakes & Ladders" under a message that was sent in a game room.
export const gameLabel = (m) => (m && m.meta && m.meta.game ? 'in ' + (GAME_NAMES[m.meta.game] || m.meta.game) : '');
// Which storage bucket a message's file is in.
export const bucketOf = (m) => (m.meta && m.meta.bucket) || (m.kind === 'photo' || m.kind === 'doodle' ? 'dm-once' : 'dm-voice');
// Stickers, GIFs, likes and big emoji stand alone instead of joining a bubble group.
function big(m) { return m.kind !== 'text' && m.kind !== 'voice' ? true : m.kind === 'text' && emojiOnly(m.body) > 0; }

// "Seen" goes under the newest message, only when it's mine and the other person has seen it.
export function seenTarget(messages, meId) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.kind === 'system' || m.kind === 'doodle') continue;
    if (m.sender !== meId) return null;
    if (m.pending || m.failed) return null;
    return m.seen_at ? { id: m.id, at: t({ created_at: m.seen_at }) } : null;
  }
  return null;
}

export const canEdit = (m, meId, now = Date.now()) =>
  !!m && m.sender === meId && m.kind === 'text' && !m.pending && now - t(m) < EDIT_WINDOW_MS;

// Messages from the other person that this browser hasn't marked seen yet.
export const unread = (messages, meId) => messages.filter((m) => m.sender !== meId && m.kind !== 'system' && !m.seen_at).length;

// Vanish-mode messages I've already seen disappear once I leave the chat.
export const vanishesOnLeave = (m, meId) => !!m.vanish && !!m.seen_at && m.sender !== meId;

// "Active now", "Active 5m ago", "Active 3h ago", "Active yesterday", "Active 4d ago".
export function activeLabel(lastSeen, online, now = Date.now()) {
  if (online) return 'Active now';
  if (!lastSeen) return '';
  const mins = Math.floor((now - (typeof lastSeen === 'number' ? lastSeen : Date.parse(lastSeen))) / 60000);
  if (mins < 2) return 'Active just now';
  if (mins < 60) return `Active ${mins}m ago`;
  if (mins < 24 * 60) return `Active ${Math.floor(mins / 60)}h ago`;
  if (mins < 48 * 60) return 'Active yesterday';
  if (mins < 7 * 24 * 60) return `Active ${Math.floor(mins / 1440)}d ago`;
  return '';
}

// "Seen", "Seen 4m ago", "Seen 2h ago", "Seen yesterday".
export function seenLabel(at, now = Date.now()) {
  const mins = Math.floor((now - at) / 60000);
  if (mins < 1) return 'Seen';
  if (mins < 60) return `Seen ${mins}m ago`;
  if (mins < 24 * 60) return `Seen ${Math.floor(mins / 60)}h ago`;
  if (mins < 48 * 60) return 'Seen yesterday';
  return `Seen ${Math.floor(mins / 1440)}d ago`;
}

// The time divider text: "Today 14:05", "Yesterday 21:30", "Monday 09:12", "3 Nov, 18:00", "3 Nov 2025, 18:00".
// Making a date formatter is slow, and the chat labels every divider on every redraw: keep them.
const FMT = new Map();
const fmt = (locale, opts) => {
  const k = (locale || '') + JSON.stringify(opts);
  let f = FMT.get(k);
  if (!f) FMT.set(k, (f = new Intl.DateTimeFormat(locale, opts)));
  return f;
};
export function dividerLabel(at, now = Date.now(), locale) {
  const d = new Date(at), n = new Date(now);
  const time = fmt(locale, { hour: 'numeric', minute: '2-digit' }).format(d);
  const day0 = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day0(n) - day0(d)) / 86400000);
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Yesterday ${time}`;
  if (days < 7) return `${fmt(locale, { weekday: 'long' }).format(d)} ${time}`;
  const opts = { day: 'numeric', month: 'short', ...(d.getFullYear() !== n.getFullYear() && { year: 'numeric' }) };
  return `${fmt(locale, opts).format(d)}, ${time}`;
}

// A voice note's waveform: `n` bars from 0 to 100, from raw samples (any array of numbers -1..1).
export function waveform(samples, n = 40) {
  const len = samples.length;
  if (!len) return new Array(n).fill(8);
  const bars = [];
  for (let i = 0; i < n; i++) {
    const from = Math.floor((i * len) / n), to = Math.max(from + 1, Math.floor(((i + 1) * len) / n));
    let peak = 0;
    for (let j = from; j < to && j < len; j++) peak = Math.max(peak, Math.abs(samples[j]));
    bars.push(peak);
  }
  const top = Math.max(...bars) || 1;
  return bars.map((b) => Math.max(8, Math.round((b / top) * 100)));
}

export function fmtDuration(sec) {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// A short preview of a message, for reply quotes and the home-screen banner.
export function preview(m) {
  if (!m) return 'Message unavailable';
  switch (m.kind) {
    case 'text': return m.body.length > 80 ? m.body.slice(0, 80) + '…' : m.body;
    case 'like': return '❤️';
    case 'sticker': return 'Sticker';
    case 'gif': return 'GIF';
    case 'voice': return `Voice message${m.meta && m.meta.dur ? ' · ' + fmtDuration(m.meta.dur) : ''}`;
    case 'photo': return 'Photo';
    case 'doodle': return 'Drew on the chat';
    case 'video': return `Video${m.meta && m.meta.dur ? ' · ' + fmtDuration(m.meta.dur) : ''}`;
    case 'share': return m.body ? (m.body.length > 80 ? m.body.slice(0, 80) + '…' : m.body) : shareLabel(m.meta);
    default: return '';
  }
}

// Photos: unlimited ones (views 0) show in the chat and are kept for good; view-once/twice ones count opens
// and are gone once the views are used. Returns { state: 'show'|'ready'|'sent'|'opened'|'gone', left }.
// Instagram's own player for a shared reel or post (stories can't be embedded): null when there is none.
export function igEmbed(url) {
  const m = /^https:\/\/(?:www\.)?instagram\.com\/(reels?|p|tv)\/([A-Za-z0-9_-]+)/.exec(String(url || ''));
  if (!m) return null;
  return `https://www.instagram.com/${m[1] === 'p' ? 'p' : m[1] === 'tv' ? 'tv' : 'reel'}/${m[2]}/embed/`;
}
// A shared Instagram reel/post/story: "Reel by @name".
export function shareLabel(meta = {}) {
  const what = { reel: 'Reel', post: 'Post', story: 'Story' }[meta.what] || 'Link';
  return meta.owner ? `${what} by @${meta.owner}` : what;
}

export function photoState(m, meId, now = Date.now()) {
  const meta = m.meta || {}, views = meta.views || 0, opens = meta.opens || 0;
  if (meta.ig) return { state: 'show', left: Infinity }; // the Instagram archive is kept for good
  if (meta.gone) return { state: 'gone', left: 0 };
  if (!views) return { state: 'show', left: Infinity };
  const left = Math.max(0, views - opens);
  if (m.sender === meId) return { state: opens ? 'opened' : 'sent', left };
  return left ? { state: 'ready', left } : { state: 'gone', left: 0 };
}

// The small grey line a theme / nickname / vanish change leaves. `name(id)` gives a display name.
// Chat wallpapers (synced for both people). 'photo' is someone's own picture.
export const WALLS = { dots: 'Dots', sprinkles: 'Sprinkles', hearts: 'Hearts', stars: 'Starry night', critters: 'Critters', doodles: 'Doodles', plain: 'Plain', photo: 'a photo' };
export const wallKind = (w) => (String(w || 'dots').startsWith('photo:') ? 'photo' : WALLS[w] ? w : 'dots');

export function systemText(m, meId, name, themeName = (k) => k) {
  const who = m.sender === meId ? 'You' : name(m.sender);
  const e = m.meta || {};
  if (e.event === 'theme') return `${who} changed the theme to ${themeName(e.value)}`;
  if (e.event === 'wall') return e.value === 'photo' ? `${who} set a photo as the wallpaper` : `${who} changed the wallpaper to ${WALLS[e.value] || e.value}`;
  if (e.event === 'ig') return e.bare ? e.text : `${who} ${e.text}`; // from the old Instagram chat
  if (e.event === 'vanish') return e.value ? `${who} turned on vanish mode` : `${who} turned off vanish mode`;
  if (e.event === 'nick') {
    const target = e.for === m.sender ? (m.sender === meId ? 'your' : 'their') : e.for === meId ? 'your' : `${name(e.for)}'s`;
    return e.value ? `${who} set ${target} nickname to ${e.value}` : `${who} cleared ${target} nickname`;
  }
  return '';
}

// Everything worth keeping, as plain JSON (vanish-mode messages are left out, as promised).
export function exportChat({ messages, reactions, players, nicknames = {} }, now = Date.now()) {
  const names = Object.fromEntries(players.map((p) => [p.id, p.name]));
  const byMsg = {};
  for (const r of reactions) (byMsg[r.message_id] = byMsg[r.message_id] || []).push({ from: names[r.player] || r.player, emoji: r.emoji });
  return {
    app: 'Sweet Revenge Messages',
    exported_at: new Date(now).toISOString(),
    people: players.map((p) => ({ id: p.id, name: p.name, nickname: nicknames[p.id] || null })),
    messages: messages.filter((m) => !m.vanish && !m.pending && (m.kind !== 'photo' || isIg(m))).map((m) => ({ // view-once photos are never kept
      id: m.id,
      at: new Date(t(m)).toISOString(),
      from: names[m.sender] || m.sender,
      kind: m.kind,
      ...(m.kind === 'system' ? { event: m.meta } : { text: m.body || preview(m) }),
      ...(m.kind === 'gif' || m.kind === 'sticker' || m.kind === 'share' ? { media: m.meta } : {}),
      ...((m.kind === 'photo' || m.kind === 'video' || m.kind === 'doodle') && m.meta && m.meta.path ? { file: m.meta.path } : {}),
      ...(m.kind === 'voice' ? { voice_file: m.meta && m.meta.path ? 'voice/' + m.meta.path.split('/').pop() : null, seconds: m.meta && m.meta.dur } : {}),
      ...(m.reply_to ? { reply_to: m.reply_to } : {}),
      ...(m.edited_at ? { edited_at: m.edited_at } : {}),
      ...(m.seen_at ? { seen_at: m.seen_at } : {}),
      ...(byMsg[m.id] ? { reactions: byMsg[m.id] } : {}),
    })),
  };
}

/* ---------------- colours from a photo wallpaper ----------------
   The page draws the photo at 64×64 and hands the RGBA pixels here. The same photo gives the same
   colours on both phones, so nothing needs saving in the database. */
const toHex = (rgb) => '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const fromHex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
function lum(rgb) {
  const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
  const [x, y] = [lum(fromHex(a)), lum(fromHex(b))].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
function hsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}
function rgbOf([h, s, l]) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
const hueGap = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };
// Nudges `bg` toward `toward` in 8% steps until `fg` reads on it at 4.5:1.
function readable(fg, bg, toward) {
  let c = fromHex(bg);
  for (let i = 0; i < 14 && contrast(fg, toHex(c)) < 4.5; i++) c = mix(c, toward, 0.08);
  return toHex(c);
}

// forceDark: the chat is always dark, so the photo's colours are fitted to a dark chat.
export function paletteFromPixels(data, { forceDark = false } = {}) {
  // Group the clearly coloured pixels by hue (12 slices); each slice's colour is the average of its
  // vivid pixels only, so a gradient doesn't wash out to grey.
  const buckets = new Map(), total = [0, 0, 0];
  let n = 0, lSum = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const rgb = [data[i], data[i + 1], data[i + 2]], [h, s, l] = hsl(rgb);
    rgb.forEach((v, j) => { total[j] += v; });
    n++; lSum += l;
    if (s < 0.25 || l < 0.15 || l > 0.85) continue;
    const k = Math.floor(h / 30);
    const b = buckets.get(k) || { n: 0, sum: [0, 0, 0], sat: 0 };
    b.n++; b.sat += s; rgb.forEach((v, j) => { b.sum[j] += v; });
    buckets.set(k, b);
  }
  const avg = n ? total.map((v) => v / n) : [128, 128, 128];
  const ranked = [...buckets.values()]
    // oranges and yellows turn brown once dark enough for white text, so they rank lower
    .map((b) => { const c = hsl(b.sum.map((v) => v / b.n)); return { hsl: c, score: b.n * (b.sat / b.n) * (c[0] >= 8 && c[0] <= 80 ? 0.45 : 1) }; })
    .sort((a, b) => b.score - a.score);
  const picked = [];
  for (const b of ranked) if (picked.length < 3 && picked.every((p) => hueGap(p[0], b.hsl[0]) >= 25)) picked.push(b.hsl);
  // A photo with fewer than three distinct colours: fill in with neighbours of its main hue.
  const base = picked[0] || (() => { const [h, s] = hsl(avg); return [s < 0.12 ? 265 : h, 0.55, 0.5]; })();
  const fills = [[base[0] - 30, base[1], base[2]], [base[0] + 30, base[1], base[2]], base];
  for (let i = 0; picked.length < 3; i++) picked.push([(fills[i][0] + 360) % 360, fills[i][1], fills[i][2]]);
  picked.sort((a, b) => a[0] - b[0]);
  // Bubble colours stay vivid: full-ish saturation, and only as dark as white text needs (4.5:1).
  const textMine = '#ffffff';
  const mine = picked.map(([h, s, l]) => {
    let c = [h, Math.max(s, 0.62), Math.min(0.58, Math.max(0.45, l))];
    // 5:1, not 4.5: the bubble gradient blends these, and a blend can land a little lighter than either end
    for (let i = 0; i < 24 && contrast(textMine, toHex(rgbOf(c))) < 5; i++) c = [c[0], c[1], c[2] - 0.025];
    return toHex(rgbOf(c));
  });
  const dark = forceDark || (n ? lSum / n < 0.4 : false);
  const textTheirs = dark ? '#f4f0fb' : '#241c33';
  const theirs = readable(textTheirs, toHex(mix(avg, dark ? [29, 24, 48] : [255, 255, 255], 0.7)), dark ? [0, 0, 0] : [255, 255, 255]);
  const accent = mine.reduce((a, b) => (hsl(fromHex(b))[1] > hsl(fromHex(a))[1] ? b : a));
  return { mine, theirs, accent, dark, textMine, textTheirs };
}

