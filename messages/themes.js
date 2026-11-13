// Chat themes, named after desserts. Each one sets the gradient my bubbles are cut from, the colour of
// the other person's bubbles and the background. Picked in the details panel, shared by both people.
export const THEMES = {
  candy:     { name: 'Candy Pop',        dark: false, mine: ['#8f6bff', '#ff6fb5', '#ffb36b'], theirs: '#efe8f7', bg: '#fff8fc', accent: '#ff4f8b' },
  sorbet:    { name: 'Raspberry Sorbet', dark: false, mine: ['#ff2e6e', '#ff6a5c', '#ff9f68'], theirs: '#fbe5e6', bg: '#fff7f6', accent: '#ff2e6e' },
  mint:      { name: 'Mint Choc Chip',   dark: false, mine: ['#0fae86', '#26c6a4', '#5fd8c0'], theirs: '#e0f2ea', bg: '#f5fcf8', accent: '#0e9c78' },
  blueberry: { name: 'Blueberry',        dark: false, mine: ['#3459e6', '#5b6cff', '#8a6bff'], theirs: '#e6eafa', bg: '#f6f7ff', accent: '#3459e6' },
  mango:     { name: 'Mango Lassi',      dark: false, mine: ['#ff8a1f', '#ffa83b', '#ffc04f'], theirs: '#fbecd6', bg: '#fffaf1', accent: '#f07a12' },
  matcha:    { name: 'Matcha Latte',     dark: false, mine: ['#4f8f3a', '#73a94c', '#9cc266'], theirs: '#e7eed8', bg: '#f7f9f0', accent: '#4f8f3a' },
  cotton:    { name: 'Cotton Candy',     dark: false, mine: ['#ff7fbf', '#d58cff', '#9fa8ff'], theirs: '#f4e6f6', bg: '#fff8fe', accent: '#d052a6' },
  midnight:  { name: 'Midnight Sundae',  dark: true,  mine: ['#ff5fc4', '#9a62ff', '#3d7bf2'], theirs: '#2a2346', bg: '#120e24', accent: '#ff7ad1' },
  cocoa:     { name: 'Hot Cocoa',        dark: true,  mine: ['#b8643a', '#d98a52', '#efb072'], theirs: '#32261f', bg: '#18110d', accent: '#efb072' },
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
  root.setProperty('--sub', dark ? '#a49cb8' : '#7a7089');
  root.setProperty('--line', dark ? '#ffffff1c' : '#2b21401a');
  root.setProperty('--bar', dark ? (vanish ? '#0b0a10cc' : th.bg + 'b3') : th.bg + 'b8');
  root.setProperty('--sheet', dark ? '#1d1830' : '#ffffff');
  root.setProperty('--chip', dark ? '#ffffff14' : '#2b214010');
  el.classList.toggle('dark', dark);
  if (!page) return;
  document.documentElement.style.background = vanish ? '#0b0a10' : th.bg;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = vanish ? '#0b0a10' : th.bg;
}
