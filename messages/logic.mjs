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
  let prev = null;
  for (const m of messages) {
    const at = t(m);
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
// Stickers, GIFs, likes and big emoji stand alone instead of joining a bubble group.
function big(m) { return m.kind !== 'text' && m.kind !== 'voice' ? true : m.kind === 'text' && emojiOnly(m.body) > 0; }

// "Seen" goes under the newest message, only when it's mine and the other person has seen it.
export function seenTarget(messages, meId) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.kind === 'system') continue;
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
export function dividerLabel(at, now = Date.now(), locale) {
  const d = new Date(at), n = new Date(now);
  const time = d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  const day0 = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day0(n) - day0(d)) / 86400000);
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Yesterday ${time}`;
  if (days < 7) return `${d.toLocaleDateString(locale, { weekday: 'long' })} ${time}`;
  const opts = { day: 'numeric', month: 'short', ...(d.getFullYear() !== n.getFullYear() && { year: 'numeric' }) };
  return `${d.toLocaleDateString(locale, opts)}, ${time}`;
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
    default: return '';
  }
}

// The small grey line a theme / nickname / vanish change leaves. `name(id)` gives a display name.
export function systemText(m, meId, name, themeName = (k) => k) {
  const who = m.sender === meId ? 'You' : name(m.sender);
  const e = m.meta || {};
  if (e.event === 'theme') return `${who} changed the theme to ${themeName(e.value)}`;
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
    messages: messages.filter((m) => !m.vanish && !m.pending).map((m) => ({
      id: m.id,
      at: new Date(t(m)).toISOString(),
      from: names[m.sender] || m.sender,
      kind: m.kind,
      ...(m.kind === 'system' ? { event: m.meta } : { text: m.body || preview(m) }),
      ...(m.kind === 'gif' || m.kind === 'sticker' ? { media: m.meta } : {}),
      ...(m.kind === 'voice' ? { voice_file: m.meta && m.meta.path ? 'voice/' + m.meta.path.split('/').pop() : null, seconds: m.meta && m.meta.dur } : {}),
      ...(m.reply_to ? { reply_to: m.reply_to } : {}),
      ...(m.edited_at ? { edited_at: m.edited_at } : {}),
      ...(m.seen_at ? { seen_at: m.seen_at } : {}),
      ...(byMsg[m.id] ? { reactions: byMsg[m.id] } : {}),
    })),
  };
}
