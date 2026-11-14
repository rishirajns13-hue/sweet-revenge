/* The Hotel Halfway lobby (Locked In, part L0): the showcase space for walking, looking and using things.
   A grand lobby with a reception desk, service bells, a key cabinet, a chandelier, sofas around a rug,
   lift doors, paintings, plants, and a carpeted corridor of guest rooms off to the west.
   build(builder, api) returns { spawn, items } where items are the usable things. `api` gives the level
   access to the game: api.toast(text), api.sfx(name), api.inspect(obj, info), api.give(item), api.say(text). */
import * as THREE from 'three';
import { tex } from '../../shared/3d/textures.js';

export const LOBBY_MODELS = [
  'furniture/loungeSofa', 'furniture/loungeChair', 'furniture/tableCoffee', 'furniture/rugRectangle', 'furniture/rugRound',
  'furniture/pottedPlant', 'furniture/lampRoundFloor', 'furniture/lampSquareTable', 'furniture/bookcaseClosedWide', 'furniture/bench',
  'furniture/coatRackStanding', 'furniture/plantSmall1', 'furniture/radio', 'people/item-luggage', 'people/item-luggage-upright', 'furniture/sideTable',
];

// ---------- small procedural props ----------
function bellMesh(brass) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.02, 24), new THREE.MeshStandardMaterial({ color: '#2b1a10', roughness: 0.5 }));
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.075, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), brass); dome.position.y = 0.012;
  const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.035, 8), brass); knob.position.y = 0.1;
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), brass); cap.position.y = 0.12;
  g.add(base, dome, knob, cap);
  g.traverse((o) => o.isMesh && (o.castShadow = true));
  return g;
}
function keyMesh(brass, tagColour = '#c0392b') {
  const g = new THREE.Group();
  const bow = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.012, 8, 20), brass);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.16, 8), brass); shaft.rotation.z = Math.PI / 2; shaft.position.x = 0.11;
  const bit = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.04, 0.01), brass); bit.position.set(0.17, -0.025, 0);
  const tag = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.006), new THREE.MeshStandardMaterial({ color: tagColour, roughness: 0.7 })); tag.position.set(-0.07, -0.06, 0); tag.rotation.z = 0.3;
  g.add(bow, shaft, bit, tag);
  g.traverse((o) => o.isMesh && (o.castShadow = true));
  return g;
}
function letterMesh(lines, title) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.375), new THREE.MeshStandardMaterial({ map: tex.paper(lines, { title }), roughness: 0.9, side: THREE.DoubleSide }));
  m.rotation.x = -Math.PI / 2;
  m.castShadow = true;
  const g = new THREE.Group(); g.add(m); return g;
}
function bookMesh(lines) {
  const g = new THREE.Group();
  const cover = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.04, 0.42), new THREE.MeshStandardMaterial({ color: '#5a1f22', roughness: 0.6 }));
  const pages = new THREE.Mesh(new THREE.PlaneGeometry(0.58, 0.4), new THREE.MeshStandardMaterial({ map: tex.paper(lines, { title: 'Guest Ledger', w: 768, h: 512 }), roughness: 0.9 }));
  pages.rotation.x = -Math.PI / 2; pages.position.y = 0.022;
  g.add(cover, pages); g.traverse((o) => o.isMesh && (o.castShadow = true));
  return g;
}

export async function build(b, api) {
  const { MATS } = b;
  const brass = MATS.brass(), gold = MATS.gold(), dark = MATS.darkwood();
  const items = [];

  // ---------- architecture ----------
  // Lobby: x -8..8, z -7..7, a tall room. Corridor to the west: x -20..-8, z -1.6..1.6.
  b.room({ x0: -8, z0: -7, x1: 8, z1: 7, h: 4.6, floor: 'checker', paper: { base: '#23463c', ink: '#2e5a4d', gold: '#c9a45c' },
    doors: { w: [{ at: 7.1, w: 3.2, h: 3 }], s: [{ at: 8.1, w: 3, h: 3.2 }] } });
  // front doors: brass-framed glass, fog outside
  b.box(-1.5, 0, 7.05, 1.5, 3.2, 7.15, MATS.glass(), { collide: true, shadow: false });
  b.box(-0.04, 0, 7.0, 0.04, 3.2, 7.2, gold, { collide: false });
  b.box(-1.55, 3.05, 7.0, 1.55, 3.2, 7.2, gold, { collide: false });
  b.room({ x0: -20, z0: -1.6, x1: -8.2, z1: 1.6, h: 3.2, floor: 'carpet', paper: { base: '#5a2a2e', ink: '#6e3439', gold: '#c9a45c', kind: 'stripes' },
    skip: ['e'], doors: { n: [{ at: 4.4, w: 1.1 }, { at: 8.9, w: 1.1 }], s: [{ at: 4.4, w: 1.1 }, { at: 8.9, w: 1.1 }] } });
  // central carpet runner from the front doors to the desk
  b.floor(-1.6, -3.4, 1.6, 7, 'carpet', { y: 0.004, scale: 1.6 });
  // a raised marble platform for the desk
  b.box(-5, 0, -7, 5, 0.18, -3.6, MATS.marble(), { collide: true, texScale: 1.4 });

  // ---------- reception desk ----------
  b.box(-3.4, 0.18, -4.6, 3.4, 1.22, -3.9, MATS.panel(), { texScale: 1.05 });   // panelled front
  b.box(-3.5, 1.22, -4.7, 3.5, 1.3, -3.8, gold, { collide: false });           // brass top edge
  b.box(-3.4, 0.18, -6.2, -2.8, 1.22, -4.6, dark);                              // side returns
  b.box(2.8, 0.18, -6.2, 3.4, 1.22, -4.6, dark);
  // key cabinet on the back wall: 4 x 6 pigeonholes with keys
  b.box(-2.4, 1.0, -7, 2.4, 3.3, -6.7, dark, { texScale: 1 });
  const holes = new THREE.Group();
  for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) {
    const hole = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.42, 0.05), new THREE.MeshStandardMaterial({ color: '#1a0f08', roughness: 0.8 }));
    hole.position.set(-1.85 + c * 0.74, 1.35 + r * 0.52, -6.68); holes.add(hole);
    if ((r * 6 + c) % 3 !== 1) { const k = keyMesh(brass, ['#c0392b', '#2e86de', '#27ae60', '#f39c12'][r]); k.rotation.z = -Math.PI / 2; k.scale.setScalar(1.3); k.position.set(-1.85 + c * 0.74, 1.45 + r * 0.52, -6.62); holes.add(k); }
  }
  b.group.add(holes);
  holes.traverse((o) => o.isMesh && (o.castShadow = false));
  b.bake(holes);

  // service bells on the desk
  const bellNotes = [1, 1.26, 1.5];
  [-1.2, 0, 1.2].forEach((x, i) => {
    const bell = bellMesh(brass); bell.position.set(x, 1.3, -4.25); b.group.add(bell);
    items.push({ obj: bell, label: 'Ring the bell', reach: 1.5, use: () => { api.sfx('bell', { rate: bellNotes[i] }); bell.userData.ring = 0.35; api.act('ring'); } });
  });
  // the guest ledger
  const ledger = bookMesh(['Rm 101 · Mr. Moon', 'Rm 102 · The Twins', 'Rm 103 · Dr. Sparrow', 'Rm 104 · (vacant)']);
  ledger.position.set(2.2, 1.31, -4.25); ledger.rotation.y = -0.15; b.group.add(ledger);
  items.push({ obj: ledger, label: 'Read the guest ledger', reach: 1.6, use: () => api.inspect(ledger, { title: 'Guest Ledger', text: 'Four rooms, three guests. Who is in 104?', faceUp: true, size: 0.75 }) });
  // the welcome letter
  const letter = letterMesh(['Dear guests,', '', 'Welcome to the Hotel Halfway.', 'You may leave whenever you like,', 'as soon as you find the way out.', '', 'Breakfast is served at dawn.', '         — The Management'], 'Welcome!');
  letter.position.set(-2.1, 1.312, -4.2); letter.rotation.y = 0.2; b.group.add(letter);
  items.push({ obj: letter, label: 'Read the letter', reach: 1.6, use: () => api.inspect(letter, { title: 'A letter on the desk', text: 'Turn it over: there might be something on the back.', size: 0.62, faceUp: true }) });

  // ---------- seating area (west) ----------
  await b.prop('furniture/rugRectangle', { x: -4.6, z: 2.2, rot: Math.PI / 2, scale: 2.4, collide: false, shadow: false, tint: { carpet: '#6b1f2a', carpetDarker: '#c9a45c' } });
  await b.prop('furniture/loungeSofa', { x: -6.6, z: 2.2, rot: Math.PI / 2 });
  await b.prop('furniture/loungeChair', { x: -4.3, z: 4.2, rot: Math.PI });
  await b.prop('furniture/loungeChair', { x: -4.3, z: 0.2, rot: 0 });
  await b.prop('furniture/tableCoffee', { x: -4.6, z: 2.2, rot: Math.PI / 2 });
  const radio = await b.prop('furniture/radio', { x: -4.6, y: 0.46, z: 2.0, rot: Math.PI / 2, collide: false, scale: 1.5, live: true });
  items.push({ obj: radio, label: 'Turn on the radio', reach: 1.6, use: () => { api.sfx('switch'); api.toast('📻 Crackle… “…and the weather at the Hotel Halfway: fog, until dawn…”'); } });
  await b.prop('furniture/lampRoundFloor', { x: -7.3, z: 4.1 });
  b.lamp(-7.25, 1.6, 4.05, { intensity: 3, distance: 6 });
  await b.prop('furniture/lampRoundFloor', { x: -7.3, z: 0.3 });
  b.lamp(-7.25, 1.6, 0.25, { intensity: 3, distance: 6, light: false });

  // ---------- east side: lifts, bench, luggage ----------
  const needles = [];
  for (const z of [-2.2, 2.2]) {
    b.box(7.62, 0, z - 0.9, 7.9, 2.9, z + 0.9, gold, { collide: false });                    // brass surround
    b.box(7.55, 0, z - 0.75, 7.8, 2.75, z + 0.75, brass, { collide: true });                  // the doors
    b.box(7.5, 2.5, z - 0.02, 7.56, 2.75, z + 0.02, dark, { collide: false });                // centre seam
    const dial = new THREE.Mesh(new THREE.CircleGeometry(0.28, 24, 0, Math.PI), brass); dial.position.set(7.52, 3.1, z); dial.rotation.y = -Math.PI / 2; b.group.add(dial); b.bake(dial);
    const needle = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.24, 0.01), new THREE.MeshStandardMaterial({ color: '#1a0f08' })); needle.position.set(7.5, 3.1, z); needle.geometry.translate(0, 0.12, 0); needle.rotation.y = -Math.PI / 2; b.group.add(needle);
    needles.push(needle);
  }
  const callBtn = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.03, 16), new THREE.MeshStandardMaterial({ color: '#ffe0a0', emissive: '#ff9a2a', emissiveIntensity: 0.4 }));
  callBtn.rotation.z = Math.PI / 2; callBtn.position.set(7.55, 1.2, 0); b.group.add(callBtn);
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.3, 0.16), brass); plate.position.set(7.58, 1.2, 0); b.group.add(plate); b.bake(plate);
  items.push({ obj: callBtn, label: 'Call the lift', reach: 1.5, at: [7.4, 1.2, 0], use: () => { api.sfx('click'); callBtn.material.emissiveIntensity = 2; setTimeout(() => (callBtn.material.emissiveIntensity = 0.4), 600); api.toast('🛗 Nothing happens. The power to the lifts is off.'); api.act('lift'); } });
  await b.prop('furniture/bench', { x: 6.3, z: 5.2, rot: -Math.PI / 2, scale: 2.4 });
  await b.prop('people/item-luggage-upright', { x: 5.8, z: -5.6, rot: 0.4, scale: 2.2 });
  await b.prop('people/item-luggage', { x: 6.3, z: -5.8, rot: -0.3, scale: 2.2 });

  // ---------- plants, paintings, clock, chandelier ----------
  for (const [x, z] of [[-7.4, -6.4], [7.4, -6.4], [-7.4, 6.4], [7.4, 6.4], [-1.9, 6.5], [1.9, 6.5]]) await b.prop('furniture/pottedPlant', { x, z, scale: 2.4 });
  const art = b.painting(-7.88, 2.4, 2.2, 'e', { seed: 2, w: 1.3, h: 1.6 });
  const artBack = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.6), new THREE.MeshStandardMaterial({ map: tex.paper(['', '', '', '      ☾  ✦  ☀'], { title: '104', w: 400, h: 500 }), roughness: 0.9 }));
  artBack.rotation.y = Math.PI; artBack.position.z = -0.035; art.add(artBack);
  items.push({ obj: art, label: 'Look at the painting', reach: 2.2, use: () => api.inspect(art, { title: 'A painting of the hills', text: 'Drag to turn it. Something is written on the back…', size: 0.75 }) });
  b.bake(b.painting(-4, 2.6, 6.88, 'n', { seed: 3 }));
  b.bake(b.painting(4, 2.6, 6.88, 'n', { seed: 4 }));
  b.bake(b.painting(-4.6, 2.7, -6.88, 's', { seed: 1, w: 1.1, h: 1.3 }));
  b.bake(b.painting(4.6, 2.7, -6.88, 's', { seed: 5, w: 1.1, h: 1.3 }));
  // grandfather clock
  b.box(5.6, 0.18, -6.9, 6.4, 2.6, -6.5, dark);
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.28, 32), new THREE.MeshStandardMaterial({ color: '#f4ead2', roughness: 0.6 })); face.position.set(6, 2.15, -6.49); b.group.add(face); b.bake(face);
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.22, 0.01), new THREE.MeshStandardMaterial({ color: '#1a0f08' })); hand.geometry.translate(0, 0.1, 0); hand.position.set(6, 2.15, -6.48); b.group.add(hand);
  const pend = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.02, 20), brass); pend.rotation.x = Math.PI / 2; b.group.add(pend);
  b.chandelier(0, 3.7, 1.5);
  // wall sconces
  for (const [x, z, f] of [[-7.86, -3, 'e'], [7.86, -4.6, 'w'], [7.86, 4.6, 'w'], [-7.86, 6, 'e']]) {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.05, 0.18, 12), MATS.gold()); s.position.set(x + (f === 'e' ? 0.08 : -0.08), 2.6, z); b.group.add(s); b.bake(s);
    b.lamp(x + (f === 'e' ? 0.12 : -0.12), 2.75, z, { intensity: 1.5, distance: 4, light: false, size: 0.06 });
  }
  // corridor: sconces between the doors, guest-room door slabs with numbers
  for (const x of [-10.5, -15, -19]) for (const z of [-1.5, 1.5]) b.lamp(x, 2.4, z + (z < 0 ? 0.12 : -0.12), { intensity: 1.6, distance: 4.5, light: z < 0 && x !== -19, size: 0.06 });
  const numbers = { '-11.2,-1.7': '101', '-15.7,-1.7': '102', '-11.2,1.7': '103', '-15.7,1.7': '104' };
  for (const [k, n] of Object.entries(numbers)) {
    const [x, z] = k.split(',').map(Number);
    b.box(x - 0.55, 0, z - 0.06, x + 0.55, 2.4, z + 0.06, dark, { collide: true, texScale: 1.2 });
    const plaque = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.14), new THREE.MeshStandardMaterial({ map: tex.paper([], { title: n, w: 256, h: 120 }), roughness: 0.5 }));
    plaque.position.set(x, 1.85, z + (z < 0 ? 0.07 : -0.07)); plaque.rotation.y = z < 0 ? 0 : Math.PI; b.group.add(plaque); b.bake(plaque);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), brass); knob.position.set(x + 0.38, 1.05, z + (z < 0 ? 0.09 : -0.09)); b.group.add(knob);
    items.push({ obj: knob, label: `Try the door of room ${n}`, reach: 1.4, at: [x, 1, z + (z < 0 ? 0.5 : -0.5)], use: () => { api.sfx('locked'); api.toast(`🔒 Room ${n} is locked.`); api.act('door' + n); } });
  }
  // a brass key someone dropped by the sofa
  const key = keyMesh(brass, '#2e86de'); key.scale.setScalar(1.4); key.position.set(-5.4, 0.02, 3.6); key.rotation.set(-Math.PI / 2, 0, 0.6); b.group.add(key);
  const keyItem = { obj: key, label: 'Pick up the key', reach: 1.3, use: () => { api.give({ id: 'key-blue', name: 'Blue-tag key', icon: '🗝️', mesh: key }); b.group.remove(key); api.remove(keyItem); } };
  items.push(keyItem);

  // ---------- light ----------
  const hemi = new THREE.HemisphereLight('#ffe2c0', '#2a1c22', 0.55); b.group.add(hemi);
  const key1 = new THREE.DirectionalLight('#ffd9a8', 1.6); key1.position.set(3, 12, 6); key1.target.position.set(-2, 0, -1);
  b.group.add(key1, key1.target);
  api.shadowLight(key1, 16);
  b.dust(-7.5, -6.5, 7.5, 6.5, 4.2, 260);
  b.finish();

  // per-frame details: bells settle, lift needles drift, the clock ticks
  const bells = items.filter((i) => i.label === 'Ring the bell').map((i) => i.obj);
  b.tick = (dt, t) => {
    bells.forEach((bell) => { const r = bell.userData.ring || 0; if (r > 0) { bell.userData.ring = r - dt; bell.rotation.z = Math.sin(r * 60) * r * 0.25; bell.position.y = 1.3 + Math.max(0, r) * 0.04; } });
    needles.forEach((n, i) => (n.rotation.x = Math.sin(t * 0.2 + i * 2) * 1.2));
    hand.rotation.z = -Math.floor(t) * (Math.PI / 30);
    pend.position.set(6 + Math.sin(t * Math.PI) * 0.12, 1.05, -6.48);
  };
  return { spawn: { x: 0, z: 5.5, yaw: Math.PI }, items };
}
