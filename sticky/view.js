'use strict';
/* Sticky Situation 3D view (three.js r128): a chunky toon cake seen from the side, the two critters as
   flat stickers that always face you, and the gummy rope as a tube that sags when slack and thins
   when stretched. Reads the world from sticky/physics.js every frame; it never changes it. */
const StickyView = (() => {
  const T = THREE;
  let renderer, scene, camera, level, platformMeshes = [], critters = {}, ropeMesh, candles = [], cherry;
  const camPos = new T.Vector3(0, 3, 15), camLook = new T.Vector3(0, 3, 0);
  const KIND = {
    plate: '#ffc2dc', strawberry: '#ff5a6e', marshmallow: '#fffaf6', wafer: '#e9b26b', top: '#ffe27a',
  };
  const toon = (color, extra = {}) => new T.MeshToonMaterial({ color, ...extra });

  function init(canvas, lvl) {
    level = lvl;
    renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    scene = new T.Scene();
    camera = new T.PerspectiveCamera(50, 1, 0.1, 200);
    scene.add(new T.HemisphereLight('#ffffff', '#c98ab0', 0.45));
    const sun = new T.DirectionalLight('#fff4e0', 0.75); sun.position.set(5, 12, 9); scene.add(sun);
    buildCake();
    buildPlatforms();
    buildExtras();
    ropeMesh = new T.Mesh(new T.BufferGeometry(), new T.MeshToonMaterial({ color: '#ff71ce', transparent: true, opacity: 0.92 }));
    scene.add(ropeMesh);
    resize();
    addEventListener('resize', resize);
  }
  function resize() {
    const c = renderer.domElement, w = c.clientWidth || innerWidth, h = c.clientHeight || innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }

  // The cake: a stack of fat cylinders behind the climbing plane, with a frosting drip ring on each layer.
  function buildCake() {
    level.layers.forEach((L, i) => {
      const h = L.y1 - L.y0, r = 12 - i * 1.2;
      const body = new T.Mesh(new T.CylinderGeometry(r, r, h, 48), toon(L.sponge));
      body.position.set(0, L.y0 + h / 2, -r - 0.9);
      scene.add(body);
      const ring = new T.Mesh(new T.TorusGeometry(r, 0.55, 12, 48), toon(L.frosting));
      ring.rotation.x = Math.PI / 2; ring.position.set(0, L.y1, -r - 0.9);
      scene.add(ring);
      // drips down the front
      for (let k = -4; k <= 4; k++) {
        const len = 0.8 + ((k * 7 + i * 3) % 5) * 0.35;
        const drip = new T.Mesh(new T.CylinderGeometry(0.28, 0.28, len, 8), toon(L.frosting));
        const blob = new T.Mesh(new T.SphereGeometry(0.28, 10, 8), toon(L.frosting));
        blob.position.y = -len / 2; drip.add(blob);
        const a = (k / 4) * 0.9;
        drip.position.set(Math.sin(a) * r, L.y1 - len / 2, -r - 0.9 + Math.cos(a) * r);
        scene.add(drip);
      }
    });
  }
  function buildPlatforms() {
    platformMeshes = level.platforms.map((p) => {
      const color = p.slip ? '#bdf3ff' : KIND[p.kind] || '#ff9ad0';
      const depth = p.kind === 'plate' ? 8 : p.kind === 'wafer' ? 1 : 1.8;
      const m = new T.Mesh(new T.BoxGeometry(p.w, p.h * (p.bounce ? 1.4 : 1), depth), toon(color, p.slip ? { emissive: '#4fc3f7', emissiveIntensity: 0.15 } : {}));
      m.position.set(p.x + p.w / 2, p.y + p.h / 2, 0);
      // a dark ink outline, like the stickers everywhere else in the app
      m.add(new T.LineSegments(new T.EdgesGeometry(m.geometry), new T.LineBasicMaterial({ color: '#2b2140' })));
      scene.add(m);
      if (p.kind === 'strawberry') { // seeds
        for (let s = 0; s < 5; s++) { const seed = new T.Mesh(new T.SphereGeometry(0.06, 6, 6), toon('#ffe27a')); seed.position.set(-p.w / 2 + 0.3 + s * (p.w - 0.6) / 4, 0.05, depth / 2); m.add(seed); }
      }
      return m;
    });
  }
  function buildExtras() {
    candles = (level.checkpoints || []).map((cp) => {
      const g = new T.Group();
      const stick = new T.Mesh(new T.CylinderGeometry(0.15, 0.15, 1.2, 12), toon('#9ab8ff'));
      stick.position.y = 0.6; g.add(stick);
      const flame = new T.Mesh(new T.ConeGeometry(0.14, 0.4, 10), new T.MeshBasicMaterial({ color: '#8a8a8a' }));
      flame.position.y = 1.4; g.add(flame);
      g.position.set(cp.x, cp.y, 0.2);
      g.userData = { flame, lit: false, y: cp.y };
      scene.add(g);
      return g;
    });
    if (level.goal) {
      cherry = new T.Group();
      const ball = new T.Mesh(new T.SphereGeometry(1, 24, 18), toon('#ff2d55'));
      cherry.add(ball);
      const stem = new T.Mesh(new T.CylinderGeometry(0.06, 0.08, 1.4, 8), toon('#2bc48a'));
      stem.position.set(0.25, 1.2, 0); stem.rotation.z = -0.4; cherry.add(stem);
      cherry.position.set(level.goal.x, level.goal.y + 0.4, -0.6);
      scene.add(cherry);
    }
  }

  // A critter is its avatar drawn onto a sprite (a flat sticker that always faces the camera).
  function critterSprite(avatarKey, mood = 'happy') {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
    const tex = new T.CanvasTexture(canvas);
    const sprite = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true }));
    sprite.scale.set(1.25, 1.35, 1);
    sprite.userData = { canvas, tex, key: null, mood: null };
    setLook(sprite, avatarKey, mood);
    scene.add(sprite);
    return sprite;
  }
  function setLook(sprite, key, mood) {
    const u = sprite.userData;
    if (u.key === key && u.mood === mood) return;
    u.key = key; u.mood = mood;
    const svg = AVATAR_ART.svg(key, mood).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="276" ');
    const img = new Image();
    img.onload = () => { const ctx = u.canvas.getContext('2d'); ctx.clearRect(0, 0, 256, 256); ctx.drawImage(img, 0, 0, 256, 256); u.tex.needsUpdate = true; };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }
  function setCritters(looks) {
    for (const k of ['a', 'b']) { if (critters[k]) setLook(critters[k], looks[k], 'happy'); else critters[k] = critterSprite(looks[k]); }
  }

  // The rope: a curve between the two that sags when slack and thins as it stretches.
  function updateRope(a, b) {
    const d = Math.hypot(b.x - a.x, b.y - a.y), slack = StickyPhysics.P.ropeSlack;
    const sag = Math.max(0, slack - d) * 0.55;
    const mid = new T.Vector3((a.x + b.x) / 2, (a.y + b.y) / 2 - sag, 0.3);
    const curve = new T.QuadraticBezierCurve3(new T.Vector3(a.x, a.y, 0.3), mid, new T.Vector3(b.x, b.y, 0.3));
    const radius = 0.11 * Math.max(0.35, Math.min(1, slack / Math.max(d, 0.01)));
    ropeMesh.geometry.dispose();
    ropeMesh.geometry = new T.TubeGeometry(curve, 20, radius, 8, false);
    ropeMesh.material.color.set(d > slack ? '#ff3b8d' : '#ff71ce');
  }

  function render(w, t) {
    // moving platforms
    const boxes = StickyPhysics.boxesAt(level, w.t);
    boxes.forEach((b, i) => { if (b.src) platformMeshes[i].position.set(b.x + b.w / 2, b.y + b.h / 2, 0); });
    // critters: squash when landing, stretch when jumping
    for (const k of ['a', 'b']) {
      const c = w[k], s = critters[k];
      if (!s) continue;
      s.position.set(c.x, c.y + 0.25, 0.6);
      const stretch = Math.max(-0.25, Math.min(0.25, c.vy * 0.02));
      s.scale.set(1.25 * (1 - stretch * 0.5), 1.35 * (1 + stretch), 1);
    }
    updateRope(w.a, w.b);
    candles.forEach((g) => {
      const lit = w.a.checkpoint.y >= g.userData.y - 0.1;
      if (lit !== g.userData.lit) { g.userData.lit = lit; g.userData.flame.material.color.set(lit ? '#ffb31c' : '#8a8a8a'); }
      if (lit) g.userData.flame.scale.y = 1 + Math.sin(t * 12 + g.userData.y) * 0.15;
    });
    if (cherry) cherry.rotation.y = t * 0.8;
    // camera: follow the middle of the pair, pull back when the rope is long
    const mx = (w.a.x + w.b.x) / 2, my = (w.a.y + w.b.y) / 2, spread = Math.hypot(w.a.x - w.b.x, w.a.y - w.b.y);
    const want = new T.Vector3(mx * 0.7, my + 2.2, 13 + spread * 0.9);
    camPos.lerp(want, 0.08);
    camLook.lerp(new T.Vector3(mx * 0.7, my + 1, 0), 0.1);
    camera.position.copy(camPos); camera.lookAt(camLook);
    renderer.render(scene, camera);
  }

  return { init, setCritters, setLook, render, critters: () => critters, resize };
})();
