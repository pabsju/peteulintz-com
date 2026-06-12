// Handler + router tests against real SQLite (see helpers/d1.mjs).
// Run with: node --experimental-sqlite --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { route } from '../worker/index.js';
import { makeDB, brokenDB } from './helpers/d1.mjs';

const BASE = 'http://test.local';

function post(path, body) {
  return new Request(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function turnPayload(overrides = {}) {
  return {
    gameId: uuid(1), mode: 'desktop', turnNo: 1, turnScore: 200, cumulativeScore: 200,
    bricks: 15, maxCombo: 3, durationS: 12.5, ...overrides,
  };
}

function gamePayload(overrides = {}) {
  return {
    gameId: uuid(1), mode: 'desktop', finalScore: 600, turns: 3, outcome: 'over',
    maxCombo: 5, durationS: 60, ...overrides,
  };
}

// --- routing ---

test('unknown path → 404', async () => {
  const res = await route(new Request(`${BASE}/api/nope`), { DB: makeDB() });
  assert.equal(res.status, 404);
});

test('wrong method → 405 with allow header', async () => {
  const res = await route(new Request(`${BASE}/api/turn`), { DB: makeDB() }); // GET
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('allow'), 'POST');
});

test('handler explosion → 500, generic message, no stack leak', async () => {
  const res = await route(post('/api/turn', turnPayload()), { DB: brokenDB() });
  assert.equal(res.status, 500);
  const body = await res.json();
  assert.deepEqual(body, { error: 'internal error' });
});

test('health: 200 with games count; 503 when DB is down', async () => {
  const ok = await route(new Request(`${BASE}/api/health`), { DB: makeDB() });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { ok: true, games: 0 });

  const down = await route(new Request(`${BASE}/api/health`), { DB: brokenDB() });
  assert.equal(down.status, 503);
});

// --- body handling ---

test('bad JSON → 400', async () => {
  const res = await route(post('/api/turn', '{nope'), { DB: makeDB() });
  assert.equal(res.status, 400);
});

test('oversized body → 413', async () => {
  const res = await route(post('/api/turn', '"' + 'x'.repeat(5000) + '"'), { DB: makeDB() });
  assert.equal(res.status, 413);
});

test('implausible payload → 422 and nothing stored', async () => {
  const env = { DB: makeDB() };
  const res = await route(post('/api/turn', turnPayload({ turnScore: 999999 })), env);
  assert.equal(res.status, 422);
  const { n } = env.DB.raw.prepare('SELECT COUNT(*) AS n FROM turns').get();
  assert.equal(n, 0);
});

// --- /api/turn semantics ---

test('first turn ever: stored, ranks at the median of a sample of 1', async () => {
  const env = { DB: makeDB() };
  const res = await route(post('/api/turn', turnPayload()), env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, {
    turnNo: 1, mode: 'desktop', cumulativeScore: 200, turnScore: 200, sampleSize: 1,
    cumulativePercentile: 50, turnPercentile: 50,
    distribution: { n: 1, min: 200, max: 200, median: 200, counts: [1] },
  });
});

test('modes never share a distribution', async () => {
  const env = { DB: makeDB() };
  // A monster desktop ball 1…
  await route(post('/api/turn', turnPayload({
    gameId: uuid(1), mode: 'desktop', bricks: 100, turnScore: 5000, cumulativeScore: 5000,
  })), env);
  // …is invisible to a laptop ball 1.
  const res = await route(post('/api/turn', turnPayload({
    gameId: uuid(2), mode: 'laptop', bricks: 10, turnScore: 100, cumulativeScore: 100,
  })), env);
  const body = await res.json();
  assert.equal(body.sampleSize, 1, 'laptop sample is laptop-only');
  assert.equal(body.cumulativePercentile, 50, 'sole laptop play sits at the median');
  // Same isolation for completed games.
  await route(post('/api/game', gamePayload({ gameId: uuid(1), mode: 'desktop', finalScore: 9000 })), env);
  const g = await route(post('/api/game', gamePayload({ gameId: uuid(2), mode: 'laptop', finalScore: 300 })), env);
  const gb = await g.json();
  assert.equal(gb.sampleSize, 1);
  assert.equal(gb.bestScore, 300, 'desktop 9000 not leaking into laptop bestScore');
});

test('duplicate turn POST is idempotent (retries cannot double-count)', async () => {
  const env = { DB: makeDB() };
  await route(post('/api/turn', turnPayload()), env);
  const res = await route(post('/api/turn', turnPayload()), env);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).sampleSize, 1, 'still one row');
});

test('percentiles rank correctly across players', async () => {
  const env = { DB: makeDB() };
  // Three players' first balls: scores 100, 200, 1000.
  const scores = [
    [uuid(1), 10, 100],
    [uuid(2), 20, 200],
    [uuid(3), 100, 1000],
  ];
  let last;
  for (const [gameId, bricks, score] of scores) {
    last = await route(post('/api/turn', turnPayload({
      gameId, bricks, turnScore: score, cumulativeScore: score, maxCombo: 3,
    })), env);
  }
  const top = await last.json();
  // 1000 vs {100, 200, 1000}: 2 below + 0.5 tie of 3 → 83.3
  assert.equal(top.sampleSize, 3);
  assert.equal(top.cumulativePercentile, 83.3);
  assert.equal(top.turnPercentile, 83.3);
  // Distribution covers all three ball-1 scores.
  assert.equal(top.distribution.n, 3);
  assert.equal(top.distribution.min, 100);
  assert.equal(top.distribution.max, 1000);
  assert.equal(top.distribution.median, 200);
  assert.equal(top.distribution.counts.reduce((a, b) => a + b, 0), 3);
});

test('turn 2 distribution only compares against other turn 2s', async () => {
  const env = { DB: makeDB() };
  // Player 1: ball 1 = 1000.
  await route(post('/api/turn', turnPayload({
    gameId: uuid(1), bricks: 100, turnScore: 1000, cumulativeScore: 1000,
  })), env);
  // Player 2: ball 1 = 100, then ball 2 = +100 → cumulative 200.
  await route(post('/api/turn', turnPayload({
    gameId: uuid(2), bricks: 10, turnScore: 100, cumulativeScore: 100,
  })), env);
  const res = await route(post('/api/turn', turnPayload({
    gameId: uuid(2), turnNo: 2, bricks: 10, turnScore: 100, cumulativeScore: 200,
  })), env);
  const body = await res.json();
  assert.equal(body.sampleSize, 1, 'only one ball-2 exists, the 1000-point ball 1 is invisible');
  assert.equal(body.cumulativePercentile, 50);
});

// --- /api/game semantics ---

test('game record: stored, summary aggregates returned', async () => {
  const env = { DB: makeDB() };
  await route(post('/api/game', gamePayload({ gameId: uuid(1), finalScore: 300 })), env);
  await route(post('/api/game', gamePayload({ gameId: uuid(2), finalScore: 900, outcome: 'won' })), env);
  const res = await route(post('/api/game', gamePayload({ gameId: uuid(3), finalScore: 600 })), env);
  const body = await res.json();
  assert.equal(body.sampleSize, 3);
  assert.equal(body.scorePercentile, 50); // 1 below, ties self: (1 + 0.5)/3
  assert.equal(body.bestScore, 900);
  assert.equal(body.gamesWon, 1);
  assert.equal(body.finalScore, 600, 'own score echoed for the marker');
  assert.equal(body.distribution.median, 600);
  assert.equal(body.distribution.n, 3);
});

test('duplicate game POST is idempotent', async () => {
  const env = { DB: makeDB() };
  await route(post('/api/game', gamePayload()), env);
  const res = await route(post('/api/game', gamePayload({ finalScore: 600 })), env);
  assert.equal((await res.json()).sampleSize, 1);
  // First write wins; the dupe didn't overwrite.
  const row = env.DB.raw.prepare('SELECT final_score FROM games').get();
  assert.equal(row.final_score, 600);
});

test('turns and games are independent tables (no FK coupling)', async () => {
  const env = { DB: makeDB() };
  // A game record with no turn rows (e.g. turns lost to network) still works.
  const res = await route(post('/api/game', gamePayload()), env);
  assert.equal(res.status, 200);
});
