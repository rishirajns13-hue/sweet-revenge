// Drawing on the chat (like Instagram's DM "Draw"): a see-through canvas over the visible messages,
// with pen, marker, neon and eraser, colours, a size slider and undo. Sending hands back the ink,
// cropped to a transparent image, with where it sat on the screen.

export const COLOURS = ['#ffffff', '#111111', '#3897f0', '#70c050', '#fdcb5c', '#fd8d32', '#ed4956', '#ff5fa2', '#a307ba'];
const TOOLS = [
  ['pen', 'Pen', '<path d="M5 19l1.2-4.3L16.4 4.5a2 2 0 0 1 2.9 0l.2.2a2 2 0 0 1 0 2.9L9.3 17.8z"/><path d="M14.5 6.4l3.1 3.1"/>'],
  ['marker', 'Marker', '<path d="M7 21v-4l3-3h4l3 3v4"/><path d="M10 14l1-9h2l1 9"/><path d="M5 21h14" stroke-width="3"/>'],
  ['neon', 'Neon', '<path d="M4 15c3-6 6 2 9-3s4-5 7-4"/><path d="M4 15c3-6 6 2 9-3s4-5 7-4" stroke-width="6" opacity=".25"/>'],
  ['eraser', 'Eraser', '<path d="M8.5 19.5L3.8 14.8a1.6 1.6 0 0 1 0-2.3l8.7-8.7a1.6 1.6 0 0 1 2.3 0l5.4 5.4a1.6 1.6 0 0 1 0 2.3l-8.2 8z"/><path d="M8.5 19.5H20M7 9.5l7.5 7.5"/>'],
];
const ic = (p) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;
const MIN = 2, MAX = 34;

let ui = null; // the open drawing, or null

export const drawing = () => !!ui;

// host: the element whose box the canvas covers (the chat's scroller); app: the chat window it sits in.
// onSend({ blob, box: {x, y, w, h} in viewport px }) → Promise; resolves once handed off.
export function openDraw({ host, app, onSend, onClose }) {
  if (ui) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const hr = host.getBoundingClientRect(), ar = app.getBoundingClientRect();
  const root = document.createElement('div');
  root.className = 'dw';
  root.innerHTML = `
    <div class="dw-scrim"></div>
    <canvas class="dw-base"></canvas><canvas class="dw-live"></canvas><canvas class="dw-core"></canvas>
    <div class="dw-top">
      <button type="button" class="dw-txt" data-dw="cancel">Cancel</button>
      <button type="button" class="dw-round" data-dw="undo" aria-label="Undo" disabled>${ic('<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>')}</button>
      <button type="button" class="dw-send" data-dw="send" disabled>Send</button>
    </div>
    <div class="dw-size" aria-label="Brush size" role="slider" aria-valuemin="${MIN}" aria-valuemax="${MAX}" tabindex="0"><i class="dw-track"></i><i class="dw-knob"></i></div>
    <div class="dw-hint">Draw anywhere on the chat</div>
    <div class="dw-bottom">
      <div class="dw-tools" role="radiogroup" aria-label="Brush">${TOOLS.map(([k, label, p]) => `<button type="button" role="radio" data-tool="${k}" aria-label="${label}">${ic(p)}<span>${label}</span></button>`).join('')}</div>
      <div class="dw-cols" role="radiogroup" aria-label="Colour">${COLOURS.map((c) => `<button type="button" role="radio" data-col="${c}" style="--c:${c}" aria-label="Colour ${c}"></button>`).join('')}</div>
    </div>`;
  app.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const base = $('.dw-base'), live = $('.dw-live'), core = $('.dw-core');
  const bctx = base.getContext('2d'), lctx = live.getContext('2d'), cctx = core.getContext('2d');
  // The canvas covers the scroller exactly, so ink lines up with the messages under it.
  const L = hr.left - ar.left, T = hr.top - ar.top, W = hr.width, H = hr.height;
  for (const c of [base, live, core]) {
    Object.assign(c.style, { left: L + 'px', top: T + 'px', width: W + 'px', height: H + 'px' });
    c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
  }
  bctx.scale(dpr, dpr); lctx.scale(dpr, dpr); cctx.scale(dpr, dpr);
  // Neon's glow is blurred on a quarter-size canvas: a blur over the full canvas is far too slow on a weak laptop.
  const G = 0.25, glow = document.createElement('canvas'), gctx = glow.getContext('2d');
  glow.width = Math.ceil(W * G); glow.height = Math.ceil(H * G);
  const head = app.querySelector('.dm-head'), comp = app.querySelector('.composer');
  $('.dw-top').style.height = (head ? head.offsetHeight : 56) + 'px';
  $('.dw-size').style.top = T + 24 + 'px';
  $('.dw-hint').style.top = T + 14 + 'px';
  $('.dw-bottom').style.minHeight = (comp ? comp.offsetHeight : 64) + 'px';

  // The last brush, colour and size come back next time (white ink is hard to see on a light chat, so pink there).
  let saved = {}; try { saved = JSON.parse(localStorage.getItem('dm-draw') || '{}') || {}; } catch (e) { /* private window */ }
  const dark = !!app.closest('.dark');
  const st = {
    tool: TOOLS.some(([k]) => k === saved.tool) && saved.tool !== 'eraser' ? saved.tool : 'pen',
    col: COLOURS.includes(saved.col) ? saved.col : dark ? COLOURS[0] : '#ff5fa2',
    size: typeof saved.size === 'number' ? Math.min(1, Math.max(0, saved.size)) : 0.28, strokes: [], cur: null, raf: 0,
  };
  const px = () => MIN + st.size * st.size * (MAX - MIN); // finer control at the small end
  const widthOf = (s) => (s.tool === 'marker' ? s.w * 2.2 : s.tool === 'eraser' ? s.w * 2 : s.w);

  function path(ctx, pts) {
    ctx.beginPath();
    if (pts.length < 3) { const [a] = pts, b = pts[pts.length - 1]; ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0] + 0.01, b[1]); return; }
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
    }
    const z = pts[pts.length - 1]; ctx.lineTo(z[0], z[1]);
  }
  const blurOf = (s) => Math.max(10, s.w * 1.6);
  const coreOf = (s) => Math.max(1.5, s.w * 0.42);
  function line(ctx, pts, width, colour) {
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = width; ctx.strokeStyle = colour;
    path(ctx, pts); ctx.stroke(); ctx.restore();
  }
  // One stroke, drawn whole.
  function paint(ctx, s) {
    if (s.tool === 'eraser') { ctx.save(); ctx.globalCompositeOperation = 'destination-out'; line(ctx, s.pts, widthOf(s), '#000'); ctx.restore(); return; }
    if (s.tool === 'neon') {
      gctx.setTransform(1, 0, 0, 1, 0, 0); gctx.clearRect(0, 0, glow.width, glow.height);
      gctx.setTransform(G, 0, 0, G, 0, 0);
      gctx.shadowColor = s.col; gctx.shadowBlur = blurOf(s) * G * 2;
      line(gctx, s.pts, s.w, s.col); line(gctx, s.pts, s.w, s.col); // twice: a brighter glow
      ctx.drawImage(glow, 0, 0, glow.width / G, glow.height / G);
    }
    line(ctx, s.pts, widthOf(s), s.col);
    if (s.tool === 'neon') line(ctx, s.pts, coreOf(s), 'rgba(255,255,255,.9)');
  }
  const clear = (ctx) => ctx.clearRect(0, 0, W, H);
  // Puts a finished stroke onto the base layer.
  function commit(s) {
    if (s.tool === 'eraser') { paint(bctx, s); return; }
    clear(lctx); paint(lctx, s);
    bctx.save(); bctx.setTransform(1, 0, 0, 1, 0, 0);
    bctx.globalAlpha = s.tool === 'marker' ? 0.55 : 1;
    bctx.drawImage(live, 0, 0);
    bctx.restore(); clear(lctx);
  }
  function redrawAll() { clear(bctx); st.strokes.forEach(commit); }
  function frame() {
    st.raf = 0;
    const s = st.cur; if (!s) return;
    if (s.tool === 'eraser') { // rubs out straight away, a few points at a time
      const from = Math.max(0, (s.done || 0) - 2);
      paint(bctx, { ...s, pts: s.pts.slice(from) }); s.done = s.pts.length; return;
    }
    // While drawing, only the newest bit is added (the screen does neon's glow), so long strokes stay smooth.
    const seg = s.pts.slice(Math.max(0, (s.done || 0) - 2)); s.done = s.pts.length;
    line(lctx, seg, widthOf(s), s.col);
    if (s.tool === 'neon') line(cctx, seg, coreOf(s), 'rgba(255,255,255,.9)');
  }
  const queue = () => { if (!st.raf) st.raf = requestAnimationFrame(frame); };
  const inked = () => st.strokes.some((s) => s.tool !== 'eraser');
  function sync() {
    $('[data-dw="undo"]').disabled = !st.strokes.length;
    $('[data-dw="send"]').disabled = !inked();
    root.classList.toggle('inked', st.strokes.length > 0);
    root.querySelectorAll('[data-tool]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.tool === st.tool)));
    root.querySelectorAll('[data-col]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.col === st.col)));
    root.classList.toggle('erasing', st.tool === 'eraser');
    const knob = $('.dw-knob'), d = Math.max(14, widthOf({ tool: st.tool, w: px() }));
    knob.style.setProperty('--y', String(1 - st.size));
    knob.style.setProperty('--d', Math.min(d, 44) + 'px');
    knob.style.setProperty('--c', st.tool === 'eraser' ? '#fff' : st.col);
    $('.dw-size').setAttribute('aria-valuenow', String(Math.round(px())));
  }

  /* drawing with a finger, pen or mouse */
  let pid = null;
  const at = (e) => { const r = live.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  live.addEventListener('pointerdown', (e) => {
    if (pid !== null || (e.pointerType === 'mouse' && e.button !== 0)) return;
    pid = e.pointerId; live.setPointerCapture(pid);
    st.cur = { tool: st.tool, col: st.col, w: px(), pts: [at(e)] };
    live.style.opacity = st.tool === 'marker' ? '.55' : '1';
    live.style.filter = st.tool === 'neon' ? `drop-shadow(0 0 ${blurOf(st.cur) / 2}px ${st.col}) drop-shadow(0 0 ${blurOf(st.cur) / 4}px ${st.col})` : '';
    root.classList.add('busy');
    queue(); e.preventDefault();
  });
  live.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pid || !st.cur) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of (evs.length ? evs : [e])) {
      const p = at(ev), q = st.cur.pts[st.cur.pts.length - 1];
      if (Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) >= 1.2) st.cur.pts.push(p);
    }
    queue();
  });
  const end = (e) => {
    if (e.pointerId !== pid) return;
    pid = null;
    const s = st.cur; st.cur = null;
    if (st.raf) { cancelAnimationFrame(st.raf); st.raf = 0; }
    root.classList.remove('busy');
    if (!s) return;
    st.strokes.push(s);
    if (s.tool === 'eraser') { st.cur = s; frame(); st.cur = null; } else commit(s); // the eraser's last few points
    clear(cctx); live.style.opacity = '1'; live.style.filter = '';
    sync();
  };
  live.addEventListener('pointerup', end);
  live.addEventListener('pointercancel', end);
  root.addEventListener('wheel', (e) => e.preventDefault(), { passive: false }); // the chat stays put under the ink
  root.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

  /* the size slider (drag up for bigger) */
  const size = $('.dw-size');
  const setFromY = (y) => { const r = size.getBoundingClientRect(); st.size = Math.min(1, Math.max(0, 1 - (y - r.top) / r.height)); sync(); };
  size.addEventListener('pointerdown', (e) => { size.setPointerCapture(e.pointerId); size.classList.add('drag'); setFromY(e.clientY); e.preventDefault(); });
  size.addEventListener('pointermove', (e) => { if (size.hasPointerCapture(e.pointerId)) setFromY(e.clientY); });
  size.addEventListener('pointerup', () => size.classList.remove('drag'));
  size.addEventListener('keydown', (e) => {
    const d = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 0.06 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -0.06 : 0;
    if (d) { st.size = Math.min(1, Math.max(0, st.size + d)); sync(); e.preventDefault(); }
  });

  /* buttons */
  root.addEventListener('click', (e) => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.tool) { st.tool = t.dataset.tool; sync(); return; }
    if (t.dataset.col) { st.col = t.dataset.col; if (st.tool === 'eraser') st.tool = 'pen'; sync(); return; }
    const a = t.dataset.dw;
    if (a === 'cancel') close();
    if (a === 'undo') { st.strokes.pop(); redrawAll(); sync(); }
    if (a === 'send') send();
  });
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); st.strokes.pop(); redrawAll(); sync(); }
  };
  document.addEventListener('keydown', onKey, true);

  async function send() {
    const box = crop();
    if (!box) return;
    const btn = $('[data-dw="send"]'); btn.disabled = true; btn.textContent = 'Sending…';
    const out = document.createElement('canvas');
    out.width = box.pw; out.height = box.ph;
    out.getContext('2d').drawImage(base, box.px, box.py, box.pw, box.ph, 0, 0, box.pw, box.ph);
    const blob = await new Promise((r) => out.toBlob(r, 'image/webp', 0.9)); // Safari makes a png instead
    if (!blob) { btn.textContent = 'Send'; btn.disabled = false; return; }
    const r = base.getBoundingClientRect();
    close();
    onSend({ blob, box: { x: r.left + box.px / dpr, y: r.top + box.py / dpr, w: box.pw / dpr, h: box.ph / dpr } });
  }
  // The smallest box around the ink (in canvas pixels), with a little room for the glow.
  function crop() {
    const w = base.width, h = base.height, a = bctx.getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      const row = y * w * 4;
      for (let x = 0; x < w; x++) if (a[row + x * 4 + 3] > 6) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
    }
    if (x1 < 0) return null;
    const pad = 2 * dpr;
    const px0 = Math.max(0, x0 - pad), py0 = Math.max(0, y0 - pad);
    return { px: px0, py: py0, pw: Math.min(w, x1 + pad + 1) - px0, ph: Math.min(h, y1 + pad + 1) - py0 };
  }
  function close() {
    if (!ui) return;
    try { localStorage.setItem('dm-draw', JSON.stringify({ tool: st.tool, col: st.col, size: st.size })); } catch (e) { /* fine */ }
    document.removeEventListener('keydown', onKey, true);
    root.classList.add('out');
    setTimeout(() => root.remove(), 180);
    ui = null;
    onClose && onClose();
  }
  ui = { close };
  sync();
  requestAnimationFrame(() => root.classList.add('in'));
}
export function closeDraw() { if (ui) ui.close(); }
