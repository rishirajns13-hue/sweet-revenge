'use strict';
/* Sticky Situation: the game loop. Part 3 has couch mode (two players, one keyboard);
   online play comes in part 4. Physics runs at a fixed 60 steps a second; the view draws every frame. */
const SP = window.StickyPhysics, LV = window.StickyLevels;
let world = null, running = false, last = 0, acc = 0, fallsShown = '';
const keys = new Set(), pressed = new Set();

const sfx = (() => {
  const p = createSamplePlayer({ takes: { pop: ['ui-pop-1.ogg', 'ui-pop-2.ogg'], drop: ['ui-drop-1.ogg', 'ui-drop-2.ogg'], shine: ['ui-shine.ogg'], win: ['ui-levelup.ogg'], slide: ['card-slide-1.ogg', 'card-slide-2.ogg'] } });
  return {
    load: p.load,
    jump() { p.sample('pop', { vol: 0.22, rate: 1.3 }); },
    bounce() { p.sample('pop', { vol: 0.5, rate: 0.7 }); },
    checkpoint() { p.sample('shine', { vol: 0.5 }); },
    fall() { p.sample('slide', { vol: 0.7, rate: 0.6 }); p.sample('drop', { vol: 0.6, rate: 0.7, when: 0.3 }); },
    win() { p.sample('win', { vol: 0.7 }); },
    get muted() { return p.muted; }, toggle: p.toggle,
  };
})();

const show = (s) => document.querySelectorAll('.screen').forEach((el) => el.classList.toggle('active', el.id === 'screen-' + s));
const P1 = { left: ['a'], right: ['d'], jump: ['w'], grab: ['shift-left'] };
const P2 = { left: ['arrowleft'], right: ['arrowright'], jump: ['arrowup'], grab: ['/', 'shift-right'] };
const keyName = (e) => (e.key === 'Shift' ? (e.code === 'ShiftRight' ? 'shift-right' : 'shift-left') : e.key.toLowerCase());
addEventListener('keydown', (e) => {
  if (!running) return;
  const k = keyName(e);
  if (!keys.has(k)) pressed.add(k);
  keys.add(k);
  if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' ', '/'].includes(k)) e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(keyName(e)));
addEventListener('blur', () => keys.clear());
const inputFor = (map) => ({
  left: map.left.some((k) => keys.has(k)), right: map.right.some((k) => keys.has(k)),
  jump: map.jump.some((k) => pressed.has(k)), grab: map.grab.some((k) => keys.has(k)),
});

function start() {
  const level = LV.cake;
  world = SP.newWorld(level);
  show('play');
  if (!StickyView.inited) { StickyView.init($('#view'), level); StickyView.setCritters({ a: myAvatar(), b: '🐼' }); StickyView.inited = true; }
  else StickyView.resize();
  running = true; last = performance.now(); acc = 0;
  banner('Climb to the cherry!', 'Together. You\'re glued, after all 🍬', 2600);
  requestAnimationFrame(frame);
}
function frame(now) {
  if (!running) return;
  acc += Math.min(0.1, (now - last) / 1000); last = now;
  while (acc >= SP.P.dt) {
    SP.step(world, inputFor(P1), inputFor(P2));
    pressed.clear();
    acc -= SP.P.dt;
    world.events.splice(0).forEach(onEvent);
  }
  StickyView.render(world, now / 1000);
  hud();
  requestAnimationFrame(frame);
}
function onEvent(e) {
  const cr = StickyView.critters();
  if (e.t === 'jump') sfx.jump();
  else if (e.t === 'bounce') sfx.bounce();
  else if (e.t === 'checkpoint') { sfx.checkpoint(); toast('🕯️ Candle lit! You\'ll come back here if you fall', 2200); }
  else if (e.t === 'fall') {
    sfx.fall();
    toast(`${e.k === 'a' ? 'Player 1' : 'Player 2'} slipped and took you both down 😭`, 2400);
    StickyView.setLook(cr[e.k], cr[e.k].userData.key, 'sulk');
    setTimeout(() => StickyView.setLook(cr[e.k], cr[e.k].userData.key, 'happy'), 2500);
  } else if (e.t === 'win') {
    sfx.win(); bigConfetti();
    ['a', 'b'].forEach((k) => StickyView.setLook(cr[k], cr[k].userData.key, 'cheer'));
    banner('YOU MADE IT! 🍒', `Falls: Player 1 ${world.a.falls} · Player 2 ${world.b.falls}`, 0);
  }
}
function hud() {
  const top = LV.cake.goal.y, h = Math.max(0, Math.min(world.a.y, world.b.y));
  $('#height').textContent = `${Math.round(h)} m`;
  $('#height-bar').style.transform = `scaleX(${Math.min(1, h / top)})`;
  const layer = LV.cake.layers.find((L) => h < L.y1) || LV.cake.layers[LV.cake.layers.length - 1];
  if ($('#layer').textContent !== layer.name) $('#layer').textContent = layer.name;
  const f = `${world.a.falls}|${world.b.falls}`;
  if (f !== fallsShown) { fallsShown = f; $('#falls').innerHTML = `<span>P1 falls <b>${world.a.falls}</b></span><span>P2 falls <b>${world.b.falls}</b></span>`; }
}
function banner(title, sub, ms) {
  const el = $('#st-banner');
  el.innerHTML = `<b>${escapeHtml(title)}</b>${sub ? `<small>${escapeHtml(sub)}</small>` : ''}`;
  el.hidden = false; retrigger(el, 'pop');
  if (ms) setTimeout(() => (el.hidden = true), ms);
}

$('#btn-couch').onclick = start;
$('#btn-leave').onclick = () => { running = false; show('home'); };
$('#btn-mute').onclick = (e) => setIcon(e.currentTarget, sfx.toggle() ? 'mute' : 'volume');
document.addEventListener('DOMContentLoaded', () => {
  hydrateIcons();
  applyPalette();
  sfx.load();
  requireLogin().then(() => {});
});
