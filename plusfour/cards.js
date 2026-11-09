'use strict';
/* Plus Four cards: faces, backs and the motions every card makes (flip, fly, fan).
   A card is { id, c, v }: c is r/y/g/b or w (wild), v is 0-9, skip, rev, d2, wild or w4. */
(function (root) {
  const COLORS = { r: 'Cherry', y: 'Sunny', g: 'Mint', b: 'Sky' };
  const HEX = { r: '#ff5a5f', y: '#ffc233', g: '#2bc48a', b: '#4d9de0', w: '#2b2140' };
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Paper grain for the cards and felt for the table, baked once into small tiles. A live noise
  // filter blended over every card looks the same but is slow to draw on laptop graphics.
  function bake(size, pixel) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d'), img = g.createImageData(size, size);
    for (let i = 0; i < img.data.length; i += 4) img.data.set(pixel(), i);
    g.putImageData(img, 0, 0);
    return `url(${c.toDataURL('image/png')})`;
  }
  // They go in a stylesheet rule, not a CSS variable: a big inherited variable slows every style update.
  if (typeof document !== 'undefined') {
    const css = document.createElement('style');
    css.textContent = `.pf-card::after { background-image: ${bake(128, () => [43, 33, 64, Math.random() ** 3 * 34])}; }
      .pf-mat::before { background-image: ${bake(160, () => { const v = Math.random() < 0.5 ? 0 : 255; return [v, v, v, Math.random() * 16]; })}; }`;
    document.head.appendChild(css);
  }
  const ms = (t) => (reduced() ? Math.min(t, 120) : t);

  /* ---------- symbols (100x100 boxes) ---------- */
  const mini = (x, y, r, fill) =>
    `<g transform="translate(${x} ${y}) rotate(${r})"><rect x="-17" y="-24" width="34" height="48" rx="6" fill="#fff" stroke="#2b2140" stroke-width="3.5"/><rect x="-12" y="-19" width="24" height="38" rx="3" fill="${fill}"/></g>`;
  const SYMBOL = {
    skip: (f) => `<circle cx="50" cy="50" r="30" fill="none" stroke="${f}" stroke-width="13"/><path d="M29 71L71 29" stroke="${f}" stroke-width="13" stroke-linecap="round"/>`,
    rev: (f) => `<g fill="none" stroke="${f}" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"><path d="M26 44a25 25 0 0 1 42-14l6 6"/><path d="M76 20v17H59"/><path d="M74 56a25 25 0 0 1-42 14l-6-6"/><path d="M24 80V63h17"/></g>`,
    d2: (f) => mini(40, 56, -12, f) + mini(60, 44, 10, f),
    wild: () => `<g stroke="#2b2140" stroke-width="3.5"><path d="M50 50V18a32 32 0 0 1 32 32z" fill="${HEX.r}"/><path d="M50 50h32a32 32 0 0 1-32 32z" fill="${HEX.y}"/><path d="M50 50v32a32 32 0 0 1-32-32z" fill="${HEX.g}"/><path d="M50 50H18a32 32 0 0 1 32-32z" fill="${HEX.b}"/></g>`,
    w4: () => mini(26, 58, -20, HEX.b) + mini(42, 50, -7, HEX.g) + mini(58, 50, 7, HEX.y) + mini(74, 58, 20, HEX.r),
  };
  const svg = (inner) => `<svg viewBox="0 0 100 100" aria-hidden="true">${inner}</svg>`;
  const corner = (v) => ({ skip: svg(SYMBOL.skip('currentColor')), rev: svg(SYMBOL.rev('currentColor')), d2: '+2', w4: '+4', wild: svg(SYMBOL.wild()) }[v] ?? v);

  function label(card) {
    const name = { skip: 'Skip', rev: 'Reverse', d2: 'Plus Two', wild: 'Wild', w4: 'Wild Plus Four' }[card.v] || card.v;
    return card.c === 'w' ? name : `${COLORS[card.c]} ${name}`;
  }
  function faceHtml(card) {
    const num = /^\d$/.test(card.v);
    const fill = card.c === 'w' ? '#fff' : HEX[card.c];
    const mid = num ? `<b class="${card.v === '6' || card.v === '9' ? 'ul' : ''}">${card.v}</b>` : svg(SYMBOL[card.v](fill));
    const k = corner(card.v), ul = card.v === '6' || card.v === '9' ? ' ul' : '';
    return `<div class="pf-face c-${card.c}${num ? '' : ' act'}"><span class="pf-idx tl${ul}">${k}</span><span class="pf-badge">${mid}</span><span class="pf-idx br${ul}">${k}</span></div>`;
  }
  const BACK = '<div class="pf-back"><span class="pf-mark" aria-hidden="true"><i>PLUS</i><b>4</b><i>FOUR</i></span></div>';

  // A card element; `card` null means you only ever see its back.
  function make(card, { down = false } = {}) {
    const el = document.createElement('div');
    el.className = 'pf-card' + (down || !card ? ' down' : '');
    el.innerHTML = (card ? faceHtml(card) : '') + BACK;
    if (card) { el.dataset.id = card.id; el.setAttribute('aria-label', label(card)); }
    else el.setAttribute('aria-label', 'Face-down card');
    return el;
  }
  function setFace(el, card) {
    el.querySelector('.pf-face')?.remove();
    el.insertAdjacentHTML('afterbegin', faceHtml(card));
    el.dataset.id = card.id;
    el.setAttribute('aria-label', label(card));
  }

  /* ---------- motion ---------- */
  // A 2D flip: squash to nothing, swap sides, spring back.
  async function flip(el, card, dur = 260) {
    const base = getComputedStyle(el).transform, t = base === 'none' ? '' : base;
    await el.animate([{ transform: `${t} scaleX(1)` }, { transform: `${t} scaleX(0)` }], { duration: ms(dur / 2), easing: 'ease-in' }).finished;
    if (card) { setFace(el, card); el.classList.remove('down'); } else el.classList.add('down');
    await el.animate([{ transform: `${t} scaleX(0)` }, { transform: `${t} scaleX(1.06)`, offset: 0.8 }, { transform: `${t} scaleX(1)` }], { duration: ms(dur / 2 + 60), easing: 'ease-out' }).finished;
  }

  // Fly a card through the air from one screen rect to another along an arc.
  // `from`/`to` are { x, y, w, rot } in viewport pixels (centre, width, degrees).
  // `flipTo` turns it face-up mid-flight; `land` adds the squash-and-thud at the end.
  function fly(el, from, to, { dur = 520, lift = 70, spin = 0, flipTo = null, land = true, layer } = {}) {
    layer = layer || document.getElementById('flight');
    const w = from.w, s1 = to.w / from.w;
    Object.assign(el.style, { position: 'fixed', left: from.x - w / 2 + 'px', top: from.y - (w * 1.4) / 2 + 'px', width: w + 'px', margin: 0, zIndex: 1 });
    el.style.setProperty('--cw', w + 'px');
    layer.appendChild(el);
    const dx = to.x - from.x, dy = to.y - from.y;
    const midRot = (from.rot + to.rot) / 2 + spin;
    const k = (o, x, y, r, s, extra = '') => ({ offset: o, transform: `translate(${x}px, ${y}px) rotate(${r}deg) scale(${s})${extra}` });
    const frames = [
      k(0, 0, 0, from.rot, 1),
      k(0.5, dx / 2, dy / 2 - lift, midRot, (1 + s1) / 2 + 0.12),
      k(1, dx, dy, to.rot, s1),
    ];
    const d = ms(dur);
    const anim = el.animate(frames, { duration: d, easing: 'cubic-bezier(.35,.75,.3,1)', fill: 'forwards' });
    if (flipTo) {
      const face = flipTo;
      setTimeout(() => { setFace(el, face); el.classList.remove('down'); el.classList.add('flipping'); }, d * 0.45);
    }
    return anim.finished.then(async () => {
      if (land && !reduced()) {
        const end = `translate(${dx}px, ${dy}px) rotate(${to.rot}deg)`;
        await el.animate([
          { transform: `${end} scale(${s1 * 1.08}, ${s1 * 0.92})` },
          { transform: `${end} scale(${s1})` },
        ], { duration: 140, easing: 'ease-out', fill: 'forwards' }).finished;
      }
      return el;
    });
  }
  // After a flight: drop the animation and inline placement so the card follows its new parent's CSS.
  function settle(el) {
    el.getAnimations().forEach((a) => a.cancel());
    el.style.cssText = '';
    el.classList.remove('flipping');
    return el;
  }
  // Where an element sits on screen, ready for fly().
  function rectOf(el, rot = 0) {
    const r = el.getBoundingClientRect();
    const v = el.style.getPropertyValue('--r') || el.style.getPropertyValue('--rot');
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: el.offsetWidth || r.width, rot: v ? parseFloat(v) : rot };
  }

  // Lay cards out as a fanned arc. Each card gets --x, --y and --r; CSS transitions them.
  function fan(cards, { width, cw, hover = -1, maxSpread = 40, bend = 0.00035 } = {}) {
    const n = cards.length;
    if (!n) return;
    const step = Math.min(cw * 0.62, (width - cw) / Math.max(1, n - 1));
    const ang = Math.min(maxSpread / Math.max(1, n - 1), 6);
    cards.forEach((el, i) => {
      const off = i - (n - 1) / 2;
      let x = off * step;
      if (hover >= 0 && i !== hover) x += (i < hover ? -1 : 1) * Math.min(cw * 0.32, step * 0.6);
      el.style.setProperty('--x', x + 'px');
      el.style.setProperty('--y', bend * x * x + 'px');
      el.style.setProperty('--r', off * ang + 'deg');
      el.style.zIndex = i === hover ? 200 : i + 1;
      el.classList.toggle('lift', i === hover);
    });
  }

  // A messy pile: every card lands a little off-centre and tilted.
  function pileSpot(rng = Math.random) {
    return { dx: (rng() - 0.5) * 22, dy: (rng() - 0.5) * 16, rot: (rng() - 0.5) * 38 };
  }

  root.PlusFourCards = { COLORS, HEX, make, setFace, flip, fly, settle, rectOf, fan, pileSpot, label, ms, reduced };
})(typeof window !== 'undefined' ? window : globalThis);
