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

// A conversation with one other player, shaped like a PeerJS DataConnection.
function makeLink(client, keys, myId, peerId, sendTopic) {
  const handlers = { data: [], close: [] };
  let chain = Promise.resolve(), lastSeen = Date.now();
  const link = {
    open: true, peerId,
    on(ev, fn) { handlers[ev].push(fn); },
    send(msg) {
      if (!link.open) return;
      chain = chain.then(() => seal(keys.key, { ...msg, from_: myId, to: peerId }))
        .then((p) => client.publish(sendTopic, p, { qos: 1 })).catch(() => {});
    },
    receive(m) {
      lastSeen = Date.now();
      if (m.t === 'ping') return;
      if (m.t === 'bye') return link.drop();
      handlers.data.forEach((fn) => fn(m));
    },
    drop() {
      if (!link.open) return;
      link.open = false;
      clearInterval(beat);
      handlers.close.forEach((fn) => fn());
    },
    close() { if (link.open) { link.send({ t: 'bye' }); link.drop(); } },
  };
  const beat = setInterval(() => {
    if (Date.now() - lastSeen > 15000) link.drop(); else link.send({ t: 'ping' });
  }, 4000);
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
    conn = makeLink(chosen.cl, keys, myId, chosen.from, hostTopic(keys, chosen.epoch));
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
