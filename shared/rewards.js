'use strict';
/* Sweet Revenge rewards: the strip on every game's end screen that shows what you just earned.
   "Tallying your XP…", then +XP with the bar filling up, "Level up!" if you went up, and any trophies
   you just unlocked, popping in. It compares the profile from the database (records.me) with the last
   one this device saw (also kept up to date by the home screen). Needs core.js and records.js.
     showRewards(container, gid)  call once a game is saved; repeat calls for the same game do nothing */
const REWARD_KEY = () => 'sr-progress:' + (me ? me.user : '');
function rememberProgress(p) {
  if (p && p.level) store.set(REWARD_KEY(), { xp: p.level.xp, level: p.level.level, ach: p.achievements.filter((a) => a.done).map((a) => a.id) });
}

const shownRewards = new Set();
async function showRewards(container, gid) {
  if (!container || !me || typeof records === 'undefined' || shownRewards.has(gid)) return;
  shownRewards.add(gid);
  const before = store.get(REWARD_KEY(), null);
  container.querySelector('.rewards')?.remove();
  container.insertAdjacentHTML('beforeend', '<div class="rewards" aria-live="polite"><div class="rw-wait"><span class="rw-spin" aria-hidden="true">🍦</span>Tallying your XP…</div></div>');
  const box = container.querySelector('.rewards');
  // Give the save a moment to land, then ask (a few times: the game may still be on its way).
  let p = null;
  // Supabase saves in well under a second, so the first look comes quickly.
  for (let tries = 0; tries < 6; tries++) {
    await new Promise((r) => setTimeout(r, tries ? 3000 : 1200));
    p = await records.me({ fresh: true });
    if (p && p.level && (!before || p.level.xp !== before.xp)) break;
  }
  if (!p || !p.level) { box.remove(); return; } // scoreboard unreachable: just don't show the strip
  const old = before || { xp: p.level.xp, level: p.level.level, ach: p.achievements.filter((a) => a.done).map((a) => a.id) };
  const gained = Math.max(0, p.level.xp - old.xp), { from, to, xp, level, title } = p.level;
  const pctNow = to ? Math.round(((xp - from) / (to - from)) * 100) : 100;
  const pctThen = level > old.level ? 0 : to ? Math.max(0, Math.round(((old.xp - from) / (to - from)) * 100)) : 100;
  const fresh = p.achievements.filter((a) => a.done && !old.ach.includes(a.id));
  box.innerHTML = `
    <div class="rw-top"><b class="rw-xp">+${gained} XP</b>${level > old.level ? `<span class="rw-up">Level up! ${escapeHtml(title)} 🍦</span>` : `<span class="rw-lv">Lv ${level} ${escapeHtml(title)}</span>`}</div>
    <div class="rw-bar"><i style="--p:${pctThen}%"></i></div>
    <small class="rw-next">${to ? `${to - xp} XP to the next scoop` : 'Top of the cone 👑'}</small>
    ${fresh.length ? `<div class="rw-trophies">${fresh.map((a, i) => `<div class="rw-trophy" style="--d:${0.6 + i * 0.25}s"><span class="rw-medal">${a.icon}</span><b>${escapeHtml(a.name)}</b><small>Trophy unlocked!</small></div>`).join('')}</div>` : ''}`;
  requestAnimationFrame(() => requestAnimationFrame(() => { box.querySelector('.rw-bar i').style.setProperty('--p', pctNow + '%'); }));
  if (fresh.length || level > old.level) setTimeout(() => typeof bigConfetti === 'function' && bigConfetti(), 700);
  rememberProgress(p);
}
