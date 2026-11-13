// Run with: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../messages/logic.mjs');

const T0 = Date.parse('2026-11-13T10:00:00Z');
let n = 0;
const msg = (o = {}) => ({ id: 'm' + String(++n).padStart(3, '0'), sender: 'ammu', kind: 'text', body: 'hi', meta: {}, created_at: new Date(T0).toISOString(), seen_at: null, vanish: false, ...o });
const at = (min) => new Date(T0 + min * 60000).toISOString();

test('merge keeps time order, drops duplicates and lets the newer copy win', () => {
  const a = msg({ id: 'a', created_at: at(0) }), b = msg({ id: 'b', created_at: at(2) });
  const out = L.merge([b, a], [{ ...a, seen_at: at(3) }, msg({ id: 'c', created_at: at(1) })]);
  assert.deepEqual(out.map((m) => m.id), ['a', 'c', 'b']);
  assert.equal(out[0].seen_at, at(3));
  assert.equal(out[0].body, 'hi'); // fields not in the update are kept
});

test('emoji-only messages up to three are big; anything else is not', () => {
  assert.equal(L.emojiOnly('😂'), 1);
  assert.equal(L.emojiOnly('❤️❤️'), 2);
  assert.equal(L.emojiOnly(' 👍🏽 🇮🇳 😭 '), 3);
  assert.equal(L.emojiOnly('👨‍👩‍👧'), 1); // a family is one emoji
  assert.equal(L.emojiOnly('😂😂😂😂'), 0);
  assert.equal(L.emojiOnly('lol 😂'), 0);
  assert.equal(L.emojiOnly('123'), 0);
  assert.equal(L.emojiOnly(''), 0);
});

test('links become safe anchors and trailing punctuation stays outside', () => {
  assert.equal(L.linkify('see https://example.com/a?b=1.'), 'see <a href="https://example.com/a?b=1" target="_blank" rel="noopener noreferrer">https://example.com/a?b=1</a>.');
  assert.match(L.linkify('www.site.org'), /href="https:\/\/www\.site\.org"/);
  assert.equal(L.linkify('no links here'), 'no links here');
});

test('rows: a divider first and after an hour of quiet; groups by sender and time', () => {
  const ms = [
    msg({ sender: 'ammu', created_at: at(0) }),
    msg({ sender: 'ammu', created_at: at(1) }),
    msg({ sender: 'ammu', created_at: at(2) }),
    msg({ sender: 'panchara kunju', created_at: at(3) }),
    msg({ sender: 'panchara kunju', created_at: at(20) }), // more than 5 min later: new group
    msg({ sender: 'ammu', created_at: at(200) }),          // more than an hour: divider
  ];
  const rows = L.buildRows(ms);
  assert.deepEqual(rows.map((r) => r.type === 'msg' ? r.pos : r.type),
    ['divider', 'first', 'middle', 'last', 'single', 'single', 'divider', 'single']);
});

test('rows: system lines and stickers break groups', () => {
  const rows = L.buildRows([
    msg({ created_at: at(0) }),
    msg({ kind: 'system', meta: { event: 'theme', value: 'ocean' }, created_at: at(1) }),
    msg({ created_at: at(1) }),
    msg({ kind: 'sticker', created_at: at(1) }),
    msg({ created_at: at(2) }),
    msg({ body: '😂', created_at: at(2) }),
  ]);
  assert.deepEqual(rows.map((r) => r.type === 'msg' ? r.pos : r.type), ['divider', 'single', 'system', 'single', 'single', 'single', 'single']);
});

test('"Seen" only under my newest message once it has been seen', () => {
  const mine = msg({ sender: 'me', created_at: at(1), seen_at: at(2) });
  assert.deepEqual(L.seenTarget([msg({ created_at: at(0) }), mine], 'me'), { id: mine.id, at: Date.parse(at(2)) });
  assert.equal(L.seenTarget([mine, msg({ created_at: at(3) })], 'me'), null); // they replied after
  assert.equal(L.seenTarget([msg({ sender: 'me' })], 'me'), null); // not seen yet
  assert.equal(L.seenTarget([mine, msg({ kind: 'system', sender: 'ammu', created_at: at(4) })], 'me').id, mine.id); // system lines don't count
  assert.equal(L.seenTarget([mine, msg({ sender: 'me', pending: true, created_at: at(5) })], 'me'), null);
});

test('edit only my own text within 15 minutes', () => {
  const m = msg({ sender: 'me', created_at: at(0) });
  assert.equal(L.canEdit(m, 'me', T0 + 14 * 60000), true);
  assert.equal(L.canEdit(m, 'me', T0 + 16 * 60000), false);
  assert.equal(L.canEdit(m, 'ammu', T0), false);
  assert.equal(L.canEdit({ ...m, kind: 'gif' }, 'me', T0), false);
});

test('unread and vanish-on-leave', () => {
  const ms = [msg(), msg({ seen_at: at(1) }), msg({ sender: 'me' }), msg({ kind: 'system' })];
  assert.equal(L.unread(ms, 'me'), 1);
  assert.equal(L.vanishesOnLeave(msg({ vanish: true, seen_at: at(1) }), 'me'), true);
  assert.equal(L.vanishesOnLeave(msg({ vanish: true }), 'me'), false); // not seen yet
  assert.equal(L.vanishesOnLeave(msg({ vanish: true, seen_at: at(1), sender: 'me' }), 'me'), false); // mine go when they leave
  assert.equal(L.vanishesOnLeave(msg({ seen_at: at(1) }), 'me'), false);
});

test('active and seen labels', () => {
  assert.equal(L.activeLabel(null, true), 'Active now');
  assert.equal(L.activeLabel(T0 - 30 * 60000, false, T0), 'Active 30m ago');
  assert.equal(L.activeLabel(T0 - 3 * 3600000, false, T0), 'Active 3h ago');
  assert.equal(L.activeLabel(T0 - 30 * 3600000, false, T0), 'Active yesterday');
  assert.equal(L.activeLabel(T0 - 30 * 86400000, false, T0), '');
  assert.equal(L.seenLabel(T0, T0 + 20000), 'Seen');
  assert.equal(L.seenLabel(T0, T0 + 5 * 60000), 'Seen 5m ago');
});

test('divider labels say today, yesterday, a weekday or a date', () => {
  const now = new Date(2026, 10, 13, 15, 0).getTime();
  assert.match(L.dividerLabel(new Date(2026, 10, 13, 9, 5).getTime(), now, 'en-GB'), /^Today 9:05$/);
  assert.match(L.dividerLabel(new Date(2026, 10, 12, 21, 30).getTime(), now, 'en-GB'), /^Yesterday 21:30$/);
  assert.match(L.dividerLabel(new Date(2026, 10, 9, 8, 0).getTime(), now, 'en-GB'), /^Monday 8:00$/);
  assert.match(L.dividerLabel(new Date(2026, 9, 3, 18, 0).getTime(), now, 'en-GB'), /^3 Oct, 18:00$/);
  assert.match(L.dividerLabel(new Date(2025, 9, 3, 18, 0).getTime(), now, 'en-GB'), /^3 Oct 2025, 18:00$/);
});

test('waveform: n bars scaled to the loudest, never flat', () => {
  const w = L.waveform([0, 0.1, 0.5, -1, 0.2, 0.05, 0, 0], 4);
  assert.deepEqual(w, [10, 100, 20, 8]);
  assert.equal(L.waveform([], 40).length, 40);
  assert.equal(L.fmtDuration(65.4), '1:05');
});

test('system lines read naturally', () => {
  const name = (id) => ({ ammu: 'Ammu', 'panchara kunju': 'Panchara' }[id]);
  const sys = (sender, meta) => L.systemText({ sender, meta }, 'ammu', name, (k) => k.toUpperCase());
  assert.equal(sys('ammu', { event: 'theme', value: 'ocean' }), 'You changed the theme to OCEAN');
  assert.equal(sys('panchara kunju', { event: 'vanish', value: true }), 'Panchara turned on vanish mode');
  assert.equal(sys('panchara kunju', { event: 'nick', for: 'ammu', value: 'Bunny' }), 'Panchara set your nickname to Bunny');
  assert.equal(sys('ammu', { event: 'nick', for: 'panchara kunju', value: 'Goof' }), "You set Panchara's nickname to Goof");
  assert.equal(sys('ammu', { event: 'nick', for: 'ammu', value: null }), 'You cleared your nickname');
});

test('export keeps everything except vanish messages and unsent drafts', () => {
  const ms = [
    msg({ id: 'x1', body: 'hello' }),
    msg({ id: 'x2', vanish: true }),
    msg({ id: 'x3', kind: 'voice', meta: { path: 'uid/abc.webm', dur: 4 } }),
    msg({ id: 'x4', pending: true }),
  ];
  const out = L.exportChat({ messages: ms, reactions: [{ message_id: 'x1', player: 'ammu', emoji: '❤️' }], players: [{ id: 'ammu', name: 'Ammu' }], nicknames: { ammu: 'Bunny' } }, T0);
  assert.deepEqual(out.messages.map((m) => m.id), ['x1', 'x3']);
  assert.deepEqual(out.messages[0].reactions, [{ from: 'Ammu', emoji: '❤️' }]);
  assert.equal(out.messages[1].voice_file, 'voice/abc.webm');
  assert.equal(out.people[0].nickname, 'Bunny');
});

test('wallpapers: names, photo detection, and the system line', () => {
  assert.equal(L.wallKind('photo:abc/wall-1.webp'), 'photo');
  assert.equal(L.wallKind('hearts'), 'hearts');
  assert.equal(L.wallKind('nonsense'), 'dots');
  assert.equal(L.wallKind(null), 'dots');
  const name = (id) => (id === 'ammu' ? 'Ammu' : 'Kunju');
  assert.equal(L.systemText({ sender: 'ammu', meta: { event: 'wall', value: 'stars' } }, 'ammu', name), 'You changed the wallpaper to Starry night');
  assert.equal(L.systemText({ sender: 'panchara kunju', meta: { event: 'wall', value: 'photo' } }, 'ammu', name), 'Kunju set a photo as the wallpaper');
});

/* ---------- colours picked from a photo wallpaper ---------- */
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hueOf = (h) => { const [r, g, b] = hexRgb(h).map((v) => v / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (!d) return 0; const x = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return (x * 60 + 360) % 360; };
// 64×64 RGBA pixels, split evenly between the given colours.
const px = (...hexes) => { const out = new Uint8ClampedArray(64 * 64 * 4); for (let i = 0; i < 64 * 64; i++) { const [r, g, b] = hexRgb(hexes[Math.floor(i * hexes.length / 4096)]); out.set([r, g, b, 255], i * 4); } return out; };

test('contrast follows the WCAG formula', () => {
  assert.ok(Math.abs(L.contrast('#000000', '#ffffff') - 21) < 0.01);
  assert.equal(L.contrast('#777777', '#777777'), 1);
});

test('a red-and-blue photo gives red and blue bubble colours', () => {
  const p = L.paletteFromPixels(px('#ff2e6e', '#3459e6'));
  assert.equal(p.mine.length, 3);
  assert.ok(p.mine.some((h) => hueOf(h) >= 330 || hueOf(h) <= 20), 'has a red: ' + p.mine);
  assert.ok(p.mine.some((h) => hueOf(h) >= 210 && hueOf(h) <= 240), 'has a blue: ' + p.mine);
});

test('a plain white or black photo still gives readable bubbles', () => {
  for (const [hex, dark] of [['#ffffff', false], ['#000000', true]]) {
    const p = L.paletteFromPixels(px(hex));
    assert.equal(p.dark, dark, hex);
    assert.ok(L.contrast(p.textMine, p.mine[1]) >= 4.5, `${hex} mine ${p.textMine} on ${p.mine[1]}`);
    assert.ok(L.contrast(p.textTheirs, p.theirs) >= 4.5, `${hex} theirs ${p.textTheirs} on ${p.theirs}`);
  }
});

test('the same photo always gives the same colours', () => {
  const a = px('#ffb36b', '#2bc48a', '#8f6bff');
  assert.deepEqual(L.paletteFromPixels(a), L.paletteFromPixels(a));
});

/* ---------- chat themes: the light ones are back, plus one Instagram-dark choice ---------- */
test('every chat theme keeps their bubbles readable, and Insta Night is one of the choices', async () => {
  const { THEMES } = await import('../messages/themes.js');
  for (const [k, t] of Object.entries(THEMES)) {
    const text = t.dark ? '#f4f0fb' : '#241c33';
    assert.ok(L.contrast(text, t.theirs) >= 4.5, `${k}: their bubbles ${t.theirs}`);
    for (const c of t.mine) assert.ok(L.contrast('#ffffff', c) >= 3.5, `${k}: white on my bubble ${c}`);
  }
  assert.ok(Object.values(THEMES).some((t) => !t.dark), 'there are light themes');
  const insta = THEMES.insta;
  assert.ok(insta && insta.dark && insta.bg === '#000000', 'Insta Night: black');
  assert.deepEqual(insta.mine, ['#a033ff', '#6a4dff', '#2f7bff']);
});

test('photo bubbles stay readable even where the gradient blends two colours', () => {
  const p = L.paletteFromPixels(px('#ff2e6e', '#2bc48a', '#3459e6'));
  for (const c of p.mine) assert.ok(L.contrast('#ffffff', c) >= 5, `white on ${c}`);
});
