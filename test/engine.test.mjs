import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, layoutCells, step, launch, resetGame,
  ballHitsRect, BALL_SPEED, MULTIPLIERS, PADDLE_MIN_SCALE,
} from '../public/js/engine.js';

// Deterministic rng for reproducible physics.
const fixedRng = () => 0.5;

function makeGame(opts = {}) {
  return createGame({ lines: ['HI'], width: 800, height: 600, rng: fixedRng, ...opts });
}

/** Park the ball dead-center on a target cell, moving down. */
function aimAtCell(g, cell) {
  g.ball.x = cell.x + g.cellSize / 2;
  g.ball.y = cell.y + g.cellSize / 2;
  g.ball.vx = 0;
  g.ball.vy = BALL_SPEED;
  g.ball.r = 4;
}

test('layout fits inside the playfield with side margins', () => {
  const { cells, cellSize } = layoutCells(['RUSH', 'TORONTO', 'AUGUST 11', '2026'], 800, 600);
  assert.ok(cells.length > 0);
  for (const c of cells) {
    assert.ok(c.x >= 0 && c.x + cellSize <= 800, `cell x ${c.x} out of bounds`);
    assert.ok(c.y >= 0 && c.y + cellSize <= 600 * 0.7, `cell y ${c.y} too low`);
  }
});

test('new game: ready on the paddle, full lives, zero score', () => {
  const g = makeGame();
  assert.equal(g.mode, 'ready');
  assert.equal(g.lives, 3);
  assert.equal(g.score, 0);
  assert.equal(g.total, g.cells.length);
  assert.ok(g.cells.every((c) => c.alive));
  assert.equal(g.ball.vy, 0, 'ball parked until launch');
});

test('ball rides the paddle until launch', () => {
  const g = makeGame();
  step(g, 0.016, 200);
  step(g, 0.016, 200);
  assert.equal(g.ball.x, g.paddle.x);
  assert.ok(g.ball.y < g.paddle.y);
});

test('launch fires the ball upward and starts play', () => {
  const g = makeGame();
  launch(g);
  assert.equal(g.mode, 'playing');
  assert.ok(g.ball.vy < 0, 'ball moving up');
  // launch is a no-op mid-game
  const v = g.ball.vy;
  launch(g);
  assert.equal(g.ball.vy, v);
});

test('ballHitsRect: overlap and miss', () => {
  const ball = { x: 10, y: 10, r: 5 };
  assert.ok(ballHitsRect(ball, 12, 8, 10, 10));
  assert.ok(!ballHitsRect(ball, 100, 100, 10, 10));
});

test('ball reflects off the left wall', () => {
  const g = makeGame();
  launch(g);
  g.ball = { x: 3, y: 300, vx: -BALL_SPEED, vy: 0, r: 5 };
  step(g, 0.016, g.paddle.x);
  assert.ok(g.ball.vx > 0, 'vx flipped to positive');
  assert.ok(g.ball.x >= g.ball.r);
});

test('paddle bounce sends the ball back up and emits a paddle event', () => {
  const g = makeGame();
  launch(g);
  g.ball = { x: g.paddle.x, y: g.paddle.y - 4, vx: 0, vy: BALL_SPEED, r: 5 };
  const events = step(g, 0.016, g.paddle.x);
  assert.ok(g.ball.vy < 0, 'vy flipped upward');
  assert.deepEqual(events.map((e) => e.type), ['paddle']);
});

test('multipliers climb linearly 1X through 10X', () => {
  assert.deepEqual(MULTIPLIERS, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('brick hit: destroys cell, scores 1X, event carries tier + hit point', () => {
  const g = makeGame();
  launch(g);
  const target = g.cells[0];
  g.textDirty = false;
  aimAtCell(g, target);
  const events = step(g, 0.0001, g.paddle.x);
  assert.equal(target.alive, false);
  assert.equal(g.destroyed, 1);
  assert.equal(g.score, g.brickPoints * MULTIPLIERS[0]);
  assert.equal(g.comboTier, 1, 'next hit will be 2X');
  assert.equal(g.textDirty, true);
  assert.equal(events.length, 1);
  const e = events[0];
  assert.equal(e.type, 'brick');
  assert.equal(e.tier, 0);
  assert.equal(e.x, target.x + g.cellSize / 2, 'hit x is the cell center');
  assert.equal(e.y, target.y + g.cellSize / 2, 'hit y is the cell center');
});

test('combo ladder: quick hits climb 1X→2X→3X… and cap at 10X', () => {
  const g = makeGame({ comboWindow: 0.2 });
  launch(g);
  let expected = 0;
  // 12 quick hits: tiers 0..9 then capped at the top tone.
  const tiers = [];
  for (let i = 0; i < 12; i++) {
    const cell = g.cells.find((c) => c.alive);
    aimAtCell(g, cell);
    const events = step(g, 0.01, g.paddle.x); // inside the 0.2s window
    const brick = events.find((e) => e.type === 'brick');
    tiers.push(brick.tier);
    expected += g.brickPoints * MULTIPLIERS[brick.tier];
  }
  assert.deepEqual(tiers, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9]);
  assert.equal(g.score, expected);
});

test('paddle shrinks as the combo climbs, recovers on reset', () => {
  const g = makeGame();
  launch(g);
  step(g, 0.016, g.paddle.x);
  const full = g.paddle.w;
  assert.equal(full, g.paddle.baseW, 'full width at 1X');
  g.comboTier = 4;
  g.comboTimer = 10;
  step(g, 0.016, g.paddle.x);
  const mid = g.paddle.w;
  assert.ok(mid < full, 'narrower mid-ladder');
  g.comboTier = MULTIPLIERS.length - 1;
  g.comboTimer = 10;
  step(g, 0.016, g.paddle.x);
  const min = g.paddle.w;
  assert.ok(min < mid, 'narrowest at 10X');
  assert.ok(Math.abs(min - full * PADDLE_MIN_SCALE) < 0.001);
  g.comboTier = 0;
  step(g, 0.016, g.paddle.x);
  assert.equal(g.paddle.w, full, 'back to full at 1X');
});

test('combo resets to 1X when the window lapses', () => {
  const g = makeGame({ comboWindow: 0.2 });
  launch(g);
  aimAtCell(g, g.cells.find((c) => c.alive));
  step(g, 0.01, g.paddle.x);
  assert.equal(g.comboTier, 1);
  // idle past the window with the ball away from everything
  g.ball = { x: 400, y: 400, vx: 0, vy: -1, r: 4 };
  step(g, 0.25, g.paddle.x);
  assert.equal(g.comboTier, 0, 'multiplier back to 1X');
  // next brick scores at 1X again
  const before = g.score;
  aimAtCell(g, g.cells.find((c) => c.alive));
  const events = step(g, 0.001, g.paddle.x);
  assert.equal(events.find((e) => e.type === 'brick').tier, 0);
  assert.equal(g.score, before + g.brickPoints);
});

test('combo window length is configurable', () => {
  const g = makeGame({ comboWindow: 5 });
  launch(g);
  aimAtCell(g, g.cells.find((c) => c.alive));
  step(g, 0.01, g.paddle.x);
  g.ball = { x: 400, y: 400, vx: 0, vy: -1, r: 4 };
  step(g, 1, g.paddle.x); // 1s gap — would kill a 0.2s window
  assert.equal(g.comboTier, 1, 'still combo-ing inside a 5s window');
});

test('only one cell dies per step', () => {
  const g = makeGame();
  launch(g);
  g.ball = { x: g.cells[0].x, y: g.cells[0].y, vx: 0, vy: BALL_SPEED, r: 50 };
  step(g, 0.0001, g.paddle.x);
  assert.equal(g.destroyed, 1);
});

test('lost ball: costs a life, back to ready, combo cleared', () => {
  const g = makeGame();
  launch(g);
  g.comboTier = 3;
  g.ball = { x: 400, y: 700, vx: 0, vy: BALL_SPEED, r: 5 };
  const events = step(g, 0.016, g.paddle.x);
  assert.equal(g.lives, 2);
  assert.equal(g.mode, 'ready');
  assert.equal(g.comboTier, 0);
  assert.deepEqual(events.map((e) => e.type), ['life']);
});

test('losing the last life ends the game, score survives', () => {
  const g = makeGame();
  g.score = 1230;
  g.lives = 1;
  launch(g);
  g.ball = { x: 400, y: 700, vx: 0, vy: BALL_SPEED, r: 5 };
  const events = step(g, 0.016, g.paddle.x);
  assert.equal(g.mode, 'over');
  assert.equal(g.score, 1230);
  assert.deepEqual(events.map((e) => e.type), ['over']);
  // dead game ignores further physics
  const snapshot = g.destroyed;
  step(g, 0.016, g.paddle.x);
  assert.equal(g.destroyed, snapshot);
});

test('clearing the board wins the game', () => {
  const g = makeGame();
  launch(g);
  for (const c of g.cells) c.alive = false;
  g.destroyed = g.total - 1;
  const last = g.cells[0];
  last.alive = true;
  aimAtCell(g, last);
  const events = step(g, 0.001, g.paddle.x);
  assert.equal(g.mode, 'won');
  assert.ok(events.some((e) => e.type === 'won'));
});

test('resetGame: fresh board, lives and score restored', () => {
  const g = makeGame();
  launch(g);
  g.score = 500;
  g.lives = 1;
  for (const c of g.cells) c.alive = false;
  g.destroyed = g.total;
  g.mode = 'over';
  resetGame(g);
  assert.equal(g.mode, 'ready');
  assert.equal(g.score, 0);
  assert.equal(g.lives, g.maxLives);
  assert.equal(g.destroyed, 0);
  assert.ok(g.cells.every((c) => c.alive));
  assert.equal(g.textDirty, true);
});

test('lives count is configurable', () => {
  const g = makeGame({ lives: 5 });
  assert.equal(g.lives, 5);
  assert.equal(g.maxLives, 5);
});
