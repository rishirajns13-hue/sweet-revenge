/* Locked In: the page. Part L0 = the hotel lobby you can explore on your own, your 3D look (Human or
   Critter), real controls, inspecting things, an inventory, and How to Play. Online co-op chapters build
   on this in L1+.
   This is the only page that loads three.js from shared/3d; every other page stays light. */
import * as THREE from 'three';
import { createStage } from '../shared/3d/stage.js?v=1';
import { models } from '../shared/3d/assets.js?v=1';
import { createInput } from '../shared/3d/input.js?v=1';
import { createFollowCamera } from '../shared/3d/camera.js?v=1';
import { createInteractor } from '../shared/3d/interact.js?v=1';
import { createHuman, HUMAN_STYLES, SKIN, HAIR, CLOTH, HUMAN_ACC } from '../shared/3d/people.js?v=1';
import { createCritter } from '../shared/3d/critters3d.js?v=1';
import { createBuilder } from './builder.js?v=1';
import * as lobby from './levels/lobby.js?v=1';

const CC = window.CharacterController;
const $ = (s) => document.querySelector(s);
const LOOK_KEY = 'li-look';

/* ---------- sounds (real recordings, CC0 Kenney) ---------- */
const sfxPlayer = createSamplePlayer({
  base: 'shared/sounds/lockedin/', volume: 0.7,
  takes: {
    'step-wood': [0, 1, 2, 3, 4].map((i) => `step-wood-${i}.ogg`), 'step-carpet': [0, 1, 2, 3, 4].map((i) => `step-carpet-${i}.ogg`),
    bell: ['bell-0.ogg', 'bell-1.ogg', 'bell-2.ogg'], open: ['door-open-1.ogg', 'door-open-2.ogg'], close: ['door-close-1.ogg', 'door-close-2.ogg'],
    creak: ['creak-1.ogg', 'creak-2.ogg'], page: ['page-1.ogg', 'page-2.ogg'], locked: ['latch.ogg'], click: ['click.ogg'], coins: ['coins.ogg'],
    cloth: ['cloth-1.ogg', 'cloth-2.ogg'], land: ['land-1.ogg', 'land-2.ogg'], put: ['put-1.ogg', 'put-2.ogg'], metal: ['metal-1.ogg', 'metal-2.ogg'],
    switch: ['switch-1.ogg', 'switch-2.ogg'], select: ['select.ogg'], uiopen: ['ui-open.ogg'], uiclose: ['ui-close.ogg'], solve: ['solve.ogg'], nope: ['nope.ogg'],
    inspect: ['inspect.ogg'], uninspect: ['uninspect.ogg'],
  },
});
const VOL = { 'step-wood': 0.22, 'step-carpet': 0.3, bell: 0.55, locked: 0.5, click: 0.4, switch: 0.4, inspect: 0.25, uninspect: 0.2, page: 0.45, land: 0.35, cloth: 0.3, coins: 0.4, select: 0.3 };
const sfx = (name, opts = {}) => sfxPlayer.sample(name, { vol: VOL[name] ?? 0.4, ...opts });

/* ---------- state ---------- */
let stage, input, cam, ui, builder, level;
let me = null;               // { ctrl, avatar, look }
let mode = 'loading';        // loading | menu | creator | play | pause
let inventory = [];
let menuT = 0;

/* ---------- look (Human or Critter), saved on this laptop ---------- */
function defaultLook() { return { kind: 'critter', critter: typeof myAvatar === 'function' ? myAvatar() : '🦊', style: 'female-c', skin: 1, hair: 0, top: 5, bottom: 9, acc: 0 }; }
function loadLook() { return { ...defaultLook(), ...(store.get(LOOK_KEY, null) || {}) }; }
function saveLook(l) { store.set(LOOK_KEY, l); }
async function makeAvatar(look) {
  return look.kind === 'human'
    ? createHuman({ style: look.style, skin: look.skin, hair: look.hair, top: look.top, bottom: look.bottom, acc: look.acc })
    : createCritter(look.critter || '🦊');
}
async function setLook(look) {
  const old = me && me.avatar;
  const av = await makeAvatar(look);
  if (old) { av.root.position.copy(old.root.position); av.root.rotation.copy(old.root.rotation); stage.scene.remove(old.root); old.dispose(); }
  stage.scene.add(av.root);
  me.avatar = av; me.look = look;
}

/* ---------- boot ---------- */
async function boot() {
  const canvas = $('#view');
  stage = createStage(canvas, { background: '#120c14' });
  stage.scene.fog = new THREE.Fog('#120c14', 18, 42);
  input = createInput(canvas);
  cam = createFollowCamera(stage.camera, { distance: 5.4, pitch: 0.38 });
  ui = createInteractor({ stage, input, promptEl: $('#prompt'), onInspect });
  builder = createBuilder(stage);

  const total = lobby.LOBBY_MODELS.length + 1;
  setLoad(0.05, 'Polishing the brass…');
  await models.preload(lobby.LOBBY_MODELS, (d) => setLoad(0.1 + (d / total) * 0.7, 'Dusting the chandelier…'));
  level = await lobby.build(builder, levelApi);
  level.items.forEach((it) => ui.add(it));

  const look = loadLook();
  me = { ctrl: CC.create({ x: level.spawn.x, z: level.spawn.z, yaw: level.spawn.yaw }), avatar: null, look };
  await setLook(look);
  setLoad(1, 'Opening the doors…');
  sfxPlayer.load();
  stage.start(frame);
  setTimeout(() => { $('#loading').classList.add('done'); toMenu(); }, 250);
}
function setLoad(f, text) { $('#load-bar').style.width = Math.round(f * 100) + '%'; if (text) $('#load-text').textContent = text; }

/* ---------- what levels can do ---------- */
const levelApi = {
  toast: (t) => toast(t, 2600),
  sfx: (n, o) => sfx(n, o),
  act: () => {},
  shadowLight: (light, size) => stage.addShadowLight(light, { size }),
  inspect: (obj, info) => { sfx('inspect'); return ui.inspect(obj, info); },
  give(item) {
    if (inventory.length >= 5) { toast('Your pockets are full'); return false; }
    inventory.push(item); renderInventory(); sfx('coins');
    me.avatar.play('pickup', { force: true });
    toast(`${item.icon} Picked up: ${item.name}`);
    return true;
  },
  remove: (it) => ui.remove(it),
};

/* ---------- the frame ---------- */
const flat = new THREE.Vector3();
function frame(dt, t) {
  builder.update(dt, t);
  builder.tick && builder.tick(dt, t);
  if (mode === 'menu' || mode === 'creator') { menuFrame(dt, t); input.endFrame(); return; }
  if (mode !== 'play') { me && me.avatar.update(dt, 0); input.endFrame(); return; }
  if (ui.inspecting) { ui.update(dt); me.avatar.update(dt, 0); input.endFrame(); return; }

  // movement relative to the camera
  const mv = input.move(cam.viewYaw());
  const run = input.down('shift');
  const out = CC.step(me.ctrl, { mx: mv.mx, mz: mv.mz, run, jump: input.pressed(' ') }, builder.boxes, dt);
  const c = me.ctrl, av = me.avatar;
  av.root.position.set(c.x, c.y, c.z);
  av.root.rotation.y = c.yaw;
  if (out.jumped) { av.play('jump', { force: true }); sfx('cloth'); }
  else if (!c.ground && c.vy < -2) av.play('fall');
  else if (c.ground && !av.busy) av.play(c.speed > 3.4 ? 'run' : c.speed > 0.3 ? 'walk' : 'idle', {});
  if (out.landed > 3) { av.land && av.land(out.landed); sfx('land', { vol: Math.min(0.5, out.landed / 20) }); if (av.anim === 'fall') av.play('idle', { force: true }); }
  if (out.steps) sfx(surfaceAt(c.x, c.z) === 'carpet' ? 'step-carpet' : 'step-wood', { rate: run ? 1.08 : 1 });
  av.update(dt, c.speed);

  // emotes
  if (input.pressed('1')) av.play('yes', { force: true });
  if (input.pressed('2')) av.play('no', { force: true });

  cam.update(dt, c, input, builder.boxes);
  ui.update(dt, c, c.yaw, t);
  if (input.pressed('escape')) pause(true);
  if (input.pressed('?') || input.pressed('h')) howTo(true);
  input.endFrame();
}
function surfaceAt(x, z) {
  if (x < -8.1) return 'carpet';                       // corridor
  if (Math.abs(x) < 1.6 && z > -3.4) return 'carpet';  // runner
  if (x > -6.4 && x < -2.8 && z > 0.4 && z < 4) return 'carpet'; // rug
  return 'wood';
}

/* ---------- menu & creator camera ---------- */
function menuFrame(dt, t) {
  menuT += dt;
  if (mode === 'menu') {
    const a = menuT * 0.06 + 0.6;
    stage.camera.position.set(Math.sin(a) * 6.5, 2.6 + Math.sin(menuT * 0.2) * 0.25, 1.5 + Math.cos(a) * 5.5);
    stage.camera.lookAt(0, 1.6, -1.5);
    me.avatar.root.position.set(0, 0, 3.2); me.avatar.root.rotation.y = Math.sin(menuT * 0.5) * 0.4;
  } else {
    // creator: the camera faces you on the carpet, you turn on a little plinth
    stage.camera.position.lerp(flat.set(0.9, 1.45, 6.1), 1 - Math.exp(-dt * 4));
    stage.camera.lookAt(0.55, 0.75, 3.2);
    me.avatar.root.position.set(0, 0, 3.2);
    me.avatar.root.rotation.y = creatorYaw + (input.dragging ? 0 : 0);
    if (input.dragging) creatorYaw += input.look.dx * 0.01;
  }
  if (!me.avatar.busy && me.avatar.anim !== 'idle') me.avatar.play('idle');
  me.avatar.update(dt, 0);
}

/* ---------- screens ---------- */
function showScreen(id) {
  $('#prompt').hidden = true;
  document.querySelectorAll('.li-screen').forEach((s) => s.classList.toggle('on', s.id === id));
  document.body.dataset.mode = mode;
}
function toMenu() { mode = 'menu'; menuT = 0; showScreen('menu'); input.enabled = true; me.avatar.play('idle', { force: true }); $('#hud').hidden = true; }
function play() {
  mode = 'play'; showScreen('none');
  $('#hud').hidden = false;
  const c = me.ctrl; c.x = level.spawn.x; c.z = level.spawn.z; c.y = 0; c.yaw = level.spawn.yaw;
  me.avatar.root.position.set(c.x, c.y, c.z);
  cam.state.yaw = c.yaw + Math.PI; cam.snap(c);
  howTo(false);
  stage.canvas?.focus?.();
}
function pause(on) {
  if (on && mode !== 'play') return;
  mode = on ? 'pause' : 'play';
  showScreen(on ? 'pause-menu' : 'none');
  sfx(on ? 'uiopen' : 'uiclose');
  input.release();
}

/* ---------- character creator ---------- */
let creatorYaw = 0, draft = null;
function openCreator() {
  mode = 'creator'; creatorYaw = 0.35; draft = { ...me.look };
  showScreen('creator');
  renderCreator();
  me.avatar.play('idle', { force: true });
}
function chips(label, values, current, key, render = (v, i) => v) {
  return `<div class="cr-row"><b>${label}</b><div class="cr-chips">${values.map((v, i) => `<button type="button" class="chip${i === current ? ' on' : ''}" data-k="${key}" data-v="${i}" ${String(v).startsWith('#') ? `style="--sw:${v}" aria-label="${label} ${i + 1}"` : ''}>${String(v).startsWith('#') ? '' : render(v, i)}</button>`).join('')}</div></div>`;
}
function renderCreator() {
  const d = draft, human = d.kind === 'human';
  $('#cr-kind').innerHTML = `<button type="button" class="seg${!human ? ' on' : ''}" data-kind="critter">🐾 Critter</button><button type="button" class="seg${human ? ' on' : ''}" data-kind="human">🧑 Human</button>`;
  if (!human) {
    const base = AVATAR_ART.parse(d.critter).base;
    $('#cr-opts').innerHTML = `<p class="cr-note">Your Sweet Revenge critter, in 3D. Change its colour or accessory in your profile and it changes here too.</p>
      <div class="cr-row"><b>Critter</b><div class="cr-chips crit">${AVATARS.map((a) => `<button type="button" class="chip big${a === base ? ' on' : ''}" data-critter="${a}">${avatarHTML(a)}</button>`).join('')}</div></div>
      <div class="cr-row"><b>Colour</b><div class="cr-chips">${AVATAR_ART.COLOURS.map((c, i) => `<button type="button" class="chip${(AVATAR_ART.parse(d.critter).colour || 0) === i ? ' on' : ''}" data-ccol="${i}" style="--sw:${c || AVATAR_ART.C[base].body}" aria-label="Colour ${i}"></button>`).join('')}</div></div>
      <div class="cr-row"><b>Accessory</b><div class="cr-chips">${AVATAR_ART.ACCESSORIES.map(([n], i) => `<button type="button" class="chip txt${(AVATAR_ART.parse(d.critter).acc || 0) === i ? ' on' : ''}" data-cacc="${i}">${n}</button>`).join('')}</div></div>`;
  } else {
    $('#cr-opts').innerHTML = chips('Style', HUMAN_STYLES, HUMAN_STYLES.indexOf(d.style), 'style', (v, i) => `${i + 1}`)
      + chips('Skin', SKIN, d.skin, 'skin') + chips('Hair', HAIR, d.hair, 'hair') + chips('Top', CLOTH, d.top, 'top') + chips('Bottom', CLOTH, d.bottom, 'bottom')
      + chips('Extra', HUMAN_ACC, d.acc, 'acc', (v) => v);
  }
}
let previewGen = 0;
async function preview() {
  const my = ++previewGen;
  const look = { ...draft };
  const av = await makeAvatar(look);
  if (my !== previewGen) { av.dispose(); return; }
  const old = me.avatar; stage.scene.remove(old.root); old.dispose();
  stage.scene.add(av.root); me.avatar = av; me.look = look;
  av.play('yes', { force: true });
}
$('#creator').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  sfx('select');
  if (b.dataset.kind) { draft.kind = b.dataset.kind; renderCreator(); preview(); return; }
  if (b.dataset.critter) { const p = AVATAR_ART.parse(draft.critter); draft.critter = AVATAR_ART.compose(b.dataset.critter, b.dataset.critter === '🤖' ? 0 : p.colour, b.dataset.critter === '🤖' ? 0 : p.acc); }
  else if (b.dataset.ccol) { const p = AVATAR_ART.parse(draft.critter); if (p.base !== '🤖') draft.critter = AVATAR_ART.compose(p.base, +b.dataset.ccol, p.acc); }
  else if (b.dataset.cacc) { const p = AVATAR_ART.parse(draft.critter); if (p.base !== '🤖') draft.critter = AVATAR_ART.compose(p.base, p.colour, +b.dataset.cacc); }
  else if (b.dataset.k) { const k = b.dataset.k, v = +b.dataset.v; draft[k] = k === 'style' ? HUMAN_STYLES[v] : v; }
  else return;
  renderCreator(); preview();
});
$('#cr-done').onclick = () => { saveLook(draft); sfx('solve'); toast('Looking sharp ✨'); toMenu(); };
$('#cr-cancel').onclick = async () => { draft = loadLook(); await preview(); toMenu(); };

/* ---------- inventory & inspect ---------- */
function renderInventory() {
  $('#inv').innerHTML = [0, 1, 2, 3, 4].map((i) => { const it = inventory[i]; return `<div class="slot${it ? ' full' : ''}" title="${it ? escapeHtml(it.name) : ''}"><kbd>${i + 1}</kbd>${it ? `<span>${it.icon}</span>` : ''}</div>`; }).join('');
}
function onInspect(open, info) {
  $('#inspect').hidden = !open;
  if (open) { $('#ins-title').textContent = info.title || ''; $('#ins-text').textContent = info.text || ''; $('#prompt').hidden = true; }
  else sfx('uninspect');
}

/* ---------- How to Play (always reachable from the "?" button) ---------- */
const HOWTO = [
  { icon: '🏨', title: 'You two are locked in', text: 'You wake up in different wings of the Hotel Halfway. Work together to find the way out before dawn.' },
  { icon: '⌨️', title: 'Walk around', text: 'W A S D (or arrows) to walk, hold Shift to run, Space to hop. Drag the mouse (or Z / C) to turn the camera, scroll to zoom.' },
  { icon: '✋', title: 'Use and inspect', text: 'Walk up to something that glows and press E (or click it). Inspecting: drag to turn it over, E or Esc to put it back.' },
  { icon: '💬', title: 'Talk without a call', text: 'Each of you sees different clues. Type in the chat, ping things, or send a snapshot of what you see. Hold V for the walkie-talkie.' },
];
function howTo(force) { showHowTo('lockedin', HOWTO, { force, title: 'How to play Locked In' }); }

/* ---------- wiring ---------- */
$('#btn-explore').onclick = () => { sfx('select'); play(); };
$('#btn-look').onclick = () => { sfx('select'); openCreator(); };
$('#btn-help').onclick = () => howTo(true);
$('#btn-help-hud').onclick = () => howTo(true);
$('#btn-pause').onclick = () => pause(true);
$('#btn-resume').onclick = () => pause(false);
$('#btn-pause-help').onclick = () => howTo(true);
$('#btn-pause-menu').onclick = () => { pause(false); toMenu(); };
$('#btn-quality').onclick = () => { const q = (stage.quality + 3) % 4; stage.setQuality(q); $('#btn-quality').textContent = 'Graphics: ' + ['Lowest', 'Low', 'High', 'Ultra'][q]; };
$('#btn-mute').onclick = (e) => setIcon(e.currentTarget, sfxPlayer.toggle() ? 'mute' : 'volume');
addEventListener('pagehide', () => { try { stage && stage.dispose(); } catch (e) { /* leaving anyway */ } });
// type in a box and the game slows its drawing (and ignores keys) so typing stays smooth
document.addEventListener('focusin', (e) => { if (/INPUT|TEXTAREA/.test(e.target.tagName)) stage && stage.throttle(30); });
document.addEventListener('focusout', () => stage && stage.throttle(0));
// debug/perf hook for the test harness
window.__li = { setQ: (q) => stage.setQuality(q), get stats() { return stage && stage.stats; }, get mode() { return mode; }, get me() { return me && me.ctrl; }, play, toMenu, openCreator, get boxes() { return builder && builder.boxes; } };

hydrateIcons();
applyPalette();
renderInventory();
requireLogin().then(() => boot()).catch((e) => { console.error(e); $('#load-text').textContent = 'Something went wrong loading the hotel. Refresh to try again.'; });
