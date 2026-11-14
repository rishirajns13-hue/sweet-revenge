// Voice notes: the recorder (with a live waveform) and one shared player for every voice bubble.
import { waveform } from './logic.mjs?v=7';

export const MAX_SECONDS = 300;

// The first format this browser can record. Safari records mp4/aac; Chrome, Edge and Firefox do webm/opus.
export function pickFormat() {
  if (typeof MediaRecorder === 'undefined') return null;
  const opts = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  return opts.find((t) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
}

// Starts recording. onLevel(0..1) is called ~12 times a second for the live bars.
// Resolves with { stop(): Promise<{ blob, dur, wave }>, cancel() }.
export async function record(onLevel) {
  const type = pickFormat();
  if (type === null) throw new Error('This browser cannot record audio');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const rec = new MediaRecorder(stream, { ...(type && { mimeType: type }), audioBitsPerSecond: 32000 });
  const chunks = [], levels = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const ac = new (window.AudioContext || window.webkitAudioContext)();
  const src = ac.createMediaStreamSource(stream), an = ac.createAnalyser();
  an.fftSize = 1024; src.connect(an);
  const buf = new Float32Array(an.fftSize);
  const started = performance.now();
  const tick = setInterval(() => {
    an.getFloatTimeDomainData(buf);
    let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const level = Math.min(1, Math.sqrt(sum / buf.length) * 4);
    levels.push(level);
    onLevel && onLevel(level, (performance.now() - started) / 1000);
  }, 80);
  rec.start(250);
  const end = () => { clearInterval(tick); stream.getTracks().forEach((t) => t.stop()); ac.close().catch(() => {}); };
  return {
    stop: () => new Promise((resolve) => {
      rec.onstop = () => {
        end();
        const dur = (performance.now() - started) / 1000;
        resolve({ blob: new Blob(chunks, { type: rec.mimeType || type || 'audio/webm' }), dur, wave: waveform(levels, 40) });
      };
      rec.stop();
    }),
    cancel: () => { rec.onstop = end; try { rec.stop(); } catch (e) { end(); } },
  };
}

/* ---------------- playback: one audio element, so starting one note stops the other ---------------- */
// Bubbles can be redrawn while a note plays (a reaction arrives, say), so the player finds its bubble
// by message id each frame instead of holding on to one element.
const audio = new Audio();
audio.preload = 'auto';
let current = null; // { id, find(): element, getNext(): button }
const RATES = [1, 1.5, 2];
let rate = 1;
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function paintEl(el, p, playing) {
  if (!el) return;
  el.classList.toggle('playing', playing);
  const bars = el.querySelectorAll('.v-bars i'), k = Math.round(p * bars.length);
  bars.forEach((b, i) => b.classList.toggle('on', playing || p > 0 ? i < k : true));
  const t = el.querySelector('.v-time');
  if (t) t.textContent = playing || p > 0 ? fmt(Math.max(0, (audio.duration || 0) - audio.currentTime)) : el.dataset.dur;
  const r = el.querySelector('.v-rate');
  if (r) r.textContent = rate + '×';
}
function paint() {
  if (!current) return;
  const p = audio.duration && isFinite(audio.duration) ? audio.currentTime / audio.duration : 0;
  paintEl(current.find(), p, !audio.paused);
}
let raf = 0;
const loop = () => { paint(); if (!audio.paused) raf = requestAnimationFrame(loop); };
audio.addEventListener('play', () => { cancelAnimationFrame(raf); loop(); });
audio.addEventListener('pause', paint);
audio.addEventListener('ended', () => {
  if (!current) return;
  const { find, getNext } = current;
  current = null;
  paintEl(find(), 0, false);
  const next = getNext && getNext();
  if (next) next.click(); // the next voice note in a row plays on its own
});

// Redraws a bubble that was just rebuilt, if it's the one playing.
export function repaint(id) { if (current && current.id === id) paint(); }
export const playingId = () => (current && !audio.paused ? current.id : null);

export async function toggle(id, find, url, getNext) {
  if (current && current.id === id) {
    if (audio.paused) audio.play(); else audio.pause();
    return;
  }
  if (current) { const old = current.find(); current = null; audio.pause(); paintEl(old, 0, false); }
  current = { id, find, getNext };
  const el = find();
  if (el) el.classList.add('loading');
  try {
    audio.src = await url();
    audio.playbackRate = rate;
    await audio.play();
  } catch (e) { current = null; paintEl(find(), 0, false); throw e; }
  finally { const e2 = find(); if (e2) e2.classList.remove('loading'); }
}
// Tapping the waveform of the playing note jumps to that point.
export function seek(id, frac) {
  if (!current || current.id !== id || !audio.duration || !isFinite(audio.duration)) return false;
  audio.currentTime = frac * audio.duration;
  paint();
  return true;
}
export function cycleRate() {
  rate = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
  audio.playbackRate = rate;
  paint();
  return rate;
}
export const currentRate = () => rate;
export function stopAll() { audio.pause(); }
