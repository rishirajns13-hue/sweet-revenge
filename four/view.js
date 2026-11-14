/* Plonk! in 3D: a chunky glossy board with real holes, discs that wear each player's critter face, a
   ghost disc over the column you point at, drops with a bounce, and the winning four pulsing.
     await FourView.init(canvas, looks); FourView.drop(c, r, who); FourView.hover(c, who); FourView.win(line) */
import * as THREE from 'three';
import { createStage } from '../shared/3d/stage.js?v=1';

const COLS = 7, ROWS = 6, GAP = 1.0, R = 0.4;
const COL = { a: '#ff5fa8', b: '#3f9bff' };
let stage = null, board = null, discs = [], ghost = null, anims = [], faces = {}, t = 0, winLine = null, colHits = [], onPick = null, hoverCol = -1;
const cx = (c) => (c - (COLS - 1) / 2) * GAP, cy = (r) => (r - (ROWS - 1) / 2) * GAP;

function faceTexture(key, color) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = color; g.beginPath(); g.arc(128, 128, 128, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(255,255,255,.22)'; g.beginPath(); g.arc(128, 128, 104, 0, Math.PI * 2); g.fill();
  const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace;
  tx.center.set(0.5, 0.5); tx.rotation = Math.PI / 2; // the cylinder's cap is mapped sideways
  if (typeof AVATAR_ART !== 'undefined' && key) {
    const svg = AVATAR_ART.svg(key, 'happy').replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="216" ');
    const img = new Image();
    img.onload = () => { g.drawImage(img, 28, 22, 200, 216); tx.needsUpdate = true; };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }
  return tx;
}

export async function init(canvas, looks, pick) {
  onPick = pick;
  if (!stage) {
    stage = createStage(canvas, { background: '#2a1f4f', fov: 34, bloom: 0.25 });
    stage.setGrade({ vignette: 0.28, warmth: 0.03, sat: 1.1 });
    stage.scene.add(new THREE.HemisphereLight('#fff6ff', '#3a2a66', 1.3));
    const key = new THREE.DirectionalLight('#ffffff', 2.4); key.position.set(-4, 8, 9); stage.addShadowLight(key, { size: 8 }); stage.scene.add(key);
    const rim = new THREE.PointLight('#ff9ad0', 18, 20, 2); rim.position.set(5, 3, -3); stage.scene.add(rim);
    // background: a soft radial glow
    const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
    const gr = g.createRadialGradient(128, 110, 10, 128, 128, 180); gr.addColorStop(0, '#7b5cff'); gr.addColorStop(1, '#1d1538'); g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    const bg = new THREE.CanvasTexture(c); bg.colorSpace = THREE.SRGBColorSpace; stage.scene.background = bg;
    stage.camera.position.set(0, 1.0, 14.2); stage.camera.lookAt(0, 0.3, 0);
    buildBoard();
    stage.start(tick);
    canvas.addEventListener('pointermove', (e) => pointer(e, false));
    canvas.addEventListener('pointerdown', (e) => pointer(e, true));
    canvas.addEventListener('pointerleave', () => { hoverCol = -1; });
  }
  faces = { a: faceTexture(looks.a, COL.a), b: faceTexture(looks.b, COL.b) };
  reset();
  return stage;
}

function buildBoard() {
  const w = COLS * GAP + 0.7, h = ROWS * GAP + 0.7;
  const shape = new THREE.Shape();
  const rr = 0.35, x0 = -w / 2, y0 = -h / 2;
  shape.moveTo(x0 + rr, y0); shape.lineTo(x0 + w - rr, y0); shape.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + rr); shape.lineTo(x0 + w, y0 + h - rr); shape.quadraticCurveTo(x0 + w, y0 + h, x0 + w - rr, y0 + h);
  shape.lineTo(x0 + rr, y0 + h); shape.quadraticCurveTo(x0, y0 + h, x0, y0 + h - rr); shape.lineTo(x0, y0 + rr); shape.quadraticCurveTo(x0, y0, x0 + rr, y0);
  for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) { const hole = new THREE.Path(); hole.absarc(cx(c), cy(r), R + 0.04, 0, Math.PI * 2, true); shape.holes.push(hole); }
  // light on purpose (low-spec laptops): 14-sided holes and one bevel step are plenty at this size
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.22, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.04, bevelSegments: 1, curveSegments: 14 });
  const mat = new THREE.MeshStandardMaterial({ color: '#ffc233', roughness: 0.35, metalness: 0.05 });
  board = new THREE.Group();
  const front = new THREE.Mesh(geo, mat); front.position.z = 0.17; front.castShadow = true; front.receiveShadow = true;
  const back = new THREE.Mesh(geo, mat); back.position.z = -0.17 - 0.28;
  board.add(front, back);
  // feet and a base so it stands on the table
  const footMat = new THREE.MeshStandardMaterial({ color: '#2b2140', roughness: 0.6 });
  for (const s of [-1, 1]) { const f = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 1.6), footMat); f.position.set(s * (w / 2 - 0.2), -h / 2 - 0.2, -0.05); f.castShadow = true; board.add(f); }
  const table = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 0.2, 48), new THREE.MeshStandardMaterial({ color: '#3a2a66', roughness: 0.9 }));
  table.position.set(0, -h / 2 - 0.6, 0); table.receiveShadow = true; board.add(table);
  stage.scene.add(board);
  // invisible column hit-boxes for picking
  for (let c = 0; c < COLS; c++) { const m = new THREE.Mesh(new THREE.BoxGeometry(GAP, h + 1.6, 1), new THREE.MeshBasicMaterial({ visible: false })); m.position.set(cx(c), 0.6, 0); m.userData.c = c; stage.scene.add(m); colHits.push(m); }
}
function discMesh(who) {
  const geo = new THREE.CylinderGeometry(R, R, 0.26, 28); geo.rotateX(Math.PI / 2);
  const side = new THREE.MeshStandardMaterial({ color: COL[who], roughness: 0.35 });
  const face = new THREE.MeshStandardMaterial({ map: faces[who], roughness: 0.4 });
  const m = new THREE.Mesh(geo, [side, face, face]); m.castShadow = true;
  return m;
}
export function reset() {
  discs.forEach((d) => d.removeFromParent()); discs = []; anims = []; winLine = null;
  if (ghost) { ghost.removeFromParent(); ghost = null; }
}
export function setBoard(boardState) {
  reset();
  for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) { const w = boardState[c][r]; if (w) { const m = discMesh(w); m.position.set(cx(c), cy(r), 0); stage.scene.add(m); discs.push(m); } }
}
// Drop a disc from above the board into (c, r) with a bounce. Resolves when it has landed.
export function drop(c, r, who, sound) {
  const m = discMesh(who); stage.scene.add(m); discs.push(m);
  const top = cy(ROWS - 1) + 1.4, y1 = cy(r);
  m.position.set(cx(c), top, 0);
  return new Promise((res) => {
    let v = 0, y = top, bounced = 0;
    anims.push((dt) => {
      v -= 38 * dt; y += v * dt;
      if (y <= y1) { y = y1; if (Math.abs(v) > 2.2 && bounced < 2) { sound && sound(bounced); v = -v * 0.32; bounced++; } else { m.position.y = y1; m.rotation.z = 0; res(); return false; } }
      m.position.y = y; m.rotation.z = Math.sin(y * 3) * 0.05;
      return true;
    });
  });
}
export function hover(c, who, show) {
  if (!show || c < 0) { if (ghost) ghost.visible = false; return; }
  if (!ghost || ghost.userData.who !== who) { if (ghost) ghost.removeFromParent(); ghost = discMesh(who); ghost.userData.who = who; ghost.material.forEach((mt) => { mt.transparent = true; mt.opacity = 0.75; }); stage.scene.add(ghost); }
  ghost.visible = true;
  ghost.userData.tx = cx(c);
}
export function win(line) { winLine = line; }
export const hovered = () => hoverCol;

const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function pointer(e, click) {
  const r = stage.renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, stage.camera);
  const hit = ray.intersectObjects(colHits)[0];
  hoverCol = hit ? hit.object.userData.c : -1;
  if (click && hoverCol >= 0 && onPick) onPick(hoverCol);
}
function tick(dt) {
  t += dt;
  anims = anims.filter((f) => f(dt));
  if (ghost && ghost.visible) { ghost.position.x += ((ghost.userData.tx ?? 0) - ghost.position.x) * Math.min(1, dt * 16); ghost.position.y = cy(ROWS - 1) + 1.25 + Math.sin(t * 4) * 0.06; }
  if (winLine) {
    for (const [c, r] of winLine) { const d = discs.find((m) => Math.abs(m.position.x - cx(c)) < 0.01 && Math.abs(m.position.y - cy(r)) < 0.01); if (d) { d.scale.setScalar(1 + Math.sin(t * 7) * 0.08); d.material[0].emissive = new THREE.Color(d.material[0].color); d.material[0].emissiveIntensity = 0.35 + Math.sin(t * 7) * 0.25; } }
  }
  // a gentle sway of the camera so it feels alive
  stage.camera.position.x = Math.sin(t * 0.25) * 0.35; stage.camera.lookAt(0, 0.3, 0);
}
export function resize() { stage && stage.resize(); }
export function dispose() { if (stage) { stage.dispose(); stage = null; } }
export const getStage = () => stage;
window.FourView = { init, reset, setBoard, drop, hover, win, hovered, resize, dispose, getStage };
