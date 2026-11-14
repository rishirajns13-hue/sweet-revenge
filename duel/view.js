/* Island Duel in 3D: a sunny sea, two sandy islands (they crater where bombs land), forts of wooden, stone
   and glass blocks, your critters (or Locked In humans) with health bars, a wooden slingshot, palms, rocks
   and ships on the horizon (Kenney's CC0 Pirate Kit). The camera shows both islands while you aim and
   follows the shot in flight. Only this page loads it.
     await DuelView.init(canvas); await DuelView.build(state, looks, names); DuelView.frame(W or state, dt, aim) */
import * as THREE from 'three';
import { createStage } from '../shared/3d/stage.js?v=1';
import { models } from '../shared/3d/assets.js';
import { createCritter } from '../shared/3d/critters3d.js?v=1';
import { createHuman } from '../shared/3d/people.js?v=1';
import { tex } from '../shared/3d/textures.js';

const S = window.DuelSim, C = S.C;
const SEAT_COL = { a: '#ff5fa8', b: '#3f9bff' };
let stage = null, world = null, sea = null, terrainMesh = null, terrainKey = '', blocks = new Map(), crit = {}, shots = new Map(), fx = [], slings = {}, cam = null, t = 0, follow = null, shake = 0, aimDots = null, decor = null, hpShown = {};

function rnd(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
async function prop(name, opts) { return models.get('pirate/' + name, { shadows: true, ...opts }); }

export async function init(canvas) {
  stage = createStage(canvas, { background: '#8fd3ff', fov: 32, bloom: 0.2 });
  stage.setGrade({ vignette: 0.2, warmth: 0.03, sat: 1.1 });
  const hemi = new THREE.HemisphereLight('#ffffff', '#4f8fa0', 1.2); stage.scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff1d6', 2.2); sun.position.set(-14, 26, 18); sun.target.position.set(0, 0, 0);
  stage.addShadowLight(sun, { size: 36 }); stage.scene.add(sun, sun.target);
  sun.shadow.camera.far = 90; sun.shadow.camera.updateProjectionMatrix();
  // sky: a soft vertical gradient
  const c = document.createElement('canvas'); c.width = 4; c.height = 256;
  const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, '#5fb8ff'); gr.addColorStop(0.75, '#cfeeff'); gr.addColorStop(1, '#fff3d9');
  g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
  const sky = new THREE.CanvasTexture(c); sky.colorSpace = THREE.SRGBColorSpace; stage.scene.background = sky;
  stage.scene.fog = new THREE.Fog('#d8f1ff', 60, 150);
  // the sea: a grid whose waves are moved on the CPU (only ~1,700 points), glossy teal
  const geo = new THREE.PlaneGeometry(260, 190, 64, 30); geo.rotateX(-Math.PI / 2); geo.translate(0, 0, -15);
  const col = new THREE.MeshStandardMaterial({ color: '#2bb3c9', roughness: 0.25, metalness: 0.05, flatShading: true }); // solid: the islands' roots stay hidden
  sea = new THREE.Mesh(geo, col); sea.receiveShadow = true; sea.userData.base = Float32Array.from(geo.attributes.position.array);
  stage.scene.add(sea);
  stage.start(() => {});
  return stage;
}

/* ---------- islands ---------- */
function terrainGeometry(terrain) {
  // For each island (a run of samples above the sea floor): a top strip running back into the scene, and a
  // front face down to the deep. Sand by the water, grass on top, vertex colours (no textures needed).
  const pos = [], colr = [], idx = [];
  const sand = new THREE.Color('#f3d49c'), grass = new THREE.Color('#86cf62'), wet = new THREE.Color('#d8b47a'), earth = new THREE.Color('#c98955');
  const zBack = -4.5, zFront = 1.6, rows = [zBack, -2.2, -0.6, zFront];
  let i = 0;
  while (i < S.N) {
    if (terrain[i] <= -3.4) { i++; continue; }
    let j = i; while (j + 1 < S.N && terrain[j + 1] > -3.4) j++;
    const base = pos.length / 3;
    for (let k = i; k <= j; k++) {
      const x = S.xAt(k), h = terrain[k];
      for (const z of rows) {
        const sway = z === zBack ? -0.6 : z === rows[1] ? -0.15 : 0;  // the back of the island dips a little
        const y = h + sway;
        pos.push(x, y, z);
        const c = y < 0.5 ? wet : y < 2.3 ? sand : grass;
        const n = 0.94 + ((k * 7 + rows.indexOf(z) * 3) % 5) * 0.02;
        colr.push(c.r * n, c.g * n, c.b * n);
      }
      pos.push(x, h, zFront + 0.001); colr.push(earth.r, earth.g, earth.b);       // front face top
      pos.push(x, -6, zFront + 0.001); colr.push(earth.r * 0.6, earth.g * 0.6, earth.b * 0.6); // front face bottom
    }
    const per = rows.length + 2;
    for (let k = 0; k < j - i; k++) {
      const a = base + k * per, b = a + per;
      for (let r = 0; r < rows.length - 1; r++) idx.push(a + r, a + r + 1, b + r, b + r, a + r + 1, b + r + 1);
      idx.push(a + rows.length, a + rows.length + 1, b + rows.length, b + rows.length, a + rows.length + 1, b + rows.length + 1);
    }
    i = j + 1;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  geo.setIndex(idx); geo.computeVertexNormals();
  return geo;
}
function setTerrain(terrain) {
  const key = terrain.join(',');
  if (key === terrainKey) return;
  terrainKey = key;
  const geo = terrainGeometry(terrain);
  if (!terrainMesh) {
    terrainMesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true, side: THREE.DoubleSide }));
    terrainMesh.receiveShadow = true; terrainMesh.castShadow = true; world.add(terrainMesh);
  } else { terrainMesh.geometry.dispose(); terrainMesh.geometry = geo; }
}

/* ---------- blocks ---------- */
const MAT = {};
function blockMaterial(kind) {
  if (MAT[kind]) return MAT[kind];
  if (kind === 'wood') { const t = tex.planks({ base: '#b97a45', dark: '#8f5a30', light: '#d39a5f' }); MAT.wood = new THREE.MeshStandardMaterial({ map: t, roughness: 0.8 }); }
  else if (kind === 'stone') MAT.stone = new THREE.MeshStandardMaterial({ color: '#8a90a6', roughness: 0.9, flatShading: true });
  else MAT.glass = new THREE.MeshPhysicalMaterial({ color: '#7fd0ff', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.5, clearcoat: 1, depthWrite: false, emissive: '#3aa9e8', emissiveIntensity: 0.15 });
  return MAT[kind];
}
function makeBlock(b) {
  const geo = b.kind === 'stone' ? new THREE.BoxGeometry(b.w, b.h, 1.3, 2, 2, 1) : new THREE.BoxGeometry(b.w, b.h, 1.3);
  if (b.kind === 'wood' && MAT.wood && MAT.wood.map) { MAT.wood.map.repeat.set(1, 1); }
  const m = new THREE.Mesh(geo, blockMaterial(b.kind).clone());
  m.castShadow = b.kind !== 'glass'; m.receiveShadow = true;
  // a dark outline edge so blocks read clearly at a distance (cartoon look)
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: '#3b2a3f', transparent: true, opacity: 0.55 }));
  m.add(edges);
  m.userData = { kind: b.kind, max: S.MATERIAL[b.kind].hp, base: m.material.color.clone() };
  world.add(m);
  return m;
}

/* ---------- critters ---------- */
function hpTag(color) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tx, depthTest: false, transparent: true }));
  s.scale.set(1.9, 0.48, 1); s.renderOrder = 10;
  s.userData.draw = (name, hp) => {
    const g = c.getContext('2d'); g.clearRect(0, 0, 256, 64);
    g.fillStyle = '#2b2140'; g.beginPath(); g.roundRect(4, 4, 248, 56, 18); g.fill();
    g.fillStyle = '#ffffff'; g.beginPath(); g.roundRect(10, 34, 236, 20, 10); g.fill();
    g.fillStyle = hp > 50 ? '#2bc48a' : hp > 25 ? '#ffc233' : '#ff5a5f'; g.beginPath(); g.roundRect(12, 36, Math.max(0, 232 * hp / 100), 16, 8); g.fill();
    g.fillStyle = color; g.font = '700 24px Fredoka, sans-serif'; g.textBaseline = 'middle'; g.fillText(name, 16, 19);
    g.fillStyle = '#fff'; g.textAlign = 'right'; g.fillText(Math.round(hp) + ' ❤', 240, 19); g.textAlign = 'left';
    tx.needsUpdate = true;
  };
  return s;
}
async function makeAvatar(look) {
  if (look && look.kind === 'human') { try { return await createHuman({ style: look.style, skin: look.skin, hair: look.hair, top: look.top, bottom: look.bottom, acc: look.acc }); } catch (e) { /* critter instead */ } }
  return createCritter((look && look.critter) || '🐼');
}
async function makeSling(seat, state) {
  const p = S.slingPos(state, seat), g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: '#8a5531', roughness: 0.8 });
  const post = (x0, y0, x1, y1, r = 0.11) => { const a = new THREE.Vector3(x0, y0, 0), b = new THREE.Vector3(x1, y1, 0); const len = a.distanceTo(b); const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.1, len, 8), wood); m.position.copy(a).add(b).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()); m.castShadow = true; g.add(m); };
  const ground = p.y - C.slingY;
  post(0, ground - 0.2, 0, ground + 1.0, 0.14); post(0, ground + 1.0, -0.45, ground + 1.75); post(0, ground + 1.0, 0.45, ground + 1.75);
  const band = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.45, ground + 1.7, 0), new THREE.Vector3(0, p.y, 0.05), new THREE.Vector3(0.45, ground + 1.7, 0)]), new THREE.LineBasicMaterial({ color: '#4a2a3a' }));
  g.add(band);
  const pouch = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), new THREE.MeshStandardMaterial({ color: '#5a3424', roughness: 1 })); pouch.position.set(0, p.y, 0.05); g.add(pouch);
  g.position.x = p.x; g.userData = { band, pouch, rest: new THREE.Vector3(0, p.y, 0.05), top: ground + 1.7 };
  world.add(g);
  return g;
}

export async function build(state, looks, names) {
  if (world) { world.removeFromParent(); world.traverse((o) => { o.geometry?.dispose(); }); }
  world = new THREE.Group(); stage.scene.add(world);
  terrainMesh = null; terrainKey = ''; blocks = new Map(); shots = new Map(); fx = []; crit = {}; slings = {}; hpShown = {};
  setTerrain(state.terrain);
  for (const b of state.blocks) blocks.set(b.id, makeBlock(b));
  for (const seat of ['a', 'b']) {
    const av = await makeAvatar(looks[seat]);
    const grp = new THREE.Group(); av.root.scale.setScalar(1.3 / (av.height || 1)); av.root.position.y = -C.critterR;
    av.root.rotation.y = seat === 'a' ? Math.PI / 2 * 0.75 : -Math.PI / 2 * 0.75; grp.add(av.root);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.06, 8, 24), new THREE.MeshStandardMaterial({ color: SEAT_COL[seat], emissive: SEAT_COL[seat], emissiveIntensity: 0.6 }));
    ring.rotation.x = Math.PI / 2; ring.position.y = -C.critterR + 0.03; grp.add(ring);
    const tag = hpTag(SEAT_COL[seat]); tag.position.y = 1.35; grp.add(tag);
    world.add(grp);
    crit[seat] = { grp, av, tag, name: names[seat] };
    slings[seat] = await makeSling(seat, state);
  }
  // decoration (seeded, mirrored like the islands): palms, rocks, barrels, flags; ships on the horizon
  const r = rnd(state.seed);
  decor = new THREE.Group(); world.add(decor);
  const put = async (name, x, z, s = 1, ry = 0) => { const m = await prop(name, { scale: s }); m.position.set(x, S.groundAt(state.terrain, x) - 0.05, z); m.rotation.y = ry; decor.add(m); return m; };
  for (const side of [-1, 1]) {
    for (let k = 0; k < 4; k++) await put(['palm-straight', 'palm-bend', 'palm-detailed-straight'][Math.floor(r() * 3)], side * (C.islandCentre - 8 + k * 4.3 + r()), -2.6 - r() * 1.4, 0.75 + r() * 0.25, r() * 6);
    await put('rocks-sand-a', side * (C.islandCentre + C.islandHalf + 1.5), -1.2, 0.6, r() * 6);
    await put('rocks-sand-b', side * (C.islandCentre - C.islandHalf - 1.8), -2.2, 0.55, r() * 6);
    await put('barrel', side * (C.sling + 2.2), -0.6, 0.55, r() * 6);
    await put('crate', side * (C.sling - 2.0), -1.0, 0.7, r() * 6);
    const flag = await put('flag-pirate', side * (C.islandCentre - 1), -1.6, 0.9, side > 0 ? Math.PI : 0);
    flag.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.color.lerp(new THREE.Color(side < 0 ? SEAT_COL.a : SEAT_COL.b), 0.35); } });
  }
  const ship = await prop('ship-pirate-medium', { scale: 0.9 }); ship.position.set(-40, -0.3, -46); ship.rotation.y = Math.PI / 2; decor.add(ship); ship.userData.sail = 0.6;
  const ship2 = await prop('ship-small', { scale: 0.8 }); ship2.position.set(30, -0.3, -58); ship2.rotation.y = -Math.PI / 2; decor.add(ship2); ship2.userData.sail = -0.4;
  decor.userData.ships = [ship, ship2];
  // the aim arc: little dots for the first part of the flight
  aimDots = new THREE.Group();
  for (let i = 0; i < 14; i++) { const d = new THREE.Mesh(new THREE.SphereGeometry(0.17 - i * 0.007, 10, 8), new THREE.MeshBasicMaterial({ color: i % 2 ? '#ffe27a' : '#ffffff', transparent: true, opacity: 1 - i * 0.055, depthTest: false })); d.renderOrder = 11; aimDots.add(d); }
  aimDots.visible = false; world.add(aimDots);
  cam = null; follow = null;
}

/* ---------- per frame ---------- */
const shotLook = {
  rock: () => new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 1), new THREE.MeshStandardMaterial({ color: '#7d7f8c', roughness: 0.9, flatShading: true })),
  bomb: () => { const g = new THREE.Group(); g.add(new THREE.Mesh(new THREE.SphereGeometry(0.36, 16, 12), new THREE.MeshStandardMaterial({ color: '#2b2b38', roughness: 0.4 }))); const f = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffb347' })); f.position.set(0.15, 0.36, 0); g.add(f); return g; },
  split: () => new THREE.Mesh(new THREE.IcosahedronGeometry(0.26, 1), new THREE.MeshStandardMaterial({ color: '#ffd34d', emissive: '#ffb000', emissiveIntensity: 0.4, flatShading: true })),
  bounce: () => new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 12), new THREE.MeshStandardMaterial({ color: '#ff6b3d', roughness: 0.35 })),
  anvil: () => new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.65, 0.6), new THREE.MeshStandardMaterial({ color: '#4a4d5e', roughness: 0.5, metalness: 0.4 })),
};
export function frame(W, dt, aim) {
  if (!stage || !world) return;
  t += dt;
  const live = W && W.world; // a running turn (planck world) or just a settled state
  const st = live ? W.state : W;
  setTerrain(st.terrain);
  // blocks
  const seen = new Set();
  if (live) for (const [id, body] of W.bodies) { const m = blocks.get(id); if (!m) continue; const p = body.getPosition(); m.position.set(p.x, p.y, 0); m.rotation.z = body.getAngle(); seen.add(id); }
  else for (const b of st.blocks) { const m = blocks.get(b.id); if (!m) continue; m.position.set(b.x, b.y, 0); m.rotation.z = b.a; seen.add(b.id); }
  // damaged blocks get darker (their own colour, shaded)
  for (const b of st.blocks) { const m = blocks.get(b.id); if (m) { const k = Math.max(0, Math.min(1, b.hp / m.userData.max)); m.material.color.copy(m.userData.base).multiplyScalar(0.55 + 0.45 * k); } }
  for (const [id, m] of blocks) if (!seen.has(id)) { m.removeFromParent(); m.geometry.dispose(); blocks.delete(id); }
  // critters
  for (const seat of ['a', 'b']) {
    const c = crit[seat]; if (!c) continue;
    const body = live && W.critterBody[seat], s = st.critters[seat];
    const p = body ? body.getPosition() : { x: s.x, y: s.y }, a = body ? body.getAngle() : s.a;
    c.grp.position.set(p.x, p.y, 0.1); c.av.root.rotation.z = a * 0.6;
    c.grp.visible = p.y > -1;
    c.av.play(s.hp <= 0 ? 'fall' : aim && aim.seat === seat ? 'idle' : 'idle');
    c.av.update(dt, 0);
    if (hpShown[seat] !== Math.round(s.hp)) { hpShown[seat] = Math.round(s.hp); c.tag.userData.draw(c.name, s.hp); }
    c.tag.position.y = 1.55;
  }
  // shots
  const live2 = new Set();
  if (live) for (const s of W.shots) {
    const u = s.getUserData(); live2.add(s);
    let m = shots.get(s); if (!m) { m = (shotLook[u.child ? 'split' : u.weapon] || shotLook.rock)(); m.castShadow = true; if (u.child) m.scale.setScalar(0.75); world.add(m); shots.set(s, m); }
    const p = s.getPosition(); m.position.set(p.x, p.y, 0); m.rotation.z = s.getAngle();
  }
  for (const [s, m] of shots) if (!live2.has(s)) { m.removeFromParent(); shots.delete(s); }
  // slingshot band pulled back while aiming
  for (const seat of ['a', 'b']) {
    const sl = slings[seat]; if (!sl) continue;
    const pull = aim && aim.seat === seat ? aim : null, pr = sl.userData.rest;
    const target = pull ? new THREE.Vector3(-Math.cos(pull.angle) * pull.power * 1.1 * (seat === 'a' ? 1 : -1), pr.y - Math.sin(pull.angle) * pull.power * 1.1, 0.05) : pr;
    sl.userData.pouch.position.lerp(target, Math.min(1, dt * 18));
    const pts = sl.userData.band.geometry.attributes.position; pts.setXYZ(1, sl.userData.pouch.position.x, sl.userData.pouch.position.y, 0.05); pts.needsUpdate = true;
  }
  // aim arc
  if (aim && aim.show) {
    const sp = S.slingPos(st, aim.seat), v = S.launchVel(aim.seat, aim.angle, aim.power);
    aimDots.visible = true;
    aimDots.children.forEach((d, i) => { const tt = (i + 1) * 0.065; d.position.set(sp.x + v.vx * tt + 0.5 * st.wind * tt * tt, sp.y + v.vy * tt + 0.5 * C.gravity * tt * tt, 0.2); });
  } else aimDots.visible = false;
  // sea waves, ships drifting
  const pos = sea.geometry.attributes.position, base = sea.userData.base;
  for (let i = 0; i < pos.count; i++) { const x = base[i * 3], z = base[i * 3 + 2]; pos.array[i * 3 + 1] = Math.sin(x * 0.35 + t * 1.3) * 0.12 + Math.cos(z * 0.5 + t * 0.9) * 0.1 - 0.05; }
  pos.needsUpdate = true; sea.geometry.computeVertexNormals();
  decor && decor.userData.ships && decor.userData.ships.forEach((s) => { s.position.x += s.userData.sail * dt; if (s.position.x > 70) s.position.x = -70; if (s.position.x < -70) s.position.x = 70; s.rotation.z = Math.sin(t * 0.8 + s.position.x) * 0.03; });
  fx = fx.filter((f) => { f.t += dt; f.update(f, dt); if (f.t > f.life) { f.obj.removeFromParent(); return false; } return true; });
  frameCamera(W, st, dt, aim);
}

function frameCamera(W, st, dt, aim) {
  const cvs = stage.renderer.domElement, aspect = (cvs.clientWidth || 16) / (cvs.clientHeight || 9), fov = (stage.camera.fov * Math.PI) / 180;
  let cx = 0, cy = 4, half = 33; // overview: both islands
  const flying = W && W.world && W.shots.find((s) => !s.getUserData().done);
  if (flying) { const p = flying.getPosition(); follow = { x: p.x, y: p.y }; }
  if (follow && flying) { cx = follow.x * 0.75; cy = Math.max(4, follow.y * 0.7 + 1.5); half = 22; }
  else if (aim && aim.seat) { cx = (aim.seat === 'a' ? -1 : 1) * 9; cy = 4.5; half = 25; } // aiming: your island big, theirs in view
  const halfH = half / aspect;
  let dist = Math.max(halfH, 9) / Math.tan(fov / 2);
  if (!cam) cam = { x: cx, y: cy, d: dist };
  const k = Math.min(1, dt * (flying ? 2.5 : 1.6));
  cam.x += (cx - cam.x) * k; cam.y += (cy - cam.y) * k; cam.d += (dist - cam.d) * k;
  const sx = shake > 0 ? (Math.random() - 0.5) * shake : 0, sy = shake > 0 ? (Math.random() - 0.5) * shake : 0;
  shake = Math.max(0, shake - dt * 2.2);
  stage.camera.position.set(cam.x + sx, cam.y + cam.d * 0.16 + sy, cam.d);
  stage.camera.lookAt(cam.x, cam.y - 1, 0);
}

/* ---------- effects ---------- */
function burst(x, y, color, n, { speed = 6, size = 0.16, life = 0.8, up = 3, z = 0.3, gravity = 14 } = {}) {
  const g = new THREE.Group(), mat = new THREE.MeshStandardMaterial({ color, roughness: 1, transparent: true, flatShading: true });
  const parts = [];
  for (let i = 0; i < n; i++) { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(size * (0.6 + Math.random() * 0.8), 0), mat); g.add(m); const a = Math.random() * Math.PI * 2; parts.push({ m, vx: Math.cos(a) * speed * Math.random(), vy: Math.abs(Math.sin(a)) * speed * Math.random() + up, vz: (Math.random() - 0.5) * 3 }); }
  g.position.set(x, y, z); world.add(g);
  fx.push({ obj: g, t: 0, life, update: (f, dt) => { parts.forEach((p) => { p.vy -= gravity * dt; p.m.position.x += p.vx * dt; p.m.position.y += p.vy * dt; p.m.position.z += p.vz * dt; p.m.rotation.x += dt * 4; }); mat.opacity = Math.max(0, 1 - f.t / f.life); } });
}
function flash(x, y, r) {
  const light = new THREE.PointLight('#ffb347', 30, r * 5, 2); light.position.set(x, y, 1.5); world.add(light);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(r * 0.6, 16, 12), new THREE.MeshBasicMaterial({ color: '#ffd27a', transparent: true }));
  ball.position.set(x, y, 0.4); world.add(ball);
  fx.push({ obj: light, t: 0, life: 0.35, update: (f) => { light.intensity = 30 * (1 - f.t / f.life); } });
  fx.push({ obj: ball, t: 0, life: 0.3, update: (f) => { const k = f.t / f.life; ball.scale.setScalar(0.6 + k * 1.4); ball.material.opacity = 1 - k; } });
}
function floatText(x, y, text, color = '#ff5a5f') {
  const c = document.createElement('canvas'); c.width = 256; c.height = 96; const g = c.getContext('2d');
  g.font = '700 64px Lilita One, Fredoka, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 10; g.strokeStyle = '#2b2140'; g.strokeText(text, 128, 48); g.fillStyle = color; g.fillText(text, 128, 48);
  const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tx, depthTest: false, transparent: true })); s.scale.set(2.2, 0.82, 1); s.position.set(x, y, 1); s.renderOrder = 12; world.add(s);
  fx.push({ obj: s, t: 0, life: 1.2, update: (f, dt) => { s.position.y += dt * 1.2; s.material.opacity = 1 - Math.max(0, f.t - 0.6) / 0.6; } });
}
const BLOCK_COL = { wood: '#b97a45', stone: '#a9adbb', glass: '#d6f3ff' };
export function event(e, W) {
  if (!world) return;
  if (e.t === 'boom') { flash(e.x, e.y, e.r); burst(e.x, e.y, '#ff8a3d', 14, { speed: 7, up: 2 }); burst(e.x, e.y, '#6b6470', 10, { speed: 4, up: 4, life: 1.1, gravity: 4, size: 0.3 }); shake = Math.min(1.2, 0.4 + e.r * 0.25); }
  else if (e.t === 'crater') burst(e.x, e.y, '#f3d49c', 12, { speed: 5, up: 4 });
  else if (e.t === 'break') burst(e.x, e.y, BLOCK_COL[e.kind] || '#ccc', e.kind === 'glass' ? 14 : 9, { speed: 4, size: e.kind === 'glass' ? 0.1 : 0.16 });
  else if (e.t === 'splash') { burst(e.x, 0.1, '#e8fbff', e.big ? 26 : 12, { speed: e.big ? 4 : 2.5, up: e.big ? 6 : 4, life: 1, size: 0.14 }); }
  else if (e.t === 'split') burst(e.x, e.y, '#ffd34d', 8, { speed: 3, up: 1, life: 0.5, gravity: 2, size: 0.1 });
  else if (e.t === 'hurt') { const c = crit[e.seat]; if (c) { floatText(c.grp.position.x, c.grp.position.y + 1.9, '-' + e.amount); c.av.play('no', { force: true }); } }
  else if (e.t === 'fire') { const sl = slings[e.seat]; if (sl) sl.userData.pouch.position.copy(sl.userData.rest); }
  else if (e.t === 'over') { if (e.winner && crit[e.winner]) crit[e.winner].av.play('yes', { force: true }); }
}
export function resize() { stage && stage.resize(); }
export function dispose() { if (stage) { stage.dispose(); stage = null; } world = null; }
export const getStage = () => stage;
window.DuelView = { init, build, frame, event, resize, dispose, getStage };
