/* Critters in 3D: the player's own Sweet Revenge critter (shared/avatars.js) as a round, bouncy little
   creature. The body is one soft ball in the critter's colour with its face (eyes, blush, mouth, markings,
   and the chosen face accessory) drawn from the same SVG art and projected onto the front, so it is
   unmistakably *their* critter. Ears, horns, tentacles and hats are small 3D shapes. It animates in code
   (waddle, run, hop, squash on landing, wave, cheer), so every critter works without a rig.
     const c = createCritter('🦊~3a'); scene.add(c.root); c.play('walk'); c.update(dt); c.setMood('cheer');
   Same play()/update() names as people.js, so the games don't care which one a player picked. */
import * as THREE from 'three';

const INK = '#2b2140';
const R = 0.42;                    // body radius (metres)
// 3D features per critter: what sticks out of the ball. Colours follow the critter's body unless given.
const FEATURES = {
  '😎': { cherry: true, drips: true },
  '🥰': { ears: 'long', inner: '#ffb3cf' },
  '🤓': { ears: 'tuft', beak: '#ffb347' },
  '🤠': { hat: 'cowboy', ears: 'floppy', earColour: '#c4956a' },
  '😺': { ears: 'pointy', inner: '#ff9db3', tail: 'cat' },
  '🐼': { ears: 'round', earColour: '#2b2140' },
  '🦊': { ears: 'pointy', inner: '#fff1e6', tail: 'fox' },
  '👻': { ghost: true },
  '🐸': { frogEyes: true },
  '🦄': { horn: true, ears: 'pointy', mane: true },
  '🐯': { ears: 'round', tail: 'tiger' },
  '🤖': { antenna: true, boxy: true },
  '🐙': { tentacles: true },
};
const ACC3D = ['none', 'party', 'crown', 'bow', 'headphones', 'flower', 'face', 'scarf', 'halo', 'horns'];

function toon(colour, extra = {}) { return new THREE.MeshStandardMaterial({ color: colour, roughness: 0.62, metalness: 0, ...extra }); }
const inkMat = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });
// inverted-hull outline: a slightly bigger copy, inside out, in ink colour
function outline(mesh, grow = 1.06) { const o = new THREE.Mesh(mesh.geometry, inkMat); o.scale.setScalar(grow); o.castShadow = false; mesh.add(o); return o; }

// The face texture: the critter's SVG, cropped to the face, on a body-coloured square with a wide margin
// (the margin is what the sides and back of the ball sample, so it must be plain body colour).
async function faceTexture(key, mood, body) {
  // as an image the SVG needs its namespace; crop the view to the face
  const svg = AVATAR_ART.svg(key, mood).replace('<svg viewBox="0 -8 100 108"', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="14 26 72 54" width="512" height="384"');
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await img.decode().catch(() => {});
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 1024;
  const g = cv.getContext('2d');
  g.fillStyle = body; g.fillRect(0, 0, 1024, 1024);
  try { g.drawImage(img, 256, 320, 512, 384); } catch (e) { /* drawing failed: plain ball */ }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
// Sphere whose UVs project straight from the front, so the face sits flat on the front of the ball.
function faceBall() {
  const geo = new THREE.SphereGeometry(R, 40, 28);
  const p = geo.attributes.position, uv = geo.attributes.uv, k = 2.05 * R; // face crop spans ~±0.5R
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    // front half gets the face; behind, push UVs into the margin (plain body colour)
    const s = z > 0 ? 1 : 3;
    uv.setXY(i, 0.5 + (x / k) * 0.5 * s * 0.98, 0.5 + (y / k) * 0.5 * s * 0.98 + 0.02);
  }
  return geo;
}

function ear(kind, colour, inner) {
  const g = new THREE.Group();
  let m;
  if (kind === 'long') { m = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.3, 6, 12), toon(colour)); m.position.y = 0.2; }
  else if (kind === 'pointy') { m = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.22, 4), toon(colour)); m.position.y = 0.09; m.rotation.y = Math.PI / 4; }
  else if (kind === 'floppy') { m = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.16, 6, 10), toon(colour)); m.rotation.z = 1.2; m.position.set(0.08, -0.04, 0); }
  else if (kind === 'tuft') { m = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 6), toon(colour)); m.position.y = 0.07; m.rotation.z = -0.3; }
  else { m = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), toon(colour)); m.scale.set(1, 1, 0.6); m.position.y = 0.04; }
  m.castShadow = true; outline(m, 1.12); g.add(m);
  if (inner && (kind === 'long' || kind === 'pointy')) {
    const i = new THREE.Mesh(kind === 'long' ? new THREE.CapsuleGeometry(0.035, 0.24, 4, 8) : new THREE.ConeGeometry(0.06, 0.14, 4), toon(inner));
    i.position.copy(m.position); i.position.z += 0.05; i.rotation.copy(m.rotation); i.scale.z = 0.5; g.add(i);
  }
  return g;
}

function buildFeatures(base, body, accIndex, root) {
  const f = FEATURES[base] || {};
  const darker = new THREE.Color(body).multiplyScalar(0.82).getStyle();
  const add = (m, x, y, z) => { m.position.set(x, y, z); m.traverse((o) => o.isMesh && (o.castShadow = true)); root.add(m); return m; };
  if (f.ears) {
    const col = f.earColour || body;
    const l = add(ear(f.ears, col, f.inner), -0.24, R * 0.78, 0), r = add(ear(f.ears, col, f.inner), 0.24, R * 0.78, 0);
    l.rotation.z = 0.35; r.rotation.z = -0.35;
    if (f.ears === 'floppy') { l.rotation.z = 0.2; r.rotation.set(0, Math.PI, 0.2); }
  }
  if (f.horn) { const h = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.28, 12), toon('#ffd56b', { emissive: '#ffb84a', emissiveIntensity: 0.15 })); outline(h, 1.12); add(h, 0, R * 1.05, 0.12).rotation.x = 0.35; }
  if (f.mane) { ['#ff9ad0', '#9ab8ff', '#c08bff'].forEach((c, i) => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 10), toon(c)); add(m, -0.05 + i * 0.05, R * 0.88 - i * 0.12, -0.25 - i * 0.05); }); }
  if (f.cherry) { const c = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), toon('#ff4d6d', { roughness: 0.3 })); outline(c, 1.1); add(c, 0, R * 1.08, 0); const st = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.14), toon('#4a7c3a')); add(st, 0.03, R * 1.08 + 0.12, 0).rotation.z = -0.4; }
  if (f.antenna) { const a = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.18), toon('#5b5f7a')); add(a, 0, R * 1.02, 0); const b = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), toon('#ff5a5f', { emissive: '#ff5a5f', emissiveIntensity: 0.8 })); add(b, 0, R * 1.02 + 0.11, 0); }
  if (f.frogEyes) { [-1, 1].forEach((s) => { const e = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), toon(body)); outline(e, 1.1); add(e, s * 0.16, R * 0.85, 0.12); }); }
  if (f.beak) { const b = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.1, 4), toon(f.beak)); b.rotation.x = Math.PI / 2 + 0.3; add(b, 0, -0.02, R * 0.98); }
  if (f.hat === 'cowboy') {
    const hat = new THREE.Group();
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.03, 28), toon('#9b6a3f')); hat.add(brim);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.18, 20), toon('#9b6a3f')); crown.position.y = 0.1; hat.add(crown);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.205, 0.205, 0.04, 20), toon('#ff5a5f')); band.position.y = 0.04; hat.add(band);
    add(hat, 0, R * 0.92, -0.02).rotation.x = -0.12;
  }
  if (f.tail) {
    const col = f.tail === 'fox' ? body : f.tail === 'tiger' ? body : body;
    const t = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, f.tail === 'fox' ? 0.22 : 0.18, 6, 10), toon(col)); outline(t, 1.1);
    add(t, 0.05, -0.18, -R * 0.95).rotation.set(-0.9, 0, 0.3);
    if (f.tail === 'fox') { const tip = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 10), toon('#fff3e6')); tip.position.y = 0.16; t.add(tip); }
  }
  if (f.tentacles) for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; const t = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.12, 6, 10), toon(darker)); outline(t, 1.1); add(t, Math.sin(a) * 0.26, -R * 0.82, Math.cos(a) * 0.26).rotation.set(Math.cos(a) * 0.6, 0, -Math.sin(a) * 0.6); }
  // accessory (face accessories like heart shades are already in the face texture)
  const acc = ACC3D[accIndex] || 'none';
  if (acc === 'party') { const h = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.32, 20), toon('#ff71ce')); outline(h, 1.08); add(h, 0.08, R * 1.12, 0).rotation.z = -0.25; const p = new THREE.Mesh(new THREE.SphereGeometry(0.045), toon('#ffd56b')); add(p, 0.15, R * 1.12 + 0.16, 0); }
  if (acc === 'crown') { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.13, 0.13, 8, 1, true), toon('#ffc233', { metalness: 0.5, roughness: 0.3, side: THREE.DoubleSide })); add(c, 0, R * 0.98, 0); }
  if (acc === 'halo') { const h = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.025, 10, 32), toon('#ffd56b', { emissive: '#ffc233', emissiveIntensity: 1.2 })); h.rotation.x = Math.PI / 2; add(h, 0, R * 1.3, 0); }
  if (acc === 'horns') [-1, 1].forEach((s) => { const h = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 10), toon('#ff5a5f')); add(h, s * 0.17, R * 0.9, 0.05).rotation.z = -s * 0.4; });
  if (acc === 'scarf') { const s = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.06, 10, 28), toon('#ff5a5f')); s.rotation.x = Math.PI / 2; add(s, 0, -R * 0.55, 0); }
  if (acc === 'headphones') { const b = new THREE.Mesh(new THREE.TorusGeometry(R * 1.02, 0.025, 8, 24, Math.PI), toon(INK)); add(b, 0, 0.02, 0); [-1, 1].forEach((s) => { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.07, 16), toon('#4d9de0')); c.rotation.z = Math.PI / 2; add(c, s * R * 1.0, 0.02, 0); }); }
  if (acc === 'bow') { [-1, 1].forEach((s) => { const w = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.12, 4), toon('#ff5a5f')); w.rotation.z = s * Math.PI / 2; add(w, 0.2 + s * 0.07, R * 0.9, 0.05); }); }
  if (acc === 'flower') { const c = new THREE.Mesh(new THREE.SphereGeometry(0.05), toon('#ffc233')); add(c, 0.22, R * 0.88, 0.08); for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2, p = new THREE.Mesh(new THREE.SphereGeometry(0.05), toon('#ffffff')); add(p, 0.22 + Math.cos(a) * 0.07, R * 0.88 + Math.sin(a) * 0.07, 0.06); } }
}

export function createCritter(key, { name } = {}) {
  const look = AVATAR_ART.parse(key), base = AVATAR_ART.C[look.base] || AVATAR_ART.C['😎'];
  const body = look.colour && AVATAR_ART.COLOURS[look.colour] ? AVATAR_ART.COLOURS[look.colour] : base.body;
  const f = FEATURES[look.base] || {};

  const root = new THREE.Group();          // stands on the floor; the game moves and turns this
  const bob = new THREE.Group();           // squash, hop, waddle happen here
  root.add(bob);
  const mat = toon(body, f.ghost ? { transparent: true, opacity: 0.92 } : {});
  const ball = new THREE.Mesh(faceBall(), mat);
  ball.castShadow = true; ball.receiveShadow = true;
  ball.position.y = R + 0.1;
  if (f.boxy) ball.scale.set(1.02, 0.96, 0.92);
  else if (f.ghost) ball.scale.set(1, 1.12, 0.95);
  else ball.scale.set(1, 0.94, 0.92);
  outline(ball, 1.045);
  bob.add(ball);
  const deco = new THREE.Group(); ball.add(deco);
  buildFeatures(look.base, body, look.acc, deco);

  // feet and hands: little dark-ish nubs (ghosts float instead of having feet)
  const limbMat = toon(new THREE.Color(body).multiplyScalar(0.78).getStyle());
  const feet = [], hands = [];
  if (!f.ghost && !f.tentacles) for (const s of [-1, 1]) {
    const ft = new THREE.Mesh(new THREE.SphereGeometry(0.1, 14, 10), limbMat); ft.scale.set(1, 0.65, 1.3); ft.castShadow = true;
    ft.position.set(s * 0.17, 0.065, 0.02); outline(ft, 1.12); bob.add(ft); feet.push(ft);
  }
  for (const s of [-1, 1]) {
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), limbMat); h.castShadow = true;
    h.position.set(s * (R + 0.02), R * 0.8, 0.05); outline(h, 1.14); bob.add(h); hands.push(h);
  }
  if (f.ghost) { const tail = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.3, 16), mat); tail.position.set(0, 0.15, -0.05); tail.rotation.x = Math.PI; bob.add(tail); }

  let mood = 'happy', faceGen = 0;
  async function setMood(m) {
    if (m === mood && ball.material.map) return;
    mood = m; const my = ++faceGen;
    const t = await faceTexture(key, m, body);
    if (my !== faceGen) { t.dispose(); return; }
    const old = mat.map; mat.map = t; mat.color.set('#ffffff'); mat.needsUpdate = true; old && old.dispose();
  }
  setMood('happy');

  // ---- procedural animation ----
  let anim = 'idle', animT = 0, once = 0, phase = 0, squash = 0, sqV = 0;
  function play(name, { force = false } = {}) {
    if (name === anim && !force) return;
    if (once > 0 && !force && !['jump', 'yes', 'no', 'pickup', 'interact'].includes(name)) return;
    anim = name; animT = 0;
    once = { jump: 0.35, yes: 1.1, no: 1.0, pickup: 0.6, interact: 0.5, die: 1.5 }[name] || 0;
    if (name === 'jump') kick(-0.25);
  }
  function kick(v) { sqV += v * 12; }       // squash spring impulse (negative = stretch tall)
  function land(speed) { kick(Math.min(0.5, speed / 14)); }

  function update(dt, moveSpeed = 0) {
    animT += dt; if (once > 0) { once -= dt; if (once <= 0 && ['yes', 'no', 'pickup', 'interact', 'jump'].includes(anim)) anim = 'idle'; }
    // squash spring
    sqV += (-squash * 180 - sqV * 14) * dt; squash += sqV * dt;
    const sq = Math.max(-0.3, Math.min(0.35, squash));
    let y = 0, rollZ = 0, tiltX = 0, handL = 0, handR = 0;
    const walking = anim === 'walk' || anim === 'run';
    if (walking) {
      const rate = anim === 'run' ? 15 : 10;
      phase += dt * rate * Math.max(0.6, moveSpeed / (anim === 'run' ? 4.8 : 2.7));
      y = Math.abs(Math.sin(phase)) * (anim === 'run' ? 0.09 : 0.05);
      rollZ = Math.sin(phase) * (anim === 'run' ? 0.08 : 0.12);  // the waddle
      tiltX = anim === 'run' ? 0.18 : 0.06;
      feet.forEach((ft, i) => { ft.position.z = 0.02 + Math.sin(phase + i * Math.PI) * (anim === 'run' ? 0.12 : 0.08); ft.position.y = 0.065 + Math.max(0, Math.cos(phase + i * Math.PI)) * 0.05; });
      handL = Math.sin(phase) * 0.6; handR = -handL;
    } else {
      feet.forEach((ft) => { ft.position.z += (0.02 - ft.position.z) * Math.min(1, dt * 10); ft.position.y = 0.065; });
      y = Math.sin(animT * 2.2) * 0.012;                             // breathing
    }
    if (anim === 'fall') { tiltX = -0.1; handL = handR = -1.4; }
    if (anim === 'yes' || anim === 'cheer') { y = Math.abs(Math.sin(animT * 9)) * 0.18; handL = handR = -2.2 + Math.sin(animT * 18) * 0.3; }
    if (anim === 'no') { rollZ = Math.sin(animT * 14) * 0.12; }
    if (anim === 'wave') { handR = -2.4 + Math.sin(animT * 12) * 0.5; }
    if (anim === 'pickup' || anim === 'interact') { tiltX = Math.sin(Math.min(1, animT / (anim === 'pickup' ? 0.6 : 0.5)) * Math.PI) * 0.45; handL = handR = -0.8; }
    if (anim === 'carry') { handL = handR = -1.2; }
    if (anim === 'sit') { y = -0.08; }
    if (f.ghost) y += 0.12 + Math.sin(animT * 2.5) * 0.04;
    bob.position.y = y;
    bob.rotation.z = rollZ; bob.rotation.x = tiltX;
    ball.scale.y = (f.ghost ? 1.12 : f.boxy ? 0.96 : 0.94) * (1 - sq);
    const wide = 1 + sq * 0.6;
    ball.scale.x = (f.boxy ? 1.02 : 1) * wide; ball.scale.z = (f.boxy ? 0.92 : f.ghost ? 0.95 : 0.92) * wide;
    ball.position.y = (R + 0.1) * (1 - sq * 0.5);
    hands[0].position.y = R * 0.8 + Math.max(0, -handL) * 0.18; hands[0].position.z = 0.05 + Math.sin(-handL) * 0.08;
    hands[1].position.y = R * 0.8 + Math.max(0, -handR) * 0.18; hands[1].position.z = 0.05 + Math.sin(-handR) * 0.08;
    if (f.tentacles) deco.children.forEach((t, i) => t.isMesh && (t.rotation.y = Math.sin(animT * 4 + i) * 0.3));
  }

  return {
    root, kind: 'critter', key, height: 1.0,
    play, update, setMood, land, kick,
    get anim() { return anim; },
    get busy() { return once > 0; },
    dispose() { root.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material !== inkMat) { o.material.map?.dispose(); o.material.dispose(); } }); },
  };
}
