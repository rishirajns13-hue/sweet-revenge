/* Model loading for the 3D games. Every model is fetched once, then cloned for each use.
   Models are CC0 (Kenney; see assets/3d/LICENSE-kenney.txt). Furniture is re-centred so its origin is the
   middle of its base, and scaled to metres.
     const sofa = await models.get('furniture/loungeSofa', { scale: 2 });   // a fresh, shadow-casting copy
     await models.preload(['furniture/desk', ...], (done, total) => bar(done / total));
   ASSET_BASE is the only place the asset location lives (if assets ever move to their own repo). */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

export const ASSET_BASE = 'assets/3d/';
export const ASSET_VERSION = 1;          // bump when a model file changes, so browsers fetch the new one

const loader = new GLTFLoader();
const cache = new Map();                  // name -> Promise<gltf>

// Models are cached by the browser after the first visit; a versioned Cache Storage bucket makes repeat
// visits instant even when the HTTP cache was cleared. Failures fall back to a normal fetch.
const BUCKET = 'sr-3d-v' + ASSET_VERSION;
async function fetchBuffer(url) {
  try {
    if ('caches' in window) {
      const c = await caches.open(BUCKET);
      const hit = await c.match(url);
      if (hit) return hit.arrayBuffer();
      const res = await fetch(url);
      if (!res.ok) throw new Error(res.status + ' ' + url);
      c.put(url, res.clone()).catch(() => {});
      return res.arrayBuffer();
    }
  } catch (e) { if (String(e.message).match(/^\d{3} /)) throw e; }
  const res = await fetch(url);
  if (!res.ok) throw new Error(res.status + ' ' + url);
  return res.arrayBuffer();
}
// remove buckets from older asset versions
if ('caches' in window) caches.keys().then((ks) => ks.filter((k) => k.startsWith('sr-3d-v') && k !== BUCKET).forEach((k) => caches.delete(k))).catch(() => {});

function load(name) {
  if (!cache.has(name)) {
    const url = ASSET_BASE + name + '.glb?v=' + ASSET_VERSION;
    const dir = ASSET_BASE + name.split('/').slice(0, -1).join('/') + '/';
    cache.set(name, fetchBuffer(url).then((buf) => new Promise((res, rej) => loader.parse(buf, dir, res, rej))));
  }
  return cache.get(name);
}

function prepare(obj, { shadows = true, receive = true } = {}) {
  obj.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = shadows; o.receiveShadow = receive;
      [].concat(o.material).forEach((m) => {
        if (m.map) { m.map.colorSpace = THREE.SRGBColorSpace; m.map.anisotropy = 4; }
        m.roughness = Math.max(m.roughness ?? 1, 0.55); m.metalness = Math.min(m.metalness ?? 0, 0.2);
      });
    }
  });
  return obj;
}

export const models = {
  load,
  async preload(names, onProgress) {
    let done = 0;
    await Promise.all(names.map((n) => load(n).then(() => onProgress && onProgress(++done, names.length))));
  },
  // A static prop: re-centred on its base, scaled, casting shadows.
  async get(name, { scale = 1, center = true, shadows = true } = {}) {
    const g = await load(name);
    const inner = g.scene.clone(true);
    prepare(inner, { shadows });
    const holder = new THREE.Group();
    holder.name = name;
    inner.scale.setScalar(scale);
    if (center) {
      const b = new THREE.Box3().setFromObject(inner);
      inner.position.set(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
    }
    holder.add(inner);
    return holder;
  },
  // An animated, skinned model (people): a deep clone that has its own skeleton.
  async getSkinned(name) {
    const g = await load(name);
    const obj = cloneSkinned(g.scene);
    prepare(obj);
    return { scene: obj, animations: g.animations };
  },
};

// The size of anything in the scene, as a box (handy for building colliders from props).
export function boundsOf(obj) { obj.updateMatrixWorld(true); return new THREE.Box3().setFromObject(obj); }
