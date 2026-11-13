// Messages: everything that talks to Supabase or the device's storage.
// Uses the globals from shared/core.js: sb, me, store, SUPABASE_URL, SUPABASE_KEY.
//
// Speed, in order of what matters:
//  1. The last messages are cached on the device and drawn before any network call.
//  2. Sending shows the bubble at once; the database write happens behind it, and failed sends wait in
//     an outbox (kept with the cache) and are retried.
//  3. One realtime channel brings new messages, edits, reactions, seen receipts, typing and "active now".
import { merge } from './logic.mjs';

const CACHE_MAX = 400, WINDOW = 200, PAGE = 50;
const listeners = new Set();
const emit = (what, extra) => listeners.forEach((fn) => fn(what, extra));
export const onData = (fn) => listeners.add(fn);

export const S = {
  me: null, other: null,           // player rows: { id, name, avatar, last_seen, pic, pic_mode }
  players: {},                     // id → player row
  messages: [],                    // sorted, see logic.mjs
  reactions: {},                   // message id → { player id: emoji }
  state: { theme: 'candy', nicknames: {}, vanish_on: false, last_read: {} },
  online: false,                   // the other person has the chat open right now
  typing: false,                   // the other person is typing
  live: 'connecting',              // 'connecting' | 'live' | 'offline'
  hasOlder: true,
};

const key = () => 'dm-cache:' + me.user;
let saveT = 0;
function saveCache() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    const msgs = S.messages.slice(-CACHE_MAX).map(({ _url, ...m }) => m); // blob links die with the page
    const ids = new Set(msgs.map((m) => m.id));
    const reactions = Object.fromEntries(Object.entries(S.reactions).filter(([id]) => ids.has(id)));
    store.set(key(), { v: 1, messages: msgs, reactions, state: S.state, players: S.players });
  }, 250);
}

// Draws from the device straight away. Returns true if there was anything cached.
export function loadCache() {
  const c = store.get(key(), null);
  if (!c || c.v !== 1) return false;
  S.messages = c.messages || [];
  S.reactions = c.reactions || {};
  S.state = { ...S.state, ...(c.state || {}) };
  S.players = c.players || {};
  pickPeople();
  return true;
}
// The chat is between these two (the database refuses anyone else, see supabase/dm.sql).
export const PAIR = ['ammu', 'panchara kunju'];
function pickPeople() {
  S.me = S.players[me.user] || { id: me.user, name: me.name };
  const otherId = PAIR.find((id) => id !== me.user) || PAIR[0];
  S.other = S.players[otherId] || S.other || { id: otherId, name: otherId.replace(/\b\w/g, (c) => c.toUpperCase()) };
}

/* ---------------- loading ---------------- */
export async function refresh() {
  const [pl, st, ms] = await Promise.all([
    sb.from('players').select('id, name, avatar, last_seen, pic, pic_mode'),
    sb.from('dm_state').select('*').eq('id', 1).maybeSingle(),
    sb.from('dm_messages').select('*').order('created_at', { ascending: false }).limit(WINDOW),
  ]);
  if (pl.error || ms.error) throw pl.error || ms.error;
  S.players = Object.fromEntries(pl.data.map((p) => [p.id, p]));
  pickPeople();
  if (st.data) S.state = st.data;
  const fresh = ms.data.reverse();
  // Anything cached inside the fetched window that the server no longer has was unsent or vanished.
  const from = fresh.length === WINDOW ? Date.parse(fresh[0].created_at) : 0;
  const keep = new Set(fresh.map((m) => m.id));
  const gone = S.messages.filter((m) => !m.pending && !m.failed && Date.parse(m.created_at) >= from && !keep.has(m.id));
  gone.forEach(cleanupFiles);
  S.messages = merge(S.messages.filter((m) => !gone.includes(m)), fresh);
  S.hasOlder = fresh.length === WINDOW || S.messages.length > fresh.length;
  await loadReactions(fresh.map((m) => m.id), true);
  saveCache();
  emit('all');
}

async function loadReactions(ids, replace) {
  if (!ids.length) return;
  const { data, error } = await sb.from('dm_reactions').select('message_id, player, emoji').in('message_id', ids);
  if (error) return;
  if (replace) ids.forEach((id) => delete S.reactions[id]);
  for (const r of data) (S.reactions[r.message_id] = S.reactions[r.message_id] || {})[r.player] = r.emoji;
}

// Older messages, when scrolling up. Resolves with how many arrived.
let loadingOlder = null;
export function loadOlder() {
  if (loadingOlder || !S.hasOlder) return loadingOlder || Promise.resolve(0);
  const oldest = S.messages.find((m) => !m.pending);
  if (!oldest) return Promise.resolve(0);
  loadingOlder = (async () => {
    const { data, error } = await sb.from('dm_messages').select('*').lt('created_at', oldest.created_at)
      .order('created_at', { ascending: false }).limit(PAGE);
    if (error) return 0;
    S.hasOlder = data.length === PAGE;
    S.messages = merge(S.messages, data);
    await loadReactions(data.map((m) => m.id));
    emit('older', data.length);
    return data.length;
  })().finally(() => { loadingOlder = null; });
  return loadingOlder;
}

// Every message ever (for export and search), oldest first.
export async function fetchAll() {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('dm_messages').select('*').order('created_at').range(from, from + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) break;
  }
  const reactions = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('dm_reactions').select('*').range(from, from + 999);
    if (error) throw error;
    reactions.push(...data);
    if (data.length < 1000) break;
  }
  return { messages: out, reactions };
}

export async function search(q) {
  const { data, error } = await sb.from('dm_messages').select('id, sender, body, created_at, kind')
    .eq('kind', 'text').ilike('body', `%${q.replace(/[%_\\]/g, (c) => '\\' + c)}%`)
    .order('created_at', { ascending: false }).limit(40);
  if (error) throw error;
  return data;
}

// Loads older pages until the message is in memory (for jumping to a reply or a search result).
export async function ensureLoaded(id, at) {
  for (let i = 0; i < 40 && !S.messages.some((m) => m.id === id); i++) {
    const oldest = S.messages.find((m) => !m.pending);
    if (!S.hasOlder || (oldest && at && Date.parse(oldest.created_at) <= Date.parse(at))) break;
    if (!(await loadOlder())) break;
  }
  return S.messages.some((m) => m.id === id);
}

/* ---------------- sending (optimistic, with an outbox) ---------------- */
const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
  : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));
const blobs = new Map(); // id → voice recording still to upload (only while this page is open)

export function send(kind, body = '', meta = {}, replyTo = null, blob = null, local = {}) {
  const m = {
    ...local, id: uuid(), sender: me.user, kind, body, meta, reply_to: replyTo,
    created_at: new Date().toISOString(), edited_at: null, seen_at: null, vanish: !!S.state.vanish_on, pending: true,
  };
  if (blob) blobs.set(m.id, blob);
  S.messages = merge(S.messages, [m]);
  emit('sent', m);
  saveCache();
  deliver(m);
  return m;
}

const inFlight = new Set();
async function deliver(m) {
  if (inFlight.has(m.id)) return;
  inFlight.add(m.id);
  try {
    let meta = m.meta;
    if (m.kind === 'voice' && !meta.path) {
      const blob = blobs.get(m.id);
      if (!blob) throw new Error('recording lost');
      const ext = /mp4|aac/.test(blob.type) ? 'm4a' : /ogg/.test(blob.type) ? 'ogg' : 'webm';
      const path = `${me.uid}/${m.id}.${ext}`;
      const type = blob.type.split(';')[0] || 'audio/webm';
      const up = await sb.storage.from('dm-voice').upload(path, blob, { contentType: type, upsert: true });
      if (up.error) throw up.error;
      meta = { ...meta, path };
      patch(m.id, { meta });
    }
    const { data, error } = await sb.rpc('dm_send', { p_id: m.id, p_kind: m.kind, p_body: m.body, p_meta: meta, p_reply_to: m.reply_to });
    if (error) throw error;
    if (data) {
      const local = S.messages.find((x) => x.id === m.id);
      if (local && local._url) data._url = local._url; // keep playing the local copy of a voice note
      replace(m.id, { ...data, pending: false, failed: false });
    }
    blobs.delete(m.id);
  } catch (e) {
    patch(m.id, { failed: true });
  } finally {
    inFlight.delete(m.id);
  }
}
function patch(id, fields) {
  const i = S.messages.findIndex((m) => m.id === id);
  if (i < 0) return;
  S.messages[i] = { ...S.messages[i], ...fields };
  emit('msg', S.messages[i]);
  saveCache();
}
function replace(id, row) {
  const i = S.messages.findIndex((m) => m.id === id);
  if (i < 0) return;
  const { pending, failed, ...rest } = S.messages[i];
  S.messages[i] = { ...rest, ...row };
  delete S.messages[i].pending; delete S.messages[i].failed;
  S.messages = merge(S.messages, []); // the server's time might reorder it
  emit('msg', S.messages.find((m) => m.id === id));
  saveCache();
}
export function retry(id) {
  const m = S.messages.find((x) => x.id === id);
  if (!m) return;
  patch(id, { failed: false, pending: true });
  deliver(m);
}
// Pending sends left over from last time (the tab closed or the network dropped).
export function flushOutbox() {
  S.messages.filter((m) => m.pending || m.failed).forEach((m) => {
    if (m.kind === 'voice' && !m.meta.path && !blobs.has(m.id)) { drop(m.id); return; } // the recording didn't survive a reload
    if (m.pending) deliver(m);
  });
}
export function drop(id) {
  S.messages = S.messages.filter((m) => m.id !== id);
  blobs.delete(id);
  emit('all'); saveCache();
}

/* ---------------- the other actions ---------------- */
export async function edit(id, body) {
  const before = S.messages.find((m) => m.id === id);
  patch(id, { body, edited_at: new Date().toISOString() });
  const { data, error } = await sb.rpc('dm_edit', { p_id: id, p_body: body });
  if (error) { if (before) patch(id, { body: before.body, edited_at: before.edited_at }); throw error; }
  replace(id, data);
}

export async function unsend(id) {
  const m = S.messages.find((x) => x.id === id);
  if (!m) return;
  if (m.pending || m.failed) { drop(id); return; }
  S.messages = S.messages.filter((x) => x.id !== id);
  emit('all'); saveCache();
  const { data: path, error } = await sb.rpc('dm_unsend', { p_id: id });
  if (error) { S.messages = merge(S.messages, [m]); emit('all'); throw error; }
  if (path) sb.storage.from('dm-voice').remove([path]);
}

export async function react(id, emoji) {
  const prev = (S.reactions[id] || {})[me.user] || null;
  const next = emoji === prev ? null : emoji;
  setReaction(id, me.user, next);
  const { error } = await sb.rpc('dm_react', { p_id: id, p_emoji: next });
  if (error) { setReaction(id, me.user, prev); throw error; }
}
function setReaction(id, player, emoji) {
  const r = (S.reactions[id] = S.reactions[id] || {});
  if (emoji) r[player] = emoji; else delete r[player];
  emit('reaction', id);
  saveCache();
}

export async function setState(fields) {
  const { data, error } = await sb.rpc('dm_set', {
    p_theme: fields.theme ?? null, p_nick_for: fields.nickFor ?? null, p_nick: fields.nick ?? null, p_vanish: fields.vanish ?? null,
  });
  if (error) throw error;
  S.state = data; emit('state'); saveCache();
}

// Marks the other person's messages seen (only while the chat is on screen).
let readT = 0;
export function markRead() {
  const now = new Date().toISOString();
  let any = false;
  for (const m of S.messages) if (m.sender !== me.user && !m.seen_at && m.kind !== 'system') { m.seen_at = now; any = true; }
  if (!any) return;
  emit('seen');
  clearTimeout(readT);
  readT = setTimeout(() => sb.rpc('dm_read').then(() => {}), 250);
}

// Vanish mode: when I leave, the vanish messages I've seen are deleted. This must survive the page
// closing, so it's a plain keepalive request instead of supabase-js.
export function vanishSweepOnLeave() {
  if (!S.messages.some((m) => m.vanish && m.seen_at && m.sender !== me.user)) return;
  try {
    fetch(`${SUPABASE_URL}/rest/v1/rpc/dm_vanish_sweep`, {
      method: 'POST', keepalive: true,
      headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + me.proof, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_mine_only: true }),
    });
  } catch (e) { /* the next open sweeps instead */ }
  S.messages = S.messages.filter((m) => !(m.vanish && m.seen_at && m.sender !== me.user));
  saveCache();
}
export async function vanishSweep() {
  const { data } = await sb.rpc('dm_vanish_sweep', { p_mine_only: true });
  return data || [];
}

// When one of my voice notes disappears (vanished or unsent elsewhere), remove its file too.
function cleanupFiles(m) {
  if (m.sender === me.user && m.kind === 'voice' && m.meta && m.meta.path) sb.storage.from('dm-voice').remove([m.meta.path]).then(() => {});
}

/* ---------------- files: short-lived links to private voice notes and photos ---------------- */
const urlCache = store.get('dm-urls', {});
export async function fileUrl(bucket, path) {
  if (!path) return null;
  const k = bucket + ':' + path, hit = urlCache[k];
  if (hit && hit.exp > Date.now() + 3600e3) return hit.url;
  const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, 7 * 86400);
  if (error || !data) return null;
  urlCache[k] = { url: data.signedUrl, exp: Date.now() + 7 * 86400e3 };
  for (const [kk, v] of Object.entries(urlCache)) if (v.exp < Date.now()) delete urlCache[kk];
  store.set('dm-urls', urlCache);
  return data.signedUrl;
}
export async function download(bucket, path) {
  const { data, error } = await sb.storage.from(bucket).download(path);
  if (error) throw error;
  return data;
}

// A new profile photo: square, 256 px (webp where the browser can make it). Replaces the old file.
export async function setPhoto(blob) {
  const type = /png|jpeg/.test(blob.type) ? blob.type : 'image/webp'; // browsers that can't make webp give png
  const path = `${me.uid}/pic-${Date.now()}.${type.split('/')[1].replace('jpeg', 'jpg')}`;
  const up = await sb.storage.from('pics').upload(path, blob, { contentType: type });
  if (up.error) throw up.error;
  const old = S.me && S.me.pic;
  const { error } = await sb.rpc('set_pic', { p_path: path, p_mode: 'photo' });
  if (error) throw error;
  if (old && old !== path) sb.storage.from('pics').remove([old]).then(() => {});
  S.players[me.user] = { ...S.players[me.user], pic: path, pic_mode: 'photo' };
  pickPeople(); emit('people'); saveCache();
}
export async function setPicMode(mode) {
  const { error } = await sb.rpc('set_pic', { p_path: null, p_mode: mode });
  if (error) throw error;
  S.players[me.user] = { ...S.players[me.user], pic_mode: mode };
  pickPeople(); emit('people'); saveCache();
}

/* ---------------- live ---------------- */
let channel = null, typingOff = 0, lastTypingSent = 0, usePrivate = true;
export function connect() {
  if (channel) return;
  if (sb.realtime && sb.realtime.setAuth) sb.realtime.setAuth(me.proof);
  // Typing and "active now" go over a private channel only the two can join. If the server ever refuses
  // it, a plain channel still carries the database changes (those are checked against the table rules).
  channel = sb.channel(usePrivate ? 'dm' : 'dm-open', { config: { private: usePrivate, broadcast: { self: false }, presence: { key: me.user } } });
  channel
    .on('postgres_changes', { event: '*', schema: 'public', table: 'dm_messages' }, onMessageChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'dm_reactions' }, onReactionChange)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'dm_state' }, (e) => { S.state = e.new; emit('state'); saveCache(); })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'players' }, (e) => {
      if (!e.new || !S.players[e.new.id]) return;
      S.players[e.new.id] = { ...S.players[e.new.id], ...pickFields(e.new) };
      pickPeople(); emit('people'); saveCache();
    })
    .on('broadcast', { event: 'typing' }, ({ payload }) => {
      if (!payload || payload.who === me.user) return;
      S.typing = !!payload.on;
      clearTimeout(typingOff);
      if (S.typing) typingOff = setTimeout(() => { S.typing = false; emit('typing'); }, 6000);
      emit('typing');
    })
    .on('presence', { event: 'sync' }, () => {
      const st = channel.presenceState();
      const was = S.online;
      S.online = !!(S.other && st[S.other.id] && st[S.other.id].some((p) => p.here));
      if (!S.online) S.typing = false;
      if (was !== S.online) emit('presence');
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        S.live = 'live'; emit('live');
        await channel.track({ here: !document.hidden, at: Date.now() });
        refresh().catch(() => {}); // catch anything that happened while disconnected
      } else if (status === 'CHANNEL_ERROR' && usePrivate && S.live !== 'live') {
        usePrivate = false;
        const c = channel; channel = null; sb.removeChannel(c); connect();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        S.live = 'offline'; emit('live');
      }
    });
}
const pickFields = (p) => ({ id: p.id, name: p.name, avatar: p.avatar, last_seen: p.last_seen, pic: p.pic, pic_mode: p.pic_mode });

function onMessageChange(e) {
  if (e.eventType === 'DELETE') {
    const id = e.old && e.old.id;
    const m = S.messages.find((x) => x.id === id);
    if (!m) return;
    cleanupFiles(m);
    S.messages = S.messages.filter((x) => x.id !== id);
    delete S.reactions[id];
    emit('removed', id); saveCache();
    return;
  }
  const row = e.new;
  const had = S.messages.find((x) => x.id === row.id);
  if (had && had.pending) return; // my own send; deliver() settles it
  const fresh = !had;
  if (had && had._url) row._url = had._url;
  // My local "seen" mark shouldn't flicker back while the server catches up.
  if (had && had.seen_at && !row.seen_at) row.seen_at = had.seen_at;
  S.messages = merge(S.messages, [row]);
  if (fresh && row.sender !== me.user) { S.typing = false; emit('typing'); }
  emit(fresh ? 'arrived' : 'msg', row);
  saveCache();
}
function onReactionChange(e) {
  if (e.eventType === 'DELETE') {
    const o = e.old || {};
    if (o.message_id && S.reactions[o.message_id]) { delete S.reactions[o.message_id][o.player]; emit('reaction', o.message_id); }
  } else {
    const r = e.new;
    (S.reactions[r.message_id] = S.reactions[r.message_id] || {})[r.player] = r.emoji;
    emit('reaction', r.message_id);
    if (r.player !== me.user) emit('reacted', r);
  }
  saveCache();
}

export function sendTyping(on) {
  if (!channel || S.live !== 'live') return;
  const now = Date.now();
  if (on && now - lastTypingSent < 2500) return;
  lastTypingSent = on ? now : 0;
  channel.send({ type: 'broadcast', event: 'typing', payload: { who: me.user, on } });
}
export function setHere(here) {
  if (channel && S.live === 'live') channel.track({ here, at: Date.now() });
}
export function reconnect() {
  if (channel && S.live === 'offline') { sb.removeChannel(channel); channel = null; connect(); }
}
