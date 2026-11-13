// Chat themes, named after desserts. Bubble colours are deep enough for white text (3.5:1, as on Instagram). Each one sets the gradient my bubbles are cut from, the colour of
// the other person's bubbles and the background. Picked in the details panel, shared by both people.
export const THEMES = {
  candy:     { name: 'Candy Pop',        dark: false, mine: ['#8f6bff', '#ff1d8b', '#d16600'], theirs: '#efe8f7', bg: '#fff8fc', accent: '#ff4f8b' },
  sorbet:    { name: 'Raspberry Sorbet', dark: false, mine: ['#ff296a', '#ff3724', '#e75400'], theirs: '#fbe5e6', bg: '#fff7f6', accent: '#ff2e6e' },
  mint:      { name: 'Mint Choc Chip',   dark: false, mine: ['#0d9774', '#1d977d', '#24947d'], theirs: '#e0f2ea', bg: '#f5fcf8', accent: '#0e9c78' },
  blueberry: { name: 'Blueberry',        dark: false, mine: ['#3459e6', '#5b6cff', '#8a6bff'], theirs: '#e6eafa', bg: '#f6f7ff', accent: '#3459e6' },
  mango:     { name: 'Mango Lassi',      dark: false, mine: ['#d76700', '#ca7000', '#ba7700'], theirs: '#fbecd6', bg: '#fffaf1', accent: '#f07a12' },
  matcha:    { name: 'Matcha Latte',     dark: false, mine: ['#4f8f3a', '#629041', '#6b8e39'], theirs: '#e7eed8', bg: '#f7f9f0', accent: '#4f8f3a' },
  cotton:    { name: 'Cotton Candy',     dark: false, mine: ['#ff198c', '#bf4fff', '#6775ff'], theirs: '#f4e6f6', bg: '#fff8fe', accent: '#d052a6' },
  midnight:  { name: 'Midnight Sundae',  dark: true,  mine: ['#ff08a4', '#9a62ff', '#3d7bf2'], theirs: '#2a2346', bg: '#120e24', accent: '#ff7ad1' },
  cocoa:     { name: 'Hot Cocoa',        dark: true,  mine: ['#b8643a', '#cb6e2d', '#c66d16'], theirs: '#32261f', bg: '#18110d', accent: '#efb072' },
  // Instagram's dark mode: black, grey bubbles, purple to blue (user, 14 Nov 2026: one choice, not every theme)
  insta:     { name: 'Insta Night',      dark: true,  mine: ['#a033ff', '#6a4dff', '#2f7bff'], theirs: '#262626', bg: '#000000', accent: '#8b6bff', sheet: '#1f1f1f', sub: '#a8a8a8' },
};
export const THEME_ORDER = Object.keys(THEMES);
export const themeName = (k) => (THEMES[k] || THEMES.candy).name;

// Sets the CSS variables the chat is drawn with, on the chat's own element (so nothing else is recoloured).
// `page`: the chat is what's on screen, so the browser's bar and the page edge take its colour too.
export function applyTheme(key, vanish = false, el = document.documentElement, { page = true } = {}) {
  const th = THEMES[key] || THEMES.candy;
  const root = el.style;
  const dark = th.dark || vanish;
  root.setProperty('--m1', th.mine[0]); root.setProperty('--m2', th.mine[1]); root.setProperty('--m3', th.mine[2]);
  root.setProperty('--theirs', vanish ? '#262330' : th.theirs);
  root.setProperty('--chat-bg', vanish ? '#0b0a10' : th.bg);
  root.setProperty('--accent', th.accent);
  root.setProperty('--text', dark ? '#f4f0fb' : '#241c33');
  root.setProperty('--sub', th.sub || (dark ? '#a49cb8' : '#6a6079')); // 5.6:1 on the light backgrounds
  root.setProperty('--line', dark ? '#ffffff1c' : '#2b21401a');
  root.setProperty('--bar', dark ? (vanish ? '#0b0a10cc' : th.bg + 'b3') : th.bg + 'b8');
  root.setProperty('--sheet', th.sheet || (dark ? '#1d1830' : '#ffffff'));
  root.setProperty('--chip', dark ? '#ffffff14' : '#2b214010');
  el.classList.toggle('dark', dark);
  if (!page) return;
  document.documentElement.style.background = vanish ? '#0b0a10' : th.bg;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = vanish ? '#0b0a10' : th.bg;
}
