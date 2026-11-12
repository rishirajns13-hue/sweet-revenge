'use strict';
/* Sweet Revenge avatars: twelve sticker critters drawn in SVG, each with a few moods.
   Custom looks: an avatar can carry a colour and an accessory after a "~", e.g. "🦊~3a" =
   fox, colour 3, accessory a. Plain "🦊" is the critter's own colours with no accessory.
   Saved avatars are still the old emoji (so saved choices and other players' games keep working);
   this file just draws each one as a character. Load after shared/core.js.
     avatarHTML(key, mood)   → markup sized at 1em (set font-size to size it), mood: happy|cheer|sulk|smug|sweat
     setAvatar(el, key, mood) → draw into an element and remember the key there */
const AVATAR_ART = (() => {
  const INK = '#2b2140';
  const S = `stroke="${INK}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"`;
  const s = (w) => `stroke="${INK}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;
  const HEAD = 'M50 12C77 12 89 30 89 53C89 78 72 91 50 91C28 91 11 78 11 53C11 30 23 12 50 12Z';

  // Each critter: body colour, what's drawn behind the head, on the head, and over the face.
  const C = {
    '😎': { name: 'Cool Scoop', body: '#ffb84d', over: `<path d="M22 44h56l-3 12c-2 6-14 7-17 0l-3-6h-6l-3 6c-3 7-15 6-17 0z" fill="${INK}"/><path d="M28 47h10" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".6"/>`, hideEyes: true },
    '🥰': { name: 'Sweetheart', body: '#ff9ad0', top: `<path d="M50 14c-4-8-15-6-14 2 1 6 14 12 14 12s13-6 14-12c1-8-10-10-14-2z" fill="#ff4d6d" ${s(3.5)}/>` },
    '🤓': { name: 'Brainy', body: '#9ab8ff', over: `<g fill="#ffffff55" ${s(4)}><circle cx="37" cy="51" r="11"/><circle cx="63" cy="51" r="11"/><path d="M48 51h4" fill="none"/></g>` },
    '🤠': { name: 'Rodeo', body: '#ffd56b', top: `<path d="M14 30c10 6 62 6 72 0-4 8-12 10-12 10H26s-8-2-12-10z" fill="#b5703a" ${s(4)}/><path d="M30 31c0-14 6-22 20-22s20 8 20 22" fill="#c98446" ${s(4)}/><path d="M31 27h38" stroke="#ff5a5f" stroke-width="5"/>` },
    '😺': { name: 'Whiskers', body: '#ffcf9e', back: `<path d="M18 36L20 8l22 14zM82 36L80 8 58 22z" fill="#ffcf9e" ${S}/><path d="M23 28l1-12 9 7zM77 28l-1-12-9 7z" fill="#ff9ab0"/>`, over: `<path d="M14 62h14M15 69l13-3M86 62H72M85 69l-13-3" ${s(2.5)}/>` },
    '🐼': { name: 'Bamboo', body: '#ffffff', back: `<circle cx="22" cy="24" r="12" fill="${INK}"/><circle cx="78" cy="24" r="12" fill="${INK}"/>`, under: `<ellipse cx="37" cy="52" rx="10" ry="12" fill="${INK}" transform="rotate(-15 37 52)"/><ellipse cx="63" cy="52" rx="10" ry="12" fill="${INK}" transform="rotate(15 63 52)"/>`, lightEyes: true },
    '🦊': { name: 'Sly Fox', body: '#ff8a4c', back: `<path d="M16 40L14 6l28 18zM84 40l2-34-28 18z" fill="#ff8a4c" ${S}/><path d="M21 30l-1-15 11 8zM79 30l1-15-11 8z" fill="#fff3e6"/>`, under: `<path d="M24 66c8 14 44 14 52 0-6 22-46 22-52 0z" fill="#fff3e6"/>` },
    '👻': { name: 'Boo', body: '#f4f1ff', head: 'M50 10C76 10 88 28 88 52V86l-9-7-8 8-8-8-8 8-8-8-8 8-8-8-9 7V52C12 28 24 10 50 10Z' },
    '🐸': { name: 'Hopper', body: '#79d98f', back: `<circle cx="30" cy="22" r="13" fill="#79d98f" ${S}/><circle cx="70" cy="22" r="13" fill="#79d98f" ${S}/>`, eyesUp: true },
    '🦄': { name: 'Sparkle', body: '#e3d2ff', back: `<path d="M18 40c-8-14 4-26 14-24M82 40c6-12-2-22-10-22" fill="none" stroke="#ff8fc8" stroke-width="8" stroke-linecap="round"/>`, top: `<path d="M44 16L52-6 58 16z" fill="#ffd56b" ${s(4)}/><path d="M47 9l9-3M49 2l7-2" ${s(2.5)}/>` },
    '🐯': { name: 'Stripes', body: '#ffa23f', back: `<circle cx="24" cy="22" r="11" fill="#ffa23f" ${S}/><circle cx="76" cy="22" r="11" fill="#ffa23f" ${S}/>`, under: `<path d="M50 13v12M40 15l4 9M60 15l-4 9M12 50h10M13 60h8M88 50H78M87 60h-8" ${s(4)}/><path d="M28 68c8 12 36 12 44 0" fill="#fff3e6"/>` },
    // Bots (not in the picker)
    '🤖': { name: 'Bot', body: '#c7d3e3', head: 'M22 20H78Q88 20 88 30V80Q88 90 78 90H22Q12 90 12 80V30Q12 20 22 20Z', top: `<path d="M50 20V8" ${s(4)}/><circle cx="50" cy="6" r="5" fill="#ff5a5f" ${s(3)}/>`, back: `<rect x="2" y="44" width="12" height="20" rx="4" fill="#9fb0c6" ${s(4)}/><rect x="86" y="44" width="12" height="20" rx="4" fill="#9fb0c6" ${s(4)}/>` },
    '🐙': { name: 'Inky', body: '#c08bff', head: 'M50 10C76 10 88 26 88 48C88 62 82 70 80 74c6 4 8 12 2 14-5 2-8-6-12-6-1 6-6 10-10 6-3-3 0-8-4-8s-1 8-6 10-6-6-8-8c-3 0-4 8-10 6-4-2-1-8-5-8-4 2-10 8-13 4-3-5 3-10 7-14-3-5-9-12-9-28C12 26 24 10 50 10Z' },
  };
  const order = Object.keys(C).filter((k) => k !== '🤖');

  // Body colours (0 = the critter's own) and accessories (0 = none) for custom looks.
  const COLOURS = [null, '#ff9ad0', '#ff8a4c', '#ffd56b', '#79d98f', '#7ee8d8', '#9ab8ff', '#c08bff', '#f4f1ff', '#c7a17a', '#ff5a5f', '#5b5f7a'];
  const ACCESSORIES = [
    ['None', ''],
    ['Party hat', `<path d="M38 18L50-6l12 24z" fill="#ff71ce" ${s(3.5)}/><path d="M43 8l12 4M41 14l16 3" stroke="#fff" stroke-width="3"/><circle cx="50" cy="-7" r="5" fill="#ffd56b" ${s(3)}/>`],
    ['Crown', `<path d="M33 19l2-17 9 9 6-13 6 13 9-9 2 17z" fill="#ffc233" ${s(3.5)}/><circle cx="50" cy="12" r="3" fill="#ff5a5f"/>`],
    ['Bow', `<g transform="translate(74 18) rotate(18)"><path d="M0 0l-14-9v18zM0 0l14-9v18z" fill="#ff5a5f" ${s(3)}/><circle r="4.5" fill="#ff8a9a" ${s(3)}/></g>`],
    ['Headphones', `<path d="M15 54C13 12 87 12 85 54" fill="none" stroke="#2b2140" stroke-width="6"/><rect x="5" y="44" width="13" height="22" rx="6" fill="#4d9de0" ${s(3)}/><rect x="82" y="44" width="13" height="22" rx="6" fill="#4d9de0" ${s(3)}/>`],
    ['Flower', `<g transform="translate(76 20)">${[0, 72, 144, 216, 288].map((a) => `<circle cx="${Math.cos((a * Math.PI) / 180) * 7}" cy="${Math.sin((a * Math.PI) / 180) * 7}" r="6" fill="#fff" ${s(2.5)}/>`).join('')}<circle r="5" fill="#ffc233" ${s(2.5)}/></g>`],
    ['Heart shades', `<g fill="#ff4d6d" ${s(3)}><path d="M37 60c-9-6-12-10-12-14 0-4 5-6 8-3l4 3 4-3c3-3 8-1 8 3 0 4-3 8-12 14z"/><path d="M63 60c-9-6-12-10-12-14 0-4 5-6 8-3l4 3 4-3c3-3 8-1 8 3 0 4-3 8-12 14z"/></g><path d="M45 50h10" ${s(3)}/>`],
    ['Scarf', `<path d="M20 80q30 14 60 0l2 10q-32 16-64 0z" fill="#ff5a5f" ${s(3.5)}/><path d="M66 88l4 16 10-4-6-14" fill="#ff5a5f" ${s(3)}/>`],
    ['Halo', `<ellipse cx="50" cy="0" rx="20" ry="6" fill="none" stroke="#ffc233" stroke-width="5"/>`],
    ['Devil horns', `<path d="M26 26q-6-16 6-22-2 12 6 18zM74 26q6-16-6-22 2 12-6 18z" fill="#ff5a5f" ${s(3)}/>`],
  ];
  // "🦊~3a" → { base: '🦊', colour: 3, acc: 10 } (both parts are base-36 digits)
  function parse(key) {
    const [base, tail = ''] = String(key || '').split('~');
    return { base: C[base] ? base : '😎', colour: parseInt(tail[0] || '0', 36) || 0, acc: parseInt(tail[1] || '0', 36) || 0 };
  }
  const compose = (base, colour, acc) => (colour || acc ? `${base}~${(colour || 0).toString(36)}${(acc || 0).toString(36)}` : base);

  function eyes(mood, light) {
    const col = light ? '#ffffff' : INK, hl = light ? INK : '#ffffff';
    if (mood === 'cheer') return `<path d="M31 53q6-9 12 0M57 53q6-9 12 0" fill="none" stroke="${col}" stroke-width="4.5" stroke-linecap="round"/>`;
    if (mood === 'smug') return `<g fill="${col}"><path d="M30 52h13a6.5 6.5 0 0 1-13 0z"/><path d="M57 52h13a6.5 6.5 0 0 1-13 0z"/></g><path d="M29 51h15M56 51h15" stroke="${col}" stroke-width="3.5" stroke-linecap="round"/>`;
    const brows = mood === 'sulk' ? `<path d="M29 40l12 5M71 40l-12 5" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>` : '';
    return `${brows}<g class="av-eyes"><ellipse cx="37" cy="52" rx="5.5" ry="7.5" fill="${col}"/><ellipse cx="63" cy="52" rx="5.5" ry="7.5" fill="${col}"/>
      <circle cx="39" cy="49" r="2.2" fill="${hl}"/><circle cx="65" cy="49" r="2.2" fill="${hl}"/></g>`;
  }
  function mouth(mood) {
    if (mood === 'cheer') return `<path d="M39 63h22c0 11-22 11-22 0z" fill="#ff5a6e" ${s(3.5)}/>`;
    if (mood === 'sulk') return `<path d="M42 71q8-7 16 0" fill="none" ${s(4)}/>`;
    if (mood === 'smug') return `<path d="M43 67q9 4 16-4" fill="none" ${s(4)}/>`;
    return `<path d="M41 64q9 9 18 0" fill="none" ${s(4)}/>`;
  }
  const sweat = '<path d="M80 30c-5 7-5 11 0 12 5-1 5-5 0-12z" fill="#7fd3ff" stroke="#2b2140" stroke-width="2.5"/>';

  function svg(key, mood = 'happy') {
    const look = parse(key), base = C[look.base];
    const c = look.colour && COLOURS[look.colour] ? { ...base, body: COLOURS[look.colour] } : base;
    const extra = (ACCESSORIES[look.acc] || ACCESSORIES[0])[1];
    const face = c.hideEyes ? '' : eyes(mood, c.lightEyes);
    const up = c.eyesUp ? ' transform="translate(0 -26)"' : '';
    return `<svg viewBox="0 -8 100 108" aria-hidden="true" focusable="false">
      ${c.back || ''}<path d="${c.head || HEAD}" fill="${c.body}" ${S}/>
      ${c.under || ''}<g${up}>${face}</g>
      <ellipse cx="26" cy="64" rx="6" ry="4" fill="#ff7aa8" opacity=".45"/><ellipse cx="74" cy="64" rx="6" ry="4" fill="#ff7aa8" opacity=".45"/>
      ${mouth(mood)}${c.over || ''}${c.top || ''}${extra}${mood === 'sweat' ? sweat : ''}</svg>`;
  }
  // A valid avatar: a known critter, optionally with a colour and accessory we know.
  function valid(key) {
    if (typeof key !== 'string' || key.length > 12) return false;
    const [base, tail] = key.split('~');
    if (!C[base] || base === '🤖' && tail) return false;
    if (tail === undefined) return true;
    const p = parse(key);
    return /^[0-9a-z]{2}$/.test(tail) && p.colour < COLOURS.length && p.acc < ACCESSORIES.length;
  }
  return { C, order, svg, parse, compose, valid, COLOURS, ACCESSORIES, name: (key) => (C[parse(key).base] || C['😎']).name };
})();

function avatarHTML(key, mood = 'happy') {
  return `<span class="av-art" data-mood="${mood}" role="img" aria-label="${AVATAR_ART.name(key)}">${AVATAR_ART.svg(key, mood)}</span>`;
}
function setAvatar(el, key, mood = 'happy') {
  if (!el) return;
  el.dataset.av = key;
  el.innerHTML = avatarHTML(key, mood);
}
