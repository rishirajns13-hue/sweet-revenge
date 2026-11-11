'use strict';
/* Ludo Party UI concepts: three whole-interface directions, five screens each. Mockups only. */
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rand(a.length)];

/* ================= icons (one stroke family, 24px grid) ================= */
const DOT = (x, y) => `<circle cx="${x}" cy="${y}" r="1.4" fill="currentColor" stroke="none"/>`;
const ICONS = {
  dice: `<rect x="4" y="4" width="16" height="16" rx="4"/>${DOT(9, 9)}${DOT(15, 15)}${DOT(12, 12)}`,
  chat: '<path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H10l-5 4v-4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
  smile: `<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5s1.3 1.8 3.5 1.8 3.5-1.8 3.5-1.8"/>${DOT(9, 10)}${DOT(15, 10)}`,
  send: '<path d="M5 12l14-7-5 15-2.5-6z"/><path d="M11.5 14L19 5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  share: '<path d="M12 4v11M7.5 8.5L12 4l4.5 4.5"/><path d="M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  volume: '<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5.5a2.5 2.5 0 0 0 2.5 4M16 6h2.5a2.5 2.5 0 0 1-2.5 4M12 13v4M8.5 20h7M10 17h4"/>',
  crown: '<path d="M4 18L3 8l5 4 4-6 4 6 5-4-1 10z" fill="currentColor"/>',
  bot: `<rect x="5" y="8" width="14" height="11" rx="3.5"/><path d="M12 4.5V8M3 13v2M21 13v2"/>${DOT(9.5, 13)}${DOT(14.5, 13)}`,
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  user: '<circle cx="12" cy="8.5" r="4"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8-8M16 7l2 2"/>',
  home: '<path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/>',
  users: '<circle cx="9" cy="9" r="3.5"/><path d="M3 19a6 6 0 0 1 12 0"/><path d="M15.5 5.5a3.5 3.5 0 0 1 0 7M18 19a6 6 0 0 0-2.5-4.9"/>',
};
const ic = (name, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

/* ================= tiny arcade sounds (pick S1) ================= */
const sfx = (() => {
  let ctx = null;
  const tone = (f, d, type = 'square', vol = 0.05, when = 0, slide) => {
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      const t = ctx.currentTime + when, o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(f, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + d);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + d);
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + d + 0.02);
    } catch { /* audio unavailable */ }
  };
  return {
    roll: () => { for (let i = 0; i < 6; i++) tone(220 + rand(500), 0.05, 'square', 0.04, i * 0.07); },
    hop: () => tone(660, 0.06, 'square', 0.04),
    pop: () => tone(880, 0.06, 'square', 0.04, 0, 1320),
    win: () => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.16, 'square', 0.05, i * 0.1)),
  };
})();

/* ================= board (classic 15x15, turned so your base is bottom-left) ================= */
const TRACK = [];
function seg(c0, r0, c1, r1) {
  const dc = Math.sign(c1 - c0), dr = Math.sign(r1 - r0);
  for (let c = c0, r = r0; ; c += dc, r += dr) { TRACK.push([c, r]); if (c === c1 && r === r1) break; }
}
seg(1, 6, 5, 6); seg(6, 5, 6, 0); seg(7, 0, 7, 0); seg(8, 0, 8, 5); seg(9, 6, 14, 6); seg(14, 7, 14, 7);
seg(14, 8, 9, 8); seg(8, 9, 8, 14); seg(7, 14, 7, 14); seg(6, 14, 6, 9); seg(5, 8, 0, 8); seg(0, 7, 0, 7); seg(0, 6, 0, 6);
const START = { red: 0, green: 13, yellow: 26, blue: 39 };
const HOME_COL = {
  red: [1, 2, 3, 4, 5].map((c) => [c, 7]), green: [1, 2, 3, 4, 5].map((r) => [7, r]),
  yellow: [13, 12, 11, 10, 9].map((c) => [c, 7]), blue: [13, 12, 11, 10, 9].map((r) => [7, r]),
};
const BASE = { red: [0, 0], green: [9, 0], yellow: [9, 9], blue: [0, 9] };
function point(color, pos, i = 0) {
  let p;
  if (pos === -1) { const [bx, by] = BASE[color]; p = [bx + 2 + (i % 2) * 2, by + 2 + Math.floor(i / 2) * 2]; }
  else if (pos <= 50) { const [c, r] = TRACK[(START[color] + pos) % 52]; p = [c + 0.5, r + 0.5]; }
  else { const [c, r] = HOME_COL[color][pos - 51]; p = [c + 0.5, r + 0.5]; }
  return [p[1] / 15 * 100, (15 - p[0]) / 15 * 100]; // rotate -90deg to match the SVG group
}
const BOARD_STYLES = {
  // A: today's sticker board. B: soft, borderless. C: dark tiles with gaps.
  A: { cell: 'fill:#fff;stroke:var(--ink);stroke-width:.06', base: (c) => `fill:var(--${c});stroke:var(--ink);stroke-width:.08`, inner: 'fill:#fff;stroke:var(--ink);stroke-width:.08', innerR: 0.7, slot: (c) => `fill:var(--${c});fill-opacity:.3;stroke:var(--ink);stroke-width:.06`, lane: (c) => `fill:var(--${c});stroke:var(--ink);stroke-width:.06`, star: '#c9c2d8', gap: 0 },
  B: { cell: 'fill:var(--surface);stroke:var(--raise);stroke-width:.07', base: (c) => `fill:var(--${c})`, inner: 'fill:var(--surface)', innerR: 1.3, slot: (c) => `fill:var(--${c});fill-opacity:.22`, lane: (c) => `fill:var(--${c});stroke:var(--surface);stroke-width:.07`, star: 'var(--muted)', gap: 0, baseR: 0.9 },
  C: { cell: 'fill:var(--surface)', base: (c) => `fill:var(--${c});fill-opacity:.16;stroke:var(--${c});stroke-width:.1`, inner: 'fill:var(--bg)', innerR: 1.1, slot: (c) => `fill:none;stroke:var(--${c});stroke-width:.08;stroke-opacity:.7`, lane: (c) => `fill:var(--${c})`, star: 'var(--muted)', gap: 0.1, baseR: 0.9 },
};
function boardSVG(kind) {
  const S = BOARD_STYLES[kind], g = S.gap;
  let s = '';
  const rect = (x, y, w, h, style, rx = 0) => (s += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" style="${style}"/>`);
  const cell = (c, r, style) => rect(c + g / 2, r + g / 2, 1 - g, 1 - g, style, g ? 0.18 : 0);
  const star = (c, r, fill) => (s += `<text x="${c + 0.5}" y="${r + 0.78}" font-size=".8" text-anchor="middle" style="fill:${fill}">★</text>`);
  for (const [color, [bx, by]] of Object.entries(BASE)) {
    rect(bx + (S.baseR ? 0.15 : 0), by + (S.baseR ? 0.15 : 0), S.baseR ? 5.7 : 6, S.baseR ? 5.7 : 6, S.base(color), S.baseR || 0);
    rect(bx + 0.9, by + 0.9, 4.2, 4.2, S.inner, S.innerR);
    for (let i = 0; i < 4; i++) {
      const [x, y] = [bx + 2 + (i % 2) * 2, by + 2 + Math.floor(i / 2) * 2];
      s += `<circle cx="${x}" cy="${y}" r=".62" style="${S.slot(color)}"/>`;
    }
  }
  TRACK.forEach(([c, r]) => cell(c, r, S.cell));
  for (const color of Object.keys(START)) {
    HOME_COL[color].forEach(([c, r]) => cell(c, r, S.lane(color)));
    const [sc, sr] = TRACK[START[color]];
    cell(sc, sr, S.lane(color)); star(sc, sr, '#ffffffd0');
    const [fc, fr] = TRACK[(START[color] + 8) % 52]; star(fc, fr, S.star);
  }
  const tri = (pts, c) => (s += `<polygon points="${pts}" style="fill:var(--${c})${kind === 'A' ? ';stroke:var(--ink);stroke-width:.06' : ''}"/>`);
  tri('6,6 6,9 7.5,7.5', 'red'); tri('6,6 9,6 7.5,7.5', 'green'); tri('9,6 9,9 7.5,7.5', 'yellow'); tri('6,9 9,9 7.5,7.5', 'blue');
  return `<svg viewBox="0 0 15 15" aria-hidden="true"><g transform="rotate(-90 7.5 7.5)">${s}</g></svg>`;
}
const PIECES = [['red', -1, 0], ['red', -1, 1], ['red', 6, 0, 'me'], ['red', 53], ['yellow', -1, 2], ['yellow', 4], ['yellow', 14], ['yellow', 30]];
function board(kind, cls = '', attrs = '') {
  const toks = PIECES.map(([c, pos, i = 0, me], k) => {
    const [x, y] = point(c, pos, i);
    return `<i class="tk" ${me ? `data-me data-pos="${pos}"` : ''} style="--c:var(--${c});--k:${k};left:${x}%;top:${y}%"></i>`;
  }).join('');
  return `<div class="board ${cls}" ${attrs}>${boardSVG(kind)}<div class="toks">${toks}</div></div>`;
}
const PIPS = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
const FACE_ROT = { 1: [0, 0], 2: [-90, 0], 3: [0, -90], 4: [0, 90], 5: [90, 0], 6: [0, 180] };
const cube = () => `<div class="cube" data-rx="0" data-ry="0">${[1, 2, 3, 4, 5, 6].map((n) =>
  `<div class="f f${n}">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => `<i class="${PIPS[n].includes(k) ? 'on' : ''}"></i>`).join('')}</div>`).join('')}</div>`;
const sbar = () => '<div class="sbar"><span>21:47</span><i></i></div>';
const bars = (n = 18) => `<span class="vbars">${Array.from({ length: n }, () => `<i style="height:${25 + rand(75)}%"></i>`).join('')}</span>`;
const wheel = (open = '') => `<div class="wheel ${open}">${['😂', '🔥', '😭', '👏', '😈', '🫡', '😱', '🥳'].map((e, i) => {
  const a = (i / 8) * Math.PI * 2 - Math.PI / 2; return `<span data-e="${e}" style="transform:translate(${Math.cos(a) * 70}px,${Math.sin(a) * 70}px)">${e}</span>`;
}).join('')}<em>Slide to an emoji,<br>let go to send</em></div>`;
const rec = '<div class="rec"><i></i>Recording… let go to send</div>';

/* ================= Concept A · Sticker Table ================= */
const A = {
  home: () => `${sbar()}<div class="body">
    <div class="a-top"><div class="a-logo" aria-label="Ludo"><span>L</span><span>U</span><span>D</span><span>O</span></div><button class="a-me" aria-label="Your profile">😎</button></div>
    <p class="a-hello">Hey Kunju! Ready for revenge?</p>
    <div class="a-card a-rival">
      <div class="row">
        <div class="a-face" style="--c:var(--red)"><span class="av">😎</span>You</div>
        <div class="a-score"><span>14</span><i>–</i><span>17</span></div>
        <div class="a-face" style="--c:var(--yellow)">${ic('crown', 'crown')}<span class="av">🥰</span>Ammu</div>
      </div>
      <p>Ammu won the last 2 games</p>
    </div>
    <button class="a-btn cta big">${ic('dice')}New game</button>
    <div class="a-join"><input aria-label="Room code" placeholder="Got a code?" maxlength="6"><button class="a-btn">Join</button></div>
    <button class="a-link">Practice against a bot</button></div>`,
  room: () => `${sbar()}<div class="body">
    <div class="a-bar"><button class="a-ic" aria-label="Back">${ic('back')}</button><span class="a-title">Your room</span></div>
    <div class="a-card a-code"><p>Send this code to your friends</p><div class="row-code"><div class="code">KX7P2Q</div><button class="a-ic" aria-label="Share invite link">${ic('share')}</button></div></div>
    <div class="a-seats">
      <div class="a-seat" style="--c:var(--red)"><span class="av">😎</span>You<span class="st">Host</span></div>
      <div class="a-seat" style="--c:var(--yellow)"><span class="av">🥰</span>Ammu<span class="st">${ic('check')}Joined</span></div>
      <div class="a-seat empty"><span class="av"></span>Waiting for a friend…</div>
      <button class="a-seat empty add" data-addbot="a" style="--c:var(--blue)"><span class="av">${ic('plus')}</span>Add a bot</button>
    </div>
    <div class="a-toggle"><span class="sw"></span><span>Teams, 2 v 2<br><small>Turns on with 4 players</small></span></div>
    <button class="a-btn cta big" style="margin-top:auto">Start game</button></div>`,
  game: () => `${sbar()}<div class="body" style="gap:12px">
    <div class="a-bar"><button class="a-ic" aria-label="Leave game">${ic('x')}</button><span style="flex:1"></span><div class="a-chip" style="--c:var(--yellow)"><span class="av">🥰</span>Ammu<small>0 home</small></div></div>
    <div style="position:relative">${board('A', '', 'data-board')}<div class="a-bubble" style="right:10px;top:-4px">don't you dare 😤</div></div>
    <div class="a-dock"><button class="diebtn ready" data-roll aria-label="Roll the dice">${cube()}</button><p class="a-status" data-status>Your turn! Tap the dice<small>1 piece home · 2 out</small></p></div>
    <div class="a-tools"><button class="a-say">${ic('chat')}Message…<span class="badge">2</span></button><button class="a-ic" data-wheel-btn aria-label="React">${ic('smile')}</button><button class="a-ic" data-mic aria-label="Hold to talk">${ic('mic')}</button></div>
    </div>${wheel()}${rec}`,
  chat: () => `${sbar()}<div class="body" style="gap:12px">
    <div class="a-bar"><button class="a-ic" aria-label="Leave game">${ic('x')}</button><span style="flex:1"></span><div class="a-chip" style="--c:var(--yellow)"><span class="av">🥰</span>Ammu<small>typing…</small></div></div>
    ${board('A')}</div>
    <div class="a-sheet"><div class="grab"></div><header><b>Chat with Ammu</b><button class="a-ic" aria-label="Close chat" style="width:36px;height:36px;box-shadow:none">${ic('x')}</button></header>
      <div class="a-msgs" data-msgs="a">
        <div class="a-m them">don't you dare 😤</div>
        <div class="a-m me">too late 😈</div>
        <div class="a-m them voice"><button aria-label="Play voice note">${ic('play')}</button>${bars()}<small>0:04</small></div>
        <div class="a-m me sticker"><span>Get bonked!</span></div>
      </div>
      <div class="a-quick">${['😂', '🔥', '😭', '👏', 'GG', 'nooo', 'lucky!'].map((q) => `<button data-quick>${q}</button>`).join('')}</div>
      <form class="a-compose" data-chat><input aria-label="Message" placeholder="Message Ammu…"><button class="a-ic send" aria-label="Send">${ic('send')}</button><button type="button" class="a-ic" data-mic aria-label="Hold to talk">${ic('mic')}</button></form>
    </div>${rec}`,
  win: () => `${sbar()}<div class="body" style="gap:12px">
    <div class="a-bar"><button class="a-ic" aria-label="Leave game">${ic('x')}</button></div>${board('A', 'dance')}</div>
    <div class="a-dim"></div>
    <div class="a-card a-win">
      <div class="a-dancers dance">${['red', 'green', 'yellow', 'blue'].map((c, k) => `<i class="tk" style="--c:var(--${c});--k:${k};left:${24 + k * 17}%"></i>`).join('')}</div>
      ${ic('trophy', 'trophy')}
      <h3>You win!</h3>
      <div class="vs">You <b>15 – 17</b> Ammu, all time</div>
      <div class="a-stats"><div><b>3</b><small>Bonks</small></div><div><b>5</b><small>Sixes</small></div><div><b>38</b><small>Turns</small></div></div>
      <div class="row"><button class="a-btn cta" data-confetti>Rematch</button><button class="a-btn">Home</button></div>
    </div>`,
};

/* ================= Concept B · Game in a Chat ================= */
const B = {
  home: () => `${sbar()}<div class="b-head"><div class="grow"><b style="font-size:20px">Ludo Party</b></div><button class="b-ibtn solid" aria-label="Your profile"><span style="font-size:20px">😎</span></button></div>
    <h3 class="b-h1">Who's playing tonight?</h3>
    <div class="b-list">
      <div class="b-row"><span class="av" style="--c:var(--yellow)">🥰</span><div class="t"><b>Ammu</b><small><em>You 14 – 17</em> · she won yesterday</small></div><button class="b-play">Play</button></div>
      <div class="b-row"><span class="stack"><span class="av" style="--c:var(--red)">😎</span><span class="av" style="--c:var(--yellow)">🥰</span><span class="av" style="--c:var(--green)">🤓</span></span><div class="t"><b>Friends night</b><small>4 players · last played Sunday</small></div><button class="b-play">Play</button></div>
      <div class="b-row"><span class="av" style="--c:var(--raise)">${ic('bot')}</span><div class="t"><b>Practice</b><small>Play a bot, no pressure</small></div><button class="b-play ghost">Play</button></div>
    </div>
    <div class="b-join"><input aria-label="Room code" placeholder="Got a code? Type it here" maxlength="6"><button class="b-play">Join</button></div>`,
  room: () => `${sbar()}<div class="b-head"><button class="b-ibtn" aria-label="Back">${ic('back')}</button><span class="av" style="--c:var(--yellow)">🥰</span><div class="grow"><b>Ammu</b><small>In your room</small></div><button class="b-ibtn" aria-label="Share invite">${ic('share')}</button></div>
    <div class="b-thread">
      <div class="b-ev">Yesterday · <b>Ammu</b> won by one piece</div>
      <div class="b-m them">rematch tonight? 😏</div>
      <div class="b-invite">
        <div class="top"><div class="mini">${board('B')}</div><div><small>Room code</small><div class="code">KX7P2Q</div></div></div>
        <div class="b-seats"><span class="b-seat" style="--c:var(--red)"><span class="av">😎</span>You</span><span class="b-seat" style="--c:var(--yellow)"><span class="av">🥰</span>Ammu</span><span class="b-seat empty">Open seat</span><span class="b-seat empty">Open seat</span></div>
      </div>
      <div class="b-ev"><span class="dot" style="--c:var(--yellow)"></span><b>Ammu</b> joined</div>
      <div class="b-m them">ready when you are</div>
    </div>
    <div class="b-cta"><button class="main">${ic('dice')}Start game</button><button class="sub">${ic('bot')}Fill open seats with bots</button></div>`,
  game: () => `${sbar()}<div class="b-head"><button class="b-ibtn" aria-label="Back">${ic('back')}</button><span class="av" style="--c:var(--yellow)">🥰</span><div class="grow"><b>Ammu</b><small>You 14 – 17 all time</small></div><button class="b-ibtn" aria-label="Sound">${ic('volume')}</button></div>
    <div class="b-boardcard">${board('B', '', 'data-board')}<span class="b-turn" data-status>Your turn · tap the dice</span></div>
    <div class="b-thread" data-msgs="b">
      <div class="b-ev"><span class="dot" style="--c:var(--yellow)"></span><b>Ammu</b> rolled a 6 and brought a piece out</div>
      <div class="b-m them">coming for you 🫣</div>
      <div class="b-ev"><span class="dot" style="--c:var(--red)"></span><b>You</b> rolled a 2</div>
    </div>
    <form class="b-compose" data-chat><button type="button" class="diebtn ready" data-roll aria-label="Roll the dice">${cube()}</button><div class="field"><input aria-label="Message" placeholder="Message"><button type="button" class="b-ibtn" aria-label="Stickers">${ic('smile')}</button></div><button type="button" class="b-ibtn solid" data-mic aria-label="Hold to talk">${ic('mic')}</button></form>${rec}`,
  chat: () => `${sbar()}<div class="b-head"><button class="b-ibtn" aria-label="Back">${ic('back')}</button><span class="av" style="--c:var(--yellow)">🥰</span><div class="grow"><b>Ammu</b><small>typing…</small></div><button class="b-ibtn" aria-label="Sound">${ic('volume')}</button></div>
    <div class="b-mini">${board('B')}<div><b>Ammu's turn</b><small>She needs a 4 to bonk you</small></div></div>
    <div class="b-thread" data-msgs="b">
      <div class="b-ev"><span class="dot" style="--c:var(--red)"></span><b>You</b> bonked Ammu's piece 💥</div>
      <div class="b-m them sticker">😭</div>
      <div class="b-m them voice"><button aria-label="Play voice note">${ic('play')}</button>${bars()}<small>0:06</small></div>
      <div class="b-m me">you shouldn't have parked there</div>
    </div>
    <form class="b-compose" data-chat><div class="field"><input aria-label="Message" value="watch this"><button type="button" class="b-ibtn" aria-label="Stickers">${ic('smile')}</button></div><button class="b-ibtn send" aria-label="Send">${ic('send')}</button></form>
    <div class="b-tray"><div class="tabs"><span class="on">Stickers</span><span>Quick lines</span></div>
      <div class="grid">${['😂', '🔥', '😭', '😈', '🫡', '🥳', '💀', '👀'].map((e) => `<button data-sticker aria-label="Send ${e}">${e}</button>`).join('')}</div>
      <div class="phr">${['GG', 'nooo', 'lucky roll', 'revenge soon', 'one more?'].map((q) => `<button data-quick>${q}</button>`).join('')}</div></div>`,
  win: () => `${sbar()}<div class="b-head"><button class="b-ibtn" aria-label="Back">${ic('back')}</button><span class="av" style="--c:var(--yellow)">🥰</span><div class="grow"><b>Ammu</b><small>Game over</small></div></div>
    <div class="b-thread" data-msgs="b">
      <div class="b-ev"><span class="dot" style="--c:var(--red)"></span><b>You</b> brought your last piece home</div>
      <div class="b-result">
        <div class="hero" data-confetti-zone>${ic('trophy')}<b>You won!</b><small>38 turns · 14 minutes</small></div>
        <div class="body">
          <div class="chips"><span>3 bonks</span><span>5 sixes</span><span>1 near miss</span></div>
          <div class="score">You <b>15 – 17</b> Ammu</div>
          <div class="row"><button class="go" data-confetti>Rematch</button><button>Done</button></div>
        </div>
      </div>
      <div class="b-m them">REMATCH. NOW. 😤</div>
    </div>`,
};

/* ================= Concept C · Night HUD ================= */
const C = {
  home: () => `${sbar()}<div class="c-pad">
    <div class="c-top"><button class="c-ibtn" aria-label="Your profile" style="font-size:22px">😎</button><button class="c-ibtn" aria-label="Sound">${ic('volume')}</button></div>
    <div class="c-board-hero"><span class="c-label">You vs Ammu, all time</span>
      <div class="c-sb"><div class="p"><span class="av" style="--c:var(--red)">😎</span>You</div><div style="display:flex;align-items:center"><span class="n">14</span><span class="colon">:</span><span class="n lead">17</span></div><div class="p"><span class="av" style="--c:var(--yellow)">🥰</span>Ammu</div></div>
      <span class="c-streak">Ammu won the last <b>2</b>. Time to fix that.</span></div>
    <button class="c-btn acc">${ic('dice')}<span class="grow">New game<small>Make a room and send the code</small></span></button>
    <button class="c-btn">${ic('key')}<span class="grow">Join a game<small>Type your friend's code</small></span></button>
    <button class="c-btn">${ic('bot')}<span class="grow">Practice<small>Play a bot, no pressure</small></span></button></div>`,
  room: () => `${sbar()}<div class="c-pad">
    <div class="c-top"><button class="c-ibtn" aria-label="Back">${ic('back')}</button><span class="c-h" style="font-size:20px">Room</span><span style="width:44px"></span></div>
    <p class="c-sub">Each seat sits where its pieces start on the board.</p>
    <div class="c-room">
      <button class="c-tile empty add" data-addbot="c" style="--c:var(--green)"><span class="av">${ic('plus')}</span><span><b>Add a bot</b><small>or wait for a friend</small></span></button>
      <div class="c-tile" style="--c:var(--yellow)"><span class="av">🥰</span><span><b>Ammu</b><small>${ic('check')}Ready</small></span></div>
      <div class="c-tile" style="--c:var(--red)"><span class="av">😎</span><span><b>You</b><small>Host</small></span></div>
      <div class="c-tile empty" style="--c:var(--blue)"><span class="av">${ic('user')}</span><span><b>Open seat</b><small>Waiting…</small></span></div>
      <span class="core"></span>
    </div>
    <div class="c-switch"><span class="sw"></span><span>Teams, 2 v 2<small>Partners sit across from each other</small></span></div>
    <div class="c-codebar"><b><small>Room code</small>KX7P2Q</b><button class="c-ibtn" aria-label="Share invite">${ic('share')}</button></div>
    <button class="c-btn acc" style="justify-content:center;margin-top:auto">Start game</button></div>`,
  game: () => `${sbar()}<div class="c-hud"><button class="c-ibtn" aria-label="Leave game">${ic('x')}</button>
      <div class="c-queue"><span class="c-q now" style="--c:var(--red)"><span class="av">😎</span><span>You<small>your turn</small></span></span><span class="c-q" style="--c:var(--yellow)">🥰</span></div>
      <button class="c-ibtn" aria-label="Chat">${ic('chat')}<span class="badge">2</span></button></div>
    <div style="position:relative" data-hold>${board('C', 'full', 'data-board')}<div class="c-float" style="--c:var(--yellow);right:10px;top:10px"><span class="av">🥰</span>don't you dare 😤</div></div>
    <p class="c-status" data-status>Roll to move</p>
    <div class="c-dock"><button class="c-ibtn" aria-label="Chat">${ic('chat')}</button><button class="diebtn ready" data-roll aria-label="Roll the dice">${cube()}</button><button class="c-ibtn" data-mic aria-label="Hold to talk">${ic('mic')}</button></div>
    <p class="c-hint">Hold the board to react</p>${wheel()}${rec}`,
  react: () => `${sbar()}<div class="c-hud"><button class="c-ibtn" aria-label="Leave game">${ic('x')}</button>
      <div class="c-queue"><span class="c-q" style="--c:var(--red)">😎</span><span class="c-q now" style="--c:var(--yellow)"><span class="av">🥰</span><span>Ammu<small>rolling…</small></span></span></div>
      <button class="c-ibtn" aria-label="Chat">${ic('chat')}</button></div>
    <div style="position:relative" data-hold>${board('C', 'full')}
      <div class="c-float" style="--c:var(--red);left:10px;bottom:12px"><span class="av">😎</span>bonk incoming</div>
      <div class="c-float" style="--c:var(--yellow);right:10px;top:10px"><span class="av">🥰</span>🙏 please no</div></div>
    <p class="c-status">Ammu is rolling…</p>
    <div class="c-dock"><button class="c-ibtn" aria-label="Chat">${ic('chat')}</button><button class="diebtn" disabled aria-label="Dice, not your turn" style="opacity:.45">${cube()}</button><button class="c-ibtn" data-mic aria-label="Hold to talk">${ic('mic')}</button></div>
    <p class="c-hint">Hold the board to react</p>
    <span class="c-touch" style="left:150px;top:230px"></span>
    <div class="wheel open" data-static style="left:150px;top:230px">${wheel().replace(/^<div class="wheel ">|<\/div>$/g, '').replace('data-e="😈"', 'class="hot" data-e="😈"')}</div>${rec}`,
  win: () => `${sbar()}<div class="c-pad">
    <div class="c-top"><button class="c-ibtn" aria-label="Close">${ic('x')}</button><button class="c-ibtn" aria-label="Share result">${ic('share')}</button></div>
    <div class="c-result"><h3 class="c-h">You win!</h3><p>+1 for you. All time it's now <b>15 : 17</b>.</p></div>
    <div class="c-podium" data-confetti-zone>
      <div class="c-pod second" style="--c:var(--yellow)"><span class="av">🥰</span><b>Ammu</b><span class="block">2</span></div>
      <div class="c-pod first" style="--c:var(--red)"><span class="av">${ic('crown')}😎</span><b>You</b><span class="block">1</span></div>
    </div>
    <div class="c-mini-stats"><div><b>3</b><small>Bonks</small></div><div><b>5</b><small>Sixes</small></div><div><b>14m</b><small>Game time</small></div></div>
    <button class="c-btn acc" data-confetti style="justify-content:center;margin-top:auto">Run it back</button>
    <button class="c-btn" style="justify-content:center">Home</button></div>`,
};

/* ================= page data ================= */
const CONCEPTS = [
  {
    id: 'A', cls: 'cA', name: 'Sticker Table', tag: "Today's look, grown up",
    intro: 'Keeps everything you like about the current game: thick outlines, chunky shadows, the bubbly logo. What changes is the thinking. <b>The board turns so your pieces always start bottom-left, right under your thumb.</b> Each player sits at their own corner, like round a real table, and their chat pops out of their seat.',
    pals: [['sunset', 'Sunset (today)'], ['lagoon', 'Lagoon'], ['lemonade', 'Lemonade'], ['bubblegum', 'Bubblegum']],
    shots: [
      ['home', 'Home', 'The rivalry score is the first thing you see, because that\'s the reason to play. One big button starts a game; joining is a code box right below it.'],
      ['room', 'Room', 'One code to share. Seats fill as friends join, and an empty seat can become a bot in one tap. Teams only switch on when 4 people are in.'],
      ['game', 'Your turn', 'Dice, status and your tools sit in the bottom half where your thumb is. Ammu\'s chip sits at her corner, and her message pops out of it. Tap the dice to play.'],
      ['chat', 'Chatting', 'Chat slides up over the lower half, so the board stays in view. Voice notes, stickers and quick replies are all in one place.'],
      ['win', 'Win', 'A big moment, then straight back in: Rematch is the main button and the all-time score updates right there.'],
    ],
  },
  {
    id: 'B', cls: 'cB', name: 'Game in a Chat', tag: 'Messenger-style',
    intro: 'The game lives inside your conversation with Ammu. <b>The board is pinned at the top, and every roll, bonk and message flows down one thread</b>, so the banter and the game are the same thing. The dice sits in the message bar where your thumb already is. Soft, borderless and calm, like the chat apps you use every day.',
    pals: [['berry', 'Berry'], ['peach', 'Peach'], ['mint', 'Mint'], ['night', 'Night']],
    shots: [
      ['home', 'Home', 'Start from a person, not a menu. Ammu is right there with your score and a Play button. A group row covers friends nights.'],
      ['room', 'Room', 'The invite is a card in your conversation. When Ammu joins it shows up as a line in the thread, like a message.'],
      ['game', 'Your turn', 'Board on top, story below. The dice is the first button in the message bar and pulses when it\'s your turn. Tap it.'],
      ['chat', 'Chatting', 'While typing, the board shrinks to a mini-map that still says whose turn it is. Stickers and quick lines replace the keyboard.'],
      ['win', 'Win', 'The result lands in the thread as a card with stats and a Rematch button. The conversation just keeps going.'],
    ],
  },
  {
    id: 'C', cls: 'cC', name: 'Night HUD', tag: 'Dark, full-screen board',
    intro: 'Made for late-night games in bed. <b>The board runs edge to edge, and the controls sit in a thumb dock at the bottom</b>: chat, a big dice, and hold-to-talk. Reactions are a long press anywhere on the board. A turn queue across the top shows who\'s up next, which matters once 3 or 4 people play.',
    pals: [['midnight', 'Midnight'], ['deepsea', 'Deep sea'], ['plum', 'Plum'], ['forest', 'Forest']],
    shots: [
      ['home', 'Home', 'A scoreboard you can read across the room. Three clear choices underneath, each with a short line about what it does.'],
      ['room', 'Room', 'Seats are laid out exactly like the board corners, so you know where your pieces will be before the game starts.'],
      ['game', 'Your turn', 'Nothing frames the board, so it\'s as big as the phone allows. The dice is the largest thing on screen when it\'s your turn.'],
      ['react', 'Reacting', 'Press and hold anywhere on the board, slide to an emoji and let go. Messages float over the board corners and fade away. Try it.'],
      ['win', 'Win', 'A podium for the winner, the new all-time score, and "Run it back" for an instant rematch.'],
    ],
  },
];
const SCREENS = { A, B, C };

$('#concepts').innerHTML = CONCEPTS.map((c, n) => `
  <section class="concept wrap" id="concept-${c.id}">
    <div class="c-head">
      <div><h2>${n + 1}. ${c.name}<small>${c.tag}</small></h2><p>${c.intro}</p></div>
      <div class="c-ctl">
        <div class="pals" role="group" aria-label="${c.name} colours">${c.pals.map(([p, label], i) => `<button class="pal" type="button" data-pal="${p}" aria-pressed="${i === 0}"><span class="sw ${c.cls} p-${p}" style="background:var(--sw)"></span>${label}</button>`).join('')}</div>
        <button class="choose" type="button" data-choose="${c.id}" aria-pressed="false">Choose this one</button>
      </div>
    </div>
    <div class="screens ${c.cls} p-${c.pals[0][0]}" data-screens="${c.id}">
      ${c.shots.map(([key, title, note]) => `<figure class="shot"><div class="phone"><div class="scr">${SCREENS[c.id][key]()}</div></div><figcaption><b>${title}</b><span>${note}</span></figcaption></figure>`).join('')}
    </div>
  </section>`).join('');

/* ================= interactions ================= */
// palettes
$$('.concept').forEach((sec) => {
  const screens = $('[data-screens]', sec);
  $$('.pal', sec).forEach((b) => b.addEventListener('click', () => {
    $$('.pal', sec).forEach((x) => x.setAttribute('aria-pressed', x === b));
    screens.className = screens.className.replace(/\bp-\S+/, `p-${b.dataset.pal}`);
    updateTray();
  }));
});

// rolling the dice moves your piece with hops
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-roll]');
  if (!btn || btn.dataset.busy) return;
  btn.dataset.busy = 1; btn.classList.remove('ready');
  const scr = btn.closest('.scr'), c = $('.cube', btn), status = $('[data-status]', scr);
  const v = 1 + rand(6), mod = (a) => ((a % 360) + 360) % 360;
  const nx = +c.dataset.rx + mod(FACE_ROT[v][0] - c.dataset.rx) + 720, ny = +c.dataset.ry + mod(FACE_ROT[v][1] - c.dataset.ry) + 720;
  c.dataset.rx = nx; c.dataset.ry = ny; c.style.transform = `rotateX(${nx}deg) rotateY(${ny}deg)`;
  sfx.roll();
  if (status) status.textContent = 'Rolling…';
  await sleep(900);
  if (status) status.textContent = v === 6 ? `A 6! Moving, then roll again` : `You rolled ${v}. Moving…`;
  const tk = $('[data-me]', scr);
  let pos = +tk.dataset.pos;
  for (let i = 0; i < v; i++) {
    pos = pos >= 50 ? 0 : pos + 1;
    const [x, y] = point('red', pos);
    tk.style.left = `${x}%`; tk.style.top = `${y}%`;
    tk.classList.remove('hop'); void tk.offsetWidth; tk.classList.add('hop'); sfx.hop();
    await sleep(170);
  }
  tk.dataset.pos = pos;
  const msgs = $('[data-msgs="b"]', scr);
  if (msgs) addEvent(msgs, `<span class="dot" style="--c:var(--red)"></span><b>You</b> rolled a ${v}`);
  await sleep(500);
  if (status) status.textContent = scr.closest('.cA') ? 'Ammu is rolling… 🤔' : scr.closest('.cB') ? "Ammu's turn" : 'Ammu is rolling…';
  await sleep(1400);
  if (status) status.textContent = scr.closest('.cA') ? 'Your turn! Tap the dice' : scr.closest('.cB') ? 'Your turn · tap the dice' : 'Roll to move';
  btn.classList.add('ready'); delete btn.dataset.busy;
});

// emote wheel: tap the smile button (A), or press and hold the board (C)
function floatEmoji(scr, emoji, x = 50 + rand(60) - 30) {
  const f = document.createElement('div'); f.className = 'floaty'; f.textContent = emoji;
  f.style.left = `${x}%`; f.style.top = '62%'; scr.append(f); setTimeout(() => f.remove(), 1700); sfx.pop();
}
document.addEventListener('click', (e) => {
  const wb = e.target.closest('[data-wheel-btn]');
  if (wb) { const w = $('.wheel', wb.closest('.scr')); w.style.left = '50%'; w.style.top = '58%'; w.classList.toggle('open'); return; }
  const s = e.target.closest('.wheel span');
  if (s) { const scr = s.closest('.scr'); floatEmoji(scr, s.dataset.e); const w = s.closest('.wheel'); if (!w.dataset.static) w.classList.remove('open'); }
});
$$('[data-hold]').forEach((zone) => {
  const scr = zone.closest('.scr'), w = $('.wheel:not([data-static])', scr) || $('.wheel', scr);
  let t = null, held = false, hot = null;
  zone.addEventListener('pointerdown', (e) => {
    if (w.dataset.static) return;
    const r = scr.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    held = false;
    t = setTimeout(() => { held = true; w.style.left = `${Math.min(Math.max(x, 100), r.width - 100)}px`; w.style.top = `${Math.max(y, 110)}px`; w.classList.add('open'); }, 280);
    zone.setPointerCapture(e.pointerId);
  });
  zone.addEventListener('pointermove', (e) => {
    if (!held) return;
    const el = document.elementsFromPoint(e.clientX, e.clientY).find((n) => n.dataset && n.dataset.e);
    $$('span', w).forEach((s) => s.classList.toggle('hot', s === el)); hot = el;
  });
  const end = () => { clearTimeout(t); if (held) { if (hot) floatEmoji(scr, hot.dataset.e); w.classList.remove('open'); $$('span', w).forEach((s) => s.classList.remove('hot')); } held = false; hot = null; };
  zone.addEventListener('pointerup', end); zone.addEventListener('pointercancel', end);
});

// chat: send, quick replies, stickers, auto replies from Ammu
const REPLIES = ['haha no 😂', 'just you wait…', 'rude 😤', '🫡', 'why are you like this', 'my yellow is coming for you', 'one more game after this?'];
const esc = (s) => s.replace(/[<&>]/g, (ch) => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;' }[ch]));
function addMsg(box, html, who, extra = '') {
  const k = box.dataset.msgs;
  box.insertAdjacentHTML('beforeend', `<div class="${k}-m ${who} ${extra} msg-in">${html}</div>`);
  box.scrollTop = box.scrollHeight;
}
function addEvent(box, html) { box.insertAdjacentHTML('beforeend', `<div class="b-ev msg-in">${html}</div>`); box.scrollTop = box.scrollHeight; }
async function reply(box) {
  await sleep(500);
  const k = box.dataset.msgs;
  box.insertAdjacentHTML('beforeend', `<div class="${k}-m them typing" data-typing><i></i><i></i><i></i></div>`); box.scrollTop = box.scrollHeight;
  await sleep(900 + rand(600));
  $('[data-typing]', box)?.remove(); addMsg(box, pick(REPLIES), 'them'); sfx.pop();
}
document.addEventListener('submit', (e) => {
  const f = e.target.closest('[data-chat]'); if (!f) return;
  e.preventDefault();
  const input = $('input', f), box = $('[data-msgs]', f.closest('.scr'));
  if (!input.value.trim() || !box) return;
  addMsg(box, esc(input.value), 'me'); input.value = ''; sfx.pop(); reply(box);
});
document.addEventListener('click', (e) => {
  const q = e.target.closest('[data-quick], [data-sticker]'); if (!q) return;
  const box = $('[data-msgs]', q.closest('.scr')); if (!box) return;
  if (q.dataset.sticker !== undefined) addMsg(box, q.textContent, 'me', box.dataset.msgs === 'b' ? 'sticker' : '');
  else addMsg(box, esc(q.textContent), 'me');
  sfx.pop(); reply(box);
});

// hold to talk (UI only, no microphone)
$$('[data-mic]').forEach((b) => {
  const scr = b.closest('.scr'), r = $('.rec', scr);
  let t0 = 0;
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); t0 = performance.now(); r?.classList.add('on'); sfx.pop(); });
  const stop = () => {
    if (!t0) return;
    const secs = Math.min(9, Math.max(1, Math.round((performance.now() - t0) / 1000))); t0 = 0;
    r?.classList.remove('on');
    const box = $('[data-msgs]', scr);
    if (box) addMsg(box, `<button aria-label="Play voice note">${ic('play')}</button>${bars()}<small>0:0${secs}</small>`, 'me', 'voice');
    else floatEmoji(scr, '🎙️');
  };
  b.addEventListener('pointerup', stop); b.addEventListener('pointerleave', stop);
});

// add a bot to an empty seat
document.addEventListener('click', (e) => {
  const s = e.target.closest('[data-addbot]'); if (!s) return;
  if (s.dataset.addbot === 'a') { s.className = 'a-seat'; s.innerHTML = `<span class="av">${ic('bot')}</span>Bot Bonky<span class="st">${ic('check')}Ready</span>`; }
  else { s.className = 'c-tile'; s.innerHTML = `<span class="av">${ic('bot')}</span><span><b>Bot Bonky</b><small>${ic('check')}Ready</small></span>`; }
  s.removeAttribute('data-addbot'); sfx.pop();
});

// rematch confetti
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-confetti]'); if (!b) return;
  const scr = b.closest('.scr'), r = scr.getBoundingClientRect(), br = b.getBoundingClientRect();
  const x = br.left - r.left + br.width / 2, y = br.top - r.top;
  const cols = ['#ff5a5f', '#2bc48a', '#ffc233', '#4d9de0', '#a77bff'];
  for (let i = 0; i < 50; i++) {
    const c = document.createElement('i'); c.className = 'confetti';
    c.style.cssText = `left:${x}px;top:${y}px;background:${pick(cols)};--dx:${(Math.random() - 0.5) * 300}px;--dy:${-80 - Math.random() * 300}px;--rot:${rand(720)}deg`;
    scr.append(c); setTimeout(() => c.remove(), 1500);
  }
  sfx.win();
});

// choose a concept → tray with concept + palette
let chosen = null;
try { chosen = localStorage.getItem('ludo-concept'); } catch { /* storage blocked */ }
function updateTray() {
  $$('[data-choose]').forEach((b) => { const on = b.dataset.choose === chosen; b.setAttribute('aria-pressed', on); b.textContent = on ? 'Chosen' : 'Choose this one'; });
  const tray = $('#tray');
  if (!chosen) { tray.classList.remove('show'); return; }
  const c = CONCEPTS.find((x) => x.id === chosen), sec = $(`#concept-${chosen}`);
  const pal = $('.pal[aria-pressed="true"]', sec).textContent.trim();
  $('#tray-text').textContent = `Concept ${c.id}: ${c.name} · ${pal} colours`;
  tray.classList.add('show');
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-choose]'); if (!b) return;
  chosen = chosen === b.dataset.choose ? null : b.dataset.choose;
  try { chosen ? localStorage.setItem('ludo-concept', chosen) : localStorage.removeItem('ludo-concept'); } catch { /* storage blocked */ }
  updateTray();
});
$('#tray-copy').addEventListener('click', async () => {
  const text = `My Ludo pick: ${$('#tray-text').textContent}`, btn = $('#tray-copy');
  try { await navigator.clipboard.writeText(text); btn.textContent = 'Copied'; }
  catch { const ta = $('#tray-fallback'); ta.value = text; ta.select(); btn.textContent = 'Selected, press Ctrl+C'; }
  setTimeout(() => (btn.textContent = 'Copy my pick'), 1800);
});
updateTray();
