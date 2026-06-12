// Canvas renderer, input, and sound for the ASCII breakout pane.
// Engine (js/engine.js) owns all game logic; this file draws, listens,
// updates the legend, and turns engine events into audio + hit markers.

import { SITE_CONFIG } from './config.js';
import { createGame, step, launch, resetGame, MULTIPLIERS } from './engine.js';

const COLORS = {
  bg: '#141413',
  text: '#ebe7de',
  depth: ['#2b2924', '#3a372f', '#4a463c'], // extrusion layers, back to front
  accent: '#d97757',
  dim: '#6b665c',
};
const DEPTH_STEP = 0.16; // extrusion offset as a fraction of cell size
const EFFECT_LIFE = 0.7; // seconds a hit marker lives

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

let state = null;
let textLayer = null; // offscreen canvas holding the extruded text
let dpr = 1;
let mouseX = null;
let lastTime = null;
let effects = []; // hit markers: {x, y, age, mult}

// ---------------------------------------------------------------------------
// Sound: tiny WebAudio synth, no assets. Context created on first click
// (browser autoplay policy). Toggleable from the legend.
// ---------------------------------------------------------------------------

// Ping ladder, one tone per combo tier: pentatonic C5 → A6.
const PING_TONES = [
  523.25, 587.33, 659.25, 783.99, 880.0,
  1046.5, 1174.66, 1318.51, 1567.98, 1760.0,
];

let audio = null;
let soundOn = localStorage.getItem('soundOn') !== 'false';

function ensureAudio() {
  if (!audio) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) audio = new AC();
  }
  if (audio && audio.state === 'suspended') audio.resume();
}

function blip({ freq, endFreq = freq, type = 'sine', dur = 0.1, gain = 0.2 }) {
  if (!soundOn || !audio || audio.state !== 'running') return;
  const t0 = audio.currentTime;
  const osc = audio.createOscillator();
  const amp = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), t0 + dur);
  amp.gain.setValueAtTime(gain, t0);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(amp).connect(audio.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

const SOUNDS = {
  // Dull "pock" off the paddle: low triangle with a fast pitch drop.
  paddle: () => blip({ freq: 200, endFreq: 110, type: 'triangle', dur: 0.09, gain: 0.3 }),
  // Brick "ping": pure tone climbing the combo ladder.
  brick: (tier) => blip({ freq: PING_TONES[tier], type: 'sine', dur: 0.12, gain: 0.18 }),
  life: () => blip({ freq: 160, endFreq: 50, type: 'sawtooth', dur: 0.35, gain: 0.12 }),
  over: () => blip({ freq: 120, endFreq: 30, type: 'sawtooth', dur: 0.8, gain: 0.15 }),
  won: () => PING_TONES.forEach((f, i) =>
    setTimeout(() => blip({ freq: f, dur: 0.15, gain: 0.15 }), i * 70)),
};

function handleEvents(events) {
  for (const e of events) {
    if (e.type === 'brick') {
      SOUNDS.brick(e.tier);
      effects.push({ x: e.x, y: e.y, age: 0, mult: MULTIPLIERS[e.tier] });
      // Repaint just the neighborhood of the dead cell — a full text-layer
      // redraw is too slow now that strokes are 2 characters thick.
      const s = state.cellSize;
      renderTextLayer({ x: e.x - s / 2, y: e.y - s / 2, w: s, h: s });
    } else if (SOUNDS[e.type]) {
      SOUNDS[e.type]();
    }
  }
}

// ---------------------------------------------------------------------------
// Legend (DOM overlay, upper right): score, lives, sound toggle.
// ---------------------------------------------------------------------------

const legendScore = document.getElementById('legend-score');
const legendLives = document.getElementById('legend-lives');
const soundToggle = document.getElementById('sound-toggle');

function renderSoundToggle() {
  soundToggle.textContent = soundOn ? 'SOUND ON' : 'SOUND OFF';
  soundToggle.setAttribute('aria-pressed', String(soundOn));
}

soundToggle.addEventListener('click', () => {
  soundOn = !soundOn;
  localStorage.setItem('soundOn', String(soundOn));
  if (soundOn) ensureAudio();
  renderSoundToggle();
});
renderSoundToggle();

function updateLegend() {
  const score = String(state.score).padStart(6, '0');
  if (legendScore.textContent !== score) legendScore.textContent = score;
  const lives = '* '.repeat(state.lives).trim() || '—';
  if (legendLives.textContent !== lives) legendLives.textContent = lives;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function cellFont(px) {
  return `bold ${px}px "IBM Plex Mono", monospace`;
}

function mono(px, weight = '') {
  return `${weight} ${px}px "IBM Plex Mono", monospace`.trim();
}

function resize() {
  const rect = canvas.parentElement.getBoundingClientRect();
  dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  state = createGame({
    lines: SITE_CONFIG.marqueeLines,
    width: rect.width,
    height: rect.height,
    ...SITE_CONFIG.game,
  });
  effects = [];
  textLayer = document.createElement('canvas');
  textLayer.width = canvas.width;
  textLayer.height = canvas.height;
}

// The 3D look: each alive cell is its own character, drawn several times with
// a diagonal offset in dark shades, then once on top in cream. Rendered to an
// offscreen layer. Pass a region to repaint only the cells around one hit;
// no region means a full repaint (board reset, resize).
function renderTextLayer(region = null) {
  const g = textLayer.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const s = state.cellSize;
  const off = Math.max(1, s * DEPTH_STEP);
  const layers = COLORS.depth.length;
  // glyphs overhang their cell and the extrusion pushes down-right, so pad
  // the repaint region enough to cover every pixel a neighbor could own
  const pad = s * 2 + off * layers;
  const r = region
    ? { x: region.x - pad, y: region.y - pad, w: region.w + pad * 2, h: region.h + pad * 2 }
    : { x: 0, y: 0, w: state.width, h: state.height };
  g.save();
  g.beginPath();
  g.rect(r.x, r.y, r.w, r.h);
  g.clip();
  g.clearRect(r.x, r.y, r.w, r.h);
  g.font = cellFont(s * 1.15);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let d = layers; d >= 0; d--) {
    g.fillStyle = d === 0 ? COLORS.text : COLORS.depth[layers - d];
    for (const cell of state.cells) {
      if (!cell.alive || !cell.char) continue;
      if (cell.x + s + pad < r.x || cell.x - s > r.x + r.w) continue;
      if (cell.y + s + pad < r.y || cell.y - s > r.y + r.h) continue;
      g.fillText(cell.char, cell.x + s / 2 + d * off, cell.y + s / 2 + d * off);
    }
  }
  g.restore();
  state.textDirty = false;
}

// Hit markers: an expanding ring at the impact point, with the multiplier
// earned popping up and fading out.
function drawEffects(dt) {
  for (const fx of effects) fx.age += dt;
  effects = effects.filter((fx) => fx.age < EFFECT_LIFE);
  for (const fx of effects) {
    const k = fx.age / EFFECT_LIFE; // 0 → 1
    // ring: quick expand, gone by half-life
    if (k < 0.5) {
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, 4 + k * 2 * 30, 0, Math.PI * 2);
      ctx.strokeStyle = COLORS.text;
      ctx.globalAlpha = 1 - k * 2;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    // multiplier pop: rises and fades over the full life
    ctx.globalAlpha = 1 - k;
    ctx.fillStyle = COLORS.accent;
    ctx.font = mono(13 + fx.mult, 'bold');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${fx.mult}X`, fx.x, fx.y - 14 - k * 40);
  }
  ctx.globalAlpha = 1;
}

function drawHUD(now) {
  const cx = state.width / 2;
  const blink = Math.floor(now / 600) % 2 === 0;
  if (state.mode === 'ready' && blink) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = COLORS.text;
    ctx.font = mono(14, 'bold');
    ctx.fillText('CLICK TO LAUNCH', cx, state.paddle.y - 60);
  } else if (state.mode === 'over' || state.mode === 'won') {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const midY = state.height * 0.72;
    ctx.fillStyle = COLORS.accent;
    ctx.font = mono(Math.max(24, state.cellSize * 2.4), 'bold');
    ctx.fillText(state.mode === 'won' ? 'ENCORE!' : 'GAME OVER', cx, midY);
    ctx.fillStyle = COLORS.text;
    ctx.font = mono(14, 'bold');
    ctx.fillText(`FINAL SCORE ${state.score}`, cx, midY + 38);
    if (blink) {
      ctx.font = mono(16, 'bold');
      ctx.fillStyle = COLORS.accent;
      ctx.fillText('PLAY AGAIN? — CLICK', cx, midY + 70);
    }
  }
}

function draw(now, dt) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, state.width, state.height);

  if (state.textDirty) renderTextLayer();
  ctx.drawImage(textLayer, 0, 0, state.width, state.height);

  drawEffects(dt);

  // Ball (hidden once the game has ended).
  if (state.mode === 'ready' || state.mode === 'playing') {
    const b = state.ball;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLORS.accent;
    ctx.font = cellFont(b.r * 3);
    ctx.fillText('*', b.x, b.y + b.r * 0.2);
  }

  // Paddle: a run of box-drawing characters (shrinks as the combo climbs).
  const pad = state.paddle;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = cellFont(14);
  ctx.fillStyle = COLORS.text;
  const segs = Math.max(3, Math.round(pad.w / 9));
  ctx.fillText('▔'.repeat(segs), pad.x, pad.y + pad.h / 2);

  drawHUD(now);
}

function frame(now) {
  if (lastTime === null) lastTime = now;
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

  const target = mouseX === null ? state.paddle.x : mouseX;
  handleEvents(step(state, dt, target));
  draw(now, dt);
  updateLegend();
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

canvas.addEventListener('pointermove', (e) => {
  const rect = canvas.getBoundingClientRect();
  mouseX = e.clientX - rect.left;
});
canvas.addEventListener('touchmove', (e) => {
  const rect = canvas.getBoundingClientRect();
  mouseX = e.touches[0].clientX - rect.left;
  e.preventDefault();
}, { passive: false });

canvas.addEventListener('pointerdown', () => {
  if (!state) return; // clicked before fonts/init finished
  ensureAudio();
  if (state.mode === 'ready') launch(state);
  else if (state.mode === 'over' || state.mode === 'won') {
    resetGame(state);
    effects = [];
  }
});

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(resize, 150);
});

// Wait for the mono font so glyph metrics are right on first paint.
document.fonts.ready.then(() => {
  resize();
  requestAnimationFrame(frame);
});

// Caption under the game comes from config too.
const cap = document.getElementById('marquee-caption');
if (cap) cap.textContent = SITE_CONFIG.marqueeCaption;

// Read-only debug handle for headless smoke tests.
window.__breakout = { get state() { return state; } };
