'use strict';
/* Sweet Revenge networking: rooms are encrypted conversations relayed by public MQTT brokers. */
/* ================= networking (encrypted messages via public MQTT brokers) =================
   Everyone connects *out* to a broker over secure WebSockets, so it works on any network
   (mobile data, CGNAT, office Wi-Fi). Topic and AES key are derived from the room code, so
   the broker only ever sees a hashed topic and ciphertext. The host's browser runs the game;
   guests send it their moves and chat, and it relays to everyone else. */
const BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt'];
const enc = new TextEncoder(), dec = new TextDecoder();
let clients = [];         // open MQTT clients
const randomId = () => [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('');

// ns keeps each game's rooms apart on the broker.
async function roomKeys(code, ns = 'ludoparty-rr7') {
  const topic = ns + '/' + (await sha256('topic:' + code)).slice(0, 32);
  const raw = await crypto.subtle.digest('SHA-256', enc.encode('key:' + code));
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { topic, key };
}
async function seal(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj))));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv); out.set(ct, 12);
  return out;
}
async function unseal(key, payload) {
  try {
    const buf = new Uint8Array(payload);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(0, 12) }, key, buf.slice(12));
    return JSON.parse(dec.decode(pt));
  } catch (e) { return null; }
}
function connectBroker(url) {
  const cl = mqtt.connect(url, { connectTimeout: 8000, reconnectPeriod: 2000, clean: true, clientId: 'lp_' + randomId() });
  clients.push(cl);
  return cl;
}
function firstBroker() {
  return new Promise((resolve, reject) => {
    let i = 0;
    const tryNext = () => {
      if (i >= BROKERS.length) return reject(new Error('no broker'));
      const cl = connectBroker(BROKERS[i++]);
      const t = setTimeout(() => { cl.end(true); tryNext(); }, 8000);
      cl.once('connect', () => { clearTimeout(t); resolve(cl); });
    };
    tryNext();
  });
}

/* A conversation with one other player, shaped like a PeerJS DataConnection.
   It starts on the broker, which is far away (every message makes two long trips). Then the guest
   (`dial`) tries a direct WebRTC connection, offered and answered through the broker. If one opens,
   messages go straight between the two browsers; if a network blocks it, everything stays on the
   broker. Messages are numbered, so switching paths never delivers them out of order. */
const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }];
const DIRECT_MAX = 60000; // bigger messages (voice notes) stay on the broker
function makeLink(client, keys, myId, peerId, sendTopic, { dial = false } = {}) {
  const handlers = { data: [], close: [] };
  let chain = Promise.resolve(), lastSeen = Date.now();
  let pc = null, dc = null, lastDirect = 0;
  let seqOut = 0, expect = 1, gapTimer = null;
  const held = new Map();
  const viaBroker = (msg) => {
    chain = chain.then(() => seal(keys.key, { ...msg, from_: myId, to: peerId }))
      .then((p) => client.publish(sendTopic, p, { qos: 1 })).catch(() => {});
  };
  const link = {
    open: true, peerId,
    get direct() { return !!(dc && dc.readyState === 'open'); },
    on(ev, fn) { handlers[ev].push(fn); },
    send(msg) {
      if (!link.open) return;
      const out = { ...msg, n: ++seqOut };
      if (link.direct) {
        const text = JSON.stringify(out);
        if (text.length < DIRECT_MAX) { try { dc.send(text); return; } catch (e) { /* fall back to the broker */ } }
      }
      viaBroker(out);
    },
    receive(m, direct = false) {
      lastSeen = Date.now();
      if (direct) lastDirect = lastSeen;
      if (m.t === 'ping') return;
      if (m.t === 'rtc') return onSignal(m);
      if (typeof m.n !== 'number') return deliver(m);
      // Hand messages over in the order they were sent, whichever path they took.
      if (m.n < expect) return;
      held.set(m.n, m);
      flush();
      clearTimeout(gapTimer);
      // A message that never turns up (it shouldn't) only holds the rest back for a moment.
      if (held.size) gapTimer = setTimeout(() => { expect = Math.min(...held.keys()); flush(); }, 1500);
    },
    drop() {
      if (!link.open) return;
      link.open = false;
      clearInterval(beat);
      clearTimeout(gapTimer);
      closeDirect();
      handlers.close.forEach((fn) => fn());
    },
    close() { if (link.open) { link.send({ t: 'bye' }); link.drop(); } },
  };
  function deliver(m) {
    if (m.t === 'bye') return link.drop();
    handlers.data.forEach((fn) => fn(m));
  }
  function flush() { while (held.has(expect)) { const next = held.get(expect); held.delete(expect); expect++; deliver(next); } }

  /* ---------- the direct connection ---------- */
  function useChannel(ch) {
    ch.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (err) { return; } link.receive(m, true); };
    ch.onclose = () => { if (dc === ch) dc = null; };
    const ready = () => { dc = ch; lastDirect = Date.now(); };
    if (ch.readyState === 'open') ready(); else ch.onopen = ready;
  }
  function closeDirect() {
    const old = pc;
    pc = null; dc = null;
    try { old && old.close(); } catch (e) { /* already closed */ }
  }
  // Wait until the browser has found its network addresses, so one message carries them all.
  const gathered = (conn) => new Promise((done) => {
    if (conn.iceGatheringState === 'complete') return done();
    const t = setTimeout(done, 2500);
    conn.addEventListener('icegatheringstatechange', () => { if (conn.iceGatheringState === 'complete') { clearTimeout(t); done(); } });
  });
  async function startDirect() {
    if (typeof RTCPeerConnection === 'undefined' || !link.open) return;
    try {
      closeDirect();
      const conn = pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      useChannel(conn.createDataChannel('game', { ordered: true }));
      await conn.setLocalDescription(await conn.createOffer());
      await gathered(conn);
      if (pc === conn && link.open) viaBroker({ t: 'rtc', sdp: conn.localDescription.toJSON() });
    } catch (e) { closeDirect(); }
  }
  async function onSignal(m) {
    if (!m.sdp || typeof m.sdp.sdp !== 'string') return;
    try {
      if (m.sdp.type === 'offer' && !dial) {
        closeDirect();
        const conn = pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        conn.ondatachannel = (e) => useChannel(e.channel);
        await conn.setRemoteDescription(m.sdp);
        await conn.setLocalDescription(await conn.createAnswer());
        await gathered(conn);
        if (pc === conn && link.open) viaBroker({ t: 'rtc', sdp: conn.localDescription.toJSON() });
      } else if (m.sdp.type === 'answer' && dial && pc && pc.signalingState === 'have-local-offer') {
        await pc.setRemoteDescription(m.sdp);
      }
    } catch (e) { closeDirect(); }
  }

  const beat = setInterval(() => {
    if (Date.now() - lastSeen > 15000) return link.drop();
    viaBroker({ t: 'ping' }); // the broker stays warm in case the direct path dies
    if (dc && dc.readyState === 'open') { try { dc.send('{"t":"ping"}'); } catch (e) { /* closing */ } }
    // A direct path that has gone quiet is dead (a network change): fall back, and the guest tries again.
    if (dc && Date.now() - lastDirect > 10000) { closeDirect(); if (dial) setTimeout(startDirect, 1000); }
  }, 4000);
  if (dial) setTimeout(startDirect, 300);
  return link;
}

// The first letter says which game the code is for (L = Ludo, D = Doodle Duel, P = Plus Four).
function genCode(prefix) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', a = new Uint8Array(5);
  crypto.getRandomValues(a);
  return prefix + [...a].map((b) => chars[b % chars.length]).join('');
}

/* ---------- generic room helpers (used by Doodle Duel) ----------
   `epoch` counts host handovers: each host listens on its own epoch's topics, so a host that
   dropped out and came back can't talk over the new one. `alive()` says whether the caller
   still wants this connection (it turns false after leaving the room). */
const hostTopic = (keys, e) => `${keys.topic}/h${e}`;
const guestTopic = (keys, e) => `${keys.topic}/g${e}`;

// Host: listen for players. onLink(link) is called once per new player, before their 'hello' arrives.
async function hostListen({ code, ns, epoch, alive, onLink }) {
  const keys = await roomKeys(code, ns);
  let client;
  try { client = await firstBroker(); } catch (e) { return false; }
  if (!alive()) return false;
  const hostId = randomId(), links = new Map();
  client.subscribe(hostTopic(keys, epoch), { qos: 1 });
  client.on('message', async (topic, payload) => {
    const m = await unseal(keys.key, payload);
    if (!m || !alive() || typeof m.from_ !== 'string' || (m.to && m.to !== hostId)) return;
    let link = links.get(m.from_);
    if (!link) {
      if (m.t !== 'hello') return;
      link = makeLink(client, keys, hostId, m.from_, guestTopic(keys, epoch));
      links.set(m.from_, link);
      link.on('close', () => links.delete(m.from_));
      onLink(link);
    }
    link.receive(m);
  });
  return true;
}

// Player: say hello on every epoch from minEpoch up, wait a moment after the first answer and
// connect to the newest host. onConnected(link, epoch) gets the link with its first messages queued.
async function knock({ code, ns, minEpoch = 0, hello, alive, onConnected }) {
  const keys = await roomKeys(code, ns);
  if (!alive()) return;
  const myId = randomId(), epochs = Array.from({ length: 6 }, (_, k) => minEpoch + k);
  let chosen = null, pickTimer = null, conn = null;
  const offers = [];
  const sayHello = async (cl) => {
    if (chosen || !alive()) return;
    const p = await seal(keys.key, { ...hello, t: 'hello', from_: myId });
    epochs.forEach((e) => cl.publish(hostTopic(keys, e), p, { qos: 1 }));
  };
  const pick = () => {
    if (chosen || !alive()) return;
    chosen = offers.reduce((a, b) => (b.epoch > a.epoch ? b : a));
    clients.filter((o) => o !== chosen.cl).forEach((o) => o.end(true));
    conn = makeLink(chosen.cl, keys, myId, chosen.from, hostTopic(keys, chosen.epoch), { dial: true });
    onConnected(conn, chosen.epoch);
    chosen.queue.forEach((m) => conn.receive(m));
  };
  for (const url of BROKERS) {
    const cl = connectBroker(url);
    let helloTimer;
    cl.on('connect', () => {
      cl.subscribe(epochs.map((e) => guestTopic(keys, e)), { qos: 1 }, () => {
        sayHello(cl);
        clearInterval(helloTimer);
        helloTimer = setInterval(() => (chosen || !alive() ? clearInterval(helloTimer) : sayHello(cl)), 3000);
      });
    });
    cl.on('message', async (topic, payload) => {
      const m = await unseal(keys.key, payload);
      if (!m || m.to !== myId || !alive()) return;
      const epoch = +topic.slice(topic.lastIndexOf('/g') + 2);
      if (chosen) {
        if (cl === chosen.cl && epoch === chosen.epoch && conn && m.from_ === conn.peerId) conn.receive(m);
        return;
      }
      let offer = offers.find((o) => o.cl === cl && o.epoch === epoch && o.from === m.from_);
      if (!offer) offers.push((offer = { cl, epoch, from: m.from_, queue: [] }));
      offer.queue.push(m);
      if (!pickTimer) pickTimer = setTimeout(pick, 1200);
    });
  }
}
// Close every broker connection (when leaving a room).
function closeAllClients() {
  const old = clients;
  clients = [];
  setTimeout(() => old.forEach((cl) => { try { cl.end(true); } catch (e) { /* already closed */ } }), 400);
}
