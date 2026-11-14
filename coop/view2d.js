/* Two Peas in 2D: a hand-drawn-looking cartoon world, painted in code on a canvas (no image files, sharp at
   any size, light on weak laptops). Ink outlines, grassy tops, soft parallax hills, your own critter art as
   the hero (squash and stretch, little walking feet), and the candy rope that ties you together: it sags
   when slack and snaps straight when tight.
   The static ground is painted once per stage into an offscreen canvas; each frame only moves things.
   Same API as the old 3D view: init, build, setHeroes, render, event, resize, dispose, getStage. */
const INK = '#2b2140', PINK = '#ff5fa8', BLUE = '#3f9bff';
const BTN = [null, '#ffc233', '#2bc48a', '#9b6bff', '#ff8a3d'];
const THEMES = {
  1: { sky: ['#8fd3ff', '#e3f6ff'], far: '#b9e6c9', mid: '#8fd48f', near: '#6cc27a', dirt: '#e09a62', dirtDark: '#c97f4b', grass: '#7cd36b', grassDark: '#4fae55' },
  2: { sky: ['#b8a2ff', '#ffe0f1'], far: '#e4c6f5', mid: '#cf9fe8', near: '#b98add', dirt: '#d98e74', dirtDark: '#bd735c', grass: '#8edc8a', grassDark: '#5bb46a' },
  3: { sky: ['#ffb877', '#ffefc9'], far: '#f6d8a8', mid: '#efbc7f', near: '#e2a462', dirt: '#d98a55', dirtDark: '#b96e3e', grass: '#9fd36a', grassDark: '#6eaf44' },
};
let cvs = null, ctx = null, W = 0, H = 0, dpr = 1, level = null, L = null, theme = THEMES[1], ground = null, PPM = 64, bgLayers = null;
let heroes = {}, cam = null, fx = [], t = 0, shake = 0, loopOn = false, throttleFps = 0;
const stageStub = { throttle(f) { throttleFps = f || 0; }, stats: { fps: 60, drawCalls: 0, tris: 0, level: 0 }, scene: { children: [] } };

function rnd(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const hashStr = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const rr = (g, x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); };

export async function init(canvas) {
  cvs = canvas; ctx = cvs.getContext('2d');
  resize();
  addEventListener('resize', resize);
  if (!loopOn) { loopOn = true; requestAnimationFrame(loop); }
  return stageStub;
}
export function resize() {
  if (!cvs) return;
  dpr = Math.min(1.75, window.devicePixelRatio || 1);
  W = cvs.clientWidth || innerWidth; H = cvs.clientHeight || innerHeight;
  cvs.width = Math.round(W * dpr); cvs.height = Math.round(H * dpr);
  bgLayers = null;
}

/* ---------- painting the ground once ---------- */
function cellAt(x, y) { return x < 0 || x >= L.W ? 1 : y < 0 || y >= L.H ? 0 : L.grid[(L.H - 1 - y) * L.W + x]; }
const isSolid = (c) => c === 1 || c === 4 || c === 5;
function paintGround() {
  const pad = 2, s = PPM;
  const gw = (L.W + pad * 2) * s, gh = (L.H + pad + 3) * s;
  const c = document.createElement('canvas'); c.width = Math.ceil(gw); c.height = Math.ceil(gh);
  const g = c.getContext('2d');
  // world (x, y) -> canvas px (y up in the world, down on canvas)
  const X = (x) => (x + pad) * s, Y = (y) => (L.H + pad - y) * s;
  const solid = (x, y) => (y < 0 ? x >= -pad && x < L.W + pad && (x < 0 || x >= L.W || isSolid(cellAt(x, 0))) : isSolid(cellAt(x, y)));
  const r = rnd(hashStr(level.id || 'x'));
  // shafts and hollows (air with ground on both sides and below): a dark earthy back wall, not the sky
  for (let y = 0; y < L.H; y++) for (let x = 0; x < L.W; x++) {
    if (solid(x, y)) continue;
    let l = false, rgt = false, below = false;
    for (let k = 1; k <= 2; k++) { if (solid(x - k, y)) l = true; if (solid(x + k, y)) rgt = true; }
    for (let k = 1; k <= 4; k++) if (solid(x, y - k)) below = true;
    let roofed = false; for (let k = 1; k <= L.H; k++) if (solid(x, y + k)) roofed = true;
    if (l && rgt && below && !roofed && solid(x - 1, y + 0) + solid(x + 1, y) >= 1 && (solid(x - 1, y) || solid(x + 1, y))) { g.fillStyle = '#8a5236'; g.fillRect(X(x) - 0.5, Y(y + 1) - 0.5, s + 1, s + 1); }
  }
  // earth: one smooth shade by depth (no seams between tiles) and pebbles
  const earth = g.createLinearGradient(0, Y(L.H), 0, Y(-3));
  earth.addColorStop(0, theme.dirt); earth.addColorStop(1, theme.dirtDark);
  for (let y = -3; y < L.H; y++) for (let x = -pad; x < L.W + pad; x++) {
    if (!solid(x, y)) continue;
    g.fillStyle = earth; g.fillRect(X(x) - 0.5, Y(y + 1) - 0.5, s + 1, s + 1);
    g.fillStyle = 'rgba(80,40,20,.13)';
    for (let k = 0; k < 3; k++) { g.beginPath(); g.ellipse(X(x) + r() * s, Y(y + 1) + r() * s, s * (0.04 + r() * 0.05), s * (0.03 + r() * 0.03), 0, 0, Math.PI * 2); g.fill(); }
  }
  // ink outline on exposed edges
  g.strokeStyle = INK; g.lineWidth = s * 0.07; g.lineCap = 'round';
  for (let y = -3; y < L.H; y++) for (let x = -pad; x < L.W + pad; x++) {
    if (!solid(x, y)) continue;
    g.beginPath();
    if (!solid(x, y + 1)) { g.moveTo(X(x), Y(y + 1)); g.lineTo(X(x + 1), Y(y + 1)); }
    if (!solid(x - 1, y) && y >= -1) { g.moveTo(X(x), Y(y + 1)); g.lineTo(X(x), Y(y)); }
    if (!solid(x + 1, y) && y >= -1) { g.moveTo(X(x + 1), Y(y + 1)); g.lineTo(X(x + 1), Y(y)); }
    if (!solid(x, y - 1) && y >= 0) { g.moveTo(X(x), Y(y)); g.lineTo(X(x + 1), Y(y)); }
    g.stroke();
  }
  // grass caps with little drips, tufts and flowers
  for (let y = 0; y < L.H; y++) for (let x = -pad; x < L.W + pad; x++) {
    if (!solid(x, y) || solid(x, y + 1)) continue;
    const c0 = cellAt(x, y); if (c0 === 4 || c0 === 5) continue;
    const top = Y(y + 1), lft = solid(x - 1, y) && !solid(x - 1, y + 1), rgt = solid(x + 1, y) && !solid(x + 1, y + 1);
    g.fillStyle = theme.grass; g.strokeStyle = INK; g.lineWidth = s * 0.06;
    g.beginPath();
    const x0 = X(x) - (lft ? 0 : s * 0.06), x1 = X(x + 1) + (rgt ? 0 : s * 0.06);
    g.moveTo(x0, top - s * 0.04);
    g.lineTo(x1, top - s * 0.04);
    // wavy drip edge underneath
    const drips = 4;
    for (let k = drips; k >= 0; k--) { const px = x0 + ((x1 - x0) * k) / drips, py = top + s * (0.2 + (k % 2 ? 0.1 : 0) + r() * 0.05); g.quadraticCurveTo(px + s * 0.08, py + s * 0.06, px, py); }
    g.closePath(); g.fill();
    g.beginPath(); g.moveTo(x0, top - s * 0.04); g.lineTo(x1, top - s * 0.04); g.stroke();
    g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(x0 + s * 0.06, top + s * 0.02, (x1 - x0) - s * 0.12, s * 0.05);
    if (x >= 0 && x < L.W && cellAt(x, y + 1) === 0) {
      const roll = r();
      if (roll < 0.35) tuft(g, X(x) + s * (0.2 + r() * 0.6), top, s);
      else if (roll < 0.5) flower(g, X(x) + s * (0.2 + r() * 0.6), top, s, ['#ff6fae', '#ffd34d', '#ffffff', '#a98bff'][Math.floor(r() * 4)]);
    }
  }
  // ledges (planks), spikes
  for (let y = 0; y < L.H; y++) for (let x = 0; x < L.W; x++) {
    const cc = cellAt(x, y);
    if (cc === 2) {
      rr(g, X(x) - s * 0.02, Y(y + 1), s * 1.04, s * 0.26, s * 0.08); g.fillStyle = '#c98a4e'; g.fill(); g.lineWidth = s * 0.06; g.strokeStyle = INK; g.stroke();
      g.fillStyle = 'rgba(0,0,0,.15)'; g.fillRect(X(x) + s * 0.48, Y(y + 1) + s * 0.04, s * 0.04, s * 0.18);
    } else if (cc === 3) {
      for (let k = 0; k < 3; k++) {
        const bx = X(x) + s * (0.04 + k * 0.32), by = Y(y);
        g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + s * 0.16, by - s * 0.5); g.lineTo(bx + s * 0.32, by); g.closePath();
        g.fillStyle = '#e7ecf5'; g.fill(); g.lineWidth = s * 0.05; g.strokeStyle = INK; g.stroke();
      }
    }
  }
  return { c, pad };
}
function tuft(g, x, y, s) {
  g.strokeStyle = '#3e9a4a'; g.lineWidth = s * 0.05; g.lineCap = 'round';
  for (const a of [-0.5, 0, 0.45]) { g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + a * s * 0.2, y - s * 0.15, x + a * s * 0.3, y - s * 0.28); g.stroke(); }
}
function flower(g, x, y, s, col) {
  g.strokeStyle = '#3e9a4a'; g.lineWidth = s * 0.04; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - s * 0.3); g.stroke();
  g.fillStyle = col; for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; g.beginPath(); g.arc(x + Math.cos(a) * s * 0.07, y - s * 0.3 + Math.sin(a) * s * 0.07, s * 0.06, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = '#ffcf3a'; g.beginPath(); g.arc(x, y - s * 0.3, s * 0.045, 0, Math.PI * 2); g.fill();
}

/* ---------- parallax background, painted once per size ---------- */
function paintBackground() {
  const mk = (h) => { const c = document.createElement('canvas'); c.width = Math.ceil(W * dpr * 1.6); c.height = Math.ceil(h * dpr); return c; };
  const sky = mk(H), sg = sky.getContext('2d'), gr = sg.createLinearGradient(0, 0, 0, sky.height);
  gr.addColorStop(0, theme.sky[0]); gr.addColorStop(1, theme.sky[1]); sg.fillStyle = gr; sg.fillRect(0, 0, sky.width, sky.height);
  // a soft sun
  const sun = sg.createRadialGradient(sky.width * 0.78, sky.height * 0.22, 0, sky.width * 0.78, sky.height * 0.22, sky.height * 0.35);
  sun.addColorStop(0, 'rgba(255,255,240,.85)'); sun.addColorStop(1, 'rgba(255,255,240,0)'); sg.fillStyle = sun; sg.fillRect(0, 0, sky.width, sky.height);
  const hills = (col, base, amp, n, seed, trees) => {
    const c = mk(H), g = c.getContext('2d'), r = rnd(seed), w = c.width, h = c.height;
    g.fillStyle = col; g.beginPath(); g.moveTo(0, h);
    const pts = []; for (let i = 0; i <= n; i++) pts.push([(i / n) * w, h * base - r() * h * amp]);
    g.lineTo(0, pts[0][1]);
    for (let i = 0; i < n; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[i + 1]; g.quadraticCurveTo(x0 + (x1 - x0) / 2, Math.min(y0, y1) - h * amp * 0.5, x1, y1); }
    g.lineTo(w, h); g.closePath(); g.fill();
    if (trees) for (let i = 0; i < trees; i++) { const x = r() * w, y = h * base - h * amp * 0.2 + r() * h * 0.08, sz = h * (0.04 + r() * 0.03); g.fillStyle = col; g.beginPath(); g.arc(x, y - sz, sz, 0, Math.PI * 2); g.fill(); g.fillRect(x - sz * 0.15, y - sz, sz * 0.3, sz * 1.4); }
    return c;
  };
  const r = rnd(hashStr(level.id || 'x') + 3);
  const clouds = mk(H), cg = clouds.getContext('2d');
  for (let i = 0; i < 7; i++) { const x = r() * clouds.width, y = clouds.height * (0.08 + r() * 0.3), s = clouds.height * (0.04 + r() * 0.04); cg.fillStyle = 'rgba(255,255,255,.9)'; for (let k = 0; k < 4; k++) { cg.beginPath(); cg.arc(x + k * s * 0.9, y + (k % 2) * s * 0.2, s * (0.8 + (k % 2) * 0.3), 0, Math.PI * 2); cg.fill(); } }
  bgLayers = [
    { c: sky, k: 0 }, { c: clouds, k: 0.05, drift: true },
    { c: hills(theme.far, 0.62, 0.18, 6, 11, 0), k: 0.12 },
    { c: hills(theme.mid, 0.74, 0.16, 8, 21, 14), k: 0.25 },
  ];
}

/* ---------- heroes from critter art ---------- */
function critterImage(key, mood) {
  return new Promise((res) => {
    if (typeof AVATAR_ART === 'undefined') return res(null);
    const svg = AVATAR_ART.svg(key, mood).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="259" ');
    const img = new Image(); img.onload = () => res(img); img.onerror = () => res(null);
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
}
export async function setHeroes(looks, names) {
  for (const k of ['a', 'b']) {
    const key = (looks[k] && looks[k].critter) || (k === 'a' ? '🐰' : '🐼');
    const [happy, sulk, cheer] = await Promise.all(['happy', 'sulk', 'cheer'].map((m) => critterImage(key, m)));
    heroes[k] = { img: { happy, sulk, cheer: cheer || happy }, name: names[k] || (k === 'a' ? 'Pink' : 'Blue'), col: k === 'a' ? PINK : BLUE, sq: 0, sqV: 0, face: 1, phase: 0, wasGround: true, mood: 'happy', moodT: 0, tilt: 0 };
  }
}
export async function build(lv) {
  level = lv; L = lv.parsed; theme = THEMES[lv.world] || THEMES[1];
  PPM = 64;
  ground = paintGround();
  bgLayers = null; cam = null; fx = [];
  return true;
}

/* ---------- drawing ---------- */
let lastW = null;
export function render(world, dt) { lastW = world; }
function loop(now) {
  requestAnimationFrame(loop);
  if (!ctx || !L || !lastW || document.hidden) return;
  if (throttleFps && now - (loop.last || 0) < 1000 / throttleFps) return;
  const dt = Math.min(0.05, (now - (loop.last || now)) / 1000); loop.last = now; t += dt;
  draw(lastW, dt);
}
function draw(Wd, dt) {
  if (!bgLayers) paintBackground();
  frameCamera(Wd, dt);
  const s = cam.ppm * dpr, sx = (x) => (x - cam.x) * s + cvs.width / 2, sy = (y) => cvs.height / 2 - (y - cam.y) * s;
  const shx = shake ? (Math.random() - 0.5) * shake * s * 0.2 : 0, shy = shake ? (Math.random() - 0.5) * shake * s * 0.2 : 0;
  shake = Math.max(0, shake - dt * 3);
  const g = ctx;
  g.setTransform(1, 0, 0, 1, 0, 0);
  // background layers (parallax on camera x)
  for (const l of bgLayers) {
    const off = ((cam.x * PPM * dpr * l.k + (l.drift ? t * 8 * dpr : 0)) % l.c.width + l.c.width) % l.c.width;
    g.drawImage(l.c, -off, 0); g.drawImage(l.c, l.c.width - off, 0);
  }
  g.setTransform(1, 0, 0, 1, shx, shy);
  // the ground layer
  const gs = s / PPM;
  g.imageSmoothingQuality = 'high';
  g.drawImage(ground.c, sx(-ground.pad), sy(L.H + ground.pad), ground.c.width * gs, ground.c.height * gs);
  // things
  drawThings(g, Wd, s, sx, sy);
  // rope behind the heroes
  if (Wd.L.rope) drawRope(g, Wd, s, sx, sy);
  for (const k of ['a', 'b']) drawHero(g, Wd, k, s, sx, sy, dt);
  // effects
  fx = fx.filter((f) => { f.t += dt; f.draw(g, f, s, sx, sy); return f.t < f.life; });
}

function drawThings(g, Wd, s, sx, sy) {
  const ink = (w = 0.06) => { g.lineWidth = s * w; g.strokeStyle = INK; g.lineJoin = 'round'; };
  // goo
  for (let y = 0; y < L.H; y++) for (let x = 0; x < L.W; x++) {
    const c = cellAt(x, y); if (c !== 4 && c !== 5) continue;
    const col = c === 4 ? PINK : BLUE, top = sy(y + 1) - s * 0.1;
    g.fillStyle = col; g.beginPath(); g.moveTo(sx(x), top + s * 0.25);
    for (let k = 0; k <= 8; k++) { const px = sx(x + k / 8); g.lineTo(px, top + Math.sin(t * 3 + x * 2 + k) * s * 0.04); }
    g.lineTo(sx(x + 1), top + s * 0.25); g.closePath(); g.fill();
    g.fillStyle = 'rgba(255,255,255,.45)'; g.beginPath(); g.ellipse(sx(x + 0.35), top + s * 0.06, s * 0.12, s * 0.03, 0, 0, Math.PI * 2); g.fill();
  }
  // colour walls: striped glass
  for (let y = 0; y < L.H; y++) for (let x = 0; x < L.W; x++) {
    const c = cellAt(x, y); if (c !== 6 && c !== 7) continue;
    g.fillStyle = c === 6 ? 'rgba(255,95,168,.32)' : 'rgba(63,155,255,.32)'; g.fillRect(sx(x), sy(y + 1), s, s);
    g.strokeStyle = c === 6 ? 'rgba(255,95,168,.7)' : 'rgba(63,155,255,.7)'; g.lineWidth = s * 0.05;
    g.beginPath(); for (let k = 0; k < 3; k++) { g.moveTo(sx(x + k * 0.33), sy(y)); g.lineTo(sx(x + k * 0.33 + 0.33), sy(y + 1)); } g.stroke();
  }
  // buttons
  for (const b of L.buttons) {
    const on = Wd.pressed[b.n], h = on ? 0.08 : 0.2, cx = sx(b.x + 0.5), base = sy(b.y);
    rr(g, cx - s * 0.42, base - s * 0.1, s * 0.84, s * 0.1, s * 0.04); g.fillStyle = '#5b5470'; g.fill(); ink(0.05); g.stroke();
    rr(g, cx - s * 0.32, base - s * (0.1 + h), s * 0.64, s * h, s * 0.08); g.fillStyle = BTN[b.n]; g.fill(); ink(0.05); g.stroke();
  }
  // gates: bars that slide into the ground when open
  for (const gt of L.gates) {
    const closed = gt.inverted ? Wd.pressed[gt.n] : !Wd.pressed[gt.n];
    gt._o = (gt._o ?? (closed ? 0 : 1)) + ((closed ? 0 : 1) - (gt._o ?? 0)) * 0.25;
    const top = sy(gt.y + 1 - gt._o * 0.92);
    g.save(); g.beginPath(); g.rect(sx(gt.x), sy(gt.y + 1), s, s); g.clip();
    rr(g, sx(gt.x + 0.08), top, s * 0.84, s, s * 0.08); g.fillStyle = BTN[gt.n]; g.fill(); ink(0.06); g.stroke();
    g.fillStyle = 'rgba(43,33,64,.85)'; for (let k = 0; k < 2; k++) g.fillRect(sx(gt.x + 0.08), top + s * (0.25 + k * 0.4), s * 0.84, s * 0.1);
    g.restore();
  }
  // locks
  Wd.locks.forEach((l, i) => {
    l._s = l.open ? Math.max(0, (l._s ?? 1) - 0.12) : 1; if (l._s <= 0) return;
    const cx = sx(l.x + 0.5), cy = sy(l.y + 0.5), z = l._s;
    g.save(); g.translate(cx, cy); g.scale(z, z);
    rr(g, -s * 0.48, -s * 0.48, s * 0.96, s * 0.96, s * 0.14); g.fillStyle = '#ffcf3a'; g.fill(); ink(0.07); g.stroke();
    g.beginPath(); g.arc(0, -s * 0.05, s * 0.12, 0, Math.PI * 2); g.fillStyle = INK; g.fill(); g.fillRect(-s * 0.04, -s * 0.05, s * 0.08, s * 0.22);
    g.restore();
  });
  // crates
  for (const c of Wd.crates) {
    const x0 = sx(c.x - c.w / 2), y0 = sy(c.y + c.h), w = c.w * s, h = c.h * s, heavy = c.need > 1;
    rr(g, x0, y0, w, h, s * 0.08); g.fillStyle = heavy ? '#a9703f' : '#d79a5a'; g.fill(); ink(0.07); g.stroke();
    g.strokeStyle = heavy ? '#7d4f2a' : '#b37a3f'; g.lineWidth = s * 0.08; g.beginPath(); g.moveTo(x0 + s * 0.12, y0 + s * 0.12); g.lineTo(x0 + w - s * 0.12, y0 + h - s * 0.12); g.moveTo(x0 + w - s * 0.12, y0 + s * 0.12); g.lineTo(x0 + s * 0.12, y0 + h - s * 0.12); g.stroke();
    if (heavy) { g.fillStyle = '#5b5470'; g.fillRect(x0, y0 + h * 0.2, w, s * 0.1); g.fillRect(x0, y0 + h * 0.72, w, s * 0.1); g.fillStyle = '#fff'; g.font = `700 ${s * 0.3}px Fredoka, sans-serif`; g.textAlign = 'center'; g.fillText('×2', x0 + w / 2, y0 + h * 0.6); }
  }
  // springs
  for (const sp of L.springs) {
    const cx = sx(sp.x + 0.5), base = sy(sp.y);
    g.strokeStyle = INK; g.lineWidth = s * 0.06; g.beginPath();
    for (let k = 0; k <= 6; k++) g.lineTo(cx + (k % 2 ? 1 : -1) * s * 0.2, base - s * (0.05 + k * 0.05));
    g.stroke();
    rr(g, cx - s * 0.36, base - s * 0.42, s * 0.72, s * 0.12, s * 0.05); g.fillStyle = '#ff6b5e'; g.fill(); ink(0.05); g.stroke();
  }
  // flags
  for (const f of Wd.flags) {
    const px = sx(f.x - 0.3), base = sy(f.y);
    g.strokeStyle = INK; g.lineWidth = s * 0.07; g.beginPath(); g.moveTo(px, base); g.lineTo(px, base - s * 1.4); g.stroke();
    const wave = Math.sin(t * 5) * s * 0.05;
    g.beginPath(); g.moveTo(px, base - s * 1.38); g.quadraticCurveTo(px + s * 0.35, base - s * 1.3 + wave, px + s * 0.6, base - s * 1.2); g.lineTo(px, base - s * 0.98); g.closePath();
    g.fillStyle = f.on ? '#2bc48a' : '#ff5a5f'; g.fill(); g.lineWidth = s * 0.05; g.stroke();
  }
  // lifts and movers: yellow striped platforms
  const plat = (x, y, w) => { rr(g, sx(x), sy(y), w * s, s * 0.4, s * 0.1); g.fillStyle = '#ffcf3a'; g.fill(); ink(0.06); g.stroke(); g.save(); g.clip(); g.fillStyle = 'rgba(43,33,64,.18)'; for (let k = 0; k < w * 3; k++) g.fillRect(sx(x + k / 3), sy(y), s * 0.12, s * 0.4); g.restore(); };
  for (const l of Wd.lifts) plat(l.x, l.y + l.off, l.w);
  for (const m of Wd.movers) plat(m.cx, m.cy + 0.4, m.w);
  // the exit door
  const e = L.exit, dx = sx(e.x + 0.5), db = sy(e.y);
  const inCount = (Wd.a.inDoor ? 1 : 0) + (Wd.b.inDoor ? 1 : 0);
  g.fillStyle = `rgba(255,220,120,${0.25 + 0.15 * Math.sin(t * 3) + inCount * 0.15})`; g.beginPath(); g.ellipse(dx, db - s * 0.9, s * 1.1, s * 1.2, 0, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.moveTo(dx - s * 0.55, db); g.lineTo(dx - s * 0.55, db - s * 1.2); g.arc(dx, db - s * 1.2, s * 0.55, Math.PI, 0); g.lineTo(dx + s * 0.55, db); g.closePath();
  g.fillStyle = '#8a5531'; g.fill(); ink(0.08); g.stroke();
  g.beginPath(); g.moveTo(dx - s * 0.38, db); g.lineTo(dx - s * 0.38, db - s * 1.15); g.arc(dx, db - s * 1.15, s * 0.38, Math.PI, 0); g.lineTo(dx + s * 0.38, db); g.closePath();
  g.fillStyle = inCount ? '#fff3c4' : '#3a2440'; g.fill();
  for (let k = 0; k < 2; k++) { g.beginPath(); g.arc(dx - s * 0.18 + k * s * 0.36, db - s * 2.05, s * 0.12, 0, Math.PI * 2); g.fillStyle = (k ? Wd.b.inDoor : Wd.a.inDoor) ? (k ? BLUE : PINK) : '#ffffff'; g.fill(); ink(0.04); g.stroke(); }
  // keys
  Wd.keys.forEach((k, i) => {
    if (k.used) return;
    const bob = k.holder ? 0 : Math.sin(t * 3 + i) * 0.08;
    drawKey(g, sx(k.x), sy(k.y + 0.2 + bob), s, k.holder ? 0 : Math.sin(t * 2) * 0.3);
  });
}
function drawKey(g, x, y, s, rot) {
  g.save(); g.translate(x, y); g.rotate(rot);
  g.fillStyle = '#ffcf3a'; g.strokeStyle = INK; g.lineWidth = s * 0.05;
  g.beginPath(); g.arc(-s * 0.14, 0, s * 0.14, 0, Math.PI * 2); g.fill(); g.stroke();
  rr(g, -s * 0.02, -s * 0.05, s * 0.36, s * 0.1, s * 0.03); g.fill(); g.stroke();
  g.fillRect(s * 0.22, s * 0.03, s * 0.06, s * 0.1); g.strokeRect(s * 0.22, s * 0.03, s * 0.06, s * 0.1);
  g.fillStyle = INK; g.beginPath(); g.arc(-s * 0.14, 0, s * 0.05, 0, Math.PI * 2); g.fill();
  g.restore();
}

// The candy rope: a sagging curve when slack, a straight line when tight; striped pink and blue.
function drawRope(g, Wd, s, sx, sy) {
  const a = Wd.a, b = Wd.b;
  if (a.inDoor || b.inDoor || a.dead > 0 || b.dead > 0) return;
  const ax = sx(a.x), ay = sy(a.y + 0.45), bx = sx(b.x), by = sy(b.y + 0.45);
  const d = Math.hypot(b.x - a.x, b.y - a.y), Lr = Wd.ropeL || 4.2;
  let sag = d < Lr ? Math.sqrt(Math.max(0, Lr * Lr - d * d)) * 0.42 : 0;
  // never sag into the ground: the lowest point stays just above the lower hero's feet
  const avgY = (a.y + b.y) / 2 + 0.45, floorY = Math.min(a.y, b.y) + 0.12;
  sag = Math.max(0, Math.min(sag, 2 * (avgY - floorY)));
  const mx = (ax + bx) / 2, my = (ay + by) / 2 + sag * s;
  const tight = Wd.ropeTight || 0;
  g.lineCap = 'round';
  g.beginPath(); g.moveTo(ax, ay); g.quadraticCurveTo(mx, my, bx, by);
  g.strokeStyle = INK; g.lineWidth = s * 0.16; g.stroke();
  const gr = g.createLinearGradient(ax, ay, bx, by); gr.addColorStop(0, PINK); gr.addColorStop(1, BLUE);
  g.strokeStyle = gr; g.lineWidth = s * 0.09; g.stroke();
  g.setLineDash([s * 0.12, s * 0.16]); g.lineDashOffset = -t * s * 0.4; g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = s * 0.05; g.stroke(); g.setLineDash([]);
  if (tight > 0.6) { g.strokeStyle = `rgba(255,255,255,${(tight - 0.6) * 1.5})`; g.lineWidth = s * 0.03; g.stroke(); }
}

function drawHero(g, Wd, k, s, sx, sy, dt) {
  const h = Wd[k], v = heroes[k];
  if (!v || h.inDoor || h.dead > 0) return;
  // squash and stretch spring
  if (h.ground && !v.wasGround) v.sqV += Math.min(0.9, Math.abs(v.lastVy || 6) / 14) * 9;
  if (!h.ground && v.wasGround && h.vy > 3) v.sqV -= 5;
  v.wasGround = h.ground; v.lastVy = h.vy;
  v.sqV += (-v.sq * 220 - v.sqV * 16) * dt; v.sq += v.sqV * dt;
  const sq = Math.max(-0.28, Math.min(0.3, v.sq + (!h.ground ? Math.max(-0.15, Math.min(0.15, h.vy * 0.012)) * -1 : 0)));
  if (h.vx > 0.3) v.face = 1; else if (h.vx < -0.3) v.face = -1;
  const moving = h.ground && Math.abs(h.vx) > 0.4;
  v.phase += dt * (moving ? 14 : 0);
  v.tilt += ((moving ? 0.08 * v.face : 0) + (h.anchor ? -0.18 * v.face : 0) - v.tilt) * Math.min(1, dt * 10);
  if (v.moodT > 0) { v.moodT -= dt; if (v.moodT <= 0) v.mood = 'happy'; }
  const cx = sx(h.x), base = sy(h.y);
  const size = s * 1.12, bob = moving ? Math.abs(Math.sin(v.phase)) * s * 0.06 : 0;
  // shadow
  g.fillStyle = 'rgba(43,33,64,.18)'; g.beginPath(); g.ellipse(cx, base, size * 0.34, size * 0.07, 0, 0, Math.PI * 2); g.fill();
  // feet
  for (const side of [-1, 1]) {
    const step = moving ? Math.sin(v.phase + (side > 0 ? Math.PI : 0)) * s * 0.12 : 0;
    g.fillStyle = INK; g.beginPath(); g.ellipse(cx + side * s * 0.16 + step * v.face, base - s * 0.04 - Math.max(0, -step) * 0.3, s * 0.12, s * 0.07, 0, 0, Math.PI * 2); g.fill();
  }
  // body (critter art) with squash and stretch and a tilt
  g.save();
  g.translate(cx, base - bob);
  g.rotate(v.tilt);
  g.scale(v.face * (1 + sq * 0.6), 1 - sq);
  const img = v.img[v.mood] || v.img.happy;
  if (img) g.drawImage(img, -size / 2, -size * 1.06, size, size * 1.08);
  else { g.fillStyle = v.col; g.beginPath(); g.arc(0, -size * 0.5, size * 0.4, 0, Math.PI * 2); g.fill(); }
  g.restore();
  // anchored: little planted-feet marks
  if (h.anchor) { g.strokeStyle = INK; g.lineWidth = s * 0.05; for (const side of [-1, 1]) { g.beginPath(); g.moveTo(cx + side * s * 0.4, base); g.lineTo(cx + side * s * 0.55, base - s * 0.12); g.stroke(); } }
  // name tag
  const label = v.name, fs = Math.max(11, s * 0.24);
  g.font = `700 ${fs}px Fredoka, sans-serif`; const tw = g.measureText(label).width + fs * 0.9;
  rr(g, cx - tw / 2, base - size * 1.32, tw, fs * 1.35, fs * 0.67); g.fillStyle = v.col; g.fill(); g.lineWidth = Math.max(2, s * 0.04); g.strokeStyle = INK; g.stroke();
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, cx, base - size * 1.32 + fs * 0.7);

}

// Keep both heroes in view, eased, never outside the level.
function frameCamera(Wd, dt) {
  const pts = ['a', 'b'].map((k) => Wd[k]).filter((h) => !h.inDoor && !(h.dead > 0));
  if (!pts.length) pts.push({ x: L.exit.x + 0.5, y: L.exit.y });
  const minX = Math.min(...pts.map((p) => p.x)), maxX = Math.max(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y)), maxY = Math.max(...pts.map((p) => p.y));
  const viewW = Math.max(16, maxX - minX + 9), viewH = Math.max(9.5, maxY - minY + 6);
  let ppm = Math.min(W / viewW, H / viewH);
  ppm = Math.max(ppm, Math.min(W / (L.W + 1), H / (L.H + 1.5)));   // never zoom out past the whole level
  ppm = Math.min(ppm, 90);
  const halfW = W / ppm / 2, halfH = H / ppm / 2;
  let cx = (minX + maxX) / 2, cy = (minY + maxY) / 2 + 1;
  cx = halfW * 2 >= L.W + 1 ? L.W / 2 : Math.max(-0.5 + halfW, Math.min(L.W + 0.5 - halfW, cx));
  cy = halfH * 2 >= L.H + 2 ? (L.H + 1) / 2 - 0.4 : Math.max(-1 + halfH, Math.min(L.H + 1.5 - halfH, cy));
  if (!cam) cam = { x: cx, y: cy, ppm };
  const k = Math.min(1, dt * 3.5);
  cam.x += (cx - cam.x) * k; cam.y += (cy - cam.y) * k; cam.ppm += (ppm - cam.ppm) * k;
}

/* ---------- effects ---------- */
function puff(x, y, col, n = 8, spd = 3) {
  const parts = Array.from({ length: n }, () => ({ x, y, vx: (Math.random() - 0.5) * spd, vy: Math.random() * spd * 0.8, r: 0.08 + Math.random() * 0.1 }));
  fx.push({ t: 0, life: 0.6, draw: (g, f, s, sx, sy) => { parts.forEach((p) => { p.x += p.vx * 0.016; p.y += p.vy * 0.016; p.vy -= 0.1; g.fillStyle = col; g.globalAlpha = Math.max(0, 1 - f.t / f.life); g.beginPath(); g.arc(sx(p.x), sy(p.y), p.r * s * (1 + f.t), 0, Math.PI * 2); g.fill(); g.globalAlpha = 1; }); } });
}
function stars(x, y) {
  const parts = Array.from({ length: 10 }, (_, i) => ({ a: (i / 10) * Math.PI * 2 }));
  fx.push({ t: 0, life: 0.7, draw: (g, f, s, sx, sy) => { parts.forEach((p) => { const r = 0.3 + f.t * 2; g.fillStyle = '#ffd34d'; g.globalAlpha = 1 - f.t / f.life; g.font = `${s * 0.35}px sans-serif`; g.textAlign = 'center'; g.fillText('✦', sx(x + Math.cos(p.a) * r), sy(y + Math.sin(p.a) * r)); g.globalAlpha = 1; }); } });
}
export function event(e, Wd) {
  if (!Wd) return;
  const h = e.k && Wd[e.k], v = e.k && heroes[e.k];
  if (e.t === 'land' && h) puff(h.x, h.y, 'rgba(255,255,255,.9)', 6, 2.5);
  else if (e.t === 'jump' && h) puff(h.x, h.y, 'rgba(255,255,255,.8)', 4, 1.5);
  else if (e.t === 'die' && h) { puff(h.x, h.y + 0.5, e.k === 'a' ? PINK : BLUE, 16, 6); shake = 1; if (v) { v.mood = 'sulk'; v.moodT = 2.5; } }
  else if (e.t === 'respawn' && h) puff(h.x, h.y + 0.4, '#ffffff', 10, 3);
  else if (e.t === 'key' && h) { stars(h.x, h.y + 1); if (v) { v.mood = 'cheer'; v.moodT = 1.2; } }
  else if (e.t === 'unlock' && h) stars(h.x + h.face * 0.8, h.y + 0.6);
  else if (e.t === 'yank') shake = Math.max(shake, 0.4);
  else if (e.t === 'spring' && h) puff(h.x, h.y, 'rgba(255,255,255,.9)', 8, 4);
  else if (e.t === 'door-in' && h) stars(h.x, h.y + 1);
  else if (e.t === 'clear') { ['a', 'b'].forEach((k) => { if (heroes[k]) { heroes[k].mood = 'cheer'; heroes[k].moodT = 5; } }); }
}
export function dispose() { L = null; lastW = null; }
export const getStage = () => (cvs ? stageStub : null);
window.CoopView = { init, build, setHeroes, render, event, resize, dispose, getStage };
