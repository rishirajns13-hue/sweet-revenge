'use strict';
/* Sweet Revenge history: saves typed chat, stickers and finished games to the database
   (the Neon Function in api/). Voice notes and emoji reactions are never sent.
   Needs shared/core.js (for `me`, the logged-in player and their login proof).

   Two ways in, so it works on every network:
   1. Direct: a plain HTTPS request to the API. Instant, and used whenever it works.
   2. Relay: some networks (Jio, for one) block *.neon.tech addresses. Then requests go, encrypted,
      through the same public MQTT relays the games already use, and the bridge (api/bridge.ts)
      answers. The bridge naps when nobody's around, so the first answer can take up to a minute.
   Fire and forget for saves: if neither works the game carries on and that bit just isn't saved. */
const RECORDS_URL = 'https://br-empty-shadow-a1673mbz-api.compute.c-1.ap-southeast-1.aws.neon.tech';

const records = (() => {
  const RELAY_TOPIC = 'sweetrevenge-relay/7c1e93b04fa25d68';
  const RELAY_BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt'];
  const MQTT_LIB = 'https://unpkg.com/mqtt@5.10.1/dist/mqtt.min.js';
  // The bridge's public key. Only the bridge holds the private half, so only it can read relayed requests.
  const BRIDGE_KEY = { kty: 'EC', crv: 'P-256', x: 'KvFH5XYiC9otXjgKAAXW1g3Af7fc7Fh-qJ9DxPOSQnM', y: '-wRCoq0xwu4dLtZJkjQEMbvC5dvS3QMjiCXabXDFZnE' };
  const te = new TextEncoder(), td = new TextDecoder();
  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const cid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  const hex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');

  let viaRelay = false;
  try { viaRelay = sessionStorage.getItem('sr-relay') === '1'; } catch (e) { /* storage blocked */ }

  /* ---------- relay connection (one per page, opened on first use) ---------- */
  let client = null;
  function loadMqtt() {
    if (typeof mqtt !== 'undefined') return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = MQTT_LIB; s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  function connect() {
    if (client) return client;
    client = loadMqtt().then(() => new Promise((resolve, reject) => {
      let i = 0;
      const tryNext = () => {
        if (i >= RELAY_BROKERS.length) { client = null; return reject(new Error('no relay')); }
        const cl = mqtt.connect(RELAY_BROKERS[i++], { connectTimeout: 8000, reconnectPeriod: 3000, clean: true, clientId: 'sr_' + hex(6) });
        const fail = () => { cl.end(true); tryNext(); };
        const t = setTimeout(fail, 9000);
        cl.once('connect', () => { clearTimeout(t); cl.off('error', fail); resolve(cl); });
        cl.once('error', () => { clearTimeout(t); fail(); });
      };
      tryNext();
    }));
    return client;
  }

  async function requestKey(epkPrivate, id) {
    const pub = await crypto.subtle.importKey('jwk', BRIDGE_KEY, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: pub }, epkPrivate, 256);
    const hk = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: te.encode(id), info: te.encode('sweet-revenge relay v1') },
      hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  // Send one request through the relay and wait for the bridge's answer (resending now and then,
  // in case the bridge was asleep and a relay dropped it). Resolves with the data, or null.
  async function relay(path, payload, waitMs) {
    const cl = await connect();
    const id = hex(16), eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const key = await requestKey(eph.privateKey, id), iv = crypto.getRandomValues(new Uint8Array(12));
    const { kty, crv, x, y } = await crypto.subtle.exportKey('jwk', eph.publicKey);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(JSON.stringify({ path, body: payload })));
    const wire = JSON.stringify({ id, epk: { kty, crv, x, y }, iv: b64(iv), ct: b64(ct) });
    const resTopic = `${RELAY_TOPIC}/res/${id}`;
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        clearInterval(resend); clearTimeout(giveUp);
        cl.off('message', onMsg); cl.unsubscribe(resTopic);
        resolve(v);
      };
      const onMsg = async (topic, msg) => {
        if (topic !== resTopic) return;
        try {
          const a = JSON.parse(msg.toString());
          const out = JSON.parse(td.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(a.iv) }, key, unb64(a.ct))));
          finish({ status: out.status, data: out.data });
        } catch (e) { /* not a valid answer */ }
      };
      cl.on('message', onMsg);
      const send = () => cl.publish(`${RELAY_TOPIC}/req`, wire, { qos: 1 });
      cl.subscribe(resTopic, { qos: 1 }, send);
      const resend = setInterval(send, 20000);
      const giveUp = setTimeout(() => finish(null), waitMs);
    });
  }

  /* ---------- one request, whichever way works ---------- */
  // Resolves { status, data } once the server answered, or null if it couldn't be reached.
  // text/plain keeps the direct request "simple": no CORS preflight, and keepalive works on page close.
  async function send(path, body, waitMs) {
    if (!me) return null;
    const payload = { ...body, user: me.user || me.name, proof: me.proof };
    if (!viaRelay) {
      try {
        const r = await fetch(RECORDS_URL + path, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(payload) });
        return { status: r.status, data: await r.json().catch(() => null) };
      } catch (e) {
        // The network can't reach the API (blocked or offline): use the relay for the rest of this visit.
        viaRelay = true;
        try { sessionStorage.setItem('sr-relay', '1'); } catch (err) { /* storage blocked */ }
      }
    }
    try { return await relay(path, payload, waitMs); } catch (e) { return null; }
  }
  async function post(path, body, waitMs = 90000) {
    const r = await send(path, body, waitMs);
    return r && r.status < 300 ? r.data : null;
  }

  /* ---------- outbox: saves wait on this device until the server has them ---------- */
  // Chat and finished games go in first and leave once the server answers (even with an error,
  // which won't get better by retrying). Anything left over, e.g. the tab closed on a slow relay,
  // is sent again the next time any page opens. The server ignores duplicates.
  const OUTBOX = 'sr-outbox';
  const readBox = () => { const b = store.get(OUTBOX, []); return Array.isArray(b) ? b : []; };
  function save(path, body) {
    const item = { id: cid(), path, body, at: Date.now() };
    store.set(OUTBOX, readBox().concat(item).slice(-60));
    deliver(item);
  }
  async function deliver(item) {
    const r = await send(item.path, item.body, 300000);
    if (r) store.set(OUTBOX, readBox().filter((x) => x.id !== item.id));
  }
  function flush() {
    const week = Date.now() - 7 * 864e5, box = readBox().filter((x) => x.at > week);
    store.set(OUTBOX, box);
    box.forEach((item, i) => setTimeout(() => deliver(item), i * 400));
  }
  // Once the login is loaded (core.js sets `me` shortly after the page starts), send any leftovers.
  const waitForMe = setInterval(() => { if (me) { clearInterval(waitForMe); flush(); } }, 1500);
  setTimeout(() => clearInterval(waitForMe), 60000);

  const sent = new Set();
  return {
    // A message this player just sent. `text` is the message, or the sticker's words.
    chat(game, room, kind, text) {
      if ((kind === 'chat' || kind === 'sticker') && text) save('/chat', { game, room: room || null, kind, body: String(text).slice(0, 300), cid: cid() });
    },
    /* A finished game, sent by every human player's browser; the server keeps the first copy.
       { kind, gid, room, practice, startedAt, players: [{ name, bot, place, score, team }],
         winners: [name], stats: { name: {...} }, hits: [{ kind: 'bonk'|'bomb', by: name, to: name, cards }] } */
    game(g) {
      const key = g.kind + ':' + g.gid;
      if (!g.gid || sent.has(key)) return;
      sent.add(key);
      save('/game', { game: g });
    },
    me: () => post('/me', {}),
    chatHistory: (room, limit) => post('/chat/history', { room, limit }),
    // How the last requests went: 'direct' or 'relay' (the hub shows this in its status popover).
    get route() { return viaRelay ? 'relay' : 'direct'; },
  };
})();
