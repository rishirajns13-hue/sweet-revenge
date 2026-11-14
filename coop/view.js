/* The co-op platformer in 3D: a side-on diorama built from Kenney's CC0 Platformer Kit.
   - Ground: grass-topped blocks where the sky is above, plain earth below, two rows deep, all instanced
     (one draw call per kind of block), with trees, flowers and rocks along the back.
   - Things: keys, locks, buttons, gates, crates, springs, flags, lifts, colour goo and colour walls.
   - Heroes: each player's own 3D critter or human (shared/3d), with a coloured ring and a name.
   - Camera: frames both heroes, eases smoothly, never shows outside the level.
   Only this page loads it; everything is freed on dispose().
     await CoopView.init(canvas); await CoopView.build(level); CoopView.setHeroes({a: look, b: look}, names);
     CoopView.render(world, dt); CoopView.event(e) */
import * as THREE from 'three';
import { createStage } from '../shared/3d/stage.js?v=1';
import { models } from '../shared/3d/assets.js';
import { createCritter } from '../shared/3d/critters3d.js?v=1';
import { createHuman } from '../shared/3d/people.js?v=1';

const KIT = 'platformer/';
const BTN_COL = [null, '#ffc233', '#2bc48a', '#9b6bff', '#ff8a3d'];
const PINK = '#ff5fa8', BLUE = '#3f9bff';
let stage = null, root = null, level = null, heroes = {}, things = null, cam = null, timeT = 0, fx = [];

function rnd(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const hashStr = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

// The single mesh inside a Kenney model (they're all one mesh with the shared colour atlas).
async function meshOf(name) {
  const g = await models.load(KIT + name);
  let mesh = null; g.scene.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
  mesh.geometry.computeBoundingBox();
  const m = mesh.material; if (m.map) { m.map.colorSpace = THREE.SRGBColorSpace; m.map.anisotropy = 4; }
  m.roughness = 0.75; m.metalness = 0;
  return mesh;
}
function instanced(mesh, list, { shadow = true } = {}) {
  if (!list.length) return null;
  const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, list.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
  list.forEach((it, i) => { p.set(it.x, it.y, it.z || 0); e.set(0, it.ry || 0, 0); q.setFromEuler(e); s.set(it.sx || 1, it.sy || it.s || 1, it.sz || it.s || 1); if (it.s && !it.sx) s.x = it.s; m4.compose(p, q, s); im.setMatrixAt(i, m4); });
  im.castShadow = shadow; im.receiveShadow = true;
  im.instanceMatrix.needsUpdate = true;
  return im;
}
async function prop(name, opts) { return models.get(KIT + name, { shadows: true, ...opts }); }
function tint(obj, color, amount = 0.55) {
  obj.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.color = new THREE.Color('#ffffff').lerp(new THREE.Color(color), amount); } });
  return obj;
}

/* ---------- sky ---------- */
function skyTexture(top, bottom) {
  const c = document.createElement('canvas'); c.width = 4; c.height = 256;
  const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, top); gr.addColorStop(1, bottom); g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const THEMES = {
  1: { sky: ['#7cc8ff', '#d9f2ff'], hills: ['#7fd37a', '#5cbf6a'], fog: '#cdeaff' },
  2: { sky: ['#b59bff', '#ffd6ee'], hills: ['#c08cf0', '#f39bc9'], fog: '#f0dcff' },
  3: { sky: ['#ffb36b', '#ffe7b3'], hills: ['#e8a35a', '#d98348'], fog: '#ffe2bd' },
};

export async function init(canvas) {
  stage = createStage(canvas, { background: '#9fd6ff', fov: 30, bloom: 0.18 });
  stage.setGrade({ vignette: 0.18, warmth: 0.02, sat: 1.12 });
  const hemi = new THREE.HemisphereLight('#ffffff', '#6a7a5a', 1.25); stage.scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff3dc', 2.1); sun.position.set(-8, 16, 12);
  stage.addShadowLight(sun, { size: 22 }); stage.scene.add(sun, sun.target);
  stage.sun = sun;
  stage.start(() => {}); // the stage draws every frame (and pauses when hidden); the game moves things in render()
  return stage;
}

let buildSeq = 0;
export async function build(lv) {
  const my = ++buildSeq;
  clear();
  level = lv;
  const R = new THREE.Group(); root = R; stage.scene.add(R);
  const T = {};
  const L = lv.parsed, theme = THEMES[lv.world] || THEMES[1];
  stage.scene.background = skyTexture(theme.sky[0], theme.sky[1]);
  stage.scene.fog = new THREE.Fog(theme.fog, 28, 70);
  const cell = (x, y) => (x < 0 || x >= L.W || y < 0 || y >= L.H ? 0 : L.grid[(L.H - 1 - y) * L.W + x]);
  const solid = (c) => c === 1 || c === 4 || c === 5;
  const [grass, ledge, spikes] = await Promise.all([meshOf('block-grass'), meshOf('platform'), meshOf('trap-spikes')]);
  if (my !== buildSeq) return;
  // plain earth below the surface, in the kit's dirt colour (the kit's blocks all have grass on top)
  const dirt = { geometry: new THREE.BoxGeometry(1.0, 1.0, 1.06), material: new THREE.MeshStandardMaterial({ color: '#d98a5b', roughness: 0.92 }) };
  const tops = [], lows = [], plats = [], spk = [], gooP = [], gooQ = [], wallP = [], wallQ = [];
  for (let y = 0; y < L.H; y++) for (let x = 0; x < L.W; x++) {
    const c = cell(x, y);
    if (solid(c)) {
      const open = !solid(cell(x, y + 1)) && cell(x, y + 1) !== 6 && cell(x, y + 1) !== 7;
      for (const z of [0, -1.04]) {
        if (open) tops.push({ x: x + 0.5, y, z });
        else lows.push({ x: x + 0.5, y: y + 0.5, z });
      }
      if (c === 4) gooP.push({ x, y }); if (c === 5) gooQ.push({ x, y });
    } else if (c === 2) plats.push({ x: x + 0.5, y: y + 0.8, z: -0.1 });
    else if (c === 3) spk.push({ x: x + 0.5, y, z: 0, s: 1.4 });
    else if (c === 6) wallP.push({ x, y }); else if (c === 7) wallQ.push({ x, y });
  }
  // earth under the bottom row so the level doesn't float
  for (let x = -6; x < L.W + 6; x++) if (x < 0 || x >= L.W || solid(cell(x, 0))) for (const z of [0, -1.04]) lows.push({ x: x + 0.5, y: -0.5, z }, { x: x + 0.5, y: -1.5, z });
  // walls of earth beyond the edges (the physics treats outside as solid)
  for (let y = 0; y < L.H + 3; y++) for (const x of [-1, L.W]) for (const z of [0, -1.04]) (y === L.H + 2 ? tops : lows).push({ x: x + 0.5, y: y === L.H + 2 ? y : y + 0.5, z });
  [instanced(grass, tops), instanced(dirt, lows), instanced(ledge, plats), instanced(spikes, spk)].forEach((m) => m && R.add(m));

  // colour goo: a glossy slab on top of the block; colour walls: tinted glass
  const gooMat = (c) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.25, roughness: 0.25, metalness: 0 });
  for (const [list, col] of [[gooP, PINK], [gooQ, BLUE]]) if (list.length) {
    const im = instanced({ geometry: new THREE.BoxGeometry(1.02, 0.22, 2.1), material: gooMat(col) }, list.map((g) => ({ x: g.x + 0.5, y: g.y + 1.0, z: -0.52 })), { shadow: false });
    im.userData.goo = true; R.add(im);
  }
  for (const [list, col] of [[wallP, PINK], [wallQ, BLUE]]) if (list.length) {
    const mat = new THREE.MeshPhysicalMaterial({ color: col, transparent: true, opacity: 0.38, roughness: 0.1, metalness: 0, transmission: 0, depthWrite: false });
    R.add(instanced({ geometry: new THREE.BoxGeometry(0.96, 0.96, 1.6), material: mat }, list.map((g) => ({ x: g.x + 0.5, y: g.y + 0.5, z: -0.3 })), { shadow: false }));
  }

  // decorations along the back, seeded by the stage so they never change
  const r = rnd(hashStr(lv.id));
  const decoNames = ['tree', 'tree-pine', 'flowers', 'flowers-tall', 'grass', 'rocks', 'mushrooms', 'plant', 'stones', 'hedge'];
  const deco = await Promise.all(decoNames.map(meshOf));
  const byName = Object.fromEntries(decoNames.map((n, i) => [n, []]));
  for (let x = 0; x < L.W; x++) for (let y = 0; y < L.H; y++) {
    if (!solid(cell(x, y)) || solid(cell(x, y + 1)) || cell(x, y) !== 1 || cell(x, y + 1) === 3) continue; // nothing grows on goo or under spikes
    const roll = r();
    const z = -1.3 - r() * 0.5;
    if (roll < 0.12) byName[r() < 0.6 ? 'tree' : 'tree-pine'].push({ x: x + 0.5 + (r() - 0.5) * 0.4, y: y + 1, z: z - 0.4, s: 1.1 + r() * 0.5, ry: r() * 6 });
    else if (roll < 0.42) byName[['flowers', 'flowers-tall', 'grass', 'grass', 'rocks', 'mushrooms', 'plant', 'stones'][Math.floor(r() * 8)]].push({ x: x + 0.5 + (r() - 0.5) * 0.6, y: y + 1, z, s: 1 + r() * 0.4, ry: r() * 6 });
    if (r() < 0.25) byName.grass.push({ x: x + 0.5 + (r() - 0.5) * 0.8, y: y + 1, z: 0.42, s: 0.7 + r() * 0.3, ry: r() * 6 });
  }
  decoNames.forEach((n, i) => { const m = instanced(deco[i], byName[n]); if (m) R.add(m); });

  // far hills and clouds
  const hillMat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 1, flatShading: true });
  for (let i = 0; i < 9; i++) {
    const h = new THREE.Mesh(new THREE.SphereGeometry(1, 9, 6), hillMat(theme.hills[i % 2]));
    const w = 7 + r() * 9;
    h.scale.set(w, 3 + r() * 5, 3); h.position.set(-10 + i * (L.W + 20) / 8 + r() * 4, -1.5, -16 - r() * 8);
    R.add(h);
  }
  const cloudMat = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 0.55, roughness: 1, flatShading: true, transparent: true, opacity: 0.94 });
  T.clouds = [];
  for (let i = 0; i < 6; i++) {
    const g = new THREE.Group();
    for (let k = 0; k < 4; k++) { const s = new THREE.Mesh(new THREE.IcosahedronGeometry(0.8 + r() * 0.7, 0), cloudMat); s.position.set(k * 0.9 - 1.3, r() * 0.4, 0); g.add(s); }
    g.position.set(r() * (L.W + 10) - 5, L.H + 1 + r() * 4, -12 - r() * 6); g.userData.v = 0.2 + r() * 0.3;
    R.add(g); T.clouds.push(g);
  }

  /* ---- interactive things ---- */
  T.keys = await Promise.all(L.keys.map(async () => { const k = await prop('key', { scale: 2.2 }); R.add(k); return k; }));
  T.locks = await Promise.all(L.locks.map(async (l) => {
    const g = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1.4), new THREE.MeshStandardMaterial({ color: '#c99a3b', roughness: 0.5, metalness: 0.35 }));
    box.position.y = 0.5; box.castShadow = box.receiveShadow = true; g.add(box);
    const lk = await prop('lock', { scale: 1.6 }); lk.position.set(0, 0.2, 0.72); g.add(lk);
    g.position.set(l.x + 0.5, l.y, -0.2); R.add(g); return g;
  }));
  T.buttons = await Promise.all(L.buttons.map(async (b) => { const m = tint(await prop('button-square', { scale: 1.5 }), BTN_COL[b.n], 0.7); m.position.set(b.x + 0.5, b.y, 0); R.add(m); return m; }));
  T.gates = L.gates.map((gt) => {
    const mat = new THREE.MeshStandardMaterial({ color: BTN_COL[gt.n], roughness: 0.4, metalness: 0.3, emissive: BTN_COL[gt.n], emissiveIntensity: 0.12 });
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.98, 1.5), mat); m.castShadow = m.receiveShadow = true;
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.16, 1.52), new THREE.MeshStandardMaterial({ color: '#2b2140' })); m.add(stripe);
    m.position.set(gt.x + 0.5, gt.y + 0.5, -0.1); m.userData = { base: gt.y + 0.5 }; R.add(m); return m;
  });
  T.crates = await Promise.all(L.crates.map(async (c) => {
    const big = c.need > 1;
    const m = await prop(big ? 'crate-strong' : 'crate', { scale: 1 });
    m.scale.set(c.w / (big ? 0.6 : 0.5), c.h / (big ? 0.6 : 0.5), (big ? 1.5 : 1.0) / (big ? 0.6 : 0.5));
    if (big) tint(m, '#d9a066', 0.25);
    R.add(m); return m;
  }));
  T.springs = await Promise.all(L.springs.map(async (s) => { const m = await prop('spring', { scale: 1.3 }); m.position.set(s.x + 0.5, s.y, 0); R.add(m); return m; }));
  T.flags = await Promise.all(L.flags.map(async (f) => { const m = await prop('flag', { scale: 1.4 }); m.position.set(f.x, f.y, -0.3); R.add(m); return m; }));
  T.lifts = await Promise.all((lv.props || []).filter((p) => p.type === 'lift').map(async (p) => {
    const g = new THREE.Group();
    const mesh = await meshOf('block-moving');
    for (let i = 0; i < p.w; i++) { const m = new THREE.Mesh(mesh.geometry, mesh.material); m.position.set(i + 0.5, -0.3, 0); m.scale.set(1, 1, 1.4); m.castShadow = m.receiveShadow = true; g.add(m); }
    g.position.set(p.x, p.y, 0); R.add(g); g.userData.base = p.y; return g;
  }));
  const door = await prop('door-large-open', { scale: 1.7 }); door.position.set(L.exit.x + 0.5, L.exit.y, -0.45); R.add(door);
  const glow = new THREE.PointLight('#ffd27a', 2.5, 4, 2); glow.position.set(L.exit.x + 0.5, L.exit.y + 1, 0.4); R.add(glow);
  T.door = door; T.doorGlow = glow;
  const star = await prop('star', { scale: 1.6 }); star.position.set(L.exit.x + 0.5, L.exit.y + 2.1, -0.45); R.add(star); T.star = star;

  // the sun's shadow box follows the camera; keep it tight around the level
  stage.sun.shadow.camera.left = -L.W / 2 - 4; stage.sun.shadow.camera.right = L.W / 2 + 4;
  stage.sun.shadow.camera.top = L.H / 2 + 6; stage.sun.shadow.camera.bottom = -L.H / 2 - 4;
  stage.sun.shadow.camera.updateProjectionMatrix();
  stage.sun.target.position.set(L.W / 2, L.H / 2, 0); stage.sun.position.set(L.W / 2 - 8, L.H / 2 + 16, 12);
  if (my !== buildSeq) { R.removeFromParent(); return; } // a newer stage started while this one loaded
  things = T; cam = null;
}

function clear() {
  things = null;
  for (const k of ['a', 'b']) if (heroes[k]) { heroes[k].group.removeFromParent(); heroes[k].av.dispose?.(); }
  heroes = {};
  if (root) { root.removeFromParent(); root.traverse((o) => { if (o.isInstancedMesh) o.dispose(); }); root = null; }
  fx.forEach((f) => f.obj.removeFromParent()); fx = [];
}

/* ---------- heroes ---------- */
function nameTag(text, color) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 72;
  const g = c.getContext('2d');
  g.font = '700 38px Fredoka, sans-serif';
  const w = Math.min(240, g.measureText(text).width + 36);
  g.fillStyle = '#2b2140'; g.beginPath(); g.roundRect((256 - w) / 2, 8, w, 54, 27); g.fill();
  g.fillStyle = color; g.beginPath(); g.roundRect((256 - w) / 2 + 4, 12, w - 8, 46, 23); g.fill();
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 128, 37);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.scale.set(1.3, 0.37, 1); s.renderOrder = 10; return s;
}
async function makeAvatar(look) {
  if (look && look.kind === 'human') { try { return await createHuman({ style: look.style, skin: look.skin, hair: look.hair, top: look.top, bottom: look.bottom, acc: look.acc }); } catch (e) { /* fall back to the critter */ } }
  return createCritter((look && look.critter) || '🐼');
}
let heroSeq = 0;
export async function setHeroes(looks, names) {
  const my = ++heroSeq;
  for (const k of ['a', 'b']) {
    const av0 = await makeAvatar(looks[k]);
    if (my !== heroSeq) { av0.dispose?.(); return; }
    if (heroes[k]) { heroes[k].group.removeFromParent(); heroes[k].av.dispose?.(); }
    const col = k === 'a' ? PINK : BLUE;
    const av = av0;
    const group = new THREE.Group();
    const fit = 0.95 / (av.height || 1);
    av.root.scale.setScalar(fit);
    group.add(av.root);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.05, 8, 28), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.6 }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.03; group.add(ring);
    const tag = nameTag(names[k] || (k === 'a' ? 'Pink' : 'Blue'), col); tag.position.y = 1.45; group.add(tag);
    stage.scene.add(group);
    heroes[k] = { av, group, tag, ring, face: 1, turn: Math.PI / 2, wasGround: true, shown: true };
  }
}

/* ---------- each frame ---------- */
const v3 = new THREE.Vector3();
export function render(W, dt, opts = {}) {
  if (!stage || !root || !things || !W) return;
  timeT += dt;
  const L = W.L;
  for (const k of ['a', 'b']) {
    const h = W[k], hv = heroes[k];
    if (!hv) continue;
    const visible = !h.inDoor && !(h.dead > 0);
    hv.group.visible = visible;
    hv.group.position.set(h.x, h.y, 0);
    const moving = Math.abs(h.vx) > 0.4;
    if (h.vx > 0.3) hv.face = 1; else if (h.vx < -0.3) hv.face = -1;
    const want = hv.face > 0 ? Math.PI / 2 : -Math.PI / 2;
    // turn to face the way you walk, with a little three-quarter view toward the camera
    hv.turn += (want * 0.82 - hv.turn) * Math.min(1, dt * 12);
    hv.av.root.rotation.y = hv.turn;
    if (!h.ground) hv.av.play(h.vy > 0 ? 'jump' : 'fall');
    else hv.av.play(moving ? 'run' : 'idle');
    if (h.ground && !hv.wasGround) hv.av.land?.(6);
    hv.wasGround = h.ground;
    hv.av.update(dt, Math.abs(h.vx));
    hv.ring.material.emissiveIntensity = 0.5 + Math.sin(timeT * 4) * 0.2;
  }
  // keys, locks, buttons, gates, crates, lifts, flags
  W.keys.forEach((key, i) => { const m = things.keys[i]; if (!m) return; m.visible = !key.used; m.position.set(key.x, key.y + (key.holder ? 0.1 : Math.sin(timeT * 3 + i) * 0.08), key.holder ? 0.25 : 0); m.rotation.y = key.holder ? 0 : timeT * 1.6; });
  W.locks.forEach((l, i) => { const m = things.locks[i]; if (!m) return; if (l.open && m.visible) { m.userData.t = (m.userData.t || 0) + dt; m.scale.setScalar(Math.max(0.01, 1 - m.userData.t * 3)); if (m.userData.t > 0.35) m.visible = false; } });
  L.buttons.forEach((b, i) => { const m = things.buttons[i]; if (m) m.scale.y += ((W.pressed[b.n] ? 0.35 : 1) - m.scale.y) * Math.min(1, dt * 18); });
  L.gates.forEach((g, i) => {
    const m = things.gates[i]; if (!m) return;
    const closed = g.inverted ? W.pressed[g.n] : !W.pressed[g.n];
    const ty = closed ? m.userData.base : m.userData.base - 0.96;
    m.position.y += (ty - m.position.y) * Math.min(1, dt * 12);
  });
  W.crates.forEach((c, i) => { const m = things.crates[i]; if (m) m.position.set(c.x, c.y, -0.1); });
  W.lifts.forEach((l, i) => { const m = things.lifts[i]; if (m) m.position.y = l.y + l.off; });
  W.flags.forEach((f, i) => { const m = things.flags[i]; if (m) { const s = f.on ? 1.25 : 1; m.scale.setScalar(m.scale.x + (s - m.scale.x) * dt * 6); } });
  things.star.rotation.y = timeT * 1.4; things.star.position.y = L.exit.y + 2.1 + Math.sin(timeT * 2) * 0.08;
  things.doorGlow.intensity = 2.2 + Math.sin(timeT * 3) * 0.6 + (W.a.inDoor || W.b.inDoor ? 2 : 0);
  things.clouds.forEach((c) => { c.position.x += c.userData.v * dt; if (c.position.x > L.W + 12) c.position.x = -12; });
  // effects
  fx = fx.filter((f) => { f.t += dt; f.update(f, dt); if (f.t > f.life) { f.obj.removeFromParent(); return false; } return true; });
  frameCamera(W, dt, opts);
}

// Keep both heroes in view (or follow `focus` when one of you is in the door), eased, clamped to the level.
function frameCamera(W, dt, opts) {
  const L = W.L, cvs = stage.renderer.domElement, aspect = (cvs.clientWidth || 16) / (cvs.clientHeight || 9);
  const pts = ['a', 'b'].map((k) => W[k]).filter((h) => !h.inDoor && !(h.dead > 0));
  if (!pts.length) pts.push({ x: L.exit.x + 0.5, y: L.exit.y });
  const minX = Math.min(...pts.map((p) => p.x)), maxX = Math.max(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y)), maxY = Math.max(...pts.map((p) => p.y));
  const fov = (stage.camera.fov * Math.PI) / 180;
  const needH = Math.max(8.5, maxY - minY + 5.5, (maxX - minX + 7) / aspect);
  let dist = needH / 2 / Math.tan(fov / 2);
  const maxH = Math.max(L.H + 2, (L.W + 2) / aspect);
  dist = Math.min(dist, maxH / 2 / Math.tan(fov / 2));
  const halfH = Math.tan(fov / 2) * dist, halfW = halfH * aspect;
  let cx = (minX + maxX) / 2, cy = (minY + maxY) / 2 + 1.2;
  cx = Math.max(-0.5 + halfW, Math.min(L.W + 0.5 - halfW, cx)); if (halfW * 2 > L.W + 1) cx = L.W / 2;
  cy = Math.max(-0.6 + halfH, Math.min(L.H + 2 - halfH, cy)); if (halfH * 2 > L.H + 2.6) cy = (L.H + 1.4) / 2;
  if (!cam) cam = { x: cx, y: cy, d: dist };
  const k = Math.min(1, dt * (opts.snap ? 60 : 3.2));
  cam.x += (cx - cam.x) * k; cam.y += (cy - cam.y) * k; cam.d += (dist - cam.d) * k;
  stage.camera.position.set(cam.x, cam.y + cam.d * 0.08, cam.d);
  stage.camera.lookAt(cam.x, cam.y, 0);
}

/* ---------- effects ---------- */
function puff(x, y, color, n = 10) {
  const g = new THREE.Group(), mat = new THREE.MeshStandardMaterial({ color, roughness: 1, transparent: true });
  const parts = [];
  for (let i = 0; i < n; i++) { const s = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12 + Math.random() * 0.1, 0), mat); g.add(s); parts.push({ s, vx: (Math.random() - 0.5) * 4, vy: Math.random() * 4 + 1 }); }
  g.position.set(x, y, 0.2); root.add(g);
  fx.push({ obj: g, t: 0, life: 0.7, update: (f, dt) => { parts.forEach((p) => { p.vy -= 12 * dt; p.s.position.x += p.vx * dt; p.s.position.y += p.vy * dt; }); mat.opacity = Math.max(0, 1 - f.t / f.life); } });
}
export function event(e, W) {
  if (!W) return;
  const h = e.k && W[e.k];
  if (e.t === 'die' && h) puff(h.x, h.y + 0.4, e.k === 'a' ? PINK : BLUE, 16);
  else if (e.t === 'respawn' && h) puff(h.x, h.y + 0.3, '#ffffff', 8);
  else if (e.t === 'jump' && h) heroes[e.k]?.av.play('jump', { force: true });
  else if (e.t === 'land' && h) { heroes[e.k]?.av.land?.(e.v); if (e.v > 10) puff(h.x, h.y, '#e8dcc8', 6); }
  else if (e.t === 'key' && h) heroes[e.k]?.av.play('yes', { force: true });
  else if (e.t === 'unlock' && h) puff(h.x + h.face * 0.7, h.y + 0.5, '#ffd34d', 14);
  else if (e.t === 'door-in' && h) puff(h.x, h.y + 0.5, '#ffd27a', 10);
  else if (e.t === 'clear') ['a', 'b'].forEach((k) => heroes[k]?.av.setMood?.('cheer'));
}

export function resize() { stage && stage.resize(); }
export function dispose() { clear(); if (stage) { stage.dispose(); stage = null; } }
export const getStage = () => stage;

window.CoopView = { init, build, setHeroes, render, event, resize, dispose, getStage };
window.dispatchEvent(new Event('coopview-ready'));
