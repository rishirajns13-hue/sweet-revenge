/* Painted textures for 3D rooms, drawn on canvases at load time (no image files to download):
   wallpaper (damask, stripes), wood planks, carpet with a border, checker tiles, wood panelling,
   and framed paintings. Each returns a THREE texture set to repeat.
     const t = tex.wallpaper({ base: '#2f5a4a', ink: '#3c6e5c' });  t.repeat.set(4, 1) */
import * as THREE from 'three';

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function finish(c, { repeat = true, srgb = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
// tiny deterministic noise so every load looks the same
function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const cache = new Map();
const memo = (key, fn) => { if (!cache.has(key)) cache.set(key, fn()); const t = cache.get(key).clone(); t.needsUpdate = true; return t; };

export const tex = {
  wallpaper({ base = '#2f5a4a', ink = '#3d7060', gold = '#c9a45c', kind = 'damask' } = {}) {
    return memo('wp' + base + ink + kind, () => {
      const [c, g] = canvas(256, 512);
      g.fillStyle = base; g.fillRect(0, 0, 256, 512);
      if (kind === 'stripes') {
        for (let x = 0; x < 256; x += 64) { g.fillStyle = ink; g.fillRect(x + 8, 0, 24, 512); g.fillStyle = gold; g.globalAlpha = 0.5; g.fillRect(x + 36, 0, 3, 512); g.globalAlpha = 1; }
      } else {
        // damask: mirrored leafy medallions
        g.strokeStyle = ink; g.fillStyle = ink; g.lineWidth = 6;
        const motif = (cx, cy, s) => {
          g.save(); g.translate(cx, cy); g.scale(s, s);
          for (const m of [1, -1]) {
            g.save(); g.scale(m, 1);
            g.beginPath(); g.moveTo(0, -90); g.bezierCurveTo(40, -70, 50, -20, 10, 0); g.bezierCurveTo(50, 20, 40, 70, 0, 90); g.stroke();
            g.beginPath(); g.ellipse(28, -40, 12, 22, -0.5, 0, Math.PI * 2); g.fill();
            g.beginPath(); g.ellipse(28, 40, 12, 22, 0.5, 0, Math.PI * 2); g.fill();
            g.beginPath(); g.arc(46, 0, 8, 0, Math.PI * 2); g.fill();
            g.restore();
          }
          g.beginPath(); g.ellipse(0, 0, 10, 18, 0, 0, Math.PI * 2); g.fillStyle = gold; g.globalAlpha = 0.55; g.fill(); g.globalAlpha = 1; g.fillStyle = ink;
          g.restore();
        };
        motif(128, 128, 1); motif(0, 384, 1); motif(256, 384, 1);
      }
      // subtle paper grain
      const r = rng(7); g.globalAlpha = 0.05;
      for (let i = 0; i < 3000; i++) { g.fillStyle = r() > 0.5 ? '#000' : '#fff'; g.fillRect(r() * 256, r() * 512, 2, 2); }
      return finish(c);
    });
  },
  planks({ base = '#7a4b2a', dark = '#5e3820', light = '#93603a' } = {}) {
    return memo('pl' + base, () => {
      const [c, g] = canvas(512, 512), r = rng(3);
      const rows = 8, h = 512 / rows;
      for (let i = 0; i < rows; i++) {
        let x = -r() * 200;
        while (x < 512) {
          const w = 160 + r() * 200;
          const shade = r();
          g.fillStyle = shade < 0.33 ? dark : shade < 0.66 ? base : light;
          g.fillRect(x, i * h, w, h);
          g.globalAlpha = 0.12; g.strokeStyle = '#2a170b';
          for (let k = 0; k < 5; k++) { g.beginPath(); const y = i * h + 6 + r() * (h - 12); g.moveTo(x, y); g.bezierCurveTo(x + w * 0.3, y + 4, x + w * 0.6, y - 4, x + w, y + r() * 4); g.stroke(); }
          g.globalAlpha = 1;
          g.fillStyle = '#2a170b'; g.fillRect(x, i * h, 2, h);
          x += w;
        }
        g.fillStyle = '#2a170b'; g.fillRect(0, i * h, 512, 2);
      }
      return finish(c);
    });
  },
  carpet({ base = '#7d1f2b', pattern = '#9a2f3a', border = '#c9a45c', withBorder = false } = {}) {
    return memo('cp' + base + withBorder, () => {
      const [c, g] = canvas(256, 256), r = rng(11);
      g.fillStyle = base; g.fillRect(0, 0, 256, 256);
      g.fillStyle = pattern;
      for (let y = 0; y < 256; y += 64) for (let x = 0; x < 256; x += 64) {
        g.save(); g.translate(x + 32, y + 32); g.rotate(Math.PI / 4); g.fillRect(-14, -14, 28, 28); g.restore();
        g.fillStyle = border; g.globalAlpha = 0.6; g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1; g.fillStyle = pattern;
      }
      g.globalAlpha = 0.08; for (let i = 0; i < 6000; i++) { g.fillStyle = r() > 0.5 ? '#000' : '#fff'; g.fillRect(r() * 256, r() * 256, 1, 1); } g.globalAlpha = 1;
      return finish(c);
    });
  },
  checker({ a = '#efe6d6', b = '#2b2830' } = {}) {
    return memo('ck' + a + b, () => {
      const [c, g] = canvas(256, 256), r = rng(5);
      for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) { g.fillStyle = (x + y) % 2 ? b : a; g.fillRect(x * 128, y * 128, 128, 128); }
      // marble veins
      g.globalAlpha = 0.18; g.strokeStyle = '#8a8070'; g.lineWidth = 1.5;
      for (let i = 0; i < 14; i++) { g.beginPath(); let x = r() * 256, y = r() * 256; g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (r() - 0.5) * 60; y += (r() - 0.3) * 40; g.lineTo(x, y); } g.stroke(); }
      g.globalAlpha = 1; g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 2; g.strokeRect(0, 0, 128, 128); g.strokeRect(128, 128, 128, 128);
      return finish(c);
    });
  },
  panel({ base = '#5a3622', light = '#6e4630' } = {}) {
    return memo('pn' + base, () => {
      const [c, g] = canvas(256, 256);
      g.fillStyle = base; g.fillRect(0, 0, 256, 256);
      g.fillStyle = light; g.fillRect(20, 24, 216, 200);
      g.strokeStyle = '#3a2214'; g.lineWidth = 6; g.strokeRect(20, 24, 216, 200);
      g.strokeStyle = 'rgba(255,220,170,.18)'; g.lineWidth = 3; g.strokeRect(30, 34, 196, 180);
      return finish(c);
    });
  },
  // a painting: generated landscape/portrait-ish art; seed picks colours, `secret` draws a mark on the back
  painting(seed = 1, { secret = '' } = {}) {
    const [c, g] = canvas(256, 320), r = rng(seed * 97);
    const skies = [['#f6c8a0', '#e88c7d'], ['#9fc9e8', '#e8f0f8'], ['#2b2550', '#7a5aa8'], ['#f4dc9a', '#e8a85a']];
    const [s1, s2] = skies[seed % skies.length];
    const sky = g.createLinearGradient(0, 0, 0, 320); sky.addColorStop(0, s1); sky.addColorStop(1, s2);
    g.fillStyle = sky; g.fillRect(0, 0, 256, 320);
    for (let i = 0; i < 3; i++) { g.fillStyle = ['#3d5a4a', '#567a5a', '#7a9a6a'][i]; g.beginPath(); g.moveTo(0, 320); let x = 0; while (x <= 256) { g.lineTo(x, 170 + i * 45 + Math.sin(x / 40 + seed + i) * 25 * r()); x += 16; } g.lineTo(256, 320); g.fill(); }
    g.fillStyle = 'rgba(255,250,230,.85)'; g.beginPath(); g.arc(60 + r() * 140, 70 + r() * 40, 18 + r() * 10, 0, Math.PI * 2); g.fill();
    if (secret) { g.fillStyle = '#2b2140'; g.font = 'bold 40px serif'; g.textAlign = 'center'; g.fillText(secret, 128, 300); }
    const t = finish(c, { repeat: false }); return t;
  },
  // a sheet of paper with handwritten-looking lines (letters, notes)
  paper(lines = [], { title = '', w = 512, h = 640, font = '"Caveat", "Comic Sans MS", cursive' } = {}) {
    const [c, g] = canvas(w, h), r = rng(lines.join('').length + 3);
    g.fillStyle = '#f4ead2'; g.fillRect(0, 0, w, h);
    g.globalAlpha = 0.06; for (let i = 0; i < 4000; i++) { g.fillStyle = r() > 0.5 ? '#6b4a1a' : '#fff'; g.fillRect(r() * w, r() * h, 2, 2); } g.globalAlpha = 1;
    g.fillStyle = '#2b2140';
    if (title) { g.font = `bold 44px ${font}`; g.textAlign = 'center'; g.fillText(title, w / 2, 70); }
    const size = Math.round(w / 18);
    g.textAlign = 'left'; g.font = `${size}px ${font}`;
    lines.forEach((l, i) => g.fillText(l, w * 0.07, (title ? 130 : 70) + i * size * 1.4, w * 0.86));
    return finish(c, { repeat: false });
  },
};
