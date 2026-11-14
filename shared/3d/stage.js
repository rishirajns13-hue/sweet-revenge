/* The 3D stage shared by Locked In (and later the Island): renderer, scene, camera, lights' environment,
   post effects and a frame loop that protects the laptop.
   - Only pages that are 3D games import this file; nothing else on the site loads three.js from here.
   - Quality steps down by itself when frames get slow (pixel ratio, then bloom, then shadow detail), and the
     loop sleeps when the tab is hidden or the game is paused, and slows down while you type in chat.
     const stage = createStage(canvas, { background: '#1b1420' });
     stage.start((dt, t) => { ...update... });   // renders after every update
     stage.dispose();                                // frees the GPU when leaving the page */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// A gentle film look: vignette, a touch of warmth in the shadows, slightly richer colour.
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, vignette: { value: 0.32 }, warmth: { value: 0.04 }, sat: { value: 1.08 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float vignette, warmth, sat; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb = mix(vec3(l), c.rgb, sat);
      c.rgb += vec3(warmth, warmth * 0.4, -warmth * 0.6) * (1.0 - l);
      vec2 d = vUv - 0.5; c.rgb *= 1.0 - vignette * dot(d, d) * 2.2;
      gl_FragColor = c;
    }`,
};

const QUALITY = [
  // 0: rescue mode for a struggling laptop
  // post = the bloom/grade/FXAA chain; without it the scene is drawn in one pass with hardware
  // anti-aliasing (the page adds a free CSS vignette), which is what integrated laptop GPUs like.
  { dpr: 0.75, post: false, bloom: false, shadows: false, shadowSize: 512 },
  { dpr: 1, post: false, bloom: false, shadows: true, shadowSize: 1024 },
  { dpr: 1.25, post: true, bloom: true, shadows: true, shadowSize: 2048 },
  { dpr: 2, post: true, bloom: true, shadows: true, shadowSize: 2048 },
];

export function createStage(canvas, { background = '#18121c', fov = 50, bloom = 0.32, quality } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.info.autoReset = false;          // count every pass of a frame together

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(background);
  const camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 200);

  // soft image-based light so materials never look flat or plastic
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;
  scene.environmentIntensity = 0.35;

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), bloom, 0.55, 0.82);
  composer.addPass(bloomPass);
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  composer.addPass(new OutputPass());
  const fxaa = new ShaderPass(FXAAShader);
  composer.addPass(fxaa);

  // ---------- quality ----------
  const maxDpr = Math.min(2, window.devicePixelRatio || 1);
  // Start from what this GPU can probably do; the governor below steps down if frames get slow.
  const gpu = (() => { try { const g = renderer.getContext(), d = g.getExtension('WEBGL_debug_renderer_info'); return d ? String(g.getParameter(d.UNMASKED_RENDERER_WEBGL)) : ''; } catch (e) { return ''; } })();
  const integrated = /Intel|UHD|Iris|Mali|Adreno|PowerVR|Apple GPU|SwiftShader|llvmpipe/i.test(gpu) && !/Arc/i.test(gpu);
  const saved = Number(localStorage.getItem('sr-3d-quality'));
  let level = quality ?? (Number.isInteger(saved) && localStorage.getItem('sr-3d-quality') !== null ? saved : integrated ? 1 : maxDpr > 1.4 ? 3 : 2);
  const shadowLights = new Set();
  function applyQuality() {
    const q = QUALITY[level];
    renderer.setPixelRatio(Math.min(q.dpr, maxDpr));
    bloomPass.enabled = q.bloom;
    renderer.shadowMap.enabled = q.shadows;
    shadowLights.forEach((l) => {
      l.castShadow = q.shadows;
      if (l.shadow.mapSize.x !== q.shadowSize) { l.shadow.mapSize.set(q.shadowSize, q.shadowSize); l.shadow.map?.dispose(); l.shadow.map = null; }
    });
    scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => (m.needsUpdate = true)); });
    resize();
  }
  function resize() {
    const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
    renderer.setSize(w, h, false);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(w, h);
    const pr = renderer.getPixelRatio();
    fxaa.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
    bloomPass.resolution.set(w / 2, h / 2);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize); ro.observe(canvas);
  applyQuality();

  // ---------- the loop ----------
  let update = null, raf = 0, last = 0, paused = false, throttle = 0, lastDraw = 0, t = 0;
  const samples = []; let calmSince = 0, stats = { fps: 0, ms: 0, level, drawCalls: 0, tris: 0 };
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (paused || document.hidden) { last = now; return; }
    const minGap = throttle ? 1000 / throttle : 1000 / 61;   // cap at 60 fps on 120 Hz screens
    if (now - lastDraw < minGap - 1) return;
    const dt = Math.min(0.1, (now - (last || now)) / 1000);
    last = now; lastDraw = now; t += dt;
    const t0 = performance.now();
    update && update(dt, t);
    renderer.info.reset();
    if (QUALITY[level].post) composer.render(dt); else renderer.render(scene, camera);
    const ms = performance.now() - t0;
    // governor: if the average frame is slow for ~2 s, drop a quality step
    samples.push(dt);
    if (samples.length > 120) samples.shift();
    if (samples.length === 120 && !throttle) {
      const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
      stats.fps = Math.round(1 / avg);
      if (stats.fps < 45 && level > 0 && now - calmSince > 2500) { level--; applyQuality(); samples.length = 0; calmSince = now; }
    }
    stats.ms = ms; stats.level = level;
    stats.drawCalls = renderer.info.render.calls; stats.tris = renderer.info.render.triangles;
  }
  function start(fn) { update = fn; if (!raf) { last = 0; raf = requestAnimationFrame(frame); } }
  function stop() { cancelAnimationFrame(raf); raf = 0; }

  // a shadow-casting sun/lamp that obeys the quality steps
  function addShadowLight(light, { size = 14, bias = -0.0004 } = {}) {
    light.castShadow = QUALITY[level].shadows;
    light.shadow.mapSize.set(QUALITY[level].shadowSize, QUALITY[level].shadowSize);
    const cam = light.shadow.camera;
    if (cam.isOrthographicCamera) { cam.left = -size; cam.right = size; cam.top = size; cam.bottom = -size; cam.near = 0.5; cam.far = 60; }
    light.shadow.bias = bias; light.shadow.normalBias = 0.02;
    shadowLights.add(light);
    return light;
  }

  function dispose() {
    stop(); ro.disconnect();
    scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) [].concat(o.material).forEach((m) => { Object.values(m).forEach((v) => v && v.isTexture && v.dispose()); m.dispose(); });
    });
    envTex.dispose(); pmrem.dispose(); composer.dispose?.(); renderer.dispose();
    renderer.forceContextLoss?.();
  }

  return {
    THREE, renderer, scene, camera, composer, stats,
    start, stop, resize, dispose, addShadowLight,
    pause(v = true) { paused = v; },
    get paused() { return paused; },
    throttle(fps) { throttle = fps || 0; },       // e.g. 30 while the chat box is focused
    get quality() { return level; },
    setQuality(l, remember = true) { level = Math.max(0, Math.min(QUALITY.length - 1, l)); applyQuality(); if (remember) try { localStorage.setItem('sr-3d-quality', String(level)); } catch (e) { /* private mode */ } },
    gpu, integrated,
    setGrade(g) { Object.entries(g).forEach(([k, v]) => grade.uniforms[k] && (grade.uniforms[k].value = v)); },
    setBloom(strength) { bloomPass.strength = strength; },
  };
}
