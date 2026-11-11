'use strict';
/* Sweet Revenge chat, shared by every game: messages, stickers, an emoji wheel and hold-to-talk
   voice notes. A game makes one with createChat(), puts its buttons somewhere with mountTools(),
   hands incoming social messages to receive(), and sends what this player says via opts.send().
   It builds its own chat sheet, wheel and recording pill. Needs shared/core.js. */

const CHAT_EMOTES = ['😂', '🔥', '😭', '👏', '😈', '🫡', '😱', '🥳'];
const CHAT_QUICK = ['😂', '🔥', '😭', '😈', '🫡', '💀'];
const CHAT_STICKERS = {
  gg: ['GG 🤝', '#ffffff'], all: ['Is that all?', '#ffc233'], lucky: ['Lucky 🍀', '#2bc48a'],
  noob: ["Beginner's luck", '#4d9de0'], revenge: ['Revenge is coming', '#c9a7ff'],
};

/* opts:
   send(m)        deliver a message this player just sent to everyone else
   players()      [{ k, name, color }] of the current game, or [] when there's no game
   me()           this player's k
   anchor(k)      element a player's bubbles and reactions come out of (optional)
   stage()        element that shakes when a sticker lands (optional)
   stickers       { id: [text, colour] } for this game (optional)
   dockAt         on screens at least this wide the chat is docked beside the game (0 = never)
   routeText(t)   return true if the game used this text itself, e.g. as a guess (optional)
   sound(kind)    'in' for someone else's message, 'out' for yours (optional)
   players() may also give each player's `avatar`, drawn beside their messages
   game           'ludo' | 'plusfour' | 'doodle': typed messages and stickers are saved under it
   room()         the room code they're saved with (optional) */
function createChat(opts) {
  const o = { stickers: CHAT_STICKERS, dockAt: 0, sound() {}, anchor() { return null; }, stage() { return null; }, room() { return null; }, ...opts };
  const COOLDOWN = { chat: 0, react: 500, sticker: 2500, voice: 0, typing: 2500 };
  const lastSent = {};
  let unread = 0, inGame = false;

  /* ---------- the chat sheet, emoji wheel and recording pill ---------- */
  document.body.insertAdjacentHTML('beforeend', `
    <div id="chat" class="sheet chat-sheet" hidden>
      <div class="grab" aria-hidden="true"></div>
      <header><b>Chat</b><button class="icon-btn sm chat-close" type="button" aria-label="Close chat" data-icon="x"></button></header>
      <div class="msgs" aria-live="polite"></div>
      <div class="quick"></div>
      <form class="compose" autocomplete="off">
        <input aria-label="Message" placeholder="Message…" maxlength="300">
        <button class="icon-btn send" type="submit" aria-label="Send" data-icon="send"></button>
        <button class="icon-btn mic" type="button" aria-label="Hold to talk" data-icon="mic" data-chat-mic></button>
      </form>
    </div>
    <div class="wheel" role="menu" aria-label="Reactions"></div>
    ${document.getElementById('rec') ? '' : '<div id="rec" class="rec" aria-live="polite"><i></i><span>Recording… let go to send</span></div>'}`);
  const sheet = $('#chat'), msgs = sheet.querySelector('.msgs'), input = sheet.querySelector('input'), wheel = document.querySelector('.wheel');
  hydrateIcons(sheet);
  const isOpen = () => !sheet.hidden;
  const docked = () => sheet.classList.contains('docked');
  const nameOf = (k) => { const p = o.players().find((x) => x.k === k); return p ? p.name.split(' ').pop() : '?'; };
  const colorOf = (k) => { const p = o.players().find((x) => x.k === k); return (p && p.color) || 'var(--red)'; };

  function setUnread(n) {
    unread = n;
    document.querySelectorAll('.chat-unread').forEach((b) => { b.hidden = !n; b.textContent = n > 9 ? '9+' : n; });
  }
  const avatarOfK = (k) => { const p = o.players().find((x) => x.k === k); return p && p.avatar; };
  // Each message sits in a row with the sender's critter; a run of messages from one sender shows it once.
  function addMsg(html, cls, k) {
    msgs.querySelector('.empty')?.remove();
    hideTyping(k);
    if (!k) {
      msgs.insertAdjacentHTML('beforeend', `<div class="m ${cls}">${html}</div>`);
    } else {
      const last = msgs.lastElementChild, cont = !!(last && last.dataset.k === k);
      const av = avatarOfK(k), art = av && typeof avatarHTML === 'function' ? avatarHTML(av, cls.includes('me') ? 'happy' : 'happy') : '';
      msgs.insertAdjacentHTML('beforeend', `<div class="m-row ${cls.split(' ')[0]}${cont ? ' cont' : ''}" data-k="${k}" style="--c:${colorOf(k)}">
        <span class="m-av" aria-hidden="true">${cont ? '' : art}</span><div class="m ${cls}" style="--c:${colorOf(k)}">${html}</div></div>`);
    }
    while (msgs.children.length > 80) msgs.firstElementChild.remove();
    msgs.scrollTop = msgs.scrollHeight;
    const row = msgs.lastElementChild;
    return row.classList.contains('m') ? row : row.querySelector('.m');
  }
  // "Kunju is typing…" at the bottom of the chat, gone after a few seconds of quiet.
  const typingTimers = {};
  function showTyping(k) {
    let el = msgs.querySelector(`.typing[data-k="${k}"]`);
    if (!el) {
      msgs.querySelector('.empty')?.remove();
      msgs.insertAdjacentHTML('beforeend', `<div class="typing" data-k="${k}" style="--c:${colorOf(k)}">${escapeHtml(nameOf(k))} is typing<span class="dots"><i></i><i></i><i></i></span></div>`);
      el = msgs.lastElementChild;
      msgs.scrollTop = msgs.scrollHeight;
    } else msgs.appendChild(el);
    clearTimeout(typingTimers[k]);
    typingTimers[k] = setTimeout(() => hideTyping(k), 4000);
  }
  function hideTyping(k) { if (k) msgs.querySelector(`.typing[data-k="${k}"]`)?.remove(); }
  function open(focus = false) {
    sheet.hidden = false;
    setUnread(0);
    msgs.scrollTop = 1e6;
    if (focus) input.focus();
  }
  function close() { if (!docked()) sheet.hidden = true; }
  // On a wide screen the chat stays docked beside the game.
  const wide = o.dockAt ? matchMedia(`(min-width: ${o.dockAt}px)`) : null;
  function dock() {
    const on = !!(wide && wide.matches && inGame), was = docked();
    sheet.classList.toggle('docked', on);
    document.body.classList.toggle('chat-docked', on);
    if (on) open(); else if (was) sheet.hidden = true;
  }
  if (wide) wide.addEventListener('change', dock);

  /* ---------- what other players see: bubbles, floating emoji, stickers ---------- */
  function showBubble(k, text) {
    if (isOpen()) return;
    const el = o.anchor(k);
    if (!el) return;
    const r = el.getBoundingClientRect(), up = r.top > innerHeight / 2;
    const b = document.createElement('div');
    b.className = `bubble ${up ? 'up' : 'down'}`;
    b.textContent = text;
    b.style.left = Math.min(Math.max(r.left + r.width / 2, 130), innerWidth - 130) + 'px';
    b.style.top = (up ? r.top - 8 : r.bottom + 8) + 'px';
    $('#fx').appendChild(b);
    setTimeout(() => b.remove(), 3300);
  }
  function floatEmoji(k, e) {
    const el = o.anchor(k);
    const [x, y] = el ? centerOf(el) : [innerWidth / 2, innerHeight / 2];
    const d = document.createElement('div');
    d.className = 'float-emoji';
    d.textContent = e;
    d.style.left = x + 'px'; d.style.top = y + 'px';
    d.style.setProperty('--dx', (Math.random() - 0.5) * 80 + 'px');
    $('#fx').appendChild(d);
    setTimeout(() => d.remove(), 1900);
  }
  function slamSticker(id) {
    const [text, bg] = o.stickers[id];
    const s = document.createElement('div');
    s.className = 'slam';
    s.innerHTML = `<span class="sticker-art" style="--sbg:${bg}">${escapeHtml(text)}</span>`;
    $('#fx').appendChild(s);
    setTimeout(() => s.remove(), 2000);
    const stage = o.stage();
    if (stage) retrigger(stage, 'shake');
  }

  // Check and show a social message. `mine` is true for messages this device sent.
  function receive(m, mine = false) {
    if (!m || !o.players().some((p) => p.k === m.from)) return false;
    if (m.t === 'typing') { if (!mine) showTyping(m.from); return true; } // no sound, no unread
    const who = mine ? '' : `<small>${escapeHtml(nameOf(m.from))}</small>`, cls = mine ? 'me' : 'them';
    if (m.t === 'chat' && typeof m.text === 'string' && m.text.trim() && m.text.length <= 300) {
      addMsg(who + escapeHtml(m.text), cls, m.from);
      if (!mine) showBubble(m.from, m.text);
    } else if (m.t === 'react' && CHAT_EMOTES.concat(CHAT_QUICK).includes(m.e)) {
      floatEmoji(m.from, m.e);
      return true; // reactions don't go in the chat or count as unread
    } else if (m.t === 'sticker' && o.stickers[m.id]) {
      const [text, bg] = o.stickers[m.id];
      addMsg(`${who}<span class="sticker-art" style="--sbg:${bg}">${escapeHtml(text)}</span>`, `${cls} sticker`, m.from);
      slamSticker(m.id);
    } else if (m.t === 'voice' && typeof m.data === 'string' && m.data.length <= 400000 && /^audio\/[\w.+-]+(;.*)?$/.test(m.mime || '') && m.dur > 0 && m.dur <= 30) {
      const bars = Array.from({ length: 18 }, () => `<i style="height:${25 + Math.random() * 75}%"></i>`).join('');
      const el = addMsg(`${who}<button type="button" aria-label="Play voice note">${ic('play')}</button><span class="bars">${bars}</span><time>0:${String(Math.round(m.dur)).padStart(2, '0')}</time>`, `${cls} voice`, m.from);
      el._audio = { data: m.data, mime: m.mime, dur: m.dur };
      if (!mine) {
        showBubble(m.from, '🎙️ Voice note');
        playVoice(el).catch(() => toast(`🎙️ ${nameOf(m.from)} sent a voice note. Open the chat to play it.`, 3200));
      }
    } else return false;
    if (!mine) { o.sound('in'); if (!isOpen()) setUnread(unread + 1); }
    return true;
  }
  function emit(m) {
    if (!inGame || !o.players().length) return;
    const now = Date.now();
    if (now - (lastSent[m.t] || 0) < COOLDOWN[m.t]) return;
    lastSent[m.t] = now;
    m.from = o.me();
    if (!receive(m, true)) return;
    if (m.t !== 'typing') o.sound('out');
    o.send(m);
    // Keep typed messages and stickers (never voice notes or reactions) in the chat history.
    if (o.game && typeof records !== 'undefined' && (m.t === 'chat' || m.t === 'sticker')) {
      records.chat(o.game, o.room(), m.t, m.t === 'chat' ? m.text : o.stickers[m.id][0]);
    }
  }

  /* ---------- voice notes ---------- */
  let playing = null;
  async function playVoice(el) {
    if (playing) { playing.audio.pause(); playing.done(); }
    const { data, mime, dur } = el._audio;
    const bytes = Uint8Array.from(atob(data), (ch) => ch.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    const audio = new Audio(url), btn = el.querySelector('button'), bars = [...el.querySelectorAll('.bars i')];
    const tick = setInterval(() => {
      const k = Math.floor((audio.currentTime / (audio.duration || dur)) * bars.length);
      bars.forEach((b, i) => b.classList.toggle('lit', i <= k));
    }, 80);
    const done = () => { clearInterval(tick); bars.forEach((b) => b.classList.remove('lit')); setIcon(btn, 'play'); URL.revokeObjectURL(url); if (playing && playing.audio === audio) playing = null; };
    playing = { audio, done };
    audio.onended = done;
    setIcon(btn, 'pause');
    try { await audio.play(); } catch (e) { done(); throw e; }
  }
  msgs.addEventListener('click', (e) => {
    const b = e.target.closest('.m.voice button');
    if (!b) return;
    const el = b.closest('.m');
    if (playing && playing.audio && el.querySelector('svg.ic').innerHTML === ICONS.pause) { playing.audio.pause(); playing.done(); return; }
    playVoice(el).catch(() => toast('Could not play that voice note 😕'));
  });

  const recorder = { stream: null, rec: null, chunks: [], t0: 0, timer: null, wanted: false, btn: null };
  function pickMime() {
    if (typeof MediaRecorder === 'undefined') return null;
    return ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
  }
  async function startTalk(btn) {
    if (!inGame || recorder.rec) return;
    const mime = pickMime();
    if (mime === null || !navigator.mediaDevices) return toast('Voice notes need a newer browser 😕');
    recorder.wanted = true;
    try {
      recorder.stream = recorder.stream || await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) { recorder.wanted = false; return toast('Allow the microphone to send voice notes 🎙️', 3000); }
    if (!recorder.wanted) return; // let go before permission came back
    recorder.chunks = [];
    recorder.rec = new MediaRecorder(recorder.stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 24000 });
    recorder.rec.ondataavailable = (e) => e.data.size && recorder.chunks.push(e.data);
    recorder.rec.onstop = finishTalk;
    recorder.rec.start();
    recorder.t0 = performance.now();
    recorder.btn = btn;
    btn.classList.add('live'); $('#rec').classList.add('on');
    recorder.timer = setTimeout(stopTalk, 20000);
  }
  function stopTalk() {
    recorder.wanted = false;
    clearTimeout(recorder.timer);
    if (recorder.rec && recorder.rec.state === 'recording') recorder.rec.stop();
  }
  function finishTalk() {
    const rec = recorder.rec, dur = (performance.now() - recorder.t0) / 1000;
    recorder.rec = null;
    recorder.btn?.classList.remove('live'); $('#rec').classList.remove('on');
    // Release the mic so the "recording" indicator goes away between notes.
    recorder.stream?.getTracks().forEach((t) => t.stop()); recorder.stream = null;
    if (dur < 0.6) return toast('Hold the mic button while you talk 🎙️');
    const blob = new Blob(recorder.chunks, { type: rec.mimeType || 'audio/webm' });
    const reader = new FileReader();
    reader.onload = () => emit({ t: 'voice', data: String(reader.result).split(',')[1], mime: blob.type, dur: Math.min(30, Math.round(dur * 10) / 10) });
    reader.readAsDataURL(blob);
  }
  // Pointer capture can fail (the pointer is already gone); the gesture still works without it.
  const capture = (el, e) => { try { el.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ } };
  function wireMic(btn) {
    btn.addEventListener('pointerdown', (e) => { e.preventDefault(); capture(btn, e); startTalk(btn); });
    btn.addEventListener('pointerup', stopTalk);
    btn.addEventListener('pointercancel', stopTalk);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
    btn.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); startTalk(btn); } });
    btn.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') stopTalk(); });
  }

  /* ---------- emoji wheel: tap to open then tap an emoji, or press, slide and let go ---------- */
  wheel.innerHTML = CHAT_EMOTES.map((e, i) => {
    const a = (i / CHAT_EMOTES.length) * Math.PI * 2 - Math.PI / 2, at = `translate(${Math.cos(a) * 78}px, ${Math.sin(a) * 78}px)`;
    return `<button type="button" role="menuitem" aria-label="Send ${e}" data-e="${e}" style="--at:${at};transform:var(--at)">${e}</button>`;
  }).join('') + '<em>Tap or slide<br>to react</em>';
  function openWheel(anchor) {
    const r = anchor.getBoundingClientRect();
    wheel.style.left = Math.min(Math.max(r.left + r.width / 2, 128), innerWidth - 128) + 'px';
    wheel.style.top = Math.min(Math.max(r.top + r.height / 2 + (r.top > innerHeight / 2 ? -90 : 90), 128), innerHeight - 128) + 'px';
    wheel.classList.add('open');
  }
  const closeWheel = () => { wheel.classList.remove('open'); wheel.querySelectorAll('.hot').forEach((b) => b.classList.remove('hot')); };
  function wireEmote(btn) {
    let sliding = false, hot = null, downAt = 0;
    btn.addEventListener('pointerdown', (e) => {
      downAt = Date.now(); sliding = false;
      if (!wheel.classList.contains('open')) { openWheel(btn); sliding = true; capture(btn, e); }
    });
    btn.addEventListener('pointermove', (e) => {
      if (!sliding) return;
      const el = document.elementsFromPoint(e.clientX, e.clientY).find((n) => n.dataset && n.dataset.e);
      wheel.querySelectorAll('button').forEach((b) => b.classList.toggle('hot', b === el));
      hot = el;
    });
    btn.addEventListener('pointerup', () => {
      if (!sliding) { closeWheel(); return; }
      sliding = false;
      if (hot) { emit({ t: 'react', e: hot.dataset.e }); closeWheel(); }
      else if (Date.now() - downAt > 400) closeWheel(); // held without choosing
      hot = null;
    });
  }
  wheel.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { emit({ t: 'react', e: b.dataset.e }); closeWheel(); } });
  document.addEventListener('pointerdown', (e) => {
    if (wheel.classList.contains('open') && !wheel.contains(e.target) && !e.target.closest('[data-chat-emote]')) closeWheel();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeWheel(); close(); } });

  /* ---------- the sheet's own controls ---------- */
  sheet.querySelector('.quick').innerHTML = Object.entries(o.stickers).map(([id, [text, bg]]) => `<button type="button" class="stk" data-sticker="${id}" style="--sbg:${bg}">${escapeHtml(text)}</button>`).join('')
    + CHAT_QUICK.map((e) => `<button type="button" class="emo" data-text="${e}">${e}</button>`).join('');
  sheet.querySelector('.quick').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.sticker) emit({ t: 'sticker', id: b.dataset.sticker }); else emit({ t: 'chat', text: b.dataset.text });
  });
  // Let the others see you're typing (at most every few seconds).
  input.addEventListener('input', () => { if (input.value.trim()) emit({ t: 'typing' }); });
  sheet.querySelector('.compose').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim().slice(0, 300);
    if (!text) return;
    input.value = '';
    if (o.routeText && o.routeText(text)) return;
    emit({ t: 'chat', text });
  });
  sheet.querySelector('.chat-close').onclick = close;
  wireMic(sheet.querySelector('[data-chat-mic]'));

  return {
    receive,
    // Put the Message / emoji / mic buttons in a game's own toolbar. `compact` makes Message an icon.
    mountTools(el, { compact = false } = {}) {
      el.insertAdjacentHTML('beforeend', compact
        ? '<button class="icon-btn chat-open" type="button" aria-label="Chat" data-icon="chat" data-chat-open><b class="badge chat-unread" hidden></b></button>'
        : '<button class="say chat-open" type="button" data-icon="chat" data-chat-open><span>Message…</span><b class="badge chat-unread" hidden></b></button>');
      el.insertAdjacentHTML('beforeend', '<button class="icon-btn" type="button" aria-label="React with an emoji" data-icon="smile" data-chat-emote></button><button class="icon-btn mic" type="button" aria-label="Hold to talk" data-icon="mic" data-chat-mic></button>');
      hydrateIcons(el);
      el.querySelector('[data-chat-open]').onclick = () => open(true);
      wireEmote(el.querySelector('[data-chat-emote]'));
      wireMic(el.querySelector('[data-chat-mic]'));
    },
    // Games call this when a game screen shows or hides; the chat only works during a game.
    setInGame(on) {
      inGame = on;
      if (!on) { closeWheel(); close(); }
      dock();
    },
    reset() {
      msgs.innerHTML = '<p class="empty">Say hi. Messages, stickers and voice notes show up here.</p>';
      setUnread(0);
      close();
    },
    sys(text) { addMsg(escapeHtml(text), 'sys'); },
    open,
    react(k, e) { floatEmoji(k, e); },
    // True when a key press is someone typing, so games can skip their shortcuts.
    typing: (e) => e.target instanceof Element && !!e.target.closest('input, textarea'),
  };
}
