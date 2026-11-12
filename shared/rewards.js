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

/* The victory moment, at the top of every end screen: your critter dances if you won; if you lost, it
   sulks under a little rain cloud next to the winner's critter, and gets a "revenge owed" stamp. */
function friendLook(name) {
  const cached = store.get('sr-profile:' + me.user, null), friends = (cached && cached.friends) || {};
  const f = Object.entries(friends).find(([id, x]) => x.name === name || id === String(name).toLowerCase());
  return (f && f[1].avatar) || (f && DEFAULT_AVATAR[f[0]]) || '🙂';
}
function showVictory(container, g) {
  if (!g || !g.winners || !g.players || container.querySelector('.victory')) return;
  const mine = me.name, iWon = g.winners.includes(mine), solo = g.winners.length > 1 ? 'You all won' : 'You won!';
  const first = g.winners[0], winnerSeat = g.players.find((p) => p.name === first) || {};
  const winnerLook = winnerSeat.bot ? '🤖' : friendLook(first);
  const html = iWon
    ? `<div class="victory won" aria-live="polite">
        <span class="v-critter dance">${avatarHTML(myAvatar(), 'cheer')}</span>
        <div class="v-txt"><b>${g.winners.length > 1 ? solo : 'You won!'}</b><small>${g.practice ? 'Bots crushed. Glory is yours.' : 'Bragging rights unlocked. Use them wisely.'}</small></div>
        <span class="v-sparkles" aria-hidden="true">✨🏆✨</span>
      </div>`
    : `<div class="victory lost" aria-live="polite">
        <span class="v-critter rival">${avatarHTML(winnerLook, 'smug')}</span>
        <div class="v-txt"><b>${escapeHtml(String(first).split(' ').pop())} wins</b><small>${winnerSeat.bot ? 'Beaten by a bot. We will never speak of this.' : 'They will not let you forget this.'}</small></div>
        <span class="v-critter me-sad">${avatarHTML(myAvatar(), 'sulk')}<i class="cloud" aria-hidden="true">🌧️</i></span>
        ${winnerSeat.bot ? '' : '<span class="v-stamp">REVENGE OWED</span>'}
      </div>`;
  container.insertAdjacentHTML('afterbegin', html);
  if (iWon && typeof bigConfetti === 'function') setTimeout(bigConfetti, 250);
}

const shownRewards = new Set();
async function showRewards(container, gid) {
  if (!container || !me || typeof records === 'undefined' || shownRewards.has(gid)) return;
  shownRewards.add(gid);
  showVictory(container, records.lastGame && records.lastGame(gid));
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
  // A practice game (against bots) gives no XP: say so with a wink instead of a sad "+0 XP".
  if (!gained && !fresh.length) {
    box.innerHTML = `<div class="rw-top"><b class="rw-xp rw-zero">Just for glory</b><span class="rw-lv">Lv ${level} ${escapeHtml(title)}</span></div>
      <small class="rw-next">Practice rounds don't give XP. Beat a real friend for that 😈</small>`;
    rememberProgress(p);
    return;
  }
  box.innerHTML = `
    <div class="rw-top"><b class="rw-xp">+${gained} XP</b>${level > old.level ? `<span class="rw-up">Level up! ${escapeHtml(title)} 🍦</span>` : `<span class="rw-lv">Lv ${level} ${escapeHtml(title)}</span>`}</div>
    <div class="rw-bar"><i style="--p:${pctThen}%"></i></div>
    <small class="rw-next">${to ? `${to - xp} XP to the next scoop` : 'Top of the cone 👑'}</small>
    ${fresh.length ? `<div class="rw-trophies">${fresh.map((a, i) => `<div class="rw-trophy" style="--d:${0.6 + i * 0.25}s"><span class="rw-medal">${a.icon}</span><b>${escapeHtml(a.name)}</b><small>Trophy unlocked!</small></div>`).join('')}</div>` : ''}`;
  requestAnimationFrame(() => requestAnimationFrame(() => { box.querySelector('.rw-bar i').style.setProperty('--p', pctNow + '%'); }));
  if (fresh.length || level > old.level) setTimeout(() => typeof bigConfetti === 'function' && bigConfetti(), 700);
  rememberProgress(p);
}
