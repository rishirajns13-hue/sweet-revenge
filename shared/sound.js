'use strict';
/* Sweet Revenge sounds: plays real recorded clips (shared/sounds, CC0 from Kenney) through Web Audio.
   Each name can have several takes; every play picks a random take and nudges its pitch and volume a
   little so repeats sound natural. Mute is shared by every page (stored as 'sr-muted').
   Used by the home screen and Plus Four. Needs shared/core.js (store). */
function createSamplePlayer({ takes, base = 'shared/sounds/', volume = 0.8 }) {
  const bufs = {};
  let ctx = null, out = null, loading = null;
  let muted = !!store.get('sr-muted', false);
  function ac() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      out = ctx.createGain();
      out.gain.value = volume;
      out.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  // takes: { name: ['file.ogg', ...] }
  function load() {
    if (loading) return loading;
    const c = ac();
    loading = Promise.all(Object.entries(takes).flatMap(([name, files]) => files.map((file) =>
      fetch(base + file)
        .then((r) => r.arrayBuffer()).then((b) => c.decodeAudioData(b))
        .then((buf) => (bufs[name] = bufs[name] || []).push(buf))
        .catch(() => { /* missing or unsupported: that sound stays quiet */ }))));
    return loading;
  }
  function sample(name, { vol = 0.7, rate = 1, when = 0, vary = true } = {}) {
    if (muted) return;
    try {
      const c = ac(), list = bufs[name];
      if (!list || !list.length) { load(); return; }
      const src = c.createBufferSource(), g = c.createGain();
      src.buffer = list[Math.floor(Math.random() * list.length)];
      src.playbackRate.value = rate * (vary ? 0.95 + Math.random() * 0.1 : 1);
      g.gain.value = vol * (vary ? 0.85 + Math.random() * 0.15 : 1);
      src.connect(g).connect(out);
      src.start(c.currentTime + when);
    } catch (e) { /* audio not available */ }
  }
  // A soft wooden note, like a little marimba (for the few moments that aren't a recorded sound).
  function note(freq, when = 0, vol = 0.05) {
    if (muted) return;
    try {
      const c = ac(), t = c.currentTime + when;
      [[1, 1], [4, 0.12]].forEach(([mult, level]) => {
        const o = c.createOscillator(), g = c.createGain();
        o.frequency.value = freq * mult;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(vol * level, t + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0001, t + (mult === 1 ? 0.45 : 0.12));
        o.connect(g).connect(out); o.start(t); o.stop(t + 0.5);
      });
    } catch (e) { /* audio not available */ }
  }
  return {
    load, sample, note,
    get muted() { return muted; },
    toggle() { muted = !muted; store.set('sr-muted', muted); return muted; },
  };
}
