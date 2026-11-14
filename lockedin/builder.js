/* Locked In: builds hotel rooms in code (floors, walls with doorways, panelling, mouldings, ceilings,
   furniture, lamps, paintings, dust in the air) and collects the colliders the character controller uses.
   Static pieces that share a material are merged at the end, so a whole room costs only a few draw calls.
     const b = createBuilder(stage);
     b.room({ x0: -7, z0: -6, x1: 7, z1: 6, floor: 'checker', paper: { base: '#2f5a4a' }, doors: { s: [{ at: 0, w: 2 }] } });
     await b.prop('furniture/loungeSofa', { x: 0, z: 2, rot: Math.PI });
     b.finish();   // merge
   Coordinates are metres; the floor is y = 0; walls are 0.2 m thick. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { models } from '../shared/3d/assets.js';
import { tex } from '../shared/3d/textures.js';

const T = 0.2;               // wall thickness
// The hotel's furniture palette: deep green velvet, walnut, brass.
export const HOTEL_TINT = { carpet: '#2f5a46', carpetDarker: '#6b1f2a', wood: '#5a3622', woodDark: '#3a2214', metal: '#b8893e', metalMedium: '#8a6a3a', lamp: '#f4dcb0' };
const PANEL_H = 1.05;        // wainscot height

// A box whose UVs are in metres / texScale, so tiled materials line up across merged pieces.
function worldBox(w, h, d, texScale = 1) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
    const k = f * 4 + i; uv.setXY(k, uv.getX(k) * dims[f][0] / texScale, uv.getY(k) * dims[f][1] / texScale);
  }
  return g;
}
function worldPlane(w, d, texScale = 1) {
  const g = new THREE.PlaneGeometry(w, d); g.rotateX(-Math.PI / 2);
  const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / texScale, uv.getY(i) * d / texScale);
  return g;
}

export function createBuilder(stage, { quality = 1 } = {}) {
  const group = new THREE.Group();
  stage.scene.add(group);
  const boxes = [];                     // colliders
  const statics = new Map();            // material key -> { mat, geos: [] }
  const lights = [];
  const anims = [];                     // per-frame little animations (dust, flicker)

  const M = {};
  const mat = (key, make) => (M[key] = M[key] || make());
  const MATS = {
    wood: () => mat('wood', () => new THREE.MeshStandardMaterial({ map: tex.planks(), roughness: 0.6 })),
    darkwood: () => mat('darkwood', () => new THREE.MeshStandardMaterial({ map: tex.planks({ base: '#4a2c1a', dark: '#3a2214', light: '#5a3622' }), roughness: 0.5 })),
    carpet: () => mat('carpet', () => new THREE.MeshStandardMaterial({ map: tex.carpet(), roughness: 0.95 })),
    bluecarpet: () => mat('bluecarpet', () => new THREE.MeshStandardMaterial({ map: tex.carpet({ base: '#1f2f5a', pattern: '#2c3f72' }), roughness: 0.95 })),
    checker: () => mat('checker', () => new THREE.MeshStandardMaterial({ map: tex.checker(), roughness: 0.25, metalness: 0.05 })),
    panel: () => mat('panel', () => new THREE.MeshStandardMaterial({ map: tex.panel(), roughness: 0.55 })),
    trim: () => mat('trim', () => new THREE.MeshStandardMaterial({ color: '#3a2214', roughness: 0.45 })),
    gold: () => mat('gold', () => new THREE.MeshStandardMaterial({ color: '#c9a45c', roughness: 0.3, metalness: 0.85 })),
    brass: () => mat('brass', () => new THREE.MeshStandardMaterial({ color: '#b8893e', roughness: 0.35, metalness: 0.9 })),
    glass: () => mat('glass', () => new THREE.MeshStandardMaterial({ color: '#cfe3ea', roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.28, envMapIntensity: 1.5, depthWrite: false })),
    plaster: () => mat('plaster', () => new THREE.MeshStandardMaterial({ color: '#d9ccb4', roughness: 0.95 })),
    marble: () => mat('marble', () => new THREE.MeshStandardMaterial({ map: tex.checker({ a: '#ece4d4', b: '#e2d8c6' }), roughness: 0.2 })),
    paper: (p = {}) => mat('paper' + JSON.stringify(p), () => new THREE.MeshStandardMaterial({ map: tex.wallpaper(p), roughness: 0.85 })),
  };
  const floorMat = (k) => (MATS[k] || MATS.wood)();

  // add static geometry (merged later). texture scale is baked into the geometry's UVs.
  function addStatic(geo, material, pos, { shadow = true, receive = true, collide = false } = {}) {
    if (pos) geo.translate(pos[0], pos[1], pos[2]);
    // pieces only merge with others that share the material, shadow flags and the same vertex attributes
    const key = material.uuid + (shadow ? 's' : '') + (receive ? 'r' : '') + Object.keys(geo.attributes).sort().join();
    if (!statics.has(key)) statics.set(key, { mat: material, geos: [], shadow, receive });
    statics.get(key).geos.push(geo);
    if (collide) { geo.computeBoundingBox(); const bb = geo.boundingBox; boxes.push({ min: bb.min.toArray(), max: bb.max.toArray() }); }
  }
  function box(x0, y0, z0, x1, y1, z1, material, { collide = true, shadow = true, texScale = 1 } = {}) {
    const w = x1 - x0, h = y1 - y0, d = z1 - z0;
    addStatic(worldBox(w, h, d, texScale), material, [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], { shadow, collide });
  }

  // Turn a finished, never-moving object into static pieces (merged by material at finish()).
  // Small things (< minShadow metres across) don't cast shadows: cheaper, and nobody would see them.
  function bake(obj, { minShadow = 0.6 } = {}) {
    obj.updateMatrixWorld(true);
    obj.traverse((o) => {
      if (!o.isMesh || o.isSkinnedMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      if (mats.length > 1 || o.material.side === THREE.BackSide) return;   // keep the odd ones as they are
      let geo = o.geometry.clone().applyMatrix4(o.matrixWorld);
      if (geo.index) geo = geo.toNonIndexed();
      for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
      if (!geo.attributes.normal) geo.computeVertexNormals();
      geo.computeBoundingBox();
      const size = geo.boundingBox.getSize(new THREE.Vector3());
      const big = Math.max(size.x, size.y, size.z) >= minShadow;
      addStatic(geo, o.material, null, { shadow: o.castShadow !== false && big, receive: true });
    });
    obj.parent && obj.parent.remove(obj);
  }

  function floor(x0, z0, x1, z1, kind = 'wood', { y = 0, scale = 2 } = {}) {
    addStatic(worldPlane(x1 - x0, z1 - z0, scale), floorMat(kind), [(x0 + x1) / 2, y + 0.001, (z0 + z1) / 2], { shadow: false });
  }
  function ceiling(x0, z0, x1, z1, h) {
    const g = worldPlane(x1 - x0, z1 - z0, 2); g.rotateX(Math.PI);
    addStatic(g, MATS.plaster(), [(x0 + x1) / 2, h, (z0 + z1) / 2], { shadow: false });
  }

  // One straight wall from (x0,z0) to (x1,z1) (must be along x or z) with door gaps: [{ at, w, h }]
  // `at` is the gap centre measured from the wall start. `inward` is which side faces the room (+1/-1).
  function wall(x0, z0, x1, z1, { h = 3.4, paper = {}, panel = true, doors = [], inward = 1 } = {}) {
    const alongX = Math.abs(z1 - z0) < 1e-6, len = alongX ? Math.abs(x1 - x0) : Math.abs(z1 - z0);
    const sx = Math.sign(x1 - x0) || 1, sz = Math.sign(z1 - z0) || 1;
    const gaps = doors.map((d) => ({ a: d.at - d.w / 2, b: d.at + d.w / 2, h: d.h || 2.4 })).sort((p, q) => p.a - q.a);
    const pieces = []; let cur = 0;
    for (const gp of gaps) { if (gp.a > cur) pieces.push([cur, gp.a, 0, h]); pieces.push([gp.a, gp.b, gp.h, h]); cur = gp.b; }
    if (cur < len) pieces.push([cur, len, 0, h]);
    const paperMat = MATS.paper(paper), panelMat = MATS.panel(), trim = MATS.trim();
    const n = inward;  // offset of trims toward the room
    for (const [a, b, y0, y1] of pieces) {
      if (b - a < 0.01 || y1 - y0 < 0.01) continue;
      const mid = (a + b) / 2, L = b - a;
      const cx = alongX ? x0 + sx * mid : x0, cz = alongX ? z0 : z0 + sz * mid;
      const W = alongX ? L : T, D = alongX ? T : L;
      const put = (yy0, yy1, m, scale = 1.4, grow = 0) => {
        const w = W + (alongX ? 0 : grow * 2), d = D + (alongX ? grow * 2 : 0);
        addStatic(worldBox(w, yy1 - yy0, d, scale), m, [cx + (alongX ? 0 : n * grow * 0), (yy0 + yy1) / 2, cz], { collide: false });
      };
      if (panel && y0 === 0) {
        put(0, PANEL_H, panelMat, 1.05);
        put(PANEL_H, y1, paperMat, 1.6);
        // chair rail + skirting, sticking out a little
        addStatic(worldBox(alongX ? L : T + 0.08, 0.06, alongX ? T + 0.08 : L), trim, [cx, PANEL_H, cz]);
        addStatic(worldBox(alongX ? L : T + 0.06, 0.14, alongX ? T + 0.06 : L), trim, [cx, 0.07, cz]);
      } else put(y0, y1, y0 > 0 ? paperMat : paperMat, 1.6);
      // crown moulding
      addStatic(worldBox(alongX ? L : T + 0.16, 0.12, alongX ? T + 0.16 : L), MATS.gold(), [cx, h - 0.06, cz], { shadow: false });
      if (y0 === 0) boxes.push({ min: [cx - W / 2, 0, cz - D / 2], max: [cx + W / 2, h, cz + D / 2] });
      else boxes.push({ min: [cx - W / 2, y0, cz - D / 2], max: [cx + W / 2, h, cz + D / 2], noCam: true });
    }
    // door frames
    for (const gp of gaps) {
      for (const e of [gp.a, gp.b]) {
        const cx = alongX ? x0 + sx * e : x0, cz = alongX ? z0 : z0 + sz * e;
        addStatic(worldBox(alongX ? 0.12 : T + 0.1, gp.h, alongX ? T + 0.1 : 0.12), MATS.darkwood(), [cx, gp.h / 2, cz]);
      }
      const mid = (gp.a + gp.b) / 2, cx = alongX ? x0 + sx * mid : x0, cz = alongX ? z0 : z0 + sz * mid;
      addStatic(worldBox(alongX ? gp.b - gp.a + 0.24 : T + 0.1, 0.14, alongX ? T + 0.1 : gp.b - gp.a + 0.24), MATS.darkwood(), [cx, gp.h + 0.07, cz]);
    }
  }

  // A rectangular room. doors: { n: [{at, w}], s: [...], e: [...], w: [...] }; `at` from the west/north end.
  function room({ x0, z0, x1, z1, h = 3.4, floor: fl = 'wood', paper = {}, doors = {}, ceiling: ceil = true, panel = true, skip = [] }) {
    floor(x0, z0, x1, z1, fl);
    if (ceil) ceiling(x0, z0, x1, z1, h);
    const o = T / 2;
    if (!skip.includes('n')) wall(x0 - o, z0 - o, x1 + o, z0 - o, { h, paper, panel, doors: doors.n || [], inward: 1 });
    if (!skip.includes('s')) wall(x0 - o, z1 + o, x1 + o, z1 + o, { h, paper, panel, doors: doors.s || [], inward: -1 });
    if (!skip.includes('w')) wall(x0 - o, z0 - o, x0 - o, z1 + o, { h, paper, panel, doors: doors.w || [], inward: 1 });
    if (!skip.includes('e')) wall(x1 + o, z0 - o, x1 + o, z1 + o, { h, paper, panel, doors: doors.e || [], inward: -1 });
  }

  // Furniture from the Kenney kit. rot is in radians; the collider is its footprint, shrunk a little.
  // `tint` recolours the kit's named materials, e.g. { carpet: '#5a1f2a', wood: '#3a2214' } (the hotel palette).
  const tintCache = new Map();
  async function prop(name, { x = 0, y = 0, z = 0, rot = 0, scale = 2, collide = true, shrink = 0.04, shadow = true, tint = HOTEL_TINT, live = false } = {}) {
    const p = await models.get(name, { scale, shadows: shadow });
    if (tint) p.traverse((o) => {
      if (!o.isMesh) return;
      const swap = (m) => {
        const want = tint[m.name]; if (!want) return m;
        const k = m.uuid + want;
        if (!tintCache.has(k)) { const c = m.clone(); c.color.set(want); if (/carpet/.test(m.name)) { c.roughness = 0.9; c.sheen = 1; } tintCache.set(k, c); }
        return tintCache.get(k);
      };
      o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
    });
    p.position.set(x, y, z); p.rotation.y = rot;
    group.add(p);
    if (collide) {
      p.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(p);
      boxes.push({ min: [bb.min.x + shrink, bb.min.y, bb.min.z + shrink], max: [bb.max.x - shrink, bb.max.y, bb.max.z - shrink], prop: name });
    }
    if (!live) { if (!shadow) p.traverse((o) => o.isMesh && (o.castShadow = false)); bake(p, { minShadow: 0.4 }); }   // furniture never moves: merge it
    return p;
  }

  const bulbMats = new Map();
  const bulbMat = (c) => { if (!bulbMats.has(c)) bulbMats.set(c, new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(3) })); return bulbMats.get(c); };
  // A warm lamp: a real light (if allowed) plus a glowing bulb that the bloom picks up.
  function lamp(x, y, z, { colour = '#ffcf8a', intensity = 6, distance = 9, bulb = true, light = true, size = 0.07 } = {}) {
    let l = null;
    if (light) { l = new THREE.PointLight(colour, intensity, distance, 2); l.position.set(x, y, z); group.add(l); lights.push(l); }
    if (bulb) { const b = new THREE.Mesh(new THREE.SphereGeometry(size, 12, 10), bulbMat(colour)); b.castShadow = false; b.position.set(x, y, z); group.add(b); bake(b); }
    return l;
  }
  // A brass-and-crystal chandelier with glowing candle bulbs.
  function chandelier(x, y, z, { arms = 8, radius = 0.9 } = {}) {
    const g = new THREE.Group(); g.position.set(x, y, z);
    const brass = MATS.brass();
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.8), brass); chain.position.y = 0.4; g.add(chain);
    const hub = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), brass); g.add(hub);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.03, 8, 40), brass); ring.rotation.x = Math.PI / 2; ring.position.y = -0.15; g.add(ring);
    const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd59a').multiplyScalar(4) });
    const crystal = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.55, envMapIntensity: 2 });
    for (let i = 0; i < arms; i++) {
      const a = (i / arms) * Math.PI * 2, cx = Math.cos(a) * radius, cz = Math.sin(a) * radius;
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, radius), brass); arm.rotation.z = Math.PI / 2; arm.rotation.y = -a; arm.position.set(cx / 2, -0.08, cz / 2); g.add(arm);
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.035, 0.06, 10), brass); cup.position.set(cx, -0.1, cz); g.add(cup);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), glow); bulb.scale.y = 1.4; bulb.position.set(cx, -0.02, cz); g.add(bulb);
      const drop = new THREE.Mesh(new THREE.OctahedronGeometry(0.045), crystal); drop.scale.y = 1.8; drop.position.set(cx, -0.3, cz); g.add(drop);
    }
    group.add(g);
    g.traverse((o) => o.isMesh && (o.castShadow = false));
    bake(g);
    const l = new THREE.PointLight('#ffcf8a', 14, 16, 1.6); l.position.set(x, y - 0.3, z); group.add(l); lights.push(l);
    anims.push((dt, t) => { l.intensity = 14 + Math.sin(t * 7.3) * 0.25 + Math.sin(t * 13.1) * 0.15; });
    return g;
  }
  // A framed painting on a wall. facing: direction it faces ('n','s','e','w' = toward -z,+z,+x,-x).
  function painting(x, y, z, facing, { seed = 1, w = 0.9, h = 1.15 } = {}) {
    const g = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.14, h + 0.14, 0.06), MATS.gold()); g.add(frame);
    const art = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex.painting(seed), roughness: 0.7 })); art.position.z = 0.032; g.add(art);
    g.rotation.y = { s: 0, n: Math.PI, e: Math.PI / 2, w: -Math.PI / 2 }[facing];
    g.position.set(x, y, z);
    g.traverse((o) => o.isMesh && (o.castShadow = true));
    group.add(g);
    return g;
  }
  // Floating dust motes catching the light (very cheap: one draw call).
  function dust(x0, z0, x1, z1, h = 3, count = 220) {
    const geo = new THREE.BufferGeometry(), pos = new Float32Array(count * 3), seed = [];
    for (let i = 0; i < count; i++) { pos[i * 3] = x0 + Math.random() * (x1 - x0); pos[i * 3 + 1] = Math.random() * h; pos[i * 3 + 2] = z0 + Math.random() * (z1 - z0); seed.push(Math.random() * 10); }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d');
    const rg = g.createRadialGradient(16, 16, 0, 16, 16, 16); rg.addColorStop(0, 'rgba(255,240,210,1)'); rg.addColorStop(1, 'rgba(255,240,210,0)'); g.fillStyle = rg; g.fillRect(0, 0, 32, 32);
    const m = new THREE.PointsMaterial({ size: 0.045, map: new THREE.CanvasTexture(c), transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
    const pts = new THREE.Points(geo, m); group.add(pts);
    anims.push((dt, t) => {
      for (let i = 0; i < count; i++) {
        let y = pos[i * 3 + 1] + dt * 0.05; if (y > h) y = 0;
        pos[i * 3 + 1] = y; pos[i * 3] += Math.sin(t * 0.4 + seed[i]) * dt * 0.03;
      }
      geo.attributes.position.needsUpdate = true;
    });
  }

  function finish() {
    for (const { mat: m, geos, shadow, receive } of statics.values()) {
      const merged = mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)), false);
      if (!merged) { console.warn('could not merge', m.name); continue; }
      geos.forEach((g) => g.dispose());
      const mesh = new THREE.Mesh(merged, m);
      mesh.castShadow = shadow; mesh.receiveShadow = receive;
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      group.add(mesh);
    }
    statics.clear();
  }
  function update(dt, t) { anims.forEach((f) => f(dt, t)); }

  return { group, boxes, lights, MATS, bake, box, floor, ceiling, wall, room, prop, lamp, chandelier, painting, dust, finish, update, addStatic };
}
