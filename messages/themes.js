// Chat themes, named after desserts. All dark, like Instagram DMs in dark mode (user, 14 Nov 2026). Each one sets the gradient my bubbles are cut from, the colour of
// the other person's bubbles and the background. Picked in the details panel, shared by both people.
export const THEMES = {
  candy:     { name: 'Candy Pop',        dark: true, mine: ['#a033ff', '#6a4dff', '#2f7bff'], theirs: '#26232c', bg: '#0b0a0f', accent: '#8b6bff' },
  sorbet:    { name: 'Raspberry Sorbet', dark: true, mine: ['#ff2e6e', '#f0365a', '#e2463a'], theirs: '#26232c', bg: '#0b0a0f', accent: '#ff4d7e' },
  mint:      { name: 'Mint Choc Chip',   dark: true, mine: ['#0f9f7a', '#11977f', '#0d8a86'], theirs: '#26232c', bg: '#0b0a0f', accent: '#2fd3a7' },
  blueberry: { name: 'Blueberry',        dark: true, mine: ['#3459e6', '#5b6cff', '#7a5cff'], theirs: '#26232c', bg: '#0b0a0f', accent: '#7d8cff' },
  mango:     { name: 'Mango Lassi',      dark: true, mine: ['#d9560b', '#e0650c', '#c95008'], theirs: '#26232c', bg: '#0b0a0f', accent: '#ffa53b' },
  matcha:    { name: 'Matcha Latte',     dark: true, mine: ['#4f8f3a', '#5a9442', '#3f7f34'], theirs: '#26232c', bg: '#0b0a0f', accent: '#8fd16b' },
  cotton:    { name: 'Cotton Candy',     dark: true, mine: ['#d93f95', '#a957e8', '#6f63ff'], theirs: '#26232c', bg: '#0b0a0f', accent: '#ff8fd0' },
  midnight:  { name: 'Midnight Sundae',  dark: true, mine: ['#d93aa6', '#8a55f5', '#3d74e8'], theirs: '#26232c', bg: '#0b0a0f', accent: '#ff7ad1' },
  cocoa:     { name: 'Hot Cocoa',        dark: true, mine: ['#b8643a', '#a85d36', '#9a532d'], theirs: '#2a2420', bg: '#0d0a08', accent: '#efb072' },
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
  root.setProperty('--text', dark ? '#f5f3f7' : '#241c33');
  root.setProperty('--sub', dark ? '#a8a3b3' : '#7a7089');
  root.setProperty('--line', dark ? '#ffffff1c' : '#2b21401a');
  root.setProperty('--bar', dark ? (vanish ? '#0b0a10cc' : th.bg + 'b3') : th.bg + 'b8');
  root.setProperty('--sheet', dark ? '#1f1d24' : '#ffffff'); // Instagram-style neutral greys
  root.setProperty('--chip', dark ? '#ffffff12' : '#2b214010');
  el.classList.toggle('dark', dark);
  if (!page) return;
  document.documentElement.style.background = vanish ? '#0b0a10' : th.bg;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = vanish ? '#0b0a10' : th.bg;
}
