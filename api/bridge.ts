// The relay bridge: lets players reach the API even on networks that block *.neon.tech addresses.
//
// Browsers that can't reach the API directly publish an encrypted request to the same public MQTT
// relays the games already use (they work on any network). This bridge connects out to those relays,
// decrypts each request, runs it through the normal API routes (app.fetch, so there's no second copy
// of any logic) and publishes the encrypted answer back.
//
// Waking: a Neon schedule trigger calls /relay-tick every minute. The bridge drains anything waiting,
// stays awake while requests keep coming, and naps after a few quiet minutes to stay within the
// free plan. While it naps, the relays hold new requests for it (a persistent MQTT session, QoS 1).
//
// Encryption (same scheme in shared/records.js): the browser makes a throwaway P-256 key, ECDH with
// the bridge's public key, HKDF-SHA256 (salt = request id, info = 'sweet-revenge relay v1') gives an
// AES-GCM key for that one request and its answer. Only the bridge can read requests.
import mqtt from 'mqtt';
import type { Hono } from 'hono';

export const RELAY_TOPIC = 'sweetrevenge-relay/7c1e93b04fa25d68';
const BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt'];
const PATHS = new Set(['/chat', '/chat/history', '/game', '/me']);
const FIRST_WAIT_MS = 5_000;   // nothing queued after this long: nobody's around, go back to sleep
const IDLE_MS = 4 * 60_000;    // stay awake this long after the last request
const MAX_MS = 13 * 60_000;    // well inside the 15-minute limit

const te = new TextEncoder(), td = new TextDecoder();
const b64 = (b: ArrayBuffer | Uint8Array) => Buffer.from(b instanceof Uint8Array ? b : new Uint8Array(b)).toString('base64');
const unb64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));

let privateKey: CryptoKey | null = null;
async function serverKey(): Promise<CryptoKey> {
  if (privateKey) return privateKey;
  const jwk = JSON.parse(process.env.RELAY_PRIVATE_KEY || 'null');
  if (!jwk) throw new Error('RELAY_PRIVATE_KEY is not set');
  privateKey = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  return privateKey;
}
async function requestKey(epk: JsonWebKey, id: string): Promise<CryptoKey> {
  const pub = await crypto.subtle.importKey('jwk', epk, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: pub }, await serverKey(), 256);
  const hk = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: te.encode(id), info: te.encode('sweet-revenge relay v1') },
    hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

type Wire = { id: string; epk: JsonWebKey; iv: string; ct: string };
const answered = new Map<string, string>(); // request id → encrypted answer, so a resend gets the same reply

async function handle(app: Hono, raw: Buffer): Promise<{ id: string; out: string } | null> {
  let w: Wire;
  try { w = JSON.parse(raw.toString()); } catch { return null; }
  if (!w || typeof w.id !== 'string' || !/^[a-f0-9]{32}$/.test(w.id) || typeof w.iv !== 'string' || typeof w.ct !== 'string' || !w.epk) return null;
  const cached = answered.get(w.id);
  if (cached) return { id: w.id, out: cached };
  let key: CryptoKey, req: { path: string; body: unknown };
  try {
    key = await requestKey(w.epk, w.id);
    req = JSON.parse(td.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(w.iv) }, key, unb64(w.ct))));
  } catch { return null; } // not for us, or tampered with
  if (!req || !PATHS.has(req.path)) return null;
  const res = await app.fetch(new Request('https://relay.internal' + req.path, {
    method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(req.body ?? {}),
  }));
  const answer = { status: res.status, data: await res.json().catch(() => null) };
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(JSON.stringify(answer)));
  const out = JSON.stringify({ iv: b64(iv), ct: b64(ct) });
  answered.set(w.id, out);
  if (answered.size > 500) answered.delete(answered.keys().next().value as string);
  return { id: w.id, out };
}

let running: Promise<{ handled: number }> | null = null;

// Runs one awake period. If one is already awake in this isolate, the call returns at once
// (so the every-minute trigger doesn't pile up waiting, and billed, invocations).
export function runBridge(app: Hono): Promise<{ handled: number; already?: boolean }> {
  if (running) return Promise.resolve({ handled: 0, already: true });
  running = new Promise((resolve) => {
    const started = Date.now();
    let last = 0, handled = 0, done = false;
    const clients = BROKERS.map((url, i) => {
      // A fixed client id + clean: false keeps a persistent session, so the relay holds requests while we nap.
      // No auto-reconnect: if a newer bridge takes the session over, this one simply bows out.
      const cl = mqtt.connect(url, { clientId: `sr-bridge-7c1e93-${i}`, clean: false, reconnectPeriod: 0, connectTimeout: 8000, keepalive: 30 });
      cl.on('connect', () => cl.subscribe(`${RELAY_TOPIC}/req`, { qos: 1 }));
      cl.on('message', (_topic, payload) => {
        last = Date.now();
        handle(app, payload).then((r) => {
          if (r) { handled++; cl.publish(`${RELAY_TOPIC}/res/${r.id}`, r.out, { qos: 1 }); }
        }).catch((e) => console.error('[relay]', e));
      });
      cl.on('error', (e) => console.error('[relay]', url, e.message));
      return cl;
    });
    const finish = () => {
      if (done) return;
      done = true;
      clearInterval(timer);
      // Give answers a moment to leave, then close. Unfinished acknowledgements stay queued on the relay.
      setTimeout(() => { clients.forEach((c) => c.end(true)); running = null; resolve({ handled }); }, 1500);
    };
    const timer = setInterval(() => {
      const now = Date.now(), alive = clients.some((c) => c.connected);
      if (now - started > MAX_MS) return finish();
      if (!last && now - started > FIRST_WAIT_MS) return finish();
      if (last && now - last > IDLE_MS) return finish();
      if (!alive && now - started > 10_000) return finish(); // both relays gone (or taken over)
    }, 1000);
  });
  return running;
}
