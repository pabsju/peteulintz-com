// Breakout engine. Pure logic, no DOM — rendering and sound live in game.js.
// All coordinates in CSS pixels; dt in seconds.
// step() returns an array of events ({type, ...}) for the renderer to react
// to (sounds, hit markers): 'paddle', 'brick' (tier + hit coords), 'life',
// 'over', 'won'.

import { rasterizeLines } from './glyphs.js';

export const BALL_SPEED = 690;
export const PADDLE_LERP = 14; // paddle chase rate (1/s)

// Combo ladder: score multiplier (and ping tone index) per consecutive
// brick hit inside the combo window.
export const MULTIPLIERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

// Paddle shrinks as the combo climbs: full width at 1X, this fraction at 10X.
export const PADDLE_MIN_SCALE = 0.55;

// Every glyph stroke is this many characters thick (and the letters scale
// up to match — bigger, bolder text).
export const TEXT_SCALE = 2;

/**
 * Lay the rasterized text out in a width x height playfield.
 * Returns { cells, cellSize, originX, originY } where each cell gains
 * x/y pixel coords and an alive flag.
 */
export function layoutCells(lines, width, height) {
  const grid = rasterizeLines(lines, 3, TEXT_SCALE);
  const padX = width * 0.04;
  const padTop = height * 0.08;
  const maxH = height * 0.6; // leave the lower part for play
  const cellSize = Math.max(
    4,
    Math.min((width - padX * 2) / grid.cols, maxH / grid.rows)
  );
  const originX = (width - grid.cols * cellSize) / 2;
  const originY = padTop;
  const cells = grid.cells.map((c) => ({
    ...c,
    x: originX + c.col * cellSize,
    y: originY + c.row * cellSize,
    alive: true,
  }));
  return { cells, cellSize, originX, originY };
}

/** Create a fresh game state. rng: () => [0,1) — injectable for tests. */
export function createGame({
  lines, width, height,
  rng = Math.random,
  lives = 3,
  comboWindow = 0.2,
  brickPoints = 10,
}) {
  const { cells, cellSize } = layoutCells(lines, width, height);
  const paddleW = Math.max(70, width * 0.12);
  const state = {
    lines, width, height, rng,
    cells, cellSize,
    total: cells.length,
    destroyed: 0,
    mode: 'ready', // 'ready' | 'playing' | 'over' | 'won'
    score: 0,
    lives,
    maxLives: lives,
    comboTier: 0,
    comboTimer: 0,
    comboWindow,
    brickPoints,
    ball: { x: width / 2, y: 0, vx: 0, vy: 0, r: Math.max(5, cellSize * 0.9) },
    paddle: { x: width / 2, y: height - 36, w: paddleW, baseW: paddleW, h: 8 },
    textDirty: true, // renderer redraws the text layer when set
  };
  ballToPaddle(state);
  return state;
}

function ballToPaddle(state) {
  state.ball.x = state.paddle.x;
  state.ball.y = state.paddle.y - state.ball.r - 4;
  state.ball.vx = 0;
  state.ball.vy = 0;
}

/** Paddle width for the current combo tier: 1X full, 10X smallest. */
function paddleWidthFor(state) {
  const frac = state.comboTier / (MULTIPLIERS.length - 1);
  return state.paddle.baseW * (1 - (1 - PADDLE_MIN_SCALE) * frac);
}

/** Fire the ball off the paddle. No-op unless waiting to launch. */
export function launch(state) {
  if (state.mode !== 'ready') return;
  const angle = (-Math.PI / 2) + (state.rng() - 0.5) * (Math.PI / 3);
  state.ball.vx = Math.cos(angle) * BALL_SPEED;
  state.ball.vy = Math.sin(angle) * BALL_SPEED;
  state.mode = 'playing';
}

/** Fresh board, fresh lives, zero score — back to the launch prompt. */
export function resetGame(state) {
  for (const c of state.cells) c.alive = true;
  state.destroyed = 0;
  state.score = 0;
  state.lives = state.maxLives;
  state.comboTier = 0;
  state.comboTimer = 0;
  state.textDirty = true;
  state.mode = 'ready';
  ballToPaddle(state);
}

/** Circle (ball) vs rect (cell) overlap test. */
export function ballHitsRect(ball, x, y, w, h) {
  const nx = Math.max(x, Math.min(ball.x, x + w));
  const ny = Math.max(y, Math.min(ball.y, y + h));
  const dx = ball.x - nx;
  const dy = ball.y - ny;
  return dx * dx + dy * dy <= ball.r * ball.r;
}

function reflectOffRect(ball, x, y, w, h) {
  // Reflect along the axis of least penetration.
  const cx = x + w / 2, cy = y + h / 2;
  const overlapX = w / 2 + ball.r - Math.abs(ball.x - cx);
  const overlapY = h / 2 + ball.r - Math.abs(ball.y - cy);
  if (overlapX < overlapY) {
    ball.vx = Math.abs(ball.vx) * Math.sign(ball.x - cx || 1);
    ball.x += Math.sign(ball.vx) * overlapX;
  } else {
    ball.vy = Math.abs(ball.vy) * Math.sign(ball.y - cy || 1);
    ball.y += Math.sign(ball.vy) * overlapY;
  }
}

/**
 * Advance the game by dt seconds. paddleTargetX: where the paddle wants
 * to be (pointer x). Mutates state; returns events for the renderer.
 */
export function step(state, dt, paddleTargetX) {
  const events = [];
  const { ball, paddle } = state;

  // Paddle eases toward target (in every mode — it's the cursor) and
  // tightens as the combo climbs.
  paddle.w = paddleWidthFor(state);
  const t = Math.min(1, PADDLE_LERP * dt);
  paddle.x += (paddleTargetX - paddle.x) * t;
  paddle.x = Math.max(paddle.w / 2, Math.min(state.width - paddle.w / 2, paddle.x));

  if (state.mode === 'ready') {
    ballToPaddle(state); // ball rides the paddle until launch
    return events;
  }
  if (state.mode !== 'playing') return events;

  // Combo decays if the next brick doesn't come fast enough.
  if (state.comboTier > 0) {
    state.comboTimer -= dt;
    if (state.comboTimer <= 0) state.comboTier = 0;
  }

  // Ball motion.
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  // Walls.
  if (ball.x - ball.r < 0) { ball.x = ball.r; ball.vx = Math.abs(ball.vx); }
  if (ball.x + ball.r > state.width) { ball.x = state.width - ball.r; ball.vx = -Math.abs(ball.vx); }
  if (ball.y - ball.r < 0) { ball.y = ball.r; ball.vy = Math.abs(ball.vy); }

  // Paddle bounce: angle depends on where the ball lands on the paddle.
  const px = paddle.x - paddle.w / 2;
  if (ball.vy > 0 && ballHitsRect(ball, px, paddle.y, paddle.w, paddle.h)) {
    const offset = (ball.x - paddle.x) / (paddle.w / 2); // -1..1
    const angle = (-Math.PI / 2) + offset * (Math.PI / 3);
    ball.vx = Math.cos(angle) * BALL_SPEED;
    ball.vy = Math.sin(angle) * BALL_SPEED;
    ball.y = paddle.y - ball.r;
    events.push({ type: 'paddle' });
  }

  // Lost below → lose a life; out of lives → game over.
  if (ball.y - ball.r > state.height) {
    state.lives--;
    state.comboTier = 0;
    state.comboTimer = 0;
    if (state.lives <= 0) {
      state.mode = 'over';
      events.push({ type: 'over' });
    } else {
      state.mode = 'ready';
      ballToPaddle(state);
      events.push({ type: 'life' });
    }
    return events;
  }

  // Cell collisions: destroy the first overlapping cell this step.
  const s = state.cellSize;
  for (const cell of state.cells) {
    if (!cell.alive) continue;
    // cheap bounds reject before the precise test
    if (Math.abs(cell.x + s / 2 - ball.x) > s + ball.r) continue;
    if (Math.abs(cell.y + s / 2 - ball.y) > s + ball.r) continue;
    if (ballHitsRect(ball, cell.x, cell.y, s, s)) {
      cell.alive = false;
      state.destroyed++;
      state.textDirty = true;
      // Score this brick at the current tier, then climb the ladder.
      const tier = state.comboTier;
      state.score += state.brickPoints * MULTIPLIERS[tier];
      state.comboTier = Math.min(MULTIPLIERS.length - 1, tier + 1);
      state.comboTimer = state.comboWindow;
      events.push({ type: 'brick', tier, x: cell.x + s / 2, y: cell.y + s / 2 });
      reflectOffRect(ball, cell.x, cell.y, s, s);
      break;
    }
  }

  if (state.destroyed === state.total && state.total > 0) {
    state.mode = 'won';
    events.push({ type: 'won' });
  }

  return events;
}
