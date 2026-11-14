/* Keyboard and mouse for the 3D games. Ignores keys while you type in the chat or any text box.
     const input = createInput(canvas);
     input.down('w'), input.pressed('e')  // pressed = went down since the last input.endFrame()
     input.move(yaw) -> { mx, mz } in world space for the camera's yaw (WASD / arrows)
     input.look -> { dx, dy } mouse movement this frame (when dragging or pointer-locked)
     input.wheel -> scroll this frame */
export function createInput(canvas) {
  const keys = new Set(), pressed = new Set();
  let dx = 0, dy = 0, wheel = 0, dragging = false, clicked = null, enabled = true;
  const typing = (e) => { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable); };
  const name = (e) => (e.code === 'Space' ? ' ' : e.code === 'ShiftLeft' || e.code === 'ShiftRight' ? 'shift' : e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase());
  const onDown = (e) => {
    if (!enabled || typing(e)) return;
    const k = name(e);
    if (!keys.has(k)) pressed.add(k);
    keys.add(k);
    if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'tab'].includes(k)) e.preventDefault();
  };
  const onUp = (e) => { keys.delete(name(e)); if (e.key.length === 1) keys.delete(e.key.toLowerCase()); };
  const clear = () => { keys.clear(); dragging = false; };
  addEventListener('keydown', onDown);
  addEventListener('keyup', onUp);
  addEventListener('blur', clear);

  // mouse: drag (any button) turns the camera; a click without much drag is a "click"
  let downAt = null;
  const onPDown = (e) => { if (!enabled) return; downAt = { x: e.clientX, y: e.clientY, b: e.button, moved: 0 }; dragging = true; canvas.setPointerCapture?.(e.pointerId); };
  const onPMove = (e) => {
    const locked = document.pointerLockElement === canvas;
    if (locked || dragging) { dx += e.movementX || 0; dy += e.movementY || 0; if (downAt) downAt.moved += Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0); }
    pointer.x = e.clientX; pointer.y = e.clientY; pointer.inside = true;
  };
  const onPUp = (e) => {
    if (downAt && downAt.moved < 6) clicked = { x: e.clientX, y: e.clientY, button: downAt.b };
    downAt = null; dragging = false;
  };
  const onWheel = (e) => { if (!enabled) return; e.preventDefault(); wheel += Math.sign(e.deltaY) * Math.min(3, Math.abs(e.deltaY) / 60 || 1); };
  const onLeave = () => { pointer.inside = false; };
  const pointer = { x: 0, y: 0, inside: false };
  canvas.addEventListener('pointerdown', onPDown);
  addEventListener('pointermove', onPMove);
  addEventListener('pointerup', onPUp);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  const any = (...ks) => ks.some((k) => keys.has(k));
  return {
    pointer,
    down: (k) => keys.has(k),
    pressed: (k) => pressed.has(k),
    any,
    anyPressed: (...ks) => ks.some((k) => pressed.has(k)),
    // wanted movement in world space, given the camera's yaw (camera looks along -z when yaw = 0)
    move(yaw) {
      const f = (any('w', 'arrowup') ? 1 : 0) - (any('s', 'arrowdown') ? 1 : 0);
      const s = (any('d', 'arrowright') ? 1 : 0) - (any('a', 'arrowleft') ? 1 : 0);
      if (!f && !s) return { mx: 0, mz: 0 };
      const sin = Math.sin(yaw), cos = Math.cos(yaw);
      // forward = away from the camera, right = camera's right
      return { mx: -sin * f + cos * s, mz: -cos * f - sin * s };
    },
    get look() { return { dx, dy }; },
    get wheel() { return wheel; },
    get dragging() { return dragging; },
    takeClick() { const c = clicked; clicked = null; return c; },
    endFrame() { pressed.clear(); dx = 0; dy = 0; wheel = 0; },
    set enabled(v) { enabled = v; if (!v) clear(); },
    get enabled() { return enabled; },
    release() { keys.clear(); },
    dispose() {
      removeEventListener('keydown', onDown); removeEventListener('keyup', onUp); removeEventListener('blur', clear);
      removeEventListener('pointermove', onPMove); removeEventListener('pointerup', onPUp);
    },
  };
}
