/* Third-person camera: orbits behind the player, follows smoothly, never ends up inside a wall.
   Mouse drag (or pointer lock) turns it, Z/C turn it too, the wheel zooms. It can also fly a short
   cinematic path (intros, "the door opened over there") and then hand control back.
     const cam = createFollowCamera(stage.camera, { distance: 5 });
     cam.update(dt, target, input, boxes);   // target: anything with x, y, z
     await cam.cinematic([{ pos, look, secs }, ...]); */
import * as THREE from 'three';

export function createFollowCamera(camera, { distance = 5.2, min = 2.2, max = 9, height = 1.1, pitch = 0.42, yaw = Math.PI } = {}) {
  const st = { yaw, pitch, dist: distance, wantDist: distance, focus: new THREE.Vector3(), cine: null };
  const tmp = new THREE.Vector3(), dir = new THREE.Vector3(), look = new THREE.Vector3();
  // ray vs box (slab test): distance to the first wall between the focus point and the camera
  function blocked(from, d, maxLen, boxes) {
    let best = maxLen;
    for (const b of boxes) {
      if (b.off || b.noCam) continue;
      let t0 = 0, t1 = best;
      for (let a = 0; a < 3; a++) {
        const o = from.getComponent(a), v = d.getComponent(a), lo = b.min[a], hi = b.max[a];
        if (Math.abs(v) < 1e-8) { if (o < lo || o > hi) { t0 = Infinity; break; } continue; }
        let ta = (lo - o) / v, tb = (hi - o) / v; if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) break;
      }
      if (t0 <= t1 && t0 > 0.05 && t0 < best) best = t0;
    }
    return best;
  }
  function update(dt, target, input, boxes = []) {
    if (st.cine) return runCine(dt);
    if (input) {
      const lk = input.look;
      st.yaw -= lk.dx * 0.005; st.pitch = Math.max(0.08, Math.min(1.25, st.pitch + lk.dy * 0.004));
      if (input.down('z')) st.yaw += dt * 2.2;      // Z / C turn the camera (E is "use")
      if (input.down('c')) st.yaw -= dt * 2.2;
      st.wantDist = Math.max(min, Math.min(max, st.wantDist + input.wheel * 0.6));
    }
    st.focus.lerp(tmp.set(target.x, target.y + height, target.z), 1 - Math.exp(-dt * 12));
    dir.set(Math.sin(st.yaw) * Math.cos(st.pitch), Math.sin(st.pitch), Math.cos(st.yaw) * Math.cos(st.pitch));
    const free = blocked(st.focus, dir, st.wantDist + 0.3, boxes) - 0.3;
    const want = Math.max(0.6, Math.min(st.wantDist, free));
    // pull in fast (no wall clipping), ease back out slowly
    st.dist += (want - st.dist) * (want < st.dist ? 1 : 1 - Math.exp(-dt * 3));
    camera.position.copy(st.focus).addScaledVector(dir, st.dist);
    camera.lookAt(st.focus);
  }
  // Facing yaw for movement: the direction the camera looks, flattened.
  const viewYaw = () => st.yaw;

  // cinematic: [{ pos:[x,y,z], look:[x,y,z], secs }] eased between keys
  function cinematic(keys) {
    return new Promise((res) => {
      st.cine = { keys, i: 0, t: 0, from: { pos: camera.position.clone(), look: camera.getWorldDirection(new THREE.Vector3()).add(camera.position) }, res };
    });
  }
  function runCine(dt) {
    const c = st.cine, k = c.keys[c.i];
    c.t += dt / k.secs;
    const e = c.t >= 1 ? 1 : c.t < 0.5 ? 4 * c.t ** 3 : 1 - (-2 * c.t + 2) ** 3 / 2;
    camera.position.lerpVectors(c.from.pos, tmp.fromArray(k.pos), e);
    look.lerpVectors(c.from.look, dir.fromArray(k.look), e);
    camera.lookAt(look);
    if (c.t >= 1) {
      c.from = { pos: new THREE.Vector3().fromArray(k.pos), look: new THREE.Vector3().fromArray(k.look) };
      c.i++; c.t = 0;
      if (c.i >= c.keys.length) { const r = c.res; st.cine = null; r(); }
    }
  }
  function skipCine() { if (st.cine) { const r = st.cine.res; st.cine = null; r(); } }
  function snap(target) { st.focus.set(target.x, target.y + height, target.z); st.dist = st.wantDist; }
  return { update, viewYaw, cinematic, skipCine, snap, get inCine() { return !!st.cine; }, state: st };
}
