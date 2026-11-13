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
    // A strawberry scoop with drips and a cherry, sunglasses pushed up so you can see the eyes.
    '😎': { name: 'Cool Scoop', body: '#ffc2dc',
      head: 'M50 12C77 12 89 30 89 52C89 62 87 68 84 72C82 76 84 84 78 85C73 86 72 79 68 79C64 79 65 88 58 88C52 88 53 81 50 81C46 81 47 89 40 89C34 89 35 80 31 80C27 80 26 86 21 84C16 82 18 75 16 71C13 66 11 60 11 52C11 30 23 12 50 12Z',
      top: `<path d="M50 10c-1-8 3-14 9-16" fill="none" ${s(3.5)}/><circle cx="49" cy="8" r="8.5" fill="#ff4d6d" ${s(4)}/><circle cx="46" cy="5" r="2.2" fill="#fff" opacity=".8"/>
        <g fill="${INK}" ${s(3)}><rect x="25" y="23" width="21" height="13" rx="6.5"/><rect x="54" y="23" width="21" height="13" rx="6.5"/></g><path d="M46 28h8" ${s(3)}/>
        <path d="M30 27h6" stroke="#fff" stroke-width="2.5" stroke-linecap="round" opacity=".6"/>
        <g stroke-width="3.5" stroke-linecap="round"><path d="M20 44l3-4" stroke="#3fb8a8"/><path d="M80 42l-4-3" stroke="#f0a020"/><path d="M83 56l-2-4" stroke="#6f8fe8"/><path d="M28 72l4 1" stroke="#f0a020"/><path d="M70 70l3-2" stroke="#3fb8a8"/></g>` },
    // A bunny with a heart nose.
    '🥰': { name: 'Honey Bun', body: '#fff3f8',
      back: `<path d="M31 32C22 8 27-7 36-6c9 1 10 18 8 36z" fill="#fff3f8" ${S}/><path d="M69 32c9-24 4-39-5-38-9 1-10 18-8 36z" fill="#fff3f8" ${S}/>
        <path d="M34 26c-5-14-3-24 2-24s6 11 5 24z" fill="#ffb3cf"/><path d="M66 26c5-14 3-24-2-24s-6 11-5 24z" fill="#ffb3cf"/>`,
      over: `<path d="M50 63c-3-2-6.5-4.2-6.5-7 0-2.2 2.4-3.6 4.3-2.4L50 55.2l2.2-1.6c1.9-1.2 4.3.2 4.3 2.4 0 2.8-3.5 5-6.5 7z" fill="#ff4d6d" ${s(2.5)}/>`,
      mouthY: 5 },
    // An owl with big face discs and a little beak.
    '🤓': { name: 'Prof. Hoot', body: '#c4956a',
      back: `<path d="M20 36L13 6l27 14z" fill="#c4956a" ${S}/><path d="M80 36l7-30-27 14z" fill="#c4956a" ${S}/>`,
      under: `<circle cx="36" cy="52" r="15" fill="#fbecd6" ${s(3.5)}/><circle cx="64" cy="52" r="15" fill="#fbecd6" ${s(3.5)}/>
        <path d="M37 80l4 3 4-3M55 80l4 3 4-3M46 86l4 3 4-3" fill="none" ${s(2.5)}/>`,
      over: `<path d="M45 63l5 8 5-8z" fill="#ffb84d" ${s(3)}/>`, noMouth: true },
    // A puppy with floppy ears, an eye patch and a tiny cowboy hat.
    '🤠': { name: 'Rodeo Pup', body: '#ffe2b8',
      under: `<ellipse cx="64" cy="50" rx="12" ry="11" fill="#e0a468"/><ellipse cx="50" cy="68" rx="16" ry="10" fill="#fff6ea"/>
        <path d="M22 26C7 26 3 52 9 66c4 8 13 2 15-14 1-9 0-19-2-26z" fill="#c98446" ${S}/><path d="M78 26c15 0 19 26 13 40-4 8-13 2-15-14-1-9 0-19 2-26z" fill="#c98446" ${S}/>`,
      over: `<ellipse cx="50" cy="62" rx="5.5" ry="4" fill="${INK}"/><circle cx="48.5" cy="61" r="1.4" fill="#fff"/>`,
      top: `<g transform="translate(23 -6) rotate(-8 27 20) scale(.55)"><path d="M14 30c10 6 62 6 72 0-4 8-12 10-12 10H26s-8-2-12-10z" fill="#b5703a" ${s(6)}/><path d="M30 31c0-14 6-22 20-22s20 8 20 22" fill="#c98446" ${s(6)}/><path d="M31 27h38" stroke="#ff5a5f" stroke-width="7"/></g>`,
      mouthY: 6 },
    // A tabby cat with cheek fluff, forehead stripes and a pink nose.
    '😺': { name: 'Whiskers', body: '#ffc98f',
      head: 'M50 14C76 14 88 31 88 50C88 58 86 64 83 68L91 71L83 75L87 81L77 80C70 88 61 91 50 91S30 88 23 80L13 81L17 75L9 71L17 68C14 64 12 58 12 50C12 31 24 14 50 14Z',
      back: `<path d="M17 40C14 24 16 10 22 6c6 2 16 10 22 14z" fill="#ffc98f" ${S}/><path d="M83 40c3-16 1-30-5-34-6 2-16 10-22 14z" fill="#ffc98f" ${S}/>
        <path d="M22 28c0-8 1-14 3-16 3 2 8 6 11 9z" fill="#ff9ab0"/><path d="M78 28c0-8-1-14-3-16-3 2-8 6-11 9z" fill="#ff9ab0"/>`,
      under: `<path d="M50 18v8M42 19l2 6M58 19l-2 6" ${s(3.5)}/>`,
      over: `<path d="M46 59h8l-4 4.5z" fill="#ff7aa8" ${s(2.5)}/><path d="M17 60h11M18 67l10-3M83 60H72M82 67l-10-3" ${s(2.5)}/>`, mouthY: 4 },
    // Kept exactly as it was (a favourite).
    '🐼': { name: 'Bamboo', body: '#ffffff', back: `<circle cx="22" cy="24" r="12" fill="${INK}"/><circle cx="78" cy="24" r="12" fill="${INK}"/>`, under: `<ellipse cx="37" cy="52" rx="10" ry="12" fill="${INK}" transform="rotate(-15 37 52)"/><ellipse cx="63" cy="52" rx="10" ry="12" fill="${INK}" transform="rotate(15 63 52)"/>`, lightEyes: true },
    // A fox with big dark-tipped ears and a white cheek mask.
    '🦊': { name: 'Sly Fox', body: '#ff8a4c',
      back: `<path d="M17 42L12 0l33 22z" fill="#ff8a4c" ${S}/><path d="M83 42L88 0 55 22z" fill="#ff8a4c" ${S}/>
        <path d="M13 4l1.5 12 9.5-6z" fill="${INK}"/><path d="M87 4l-1.5 12-9.5-6z" fill="${INK}"/>
        <path d="M21 33l-2-15 12 7z" fill="#fff3e6"/><path d="M79 33l2-15-12 7z" fill="#fff3e6"/>`,
      under: `<path d="M11.5 56c10 3 22 4 30 13 4 5 12 5 16 0 8-9 20-10 31-13-2 20-17 35-38.5 35S13.5 76 11.5 56z" fill="#fff6ec"/>`,
      over: `<ellipse cx="50" cy="63" rx="4.5" ry="3.2" fill="${INK}"/>`, mouthY: 5 },
    // A ghost with little arms and its tongue out.
    '👻': { name: 'Boo', body: '#f7f4ff',
      head: 'M50 10C76 10 87 28 87 52V82C87 88 81 90 77 86L73 82L68 87C65 90 61 90 58 87L53 82L48 87C45 90 41 90 38 87L33 82L28 87C24 90 13 89 13 82V52C13 28 24 10 50 10Z',
      back: `<path d="M16 58C6 56 2 66 8 72c4 4 9 0 9-4" fill="#f7f4ff" ${S}/><path d="M84 58c10-2 14 8 8 14-4 4-9 0-9-4" fill="#f7f4ff" ${S}/>`,
      over: `<path d="M47 70c0 7 6 7 6 0z" fill="#ff7aa8" ${s(2.5)}/>`, blush: '#c9a7ff' },
    // A wide frog with eyes up top and a pale chin.
    '🐸': { name: 'Hopper', body: '#86e08f',
      head: 'M50 28C80 28 94 42 94 60C94 79 76 91 50 91S6 79 6 60C6 42 20 28 50 28Z',
      back: `<circle cx="31" cy="27" r="15" fill="#86e08f" ${S}/><circle cx="69" cy="27" r="15" fill="#86e08f" ${S}/>`,
      under: `<ellipse cx="50" cy="81" rx="24" ry="8" fill="#cdf7c9"/><circle cx="46" cy="58" r="1.8" fill="${INK}"/><circle cx="54" cy="58" r="1.8" fill="${INK}"/>`,
      eyesUp: true, mouthY: 5 },
    // A unicorn with a rainbow mane and a golden horn.
    '🦄': { name: 'Sparkle', body: '#fbf3ff',
      back: `<path d="M84 40c8-6 10-18 2-26" fill="none" stroke="#ff8fc8" stroke-width="10" stroke-linecap="round"/><path d="M90 54c8-8 6-18 0-22" fill="none" stroke="#7ee8d8" stroke-width="9" stroke-linecap="round"/>
        <path d="M86 68c8-6 8-14 4-18" fill="none" stroke="#ffd56b" stroke-width="8" stroke-linecap="round"/>
        <path d="M22 32l1-20 14 11z" fill="#fbf3ff" ${S}/><path d="M78 32l-1-20-14 11z" fill="#fbf3ff" ${S}/>`,
      top: `<path d="M43 18L51-10 59 18z" fill="#ffd56b" ${s(4)}/><path d="M46 10l10-3M48 2l7-2M44 15l13-3" ${s(2.5)}/>
        <path d="M30 22c2-9 12-13 20-9-6 1-9 6-8 12-5-3-9-4-12-3z" fill="#ff8fc8" ${s(3)}/><path d="M50 13c6-4 14-2 18 4-5-1-9 1-10 5-2-4-5-7-8-9z" fill="#c9a7ff" ${s(3)}/>
        <path d="M14 18l2 4 4 1-4 2-1 4-2-4-4-1 4-2z" fill="#ffd56b" ${s(2)}/>` },
    // Kept exactly as it was (a favourite).
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
      <ellipse cx="26" cy="64" rx="6" ry="4" fill="${c.blush || '#ff7aa8'}" opacity=".45"/><ellipse cx="74" cy="64" rx="6" ry="4" fill="${c.blush || '#ff7aa8'}" opacity=".45"/>
      ${c.noMouth ? '' : c.mouthY ? `<g transform="translate(0 ${c.mouthY})">${mouth(mood)}</g>` : mouth(mood)}${c.over || ''}${c.top || ''}${extra}${mood === 'sweat' ? sweat : ''}</svg>`;
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

/* A critter reacts for a moment: its face changes mood and it bounces (cheer, smug) or droops (sulk,
   sweat), then goes back to happy. `holder` is any element with a critter (.av-art) inside; only the
   critter is swapped, so things beside it (a crown, a count) stay. Games call it on big moments. */
function critterReact(holder, key, mood = 'cheer', ms = 2600) {
  if (!holder || !key || typeof AVATAR_ART === 'undefined') return;
  const swap = (m) => {
    const art = holder.querySelector('.av-art');
    if (art) art.outerHTML = avatarHTML(key, m); else holder.innerHTML = avatarHTML(key, m);
  };
  swap(mood);
  holder.classList.remove('crit-hype', 'crit-droop');
  void holder.offsetWidth; // restart the animation
  holder.classList.add(mood === 'sulk' || mood === 'sweat' ? 'crit-droop' : 'crit-hype');
  clearTimeout(holder._critT);
  holder._critT = setTimeout(() => { swap('happy'); holder.classList.remove('crit-hype', 'crit-droop'); }, ms);
}
