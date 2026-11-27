/* GUESS IT – Spieleransicht (Smartphone) */
(function () {
  'use strict';
  const { fmt, fmtFor, fmtQ, parseNumber, el, countUp, confetti, FINAL_DURATION, blobLogo, deco } = window.GI;

  const view = document.getElementById('view');
  const meChip = document.getElementById('meChip');
  const progress = document.getElementById('progress');
  const progressLabel = document.getElementById('progressLabel');
  const progressFill = document.getElementById('progressFill');
  const offline = document.getElementById('offline');

  const store = {
    get() { try { return localStorage.getItem('guessit:id'); } catch { return null; } },
    set(v) { try { localStorage.setItem('guessit:id', v); } catch { /* egal */ } },
    clear() { try { localStorage.removeItem('guessit:id'); } catch { /* egal */ } },
  };

  const socket = io({ transports: ['websocket', 'polling'] });
  let myId = store.get();
  let state = null;
  let renderedKey = null;
  let editing = false;
  let clockOffset = 0;
  let timerRaf = null;
  let finalTimeout = null;

  socket.on('connect', () => {
    offline.classList.add('hidden');
    if (myId) {
      socket.emit('player:resume', myId, (res) => {
        if (!res.ok) { myId = null; store.clear(); showJoin(); }
      });
    } else {
      showJoin();
    }
  });
  socket.on('disconnect', () => offline.classList.remove('hidden'));
  socket.on('kicked', () => { myId = null; store.clear(); state = null; renderedKey = null; showJoin(); });
  socket.on('state', (s) => {
    clockOffset = s.now - Date.now();
    state = s;
    render();
  });

  // -------------------------------------------------------------------------
  function setView(key, nodes) {
    renderedKey = key;
    view.replaceChildren();
    const screen = el('section', 'screen');
    nodes.forEach((n) => n && screen.appendChild(n));
    view.appendChild(screen);
    return screen;
  }

  function showJoin(errorText) {
    document.getElementById('headerLogo').style.visibility = 'hidden'; // großes Logo im Anmeldebildschirm
    meChip.classList.add('hidden');
    progress.classList.add('hidden');
    const logo = el('div', 'logo hero-logo');
    logo.appendChild(blobLogo());
    const tag = el('p', 'tagline wide', 'Das Schätzspiel der C3 Xmas Party');
    tag.style.color = 'var(--red)';

    const form = el('form', 'card');
    const field = el('div', 'field');
    const label = el('label', null, 'Dein Name');
    label.htmlFor = 'name';
    const input = el('input', 'input');
    Object.assign(input, { id: 'name', maxLength: 20, autocomplete: 'nickname', placeholder: 'z. B. Julia', enterKeyHint: 'go' });
    field.append(label, input);
    const err = el('p', 'error', errorText || '');
    const btn = el('button', 'btn block', 'Mitspielen');
    btn.type = 'submit';
    btn.style.marginTop = '16px';
    form.append(field, btn, err);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = input.value.trim();
      if (!name) { err.textContent = 'Bitte gib deinen Namen ein.'; return; }
      btn.disabled = true;
      socket.emit('player:join', name, (res) => {
        btn.disabled = false;
        if (!res.ok) { err.textContent = res.error; return; }
        myId = res.id; store.set(myId);
        renderedKey = null;
      });
    });
    setView('join', [deco('jar'), logo, tag, form]);
    setTimeout(() => input.focus(), 300);
  }

  // -------------------------------------------------------------------------
  function render() {
    if (!state || !myId || !state.me) return;
    const { phase, qIndex, total, me } = state;

    // Ab der „geheimen“ Phase keinen Punktestand mehr zeigen, damit es spannend bleibt
    const secret = state.hideLeaderboardFrom && phase !== 'lobby' && qIndex + 1 >= state.hideLeaderboardFrom;
    meChip.textContent = secret ? me.name : `${me.name} · ${fmt(me.score)} P`;
    meChip.classList.remove('hidden');
    document.getElementById('headerLogo').style.visibility = '';

    const inGame = phase !== 'lobby';
    progress.classList.toggle('hidden', !inGame);
    if (inGame) {
      const done = phase === 'question' || phase === 'awaiting' ? qIndex : qIndex + 1;
      progressLabel.textContent = phase === 'final' ? 'Finale' : `Frage ${qIndex + 1} / ${total}`;
      progressFill.style.width = `${(done / total) * 100}%`;
    }

    if (phase !== 'question') editing = false;
    const answered = me.answer != null && !editing;
    const key = `${phase}:${qIndex}:${phase === 'question' ? (answered ? 'a' : 'q') : ''}:${phase === 'reveal' && state.question ? state.question.answer : ''}`;
    if (key === renderedKey) {
      if (phase === 'lobby') updateLobby();
      return;
    }
    cancelAnimationFrame(timerRaf);
    clearTimeout(finalTimeout);

    if (phase === 'lobby') renderLobby();
    else if (phase === 'question') answered ? renderAnswered() : renderQuestion();
    else if (phase === 'awaiting') renderAwaiting();
    else if (phase === 'reveal') renderReveal();
    else if (phase === 'leaderboard') renderLeaderboard();
    else if (phase === 'final') renderFinal();
    renderedKey = key;
  }

  function renderLobby() {
    const card = el('div', 'card center');
    card.append(
      el('div', 'kicker', 'Du bist dabei'),
      el('div', 'q-text', `Hallo ${state.me.name}!`),
    );
    const dots = el('div', 'wait-dots center');
    dots.innerHTML = '<span></span><span></span><span></span>';
    dots.style.marginTop = '18px';
    const info = el('p', 'tagline', '');
    info.id = 'lobbyInfo';
    const howto = el('div', 'card');
    howto.innerHTML = `
      <div class="kicker" style="margin-bottom:8px">So geht's</div>
      <p class="muted" style="line-height:1.5">Schätze bei jeder Frage eine Zahl. Je näher du dran bist, desto mehr Punkte – die drei besten Schätzungen bekommen einen Bonus. Bis Frage 10 zeigt die Leinwand nach jeder Runde den Zwischenstand – danach bleibt es bis zum Finale geheim.</p>`;
    setView('lobby', [card, dots, info, howto]);
    updateLobby();
  }
  function updateLobby() {
    const info = document.getElementById('lobbyInfo');
    if (info) info.textContent = `${state.playerCount} ${state.playerCount === 1 ? 'Person ist' : 'Personen sind'} dabei – gleich geht's los!`;
  }

  function timerBar() {
    if (!state.deadline) return null; // kein Zeitlimit
    const bar = el('div', 'timer-bar');
    const fill = el('div');
    bar.appendChild(fill);
    const totalMs = state.question.time * 1000;
    const deadline = state.deadline;
    function frame() {
      if (!deadline) return;
      const left = Math.max(0, deadline - (Date.now() + clockOffset));
      fill.style.transform = `scaleX(${left / totalMs})`;
      bar.classList.toggle('urgent', left < 5000);
      if (left > 0) timerRaf = requestAnimationFrame(frame);
    }
    timerRaf = requestAnimationFrame(frame);
    return bar;
  }

  function renderQuestion() {
    const q = state.question;
    const head = el('div');
    head.append(el('div', 'kicker', `Frage ${state.qIndex + 1}`), el('div', 'q-text', q.question));
    head.lastChild.style.marginTop = '8px';

    const form = el('form', 'card');
    const input = el('input', 'input big');
    Object.assign(input, { type: 'text', inputMode: 'decimal', autocomplete: 'off', placeholder: 'Schätzung', enterKeyHint: 'send' });
    if (state.me.answer != null) input.value = String(state.me.answer).replace('.', ',');
    const unit = el('div', 'unit-hint', q.unit ? `in ${q.unit}` : '');
    const preview = el('div', 'preview', '');
    const err = el('p', 'error', '');
    const btn = el('button', 'btn block', 'Abschicken');
    btn.type = 'submit';
    btn.style.marginTop = '14px';
    form.append(input, unit, preview, btn, err);

    input.addEventListener('input', () => {
      const n = parseNumber(input.value);
      preview.textContent = input.value.trim() === '' ? '' : n == null ? 'Bitte nur Zahlen' : `= ${fmtQ(n, q)}`;
      err.textContent = '';
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const n = parseNumber(input.value);
      if (n == null) { err.textContent = 'Bitte eine Zahl eingeben.'; return; }
      btn.disabled = true;
      input.blur();
      socket.emit('player:answer', n, (res) => {
        btn.disabled = false;
        if (!res.ok) { err.textContent = res.error; return; }
        editing = false;
        if (navigator.vibrate) navigator.vibrate(30);
      });
    });

    setView(`q`, [head, timerBar(), form]);
    setTimeout(() => input.focus(), 250);
  }

  function renderAnswered() {
    const q = state.question;
    const head = el('div');
    head.append(el('div', 'kicker', `Frage ${state.qIndex + 1}`), el('div', 'q-text', q.question));
    head.lastChild.style.marginTop = '8px';

    const saved = el('div', 'saved');
    const check = el('div', 'check', '✓');
    const txt = el('div');
    txt.append(el('div', 'lbl', 'Deine Schätzung ist gespeichert'), el('div', 'val', fmtQ(state.me.answer, q)));
    saved.append(check, txt);

    const change = el('button', 'btn ghost block', 'Antwort ändern');
    change.addEventListener('click', () => { editing = true; renderedKey = null; render(); });
    const wait = el('p', 'tagline', 'Warte auf die anderen …');

    setView('a', [head, timerBar(), saved, change, wait]);
  }

  function renderAwaiting() {
    const q = state.question;
    const head = el('div', 'center');
    head.append(el('div', 'kicker', 'Live-Auflösung'), el('div', 'q-text pulse', 'Jetzt wird es vor Ort ermittelt. Schaut nach vorne!'));
    head.lastChild.style.marginTop = '10px';
    const card = el('div', 'card center');
    if (state.me.answer != null) card.append(el('div', 'muted', 'Deine Schätzung'), el('div', 'big-num gold', fmtFor(q)(state.me.answer)), el('div', 'muted', q.unit || ''));
    else card.append(el('div', 'q-text', 'Diesmal keine Schätzung'));
    setView('awaiting', [deco('stopwatch'), head, card]);
  }

  function renderReveal() {
    const q = state.question;
    const me = state.me;
    const head = el('div', 'center');
    head.append(el('div', 'kicker', 'Richtige Antwort'));
    const ans = el('div', 'big-num gold', '0');
    const unit = el('div', 'muted', q.unit || '');
    head.append(ans, unit);
    countUp(ans, 0, q.answer, 1400, fmtFor(q));

    const card = el('div', 'card center');
    if (me.lastGuess == null) {
      card.append(el('div', 'q-text', 'Keine Schätzung abgegeben'), el('p', 'muted', 'Bei der nächsten Frage bist du wieder dabei!'));
    } else {
      const stats = el('div', 'stat-row');
      const s1 = el('div', 'stat'); s1.append(el('div', 'v', fmtFor(q)(me.lastGuess)), el('div', 'l', 'Deine Schätzung'));
      const closest = state.closest || [];
      const iWon = closest.some((c) => c.id === me.id);
      const others = closest.filter((c) => c.id !== me.id).map((c) => c.name);
      const winnerText = iWon ? (others.length ? `Du & ${others.join(' & ')}` : 'Du!') : others.join(' & ') || '–';
      const s2 = el('div', 'stat'); s2.append(el('div', 'v name', winnerText), el('div', 'l', 'Am nächsten dran'));
      stats.append(s1, s2);
      const badge = el('div', 'points-badge', `+${fmt(me.lastPoints)} Punkte`);
      badge.style.marginTop = '16px';
      const myPlace = el('p', 'muted', `Du warst #${me.lastPlace} von ${state.guessCount}`);
      myPlace.style.marginTop = '12px';
      card.append(stats, badge, myPlace);
      if (me.lastPlace === 1) setTimeout(() => confetti(120, { x: 0.5, y: 0.3 }), 1400);
    }
    const info = q.info ? el('p', 'tagline', q.info) : null;
    setView('reveal', [head, card, info]);
  }

  function renderLeaderboard() {
    const me = state.me;
    const head = el('div', 'center');
    head.append(el('div', 'kicker', 'Dein Zwischenstand'));
    const rank = el('div', 'big-num gold', `Platz ${me.rank}`);
    head.append(rank);
    const delta = state.qIndex > 0 && me.prevRank ? me.prevRank - me.rank : 0;
    const move = el('div', `move ${delta > 0 ? 'up' : delta < 0 ? 'down' : 'same'}`,
      delta > 0 ? `▲ ${delta} ${delta === 1 ? 'Platz' : 'Plätze'} nach oben` :
      delta < 0 ? `▼ ${-delta} ${delta === -1 ? 'Platz' : 'Plätze'} nach unten` : '● Platz gehalten');
    move.style.marginTop = '8px';
    head.append(move);
    const card = el('div', 'card center');
    const pts = el('div', 'big-num', fmt(me.score - me.lastPoints));
    countUp(pts, me.score - me.lastPoints, me.score, 1500);
    card.append(pts, el('div', 'muted', `Punkte von ${state.playerCount} Mitspielenden`));
    const left = state.total - state.qIndex - 1;
    const lastBoard = state.hideLeaderboardFrom && state.qIndex + 2 === state.hideLeaderboardFrom;
    const info = el('p', 'tagline', (left === 1 ? 'Noch 1 Frage!' : `Noch ${left} Fragen`) + (lastBoard ? ' Ab jetzt bleibt der Zwischenstand geheim.' : ''));
    setView('lb', [head, card, info]);
  }

  function renderFinal() {
    const me = state.me;
    const logo = el('div', 'center');
    logo.append(el('div', 'kicker', 'Das große Finale'), el('div', 'q-text pulse', 'Alle Augen auf die Leinwand!'));
    const dots = el('div', 'wait-dots center');
    dots.innerHTML = '<span></span><span></span><span></span>';
    const screen = setView('final', [logo, dots]);

    finalTimeout = setTimeout(() => {
      const head = el('div', 'center');
      head.append(el('div', 'kicker', 'Dein Endergebnis'), el('div', 'big-num gold', `Platz ${me.rank}`));
      const card = el('div', 'card center');
      card.append(el('div', 'big-num', fmt(me.score)), el('div', 'muted', 'Punkte'));
      const msg = el('p', 'tagline', me.rank === 1 ? 'Schätz-Champion. Glückwunsch!' : me.rank <= 3 ? 'Aufs Treppchen geschätzt!' : 'Danke fürs Mitspielen und frohe Weihnachten!');
      screen.replaceChildren(deco(me.rank <= 3 ? 'trophy' : 'tree'), head, card, msg);
      if (me.rank <= 3) { confetti(200); setTimeout(() => confetti(150, { x: 0.2, y: 0.4 }), 500); setTimeout(() => confetti(150, { x: 0.8, y: 0.4 }), 900); }
    }, FINAL_DURATION);
  }
})();
