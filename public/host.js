/* GUESS IT – Leinwand / Moderation */
(function () {
  'use strict';
  const { fmt, fmtUnit, fmtFor, fmtQ, parseNumber, el, sleep, countUp, confetti, sound, blobLogo, deco, printify } = window.GI;

  const $ = (id) => document.getElementById(id);
  const stage = $('stage');
  const segments = $('segments');
  const count = $('count');
  const dock = $('dock');
  const nextBtn = $('next');
  const addTimeBtn = $('addTime');
  const menu = $('menu');
  const spotlight = $('spotlight');

  const socket = io({ transports: ['websocket', 'polling'] });
  const params = new URLSearchParams(location.search);
  let hostKey = params.get('key') || sessionStorageGet('guessit:hostKey') || '';
  let state = null;
  let renderedKey = null;
  let clockOffset = 0;
  let sceneRun = 0;          // erhöht sich bei jedem Szenenwechsel -> laufende Animationen brechen ab
  let timerRaf = null;
  let lastTickSecond = null;
  let joinUrl = '';

  function sessionStorageGet(k) { try { return sessionStorage.getItem(k); } catch { return null; } }
  function sessionStorageSet(k, v) { try { sessionStorage.setItem(k, v); } catch { /* egal */ } }

  fetch('/api/info').then((r) => r.json()).then((info) => { joinUrl = info.joinUrl; const u = $('joinUrl'); if (u) u.textContent = prettyUrl(joinUrl); });
  const prettyUrl = (u) => u.replace(/^https?:\/\//, '').replace(/\/$/, '');

  // -------------------------------------------------------------------------
  // Verbindung & Auth
  // -------------------------------------------------------------------------
  function auth() {
    socket.emit('host:auth', hostKey, (res) => {
      if (res.ok) {
        sessionStorageSet('guessit:hostKey', hostKey);
        $('auth').classList.add('hidden');
        dock.classList.remove('hidden');
      } else {
        $('auth').classList.remove('hidden');
        $('authErr').textContent = hostKey ? 'Falscher Schlüssel.' : '';
        setTimeout(() => $('authKey').focus(), 100);
      }
    });
  }
  socket.on('connect', auth);
  $('authForm').addEventListener('submit', (e) => { e.preventDefault(); hostKey = $('authKey').value.trim(); auth(); });

  socket.on('state', (s) => {
    clockOffset = s.now - Date.now();
    state = s;
    render();
  });

  // -------------------------------------------------------------------------
  // Steuerung
  // -------------------------------------------------------------------------
  function next() { sound.unlock(); socket.emit('host:next'); }
  nextBtn.addEventListener('click', next);
  addTimeBtn.addEventListener('click', () => socket.emit('host:addTime', 15));
  $('menuBtn').addEventListener('click', (e) => { e.stopPropagation(); menu.classList.toggle('hidden'); });
  document.addEventListener('click', (e) => { if (!menu.contains(e.target)) menu.classList.add('hidden'); });
  menu.addEventListener('click', (e) => { if (e.target.closest('button')) menu.classList.add('hidden'); });
  $('mFullscreen').addEventListener('click', toggleFullscreen);
  $('mSound').addEventListener('click', toggleSound);
  $('mFix').addEventListener('click', () => {
    menu.classList.add('hidden');
    const v = prompt('Korrigierte Antwort eingeben – Punkte dieser Frage werden neu berechnet:');
    if (v == null) return;
    const n = parseNumber(v);
    if (n == null) return alert('Bitte eine Zahl eingeben.');
    socket.emit('host:setAnswer', n, (res) => { if (!res.ok) alert(res.error); else { renderedKey = null; } });
  });
  $('mReplay').addEventListener('click', () => { renderedKey = null; render(); });
  $('mRestart').addEventListener('click', () => { if (confirm('Neues Spiel starten? Alle Punkte werden auf 0 gesetzt, Spieler bleiben angemeldet.')) socket.emit('host:reset', true); });
  $('mReset').addEventListener('click', () => { if (confirm('Wirklich alles zurücksetzen? Alle Spieler werden abgemeldet.')) socket.emit('host:reset', false); });

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
  }
  function toggleSound() {
    sound.enabled = !sound.enabled;
    $('mSound').textContent = sound.enabled ? 'Ton aus (M)' : 'Ton an (M)';
  }
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === ' ' || e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); next(); }
    else if (e.key === 'f' || e.key === 'F') toggleFullscreen();
    else if (e.key === 'm' || e.key === 'M') toggleSound();
  });
  document.addEventListener('pointerdown', () => sound.unlock(), { once: true });

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------
  function render() {
    if (!state) return;
    const { phase, qIndex, total } = state;

    // Kopfzeile
    const online = state.players.filter((p) => p.online).length;
    count.innerHTML = `<b>${online}</b> ${online === 1 ? 'Spieler' : 'Spieler'} online`;
    renderSegments(phase, qIndex, total);

    // Steuerung
    const labels = {
      lobby: '▶ Spiel starten',
      question: 'Frage beenden',
      awaiting: '',
      reveal: qIndex >= total - 1 ? 'Zum Finale' : (state.hideLeaderboardFrom && qIndex + 1 >= state.hideLeaderboardFrom ? `Frage ${qIndex + 2} ▶` : 'Zwischenstand'),
      leaderboard: `Frage ${qIndex + 2} ▶`,
      final: '',
    };
    nextBtn.textContent = labels[phase];
    nextBtn.classList.toggle('hidden', phase === 'final' || phase === 'awaiting');
    nextBtn.disabled = phase === 'lobby' && state.players.length === 0;
    addTimeBtn.classList.toggle('hidden', phase !== 'question' || !state.deadline);
    $('mReplay').classList.toggle('hidden', phase !== 'final');
    $('mFix').classList.toggle('hidden', !(phase === 'reveal' && state.question && state.question.live));

    const key = `${phase}:${qIndex}:${phase === 'reveal' && state.question ? state.question.answer : ''}`;
    if (key === renderedKey) {
      if (phase === 'lobby') updateLobby();
      if (phase === 'question') updateQuestion();
      return;
    }
    renderedKey = key;
    sceneRun++;
    cancelAnimationFrame(timerRaf);
    spotlight.className = 'spotlight';

    if (phase === 'lobby') renderLobby();
    else if (phase === 'question') renderQuestion();
    else if (phase === 'awaiting') renderAwaiting();
    else if (phase === 'reveal') renderReveal();
    else if (phase === 'leaderboard') renderLeaderboard();
    else if (phase === 'final') renderFinal();
  }

  function setScene(cls, nodes) {
    stage.replaceChildren();
    const scene = el('div', 'scene ' + cls);
    nodes.forEach((n) => n && scene.appendChild(n));
    stage.appendChild(scene);
    return scene;
  }

  function renderSegments(phase, qIndex, total) {
    const show = phase !== 'lobby';
    segments.classList.toggle('hidden', !show);
    if (!show) return;
    if (segments.childElementCount !== total + 1) {
      segments.replaceChildren(el('span', 'seg-label'));
      for (let i = 0; i < total; i++) segments.appendChild(el('div', 'seg'));
    }
    const label = segments.firstChild;
    label.textContent = phase === 'final' ? 'Finale' : `Frage ${qIndex + 1} / ${total}`;
    [...segments.querySelectorAll('.seg')].forEach((s, i) => {
      const open = phase === 'question' || phase === 'awaiting';
      const done = phase === 'final' || i < qIndex || (i === qIndex && !open);
      s.classList.toggle('done', done);
      s.classList.toggle('current', i === qIndex && open);
    });
  }

  // ---- Lobby --------------------------------------------------------------
  let chipMap = new Map();
  function renderLobby() {
    chipMap = new Map();
    const left = el('div');
    left.style.position = 'relative';
    const logo = el('div', 'logo big-logo');
    logo.appendChild(blobLogo());
    const sub = el('div', 'sub', 'Das Schätzspiel der C3 Xmas Party');
    const date = el('div', 'date-line', '02.12.2026');
    const url = el('div', 'url', joinUrl ? prettyUrl(joinUrl) : '');
    url.id = 'joinUrl';
    left.append(deco('jar'), logo, sub, date, url);

    const qrCol = el('div', 'qr-col');
    const qr = el('div', 'qr-card');
    const img = el('img');
    img.src = '/qr.svg?t=' + Date.now();
    img.alt = 'QR-Code zum Mitspielen';
    qr.appendChild(img);
    qrCol.append(deco('hand'), qr, el('div', 'hint', 'Scannen & mitspielen'));

    const top = el('div', 'lobby');
    top.append(left, qrCol);
    const chips = el('div', 'chips');
    chips.id = 'chips';
    const wrap = el('div', 'lobby-wrap');
    wrap.append(top, chips);
    setScene('', [wrap]);
    updateLobby();
  }
  function updateLobby() {
    const chips = $('chips');
    if (!chips) return;
    const ids = new Set(state.players.map((p) => p.id));
    for (const [id, chip] of chipMap) if (!ids.has(id)) { chip.remove(); chipMap.delete(id); }
    // Neueste zuerst anzeigen, damit sie bei vielen Spielern sichtbar bleiben
    for (const p of state.players) {
      let chip = chipMap.get(p.id);
      if (!chip) {
        chip = el('div', 'chip', p.name);
        chip.title = 'Klicken zum Entfernen';
        chip.addEventListener('click', () => { if (confirm(`„${p.name}“ entfernen?`)) socket.emit('host:kick', p.id); });
        chips.prepend(chip);
        chipMap.set(p.id, chip);
        if (chipMap.size > 1) sound.pop();
      }
      chip.classList.toggle('offline', !p.online);
    }
    // Nicht alle Namen passen auf die Leinwand: ältere ausblenden und zählen
    const MAX_CHIPS = 40;
    let more = chips.querySelector('.chip.more');
    const named = [...chips.querySelectorAll('.chip:not(.more)')];
    named.forEach((c, i) => c.classList.toggle('hidden', i >= MAX_CHIPS));
    const hiddenCount = Math.max(0, named.length - MAX_CHIPS);
    if (hiddenCount > 0) {
      if (!more) { more = el('div', 'chip more'); chips.appendChild(more); }
      more.textContent = `+${hiddenCount} weitere`;
      chips.appendChild(more);
    } else if (more) more.remove();
  }

  // ---- Frage --------------------------------------------------------------
  function renderQuestion() {
    const q = state.question;
    const head = el('div');
    head.append(el('div', 'h-kicker', `Frage ${state.qIndex + 1} von ${state.total}`));
    const center = el('div', 'q-center');
    center.append(el('div', 'h-title', q.question));
    if (q.unit) center.append(el('div', 'unit', `Antwort in ${q.unit}`));

    const bottom = el('div', 'q-bottom');
    const answered = el('div', 'answered');
    answered.innerHTML = `<div class="big" id="ansCount">0</div><div class="lbl" id="ansLbl">Antworten</div><div class="answered-bar"><div id="ansBar" style="width:0%"></div></div>`;
    if (state.deadline) {
      // Countdown nur, wenn die Frage ein Zeitlimit hat
      const ring = el('div', 'ring');
      ring.innerHTML = `<svg viewBox="0 0 100 100"><circle class="bg" cx="50" cy="50" r="44"/><circle class="fg" cx="50" cy="50" r="44" stroke-dasharray="276.46" stroke-dashoffset="0"/></svg><div class="num">${q.time}</div>`;
      bottom.append(ring);
    }
    bottom.append(answered);
    setScene('question-scene', [deco(q.image || 'stopwatch', 'watch'), head, center, bottom]);
    sound.whoosh();

    lastTickSecond = null;
    updateQuestion();
  }
  function updateQuestion() {
    const online = Math.max(1, state.connectedCount);
    const c = $('ansCount');
    if (!c) return;
    c.textContent = `${state.answeredCount} / ${state.connectedCount}`;
    $('ansBar').style.width = `${Math.min(100, (state.answeredCount / online) * 100)}%`;
    // Timer neu starten, falls Zeit verlängert wurde
    cancelAnimationFrame(timerRaf);
    const ring = stage.querySelector('.ring');
    if (ring && state.deadline) {
      const fg = ring.querySelector('.fg');
      const num = ring.querySelector('.num');
      const totalMs = Math.max(state.question.time * 1000, state.deadline - (Date.now() + clockOffset));
      const frame = () => {
        if (state.phase !== 'question') return;
        const left = Math.max(0, state.deadline - (Date.now() + clockOffset));
        fg.setAttribute('stroke-dashoffset', String(276.46 * (1 - Math.min(1, left / totalMs))));
        const sec = Math.ceil(left / 1000);
        num.textContent = sec;
        ring.classList.toggle('urgent', left <= 5000);
        if (left <= 5000 && sec !== lastTickSecond && sec > 0) { lastTickSecond = sec; sound.tick(); }
        if (left > 0) timerRaf = requestAnimationFrame(frame);
      };
      timerRaf = requestAnimationFrame(frame);
    }
  }

  // ---- Live-Frage: Antwort wird vor Ort ermittelt -----------------------
  function renderAwaiting() {
    const q = state.question;
    const head = el('div');
    head.append(el('div', 'h-kicker', `Frage ${state.qIndex + 1} · Live-Auflösung`));
    const center = el('div', 'q-center');
    center.append(el('div', 'h-title', q.question));
    const sub = el('div', 'unit', `${state.answeredCount} Schätzungen abgegeben – jetzt wird's live ermittelt`);
    center.append(sub);

    const form = el('form', 'live-form');
    const input = el('input', 'input big');
    Object.assign(input, { type: 'text', inputMode: 'decimal', autocomplete: 'off', placeholder: 'Ergebnis' });
    const unit = el('span', 'live-unit', q.unit || '');
    const btn = el('button', 'btn', 'Auflösen ▶');
    btn.type = 'submit';
    const err = el('div', 'error', '');
    const row = el('div', 'live-row');
    row.append(input, unit, btn);
    form.append(el('div', 'live-label', 'Richtige Antwort eintragen'), row, err);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      sound.unlock();
      const n = parseNumber(input.value);
      if (n == null) { err.textContent = 'Bitte eine Zahl eingeben.'; return; }
      btn.disabled = true;
      socket.emit('host:setAnswer', n, (res) => {
        btn.disabled = false;
        if (!res.ok) err.textContent = res.error;
      });
    });
    setScene('question-scene', [deco(q.image || 'stopwatch', 'watch'), head, center, form]);
  }

  // ---- Auflösung ----------------------------------------------------------
  async function renderReveal() {
    const run = sceneRun;
    const q = state.question;
    const res = state.results || { entries: [], answer: q.answer };
    const qSmall = el('div', 'q-small', q.question);
    const big = el('div', 'answer-big');
    const val = printify(el('div', 'val', '0'));
    big.append(el('div', 'h-kicker', 'Die richtige Antwort'), val, el('div', 'unit', q.unit || ''));
    const info = q.info ? el('div', 'info', q.info) : null;
    if (info) { info.style.opacity = '0'; big.append(info); }

    const bottom = el('div', 'reveal-bottom');
    const line = el('div', 'numline');
    const closest = el('div', 'closest');
    bottom.append(line, closest);
    setScene('reveal-scene', [deco(q.image || 'tape', 'tape'), qSmall, big, bottom]);

    sound.drumroll(1.6);
    await countUp(val, 0, q.answer, 1800, fmtFor(q));
    if (run !== sceneRun) return;
    sound.gong();
    if (info) { info.style.transition = 'opacity .6s'; info.style.opacity = '0.85'; }
    await sleep(500);
    if (run !== sceneRun) return;

    if (res.entries.length === 0) {
      bottom.replaceChildren(el('div', 'nobody', 'Niemand hat geschätzt'));
      bottom.style.gridTemplateColumns = '1fr';
      return;
    }
    drawNumberLine(line, res, q);
    await sleep(Math.min(1500, res.entries.length * 40) + 600);
    if (run !== sceneRun) return;

    res.entries.filter((e) => e.place <= 3).slice(0, 5).forEach((e, i) => {
      const row = el('div', 'row');
      row.style.animationDelay = `${i * 0.35}s`;
      const mid = el('div');
      mid.style.minWidth = '0';
      mid.append(el('div', 'name', e.name), el('div', 'guess', `Schätzung: ${fmtQ(e.guess, q)}`));
      row.append(el('div', `place m${e.place}`, String(e.place)), mid, el('div', 'pts', `+${fmt(e.points)}`));
      closest.appendChild(row);
      setTimeout(() => { if (run === sceneRun) sound.pop(); }, i * 350);
    });
  }

  function drawNumberLine(line, res, q) {
    const guesses = res.entries.map((e) => e.guess).sort((a, b) => a - b);
    const quant = (p) => guesses[Math.min(guesses.length - 1, Math.max(0, Math.round(p * (guesses.length - 1))))];
    let lo = Math.min(q.answer, quant(0.1));
    let hi = Math.max(q.answer, quant(0.9));
    if (hi - lo < 1e-9) { const d = Math.abs(q.answer) * 0.5 || 1; lo -= d; hi += d; }
    const pad = (hi - lo) * 0.08;
    lo -= pad; hi += pad;
    const f = fmtFor(q);
    const pos = (v) => Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100));

    line.appendChild(el('div', 'axis'));
    const tickLo = el('div', 'tick', f(round2(lo))); tickLo.style.left = '0%'; tickLo.style.transform = 'none';
    const tickHi = el('div', 'tick', f(round2(hi))); tickHi.style.left = 'auto'; tickHi.style.right = '0'; tickHi.style.transform = 'none';
    line.append(tickLo, tickHi);

    const target = el('div', 'target');
    target.style.left = pos(q.answer) + '%';
    target.appendChild(el('span', null, f(q.answer)));
    line.appendChild(target);

    // Mehrfach gleiche Positionen leicht vertikal versetzen
    const buckets = new Map();
    res.entries.forEach((e, i) => {
      const p = pos(e.guess);
      const b = Math.round(p * 1.5);
      const n = buckets.get(b) || 0;
      buckets.set(b, n + 1);
      const dot = el('div', 'dot' + (e.place <= 3 ? ' top' : ''));
      dot.style.left = p + '%';
      dot.style.top = `calc(var(--axis) - ${Math.min(n, 8) * 1.4}vh)`;
      dot.style.animationDelay = `${Math.min(1.5, i * 0.04)}s`;
      dot.title = `${e.name}: ${f(e.guess)}`;
      line.appendChild(dot);
      // Name klein und schräg über dem Punkt
      const label = el('div', 'dot-label' + (e.place <= 3 ? ' top' : ''), e.name);
      label.style.left = p + '%';
      label.style.top = `calc(var(--axis) - ${Math.min(n, 8) * 1.4 + 1.4}vh)`;
      label.style.animationDelay = `${Math.min(1.5, i * 0.04) + 0.2}s`;
      line.appendChild(label);
    });
  }
  const round2 = (v) => (Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 100) / 100);

  // ---- Zwischenstand ------------------------------------------------------
  async function renderLeaderboard() {
    const run = sceneRun;
    const players = state.players;
    const title = el('div');
    const lastBoard = state.hideLeaderboardFrom && state.qIndex + 2 === state.hideLeaderboardFrom;
    title.append(el('div', 'h-kicker', lastBoard ? `Letzter Zwischenstand – ab jetzt bleibt es geheim!` : `Nach Frage ${state.qIndex + 1} von ${state.total}`), printify(el('div', 'h-title', 'Zwischenstand')));
    title.style.textAlign = 'center';
    const list = el('div', 'lb-list');
    const scene = setScene('lb-scene', [deco('tree'), title, list]);

    const N = Math.min(10, players.length);
    if (N === 0) return;
    await sleep(30);
    const avail = scene.clientHeight - title.offsetHeight - parseFloat(getComputedStyle(scene).rowGap || 0) - 10;
    const rowH = Math.min(avail / N, window.innerHeight * 0.095);
    list.style.height = `${rowH * N}px`;

    const prevOrder = [...players].sort((a, b) => b.prevScore - a.prevScore || a.name.localeCompare(b.name));
    const prevIdx = new Map(prevOrder.map((p, i) => [p.id, i]));
    const top = players.slice(0, N);
    const showMoves = state.qIndex > 0;

    const rows = top.map((p, newIdx) => {
      const row = el('div', 'lb-row');
      row.style.height = `${rowH - Math.max(6, rowH * 0.12)}px`;
      const rank = el('div', 'rank', String(prevIdx.get(p.id) + 1));
      const name = el('div', 'name', p.name);
      const plus = el('div', 'plus', `+${fmt(p.lastPoints)}`);
      const score = el('div', 'score', fmt(p.prevScore));
      const delta = (prevIdx.get(p.id) + 1) - p.rank;
      const mv = el('div', 'mv ' + (delta > 0 ? 'up' : delta < 0 ? 'down' : ''), !showMoves || delta === 0 ? '' : delta > 0 ? '▲' : '▼');
      row.append(rank, name, plus, score, mv);
      const start = prevIdx.get(p.id);
      const startPos = start < N ? start : N + 0.5;
      row.style.transform = `translateY(${startPos * rowH}px)`;
      if (start >= N) row.style.opacity = '0';
      list.appendChild(row);
      return { p, row, rank, plus, score, mv, newIdx };
    });

    await sleep(900);
    if (run !== sceneRun) return;
    rows.forEach(({ p, plus }, i) => setTimeout(() => { if (p.lastPoints > 0) plus.classList.add('show'); }, i * 60));
    sound.pop();
    await sleep(1100);
    if (run !== sceneRun) return;

    sound.whoosh();
    rows.forEach(({ p, row, rank, score, mv, newIdx }) => {
      row.style.transform = `translateY(${newIdx * rowH}px)`;
      row.style.opacity = '1';
      countUp(score, p.prevScore, p.score, 1100);
      setTimeout(() => {
        rank.textContent = p.rank;
        row.classList.add(`r${p.rank}`);
        mv.classList.add('show');
      }, 900);
    });
  }

  // ---- Finale -------------------------------------------------------------
  async function renderFinal() {
    const run = sceneRun;
    const alive = () => run === sceneRun;
    const players = state.players;
    const top3 = players.slice(0, 3);
    const rest = players.slice(3, 10).reverse(); // Platz 10 … 4

    const titleWrap = el('div', 'final-title');
    const titleTxt = el('div', 'txt');
    titleTxt.append(el('div', 'h-kicker', 'Nach ' + state.total + ' Fragen'), printify(el('div', 'h-title', 'Das Finale')));
    titleWrap.appendChild(titleTxt);

    const restList = el('div', 'rest-list');
    const podium = el('div', 'podium');
    const pods = {};
    [2, 1, 3].forEach((place) => {
      const p = top3[place - 1];
      const pod = el('div', `pod p${place}`);
      const who = el('div', 'who');
      who.append(
        el('div', 'nm', p ? p.name : '—'),
        el('div', 'pt', p ? `${fmt(p.score)} Punkte` : ''),
      );
      const block = el('div', 'block');
      block.append(el('span', 'n', p ? String(p.rank) : String(place)), el('span', 'qm', '?'));
      pod.append(who, block);
      if (!p) pod.style.visibility = 'hidden';
      podium.appendChild(pod);
      pods[place] = pod;
    });
    const trophy = deco('trophy');
    setScene('final-scene', [deco('tree'), trophy, titleWrap, restList, podium]);
    restList.style.opacity = '0';
    podium.style.opacity = '0';
    podium.style.transition = restList.style.transition = 'opacity .8s';

    // 1) Titel
    sound.drumroll(1.2);
    await sleep(100); titleTxt.classList.add('show');
    await sleep(1400); if (!alive()) return;
    sound.crash();
    await sleep(1500); if (!alive()) return;
    titleTxt.classList.remove('show'); titleTxt.classList.add('out');
    await sleep(600); if (!alive()) return;
    titleWrap.remove();
    podium.style.opacity = '1';
    restList.style.opacity = '1';

    // 2) Plätze 10 … 4
    await sleep(600);
    for (const p of rest) {
      const row = el('div', 'rest-row');
      row.append(el('div', 'rank', `${p.rank}.`), el('div', 'name', p.name), el('div', 'score', fmt(p.score)));
      restList.appendChild(row);
      await sleep(30); row.classList.add('show'); sound.pop();
      await sleep(rest.length > 5 ? 750 : 1000); if (!alive()) return;
    }
    await sleep(800); if (!alive()) return;

    // 3) Platz 3 und 2
    for (const [place, roll] of [[3, 2.6], [2, 3.2]]) {
      if (!top3[place - 1]) continue;
      const pod = pods[place];
      pod.classList.add('drum');
      sound.drumroll(roll);
      await sleep(roll * 1000); if (!alive()) return;
      pod.classList.remove('drum');
      pod.classList.add('revealed');
      sound.crash();
      const r = pod.getBoundingClientRect();
      confetti(70, { x: (r.left + r.width / 2) / innerWidth, y: r.top / innerHeight });
      await sleep(1800); if (!alive()) return;
    }

    // 4) Der Sieger
    if (!top3[0]) return;
    const pod1 = pods[1];
    const r1 = pod1.getBoundingClientRect();
    spotlight.classList.add('on', 'sweep');
    pod1.classList.add('drum');
    sound.drumroll(5.5);
    await sleep(5500); if (!alive()) return;
    spotlight.classList.remove('sweep');
    spotlight.style.setProperty('--sx', `${((r1.left + r1.width / 2) / innerWidth) * 100}%`);
    pod1.classList.remove('drum');
    pod1.classList.add('revealed');
    sound.crash();
    sound.fanfare();
    const banner = el('div', 'winner-banner');
    banner.append(el('div', 'h-kicker', 'Gewinner:in von GUESS IT'), printify(el('div', 'h-title', top3[0].name)));
    trophy.classList.add('show');
    stage.querySelector('.final-scene').appendChild(banner);
    requestAnimationFrame(() => banner.classList.add('show'));
    const cx = (r1.left + r1.width / 2) / innerWidth;
    confetti(260, { x: cx, y: 0.35 });
    await sleep(1600);
    spotlight.classList.remove('on');
    for (let i = 0; i < 6 && alive(); i++) {
      confetti(120, { x: 0.15 + Math.random() * 0.7, y: 0.2 + Math.random() * 0.3 });
      await sleep(900);
    }
  }
})();
