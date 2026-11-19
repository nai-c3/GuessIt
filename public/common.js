/* GUESS IT – gemeinsame Helfer für Host- und Spieleransicht */
(function () {
  'use strict';

  const nf = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 3 });
  const fmt = (n) => (n == null || !isFinite(n) ? '–' : nf.format(n));
  const fmtUnit = (n, unit) => fmt(n) + (unit ? ' ' + unit : '');
  // Formatierer passend zur Frage (Jahreszahlen ohne Tausenderpunkt)
  const fmtFor = (q) => (q && q.format === 'year' ? (n) => (n == null || !isFinite(n) ? '–' : String(Math.round(n))) : fmt);
  const fmtQ = (n, q) => fmtFor(q)(n) + (q && q.unit ? ' ' + q.unit : '');

  // Deutsche Zahleneingabe tolerant parsen: "1.234,5" "1234.5" "384 400" "1,5"
  function parseNumber(str) {
    let s = String(str || '').trim().replace(/[\s'’_]/g, '');
    if (!s) return null;
    const mmss = s.match(/^(\d+):([0-5]?\d)$/);           // 1:20 -> 80 (Minuten:Sekunden)
    if (mmss) return Number(mmss[1]) * 60 + Number(mmss[2]);
    if (s.includes(',')) {
      s = s.replace(/\./g, '').replace(',', '.');           // 1.234,5 -> 1234.5
    } else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) {
      s = s.replace(/\./g, '');                              // 384.400 -> 384400
    }
    if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
    const n = Number(s);
    return isFinite(n) ? n : null;
  }

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  const reducedMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Zahl hochzählen lassen
  function countUp(node, from, to, ms, format = fmt) {
    const start = performance.now();
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    return new Promise((resolve) => {
      function frame(now) {
        const t = Math.min(1, (now - start) / ms);
        const v = from + (to - from) * ease(t);
        const rounded = Number.isInteger(to) && Number.isInteger(from) ? Math.round(v) : v;
        node.textContent = format(t === 1 ? to : rounded);
        if (t < 1) requestAnimationFrame(frame); else resolve();
      }
      requestAnimationFrame(frame);
    });
  }

  // -------------------------------------------------------------------------
  // Schnee im Hintergrund
  // -------------------------------------------------------------------------
  function snow(canvas, density = 1) {
    if (reducedMotion()) return;
    const ctx = canvas.getContext('2d');
    let w, h, flakes = [];
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    function resize() {
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const target = Math.round((w * h) / 9000 * density);
      while (flakes.length < target) flakes.push(make(true));
      flakes.length = Math.min(flakes.length, target);
    }
    function make(anyY) {
      const r = Math.random() * 2.2 + 0.6;
      return { x: Math.random() * w, y: anyY ? Math.random() * h : -5, r, vy: r * 0.35 + 0.2, phase: Math.random() * 6.28, a: Math.random() * 0.5 + 0.25 };
    }
    let last = performance.now();
    function tick(now) {
      const dt = Math.min(50, now - last) / 16.67; last = now;
      ctx.clearRect(0, 0, w, h);
      for (const f of flakes) {
        f.y += f.vy * dt; f.phase += 0.01 * dt;
        f.x += Math.sin(f.phase) * 0.3 * dt;
        if (f.y > h + 5) Object.assign(f, make(false));
        ctx.globalAlpha = f.a;
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 6.283); ctx.fillStyle = '#fff'; ctx.fill();
      }
      requestAnimationFrame(tick);
    }
    window.addEventListener('resize', resize);
    resize(); requestAnimationFrame(tick);
  }

  // -------------------------------------------------------------------------
  // Konfetti
  // -------------------------------------------------------------------------
  let confettiCanvas, confettiCtx, confettiParts = [], confettiRunning = false;
  // Konfetti-Farben kommen aus den Marken-Tokens in style.css
  function confettiColors() {
    const cs = getComputedStyle(document.documentElement);
    const c = ['--brand', '--brand-soft', '--accent', '--text', '--medal-2'].map((v) => cs.getPropertyValue(v).trim()).filter(Boolean);
    return c.length ? c : ['#ffffff'];
  }
  function confetti(amount = 160, origin = { x: 0.5, y: 0.35 }) {
    if (reducedMotion()) return;
    const CONFETTI_COLORS = confettiColors();
    if (!confettiCanvas) {
      confettiCanvas = el('canvas', 'confetti-canvas');
      document.body.appendChild(confettiCanvas);
      confettiCtx = confettiCanvas.getContext('2d');
    }
    const w = (confettiCanvas.width = innerWidth), h = (confettiCanvas.height = innerHeight);
    for (let i = 0; i < amount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 14 + 4;
      confettiParts.push({
        x: origin.x * w, y: origin.y * h,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 8,
        size: Math.random() * 8 + 5, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4,
        color: CONFETTI_COLORS[(Math.random() * CONFETTI_COLORS.length) | 0], life: 0,
      });
    }
    if (!confettiRunning) { confettiRunning = true; requestAnimationFrame(confettiTick); }
  }
  function confettiTick() {
    const ctx = confettiCtx, w = confettiCanvas.width, h = confettiCanvas.height;
    ctx.clearRect(0, 0, w, h);
    confettiParts = confettiParts.filter((p) => p.y < h + 40 && p.life < 600);
    for (const p of confettiParts) {
      p.life++; p.vy += 0.32; p.vx *= 0.985; p.vy *= 0.985;
      p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2 * Math.abs(Math.cos(p.life * 0.1)) + 1);
      ctx.restore();
    }
    if (confettiParts.length) requestAnimationFrame(confettiTick);
    else { confettiRunning = false; ctx.clearRect(0, 0, w, h); }
  }

  // -------------------------------------------------------------------------
  // Sounds (Web Audio, synthetisch – keine Dateien nötig)
  // -------------------------------------------------------------------------
  const sound = {
    enabled: true,
    ctx: null,
    unlock() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) this.ctx = new AC();
      }
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    },
    _ok() { return this.enabled && this.ctx && this.ctx.state === 'running'; },
    tone(freq, dur = 0.15, type = 'sine', vol = 0.2, when = 0) {
      if (!this._ok()) return;
      const t = this.ctx.currentTime + when;
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.ctx.destination);
      o.start(t); o.stop(t + dur + 0.05);
    },
    noise(dur, { vol = 0.3, filter = 'highpass', freq = 6000, when = 0, attack = 0.005 } = {}) {
      if (!this._ok()) return null;
      const t = this.ctx.currentTime + when;
      const len = Math.ceil(this.ctx.sampleRate * dur);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const src = this.ctx.createBufferSource(); src.buffer = buf;
      const f = this.ctx.createBiquadFilter(); f.type = filter; f.frequency.value = freq;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f).connect(g).connect(this.ctx.destination);
      src.start(t); src.stop(t + dur + 0.05);
      return g;
    },
    tick() { this.tone(1200, 0.05, 'square', 0.06); },
    pop() { this.tone(660, 0.08, 'triangle', 0.15); this.tone(990, 0.1, 'triangle', 0.1, 0.05); },
    whoosh() { this.noise(0.6, { vol: 0.15, filter: 'bandpass', freq: 1200, attack: 0.25 }); },
    gong() { [196, 247, 294].forEach((f, i) => this.tone(f, 1.6, 'sine', 0.18, i * 0.01)); },
    drumroll(sec) {
      if (!this._ok()) return;
      // schneller werdender Wirbel
      let t = 0;
      while (t < sec) {
        const progress = t / sec;
        this.noise(0.08, { vol: 0.08 + progress * 0.22, filter: 'bandpass', freq: 1800, when: t, attack: 0.002 });
        t += 0.07 - progress * 0.035;
      }
    },
    crash() {
      this.noise(2.2, { vol: 0.45, filter: 'highpass', freq: 5000 });
      this.tone(110, 0.6, 'sine', 0.4);
    },
    fanfare() {
      const n = [523, 659, 784, 1047];
      n.forEach((f, i) => this.tone(f, 0.25, 'sawtooth', 0.09, i * 0.13));
      [523, 659, 784, 1047].forEach((f) => this.tone(f, 1.4, 'triangle', 0.09, 0.6));
    },
  };

  // Dauer der Finalanimation auf der Leinwand (ms) – Handys warten so lange
  const FINAL_DURATION = 30000;

  window.GI = { fmt, fmtUnit, fmtFor, fmtQ, parseNumber, el, sleep, countUp, snow, confetti, sound, FINAL_DURATION };
})();
