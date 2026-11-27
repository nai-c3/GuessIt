'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');

// ---------------------------------------------------------------------------
// Konfiguration
// ---------------------------------------------------------------------------
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
const HOST_KEY = process.env.HOST_KEY || crypto.randomBytes(3).toString('hex');
const QUESTIONS_FILE = process.env.QUESTIONS_FILE || path.join(__dirname, 'questions.json');

// Kein Zeitlimit: Eine Frage bleibt offen, bis alle geantwortet haben oder der Host sie beendet.
// Optional pro Frage "time" (Sekunden) in questions.json setzen.
const MAX_POINTS = 1000;            // Punkte für einen exakten Treffer
const LOG_ZERO_FACTOR = 4;          // Ab Faktor 4 daneben gibt es 0 Grundpunkte
const PLACE_BONUS = [300, 200, 100];// Bonus für die drei nächsten Schätzungen
const MAX_NAME_LEN = 20;

let HIDE_LEADERBOARD_FROM = 0;      // ab dieser Frage (1-basiert) kein Zwischenstand mehr, 0 = immer zeigen
const questions = loadQuestions();

function loadQuestions() {
  const raw = JSON.parse(fs.readFileSync(QUESTIONS_FILE, 'utf8'));
  const list = Array.isArray(raw) ? raw : raw.questions;
  if (!Array.isArray(raw) && raw.hideLeaderboardFrom) HIDE_LEADERBOARD_FROM = Number(raw.hideLeaderboardFrom) || 0;
  if (!Array.isArray(list) || list.length === 0) throw new Error('questions.json enthält keine Fragen');
  return list.map((q, i) => {
    const live = q.live === true || q.answer == null;
    if (typeof q.question !== 'string' || (!live && (typeof q.answer !== 'number' || !isFinite(q.answer)))) {
      throw new Error(`Frage ${i + 1}: "question" (Text) und "answer" (Zahl) sind Pflicht – oder "live": true`);
    }
    if (!live && q.maxDeviation == null && q.answer <= 0) {
      throw new Error(`Frage ${i + 1}: Antwort <= 0 braucht "maxDeviation" (lineare Wertung)`);
    }
    return {
      question: q.question,
      answer: live ? null : q.answer,
      live,
      unit: q.unit || '',
      time: Number(q.time) || 0,
      maxDeviation: q.maxDeviation != null ? Number(q.maxDeviation) : null,
      info: q.info || '',
      format: q.format === 'year' ? 'year' : '',
      image: /^[a-z0-9-]+$/.test(q.image || '') ? q.image : '',
    };
  });
}

// ---------------------------------------------------------------------------
// Spielzustand (im Speicher)
// ---------------------------------------------------------------------------
const game = {
  phase: 'lobby', // lobby | question | awaiting | reveal | leaderboard | final
  liveAnswers: new Map(), // qIndex -> vor Ort ermittelte Antwort
  qIndex: -1,
  deadline: null,
  answers: new Map(),   // playerId -> number (aktuelle Frage)
  results: null,        // Auswertung der aktuellen Frage
  players: new Map(),   // playerId -> { id, name, score, prevScore, prevRank, rank, sockets:Set }
};
let timer = null;

// Frage inkl. live eingetragener Antwort
function currentQ() {
  const q = questions[game.qIndex];
  return game.liveAnswers.has(game.qIndex) ? { ...q, answer: game.liveAnswers.get(game.qIndex) } : q;
}

function basePoints(q, guess) {
  if (q.maxDeviation != null) {
    const dev = Math.abs(guess - q.answer);
    return Math.round(MAX_POINTS * Math.max(0, 1 - dev / q.maxDeviation));
  }
  if (guess <= 0) return 0;
  const err = Math.abs(Math.log(guess / q.answer));
  return Math.round(MAX_POINTS * Math.max(0, 1 - err / Math.log(LOG_ZERO_FACTOR)));
}

function rankPlayers() {
  const list = [...game.players.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  let lastScore = null;
  let lastRank = 0;
  list.forEach((p, i) => {
    if (p.score !== lastScore) { lastRank = i + 1; lastScore = p.score; }
    p.rank = lastRank;
  });
  return list;
}

function evaluate() {
  const q = currentQ();
  const entries = [...game.answers.entries()]
    .filter(([id]) => game.players.has(id))
    .map(([id, guess]) => ({ id, name: game.players.get(id).name, guess, diff: Math.abs(guess - q.answer) }))
    .sort((a, b) => a.diff - b.diff);

  // Rangfolge der Schätzungen (gleicher Abstand = gleicher Platz)
  let lastDiff = null;
  let place = 0;
  entries.forEach((e, i) => {
    if (e.diff !== lastDiff) { place = i + 1; lastDiff = e.diff; }
    e.place = place;
    e.points = basePoints(q, e.guess) + (PLACE_BONUS[place - 1] || 0);
  });

  // Vorherigen Stand merken, dann Punkte gutschreiben
  rankPlayers();
  for (const p of game.players.values()) {
    p.prevScore = p.score;
    p.prevRank = p.rank;
    p.lastPoints = 0;
    p.lastGuess = null;
    p.lastPlace = null;
  }
  for (const e of entries) {
    const p = game.players.get(e.id);
    p.score += e.points;
    p.lastPoints = e.points;
    p.lastGuess = e.guess;
    p.lastPlace = e.place;
  }
  rankPlayers();

  game.results = {
    answer: q.answer,
    count: entries.length,
    entries: entries.map(({ id, name, guess, place, points }) => ({ id, name, guess, place, points })),
  };
}

function clearTimer() {
  if (timer) { clearTimeout(timer); timer = null; }
}

function startQuestion(index) {
  clearTimer();
  game.qIndex = index;
  game.phase = 'question';
  game.answers = new Map();
  game.results = null;
  const q = questions[index];
  if (q.time > 0) {
    game.deadline = Date.now() + q.time * 1000;
    timer = setTimeout(closeQuestion, q.time * 1000 + 300);
  } else {
    game.deadline = null;
  }
}

function closeQuestion() {
  if (game.phase !== 'question') return;
  clearTimer();
  game.deadline = null;
  if (currentQ().answer == null) {
    game.phase = 'awaiting'; // Live-Frage: Host trägt die Antwort ein
  } else {
    evaluate();
    game.phase = 'reveal';
  }
  broadcast();
}

// Live-Antwort setzen (oder im Reveal korrigieren -> Punkte neu berechnen)
function setLiveAnswer(value) {
  const q = questions[game.qIndex];
  if (!q || !q.live) return 'Diese Frage ist keine Live-Frage.';
  if (!isFinite(value)) return 'Bitte eine gültige Zahl eingeben.';
  if (q.maxDeviation == null && value <= 0) return 'Die Antwort muss größer als 0 sein (oder "maxDeviation" setzen).';
  if (game.phase === 'reveal') {
    for (const p of game.players.values()) p.score = p.prevScore; // Auswertung zurückdrehen
  } else if (game.phase !== 'awaiting') {
    return 'Gerade nicht möglich.';
  }
  game.liveAnswers.set(game.qIndex, value);
  evaluate();
  game.phase = 'reveal';
  broadcast();
  return null;
}

function next() {
  switch (game.phase) {
    case 'lobby':
      startQuestion(0);
      break;
    case 'question':
      closeQuestion();
      return;
    case 'awaiting':
      return; // erst Antwort eintragen
    case 'reveal':
      if (game.qIndex >= questions.length - 1) game.phase = 'final';
      else if (leaderboardHiddenAfter(game.qIndex)) { startQuestion(game.qIndex + 1); break; }
      else game.phase = 'leaderboard';
      break;
    case 'leaderboard':
      startQuestion(game.qIndex + 1);
      break;
    case 'final':
      return;
  }
  broadcast();
}

// Nach dieser Frage (0-basiert) keinen Zwischenstand zeigen?
function leaderboardHiddenAfter(qIndex) {
  return HIDE_LEADERBOARD_FROM > 0 && qIndex + 1 >= HIDE_LEADERBOARD_FROM;
}

function resetGame(keepPlayers) {
  clearTimer();
  game.phase = 'lobby';
  game.qIndex = -1;
  game.deadline = null;
  game.answers = new Map();
  game.results = null;
  game.liveAnswers = new Map();
  if (!keepPlayers) {
    for (const p of game.players.values()) for (const sid of p.sockets) io.sockets.sockets.get(sid)?.emit('kicked');
    game.players.clear();
  } else {
    for (const p of game.players.values()) Object.assign(p, { score: 0, prevScore: 0, prevRank: 0, rank: 0, lastPoints: 0, lastGuess: null, lastPlace: null });
  }
  broadcast();
}

// ---------------------------------------------------------------------------
// Zustände für Host & Spieler
// ---------------------------------------------------------------------------
function questionPublic(withAnswer) {
  if (game.qIndex < 0) return null;
  const q = currentQ();
  return {
    question: q.question,
    live: q.live,
    unit: q.unit,
    time: q.time,
    format: q.format,
    image: q.image,
    info: withAnswer ? q.info : '',
    answer: withAnswer ? q.answer : undefined,
  };
}

function hostState() {
  const ranked = rankPlayers();
  const showAnswer = !['lobby', 'question', 'awaiting'].includes(game.phase);
  return {
    phase: game.phase,
    qIndex: game.qIndex,
    total: questions.length,
    deadline: game.deadline,
    hideLeaderboardFrom: HIDE_LEADERBOARD_FROM,
    now: Date.now(),
    question: questionPublic(showAnswer),
    answeredCount: game.answers.size,
    connectedCount: [...game.players.values()].filter((p) => p.sockets.size > 0).length,
    results: showAnswer ? game.results : null,
    players: ranked.map((p) => ({
      id: p.id, name: p.name, score: p.score, rank: p.rank,
      prevScore: p.prevScore, prevRank: p.prevRank,
      lastPoints: p.lastPoints, online: p.sockets.size > 0,
      answered: game.answers.has(p.id),
    })),
  };
}

function playerState(p) {
  const showAnswer = !['lobby', 'question', 'awaiting'].includes(game.phase);
  return {
    phase: game.phase,
    qIndex: game.qIndex,
    total: questions.length,
    deadline: game.deadline,
    hideLeaderboardFrom: HIDE_LEADERBOARD_FROM,
    now: Date.now(),
    question: questionPublic(showAnswer),
    me: {
      id: p.id, name: p.name, score: p.score, rank: p.rank, prevRank: p.prevRank,
      lastPoints: p.lastPoints, lastGuess: p.lastGuess, lastPlace: p.lastPlace,
      answer: game.answers.has(p.id) ? game.answers.get(p.id) : null,
    },
    playerCount: game.players.size,
  };
}

let broadcastQueued = false;
function broadcast() {
  // Mehrere Änderungen im selben Tick zusammenfassen
  if (broadcastQueued) return;
  broadcastQueued = true;
  setImmediate(() => {
    broadcastQueued = false;
    rankPlayers();
    io.to('hosts').emit('state', hostState());
    for (const p of game.players.values()) {
      const s = playerState(p);
      for (const sid of p.sockets) io.to(sid).emit('state', s);
    }
  });
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
const app = express();
const server = http.createServer(app);
const io = new Server(server, { pingInterval: 10000, pingTimeout: 8000 });

app.set('trust proxy', true);
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

function lanAddress() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces || []) {
      if (i.family === 'IPv4' && !i.internal) return i.address;
    }
  }
  return 'localhost';
}

function joinUrl(req) {
  if (PUBLIC_URL) return PUBLIC_URL + '/';
  const host = req.get('host') || '';
  if (host && !/^(localhost|127\.|\[::1\])/.test(host)) return `${req.protocol}://${host}/`;
  return `http://${lanAddress()}:${PORT}/`;
}

app.get('/api/info', (req, res) => {
  res.json({ joinUrl: joinUrl(req), total: questions.length });
});

app.get('/qr.svg', async (req, res) => {
  const svg = await QRCode.toString(joinUrl(req), {
    type: 'svg', margin: 1, errorCorrectionLevel: 'M',
    color: { dark: '#0b1530', light: '#ffffff' },
  });
  res.type('image/svg+xml').send(svg);
});

// ---------------------------------------------------------------------------
// Socket.io
// ---------------------------------------------------------------------------
function cleanName(name) {
  return String(name || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LEN);
}

function uniqueName(name, exceptId) {
  const taken = new Set([...game.players.values()].filter((p) => p.id !== exceptId).map((p) => p.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let n = 2; ; n++) {
    const candidate = `${name.slice(0, MAX_NAME_LEN - String(n).length - 1)} ${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

io.on('connection', (socket) => {
  let player = null;

  // ---- Host --------------------------------------------------------------
  socket.on('host:auth', (key, ack) => {
    if (key !== HOST_KEY) return ack?.({ ok: false });
    socket.data.isHost = true;
    socket.join('hosts');
    ack?.({ ok: true });
    socket.emit('state', hostState());
  });

  const hostOnly = (fn) => (...args) => { if (socket.data.isHost) fn(...args); };
  socket.on('host:next', hostOnly(() => next()));
  socket.on('host:reset', hostOnly((keepPlayers) => resetGame(!!keepPlayers)));
  socket.on('host:kick', hostOnly((id) => {
    const p = game.players.get(id);
    if (!p) return;
    for (const sid of p.sockets) io.to(sid).emit('kicked');
    game.players.delete(id);
    game.answers.delete(id);
    broadcast();
  }));
  socket.on('host:setAnswer', (value, ack) => {
    if (!socket.data.isHost) return ack?.({ ok: false });
    const err = setLiveAnswer(Number(value));
    ack?.(err ? { ok: false, error: err } : { ok: true });
  });
  socket.on('host:addTime', hostOnly((sec) => {
    if (game.phase !== 'question' || !game.deadline) return;
    clearTimer();
    game.deadline += (Number(sec) || 15) * 1000;
    timer = setTimeout(closeQuestion, Math.max(0, game.deadline - Date.now()) + 300);
    broadcast();
  }));

  // ---- Spieler -----------------------------------------------------------
  socket.on('player:resume', (id, ack) => {
    const p = game.players.get(id);
    if (!p) return ack?.({ ok: false });
    player = p;
    p.sockets.add(socket.id);
    ack?.({ ok: true, name: p.name });
    broadcast();
  });

  socket.on('player:join', (rawName, ack) => {
    const name = cleanName(rawName);
    if (name.length < 1) return ack?.({ ok: false, error: 'Bitte gib deinen Namen ein.' });
    if (player) player.sockets.delete(socket.id);
    const id = crypto.randomUUID();
    player = {
      id, name: uniqueName(name), score: 0, prevScore: 0, prevRank: 0, rank: 0,
      lastPoints: 0, lastGuess: null, lastPlace: null, sockets: new Set([socket.id]),
    };
    game.players.set(id, player);
    ack?.({ ok: true, id, name: player.name });
    broadcast();
  });

  socket.on('player:answer', (value, ack) => {
    if (!player || !game.players.has(player.id)) return ack?.({ ok: false, error: 'Nicht angemeldet.' });
    if (game.phase !== 'question') return ack?.({ ok: false, error: 'Die Frage ist schon geschlossen.' });
    const num = Number(value);
    if (!isFinite(num) || Math.abs(num) > 1e15) return ack?.({ ok: false, error: 'Bitte eine gültige Zahl eingeben.' });
    game.answers.set(player.id, num);
    ack?.({ ok: true });

    // Alle verbundenen Spieler haben geantwortet -> Frage automatisch schließen
    const online = [...game.players.values()].filter((p) => p.sockets.size > 0);
    if (online.length > 0 && online.every((p) => game.answers.has(p.id))) {
      const q = game.qIndex;
      setTimeout(() => { if (game.qIndex === q) closeQuestion(); }, 1200);
    }
    broadcast();
  });

  socket.on('disconnect', () => {
    if (player) {
      player.sockets.delete(socket.id);
      broadcast();
    }
  });
});

server.listen(PORT, () => {
  const base = PUBLIC_URL || `http://${lanAddress()}:${PORT}`;
  console.log('\n  🎄 GUESS IT läuft\n');
  console.log(`  Spieler:   ${base}/`);
  console.log(`  Host:      ${base}/host?key=${HOST_KEY}`);
  console.log(`  Fragen:    ${questions.length}\n`);
});
