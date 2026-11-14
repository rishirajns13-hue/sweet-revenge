/* Using things in the 3D games.
   - The closest usable thing in front of you (or under the mouse, within reach) glows softly and shows a
     prompt bubble: "E  Ring the bell". Press E or click it to use it.
   - Inspect mode: the object flies up in front of the camera on a dim backdrop; drag to turn it, scroll to
     zoom, E or Esc to put it back. Hidden marks on the back of things are found this way.
     const ui = createInteractor({ stage, input, promptEl });
     ui.add({ obj, label: 'Ring the bell', use: () => ..., reach: 1.6 });
     ui.update(dt, playerPos, playerYaw);     // every frame
     ui.inspect(model, { title, text })        // returns a promise that resolves when closed */
import * as THREE from 'three';

export function createInteractor({ stage, input, promptEl, onInspect }) {
  const { scene, camera } = stage;
  const items = new Set();
  const owner = new WeakMap();          // mesh -> item (kept out of userData so clones stay clean)
  let focus = null, inspecting = null;
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), v = new THREE.Vector3(), tmp = new THREE.Vector3();
  scene.add(camera);

  function add(it) {
    it.reach = it.reach ?? 1.7;
    it.enabled = it.enabled ?? true;
    it._mats = [];
    it.obj.traverse((o) => {
      if (!o.isMesh || !o.material || o.material.side === THREE.BackSide) return;
      o.material = o.material.clone();                 // its own copy, so only this one glows
      if (!o.material.emissive) return;
      it._mats.push(o.material);
      owner.set(o, it);
    });
    items.add(it);
    return it;
  }
  function remove(it) { if (focus === it) setFocus(null); items.delete(it); }
  function setFocus(it) {
    if (focus === it) return;
    if (focus) focus._mats.forEach((m) => m.emissive.setRGB(0, 0, 0));
    focus = it;
    if (!promptEl) return;
    if (!it) { promptEl.hidden = true; return; }
    promptEl.innerHTML = `<kbd>E</kbd><span>${it.label}</span>`;
    promptEl.hidden = false;
  }
  function centre(it) { const b = new THREE.Box3().setFromObject(it.obj); return b.getCenter(tmp.clone()).setY(b.max.y + 0.15); }

  function update(dt, pos, yaw, t = performance.now() / 1000) {
    if (inspecting) return updateInspect(dt);
    let best = null, bestScore = Infinity;
    // under the mouse, within reach (generous reach for clicks)
    if (input.pointer.inside && !input.dragging) {
      const r = stage.renderer.domElement.getBoundingClientRect();
      ndc.set(((input.pointer.x - r.left) / r.width) * 2 - 1, -((input.pointer.y - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const meshes = [];
      items.forEach((it) => it.enabled && it.obj.traverse((o) => o.isMesh && owner.has(o) && meshes.push(o)));
      const hit = ray.intersectObjects(meshes, false)[0];
      if (hit) {
        const it = owner.get(hit.object);
        it.obj.getWorldPosition(v);
        const d = Math.hypot(v.x - pos.x, v.z - pos.z);
        if (d < it.reach + 1.2) { best = it; bestScore = -1; }
      }
    }
    // otherwise the closest thing in front of you
    if (!best) items.forEach((it) => {
      if (!it.enabled) return;
      it.obj.getWorldPosition(v);
      if (it.at) v.set(it.at[0], it.at[1], it.at[2]);
      const dx = v.x - pos.x, dz = v.z - pos.z, d = Math.hypot(dx, dz);
      if (d > it.reach || Math.abs(v.y - pos.y) > 2.2) return;
      const facing = d < 0.5 ? 1 : (dx * Math.sin(yaw) + dz * Math.cos(yaw)) / d;
      if (facing < 0.1) return;
      const score = d * (1.6 - facing);
      if (score < bestScore) { bestScore = score; best = it; }
    });
    setFocus(best);
    if (focus) {
      const glow = 0.12 + Math.sin(t * 5) * 0.06;
      focus._mats.forEach((m) => m.emissive.setRGB(glow, glow * 0.85, glow * 0.5));
      if (promptEl) {
        centre(focus).project(camera);
        const r = stage.renderer.domElement.getBoundingClientRect();
        promptEl.style.transform = `translate(${(tmp.x * 0.5 + 0.5) * r.width}px, ${(-tmp.y * 0.5 + 0.5) * r.height}px) translate(-50%, -100%)`;
      }
    }
    // E or a click on the focused thing uses it
    const click = input.takeClick();
    let use = input.pressed('e');
    if (click && click.button === 0 && focus && bestScore === -1) use = true;
    if (use && focus) focus.use(focus);
  }

  // ---------- inspect ----------
  let ins = null;
  // faceUp: things that lie flat (letters, books) are tipped up to face you
  function inspect(model, { title = '', text = '', size = 0.55, flip = false, faceUp = false } = {}) {
    if (ins) close();
    const group = new THREE.Group();
    const holder = model.clone(true);
    holder.rotation.set(0, 0, 0); holder.position.set(0, 0, 0); holder.updateMatrixWorld(true);
    const sz = new THREE.Box3().setFromObject(holder).getSize(new THREE.Vector3());
    const s = size / Math.max(sz.x, sz.y, sz.z);
    const pivot = new THREE.Group(); pivot.add(holder); pivot.scale.setScalar(s);
    if (flip) pivot.rotation.y = Math.PI;
    if (faceUp) pivot.rotation.x = Math.PI / 2;
    holder.rotation.set(0, 0, 0); holder.position.set(0, 0, 0);
    const b2 = new THREE.Box3().setFromObject(holder); holder.position.sub(b2.getCenter(new THREE.Vector3()));
    group.add(pivot);
    group.position.set(0, 0, -1.25);
    const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshBasicMaterial({ color: '#0d0912', transparent: true, opacity: 0, depthWrite: false }));
    backdrop.position.z = -2.4; backdrop.renderOrder = -1;
    const key = new THREE.PointLight('#fff1dc', 6, 4); key.position.set(0.6, 0.8, -0.4);
    const rim = new THREE.PointLight('#9ab8ff', 3, 4); rim.position.set(-0.8, 0.2, -1.8);
    group.add(key, rim);
    camera.add(backdrop, group);
    pivot.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    ins = { group, backdrop, pivot, vx: 0, vy: 0, zoom: 1, t: 0, done: null };
    inspecting = true;
    setFocus(null);
    onInspect && onInspect(true, { title, text });
    return new Promise((res) => { ins.done = res; });
  }
  function updateInspect(dt) {
    ins.t += dt;
    ins.backdrop.material.opacity = Math.min(0.78, ins.t * 4);
    const intro = Math.min(1, ins.t * 3.5), e = 1 - (1 - intro) ** 3;
    ins.group.position.z = -1.25 - (1 - e) * 1.2;
    const lk = input.look;
    if (input.dragging) { ins.vx = lk.dx * 0.6; ins.vy = lk.dy * 0.6; }
    else { ins.vx *= Math.exp(-dt * 4); ins.vy *= Math.exp(-dt * 4); }
    ins.pivot.rotation.y += ins.vx * dt * 0.6 + (input.down('a') || input.down('arrowleft') ? -dt * 2 : 0) + (input.down('d') || input.down('arrowright') ? dt * 2 : 0);
    ins.pivot.rotation.x = Math.max(-1.4, Math.min(1.4, ins.pivot.rotation.x + ins.vy * dt * 0.6 + (input.down('w') || input.down('arrowup') ? -dt * 1.5 : 0) + (input.down('s') || input.down('arrowdown') ? dt * 1.5 : 0)));
    ins.zoom = Math.max(0.6, Math.min(2.2, ins.zoom - input.wheel * 0.12));
    ins.group.scale.setScalar(ins.zoom);
    input.takeClick();
    if (ins.t > 0.25 && (input.pressed('e') || input.pressed('escape'))) close();
  }
  function close() {
    if (!ins) return;
    camera.remove(ins.backdrop, ins.group);
    ins.backdrop.geometry.dispose(); ins.backdrop.material.dispose();
    const done = ins.done; ins = null; inspecting = null;
    onInspect && onInspect(false);
    done && done();
  }

  return {
    add, remove, update, inspect, close,
    get focus() { return focus; },
    get inspecting() { return !!inspecting; },
    clear() { items.clear(); setFocus(null); },
  };
}
