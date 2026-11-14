/* Human characters for the 3D games: Kenney's CC0 "Mini Characters" (13 base styles, fully animated),
   recoloured per player. Each player's look gets its own small copy of the colour atlas: skin, hair and two
   outfit colours are moved onto spare swatches in the atlas's empty top row and painted there, so the
   original eyes and details stay untouched.
     const h = await createHuman({ style: 'female-a', skin: 2, hair: 0, top: 5, bottom: 9, acc: 0 });
     scene.add(h.root); h.play('walk'); h.update(dt);
   Animations: idle, walk, run, jump, fall, sit, pickup, yes, no, interact, carry, crouch, die. */
import * as THREE from 'three';
import { models } from './assets.js';

export const HUMAN_STYLES = ['female-b', 'female-c', 'female-d', 'female-e', 'female-f', 'male-a', 'male-b', 'male-c', 'male-d', 'male-e', 'male-f', 'male-g'];
export const SKIN = ['#ffe0c4', '#f6c39b', '#e3a273', '#c47c4f', '#9c5b3a', '#6b3c27'];
export const HAIR = ['#2c2830', '#5b3926', '#9c5a32', '#e2b25a', '#f3e6bf', '#d9564c', '#9b7be2', '#4fb6da', '#ff86c2'];
export const CLOTH = ['#e8504f', '#ff8a4c', '#ffc94a', '#5cc98a', '#3fb3a8', '#5b8def', '#8a63d2', '#ff86c2', '#f4f1ea', '#3b3d4a', '#7a5a43', '#b8c4d6'];
export const HUMAN_ACC = ['None', 'Glasses', 'Sunglasses'];
const ACC_MODEL = [null, 'people/aid-glasses', 'people/aid-sunglasses'];
export const HUMAN_SCALE = 1.6;

const CLIPS = { idle: 'idle', walk: 'walk', run: 'sprint', jump: 'jump', fall: 'fall', sit: 'sit', pickup: 'pick-up', yes: 'emote-yes', no: 'emote-no', interact: 'interact-right', carry: 'holding-both', crouch: 'crouch', die: 'die' };
const ONCE = new Set(['jump', 'pickup', 'yes', 'no', 'interact', 'die']);

// atlas: 16 columns x 4 rows of swatches; row 0 is empty, so slots 0..15 of row 0 are ours to paint
const COLS = 16, ROWS = 4;
const SLOT = { skin: 0, hair: 1, top: 2, bottom: 3 };
const cellOf = (u, v) => [Math.min(COLS - 1, Math.floor(u * COLS)), Math.min(ROWS - 1, Math.floor(v * ROWS))];

// Which swatches each style uses for skin / hair / outfit, worked out once from the model's own UVs.
function analyse(scene) {
  const head = [], body = [];
  scene.traverse((o) => {
    if (!o.isSkinnedMesh && !o.isMesh) return;
    const uv = o.geometry.attributes.uv, pos = o.geometry.attributes.position, counts = new Map();
    for (let i = 0; i < uv.count; i++) {
      const [c, r] = cellOf(uv.getX(i), uv.getY(i)), k = c + ',' + r, e = counts.get(k) || [0, 0];
      e[0]++; e[1] += pos.getY(i); counts.set(k, e);
    }
    (/head/.test(o.name) ? head : body).push(...[...counts].map(([k, [n, sy]]) => [k, n, sy / n]).sort((a, b) => b[1] - a[1]));
  });
  // The face is the head swatch with exactly the face's vertex count (220 in every style); hair is the other big one.
  const skin = (head.find(([, n]) => n === 220) || head[0])[0];
  const hair = head.filter(([k]) => k !== skin).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  // Outfit: of the two biggest clothing swatches, the higher one on the body is the top, the lower the bottom.
  const outfit = body.filter(([k]) => k !== skin && k !== hair).sort((a, b) => b[1] - a[1]).slice(0, 2).sort((a, b) => b[2] - a[2]);
  return { skin, hair, top: outfit[0]?.[0] || null, bottom: outfit[1]?.[0] || null };
}
// The eyes are flat quads on the front of the face: never recolour them, even when hair shares their swatch.
function isEye(pos, nor, i) { return nor.getZ(i) > 0.95 && pos.getZ(i) > 0.15 && pos.getY(i) > 0.38 && pos.getY(i) < 0.53; }

function shade(hex, f) { const c = new THREE.Color(hex); const hsl = {}; c.getHSL(hsl); c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l * f))); return '#' + c.getHexString(); }

let atlasImg = null;
function atlasFor(look, source) {
  const W = source.width, H = source.height, cw = W / COLS, ch = H / ROWS;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.drawImage(source, 0, 0);
  const paint = (slot, hex) => {
    const x = slot * cw, grad = g.createLinearGradient(0, 0, 0, ch);
    grad.addColorStop(0, shade(hex, 1.08)); grad.addColorStop(1, shade(hex, 0.86));
    g.fillStyle = grad; g.fillRect(x, 0, cw, ch);
  };
  paint(SLOT.skin, SKIN[look.skin] || SKIN[1]);
  paint(SLOT.hair, HAIR[look.hair] || HAIR[0]);
  paint(SLOT.top, CLOTH[look.top] || CLOTH[5]);
  paint(SLOT.bottom, CLOTH[look.bottom] || CLOTH[9]);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = false; tex.magFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter;
  return tex;
}

export function defaultHumanLook(seed = 0) {
  return { kind: 'human', style: HUMAN_STYLES[seed % HUMAN_STYLES.length], skin: 1 + (seed % 4), hair: seed % HAIR.length, top: (seed * 3) % CLOTH.length, bottom: 9, acc: 0 };
}

export async function createHuman(look) {
  look = { ...defaultHumanLook(), ...look };
  const { scene, animations } = await models.getSkinned('people/character-' + look.style);
  const parts = analyse(scene);
  let mat = null;
  scene.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry = o.geometry.clone();                 // our own UVs, so recolouring never touches other players
    const uv = o.geometry.attributes.uv, pos = o.geometry.attributes.position, nor = o.geometry.attributes.normal, isHead = /head/.test(o.name);
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i), v = uv.getY(i), [c, r] = cellOf(u, v), k = c + ',' + r;
      let slot = null;
      if (k === parts.skin) slot = SLOT.skin;
      else if (isHead && k === parts.hair && !isEye(pos, nor, i)) slot = SLOT.hair;
      else if (!isHead && k === parts.top) slot = SLOT.top;
      else if (!isHead && k === parts.bottom) slot = SLOT.bottom;
      if (slot == null) continue;
      const fu = u * COLS - c, fv = v * ROWS - r;      // keep the position inside the swatch (its shading)
      uv.setXY(i, (slot + fu) / COLS, fv / ROWS);
    }
    uv.needsUpdate = true;
    o.frustumCulled = false;                           // skinned bounds lag behind animation; never pop out
    if (!mat) {
      mat = o.material.clone();
      atlasImg = atlasImg || o.material.map.image;
      mat.map = atlasFor(look, atlasImg);
    }
    o.material = mat;
  });

  const root = new THREE.Group();
  scene.scale.setScalar(HUMAN_SCALE);
  root.add(scene);
  root.userData.kind = 'human';

  // accessory on the head bone
  const head = scene.getObjectByName('head');
  if (look.acc && ACC_MODEL[look.acc] && head) {
    const acc = await models.get(ACC_MODEL[look.acc], { center: false });
    root.updateMatrixWorld(true);
    // glasses sit over the eyes, which are at about (0, 0.455, 0.165) in the model's own units
    const at = new THREE.Vector3(0, 0.425 * HUMAN_SCALE, 0.16 * HUMAN_SCALE);
    head.worldToLocal(at);
    acc.position.copy(at); acc.scale.setScalar(1);
    head.add(acc);
  }

  const mixer = new THREE.AnimationMixer(scene);
  const actions = {};
  for (const [k, clipName] of Object.entries(CLIPS)) {
    const clip = animations.find((a) => a.name === clipName);
    if (!clip) continue;
    const a = mixer.clipAction(clip);
    if (ONCE.has(k)) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
    actions[k] = a;
  }
  let current = null, locked = 0;
  function play(name, { fade = 0.18, speed = 1, force = false } = {}) {
    if (!actions[name]) name = 'idle';
    if (current === name && !force) { actions[name].timeScale = speed; return; }
    if (locked > 0 && !force && !ONCE.has(name)) return;  // let one-shots (wave, pick up) finish
    const next = actions[name], prev = current && actions[current];
    next.reset(); next.timeScale = speed; next.enabled = true; next.setEffectiveWeight(1);
    if (prev) next.crossFadeFrom(prev, fade, false);
    next.play();
    current = name;
    locked = ONCE.has(name) ? next.getClip().duration / speed - fade : 0;
  }
  play('idle');
  return {
    root, kind: 'human', look, height: 1.25,
    play,
    get anim() { return current; },
    get busy() { return locked > 0; },
    update(dt) { mixer.update(dt); if (locked > 0) locked -= dt; },
    setMood() { /* humans show moods with emotes; see play('yes'/'no') */ },
    dispose() { mat?.map?.dispose(); mat?.dispose(); scene.traverse((o) => o.geometry && o.geometry.dispose()); },
  };
}
