// Recorder state machine tests. The recorder is fed synthetic frames the
// same way game.js feeds it real ones: tick(rec, state, events, dt).
// The last suite cross-checks emitted records against the SERVER's
// validators — the client/server contract test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecorder, tick, send, latest } from '../public/js/stats.js';
import { validateTurn, validateGame } from '../worker/lib/validate.js';

// Deterministic ids for tests.
const ids = () => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
};

const rec = () => createRecorder({ newId: ids() });
const FRAME = 1 / 60;

// Drive helpers: each returns whatever records the tick emitted.
const idle = (r, state) => tick(r, { ...state }, [], FRAME);
const brick = (r, state, tier = 0) =>
  tick(r, { ...state }, [{ type: 'brick', tier, x: 0, y: 0 }], FRAME);

/** Play one ball: launch, hit each tier in `tiers` (scoring as the engine
 * would), then end with `endEvent`. Mutates `state`. */
function playBall(r, state, tiers, endEvent) {
  state.mode = 'playing';
  let out = idle(r, state);
  for (const tier of tiers) {
    state.score += 10 * (tier + 1);
    out = out.concat(brick(r, state, tier));
  }
  if (endEvent === 'life') state.mode = 'ready';
  if (endEvent === 'over' || endEvent === 'won') state.mode = endEvent;
  out = out.concat(tick(r, { ...state }, [{ type: endEvent }], FRAME));
  return out;
}

test('nothing emitted while idle or mid-ball', () => {
  const r = rec();
  const state = { mode: 'ready', score: 0 };
  assert.deepEqual(idle(r, state), []);
  state.mode = 'playing';
  assert.deepEqual(idle(r, state), []);
  state.score = 10;
  assert.deepEqual(brick(r, state), []);
});

test('ball lost → one turn record with score delta and brick count', () => {
  const r = rec();
  const state = { mode: 'ready', score: 0 };
  idle(r, state);
  const out = playBall(r, state, [0, 1, 2], 'life'); // 10+20+30 = 60 points
  assert.equal(out.length, 1);
  const t = out[0];
  assert.equal(t.kind, 'turn');
  assert.equal(t.turnNo, 1);
  assert.equal(t.turnScore, 60);
  assert.equal(t.cumulativeScore, 60);
  assert.equal(t.bricks, 3);
  assert.equal(t.maxCombo, 3); // tier 2 → 3X
  assert.ok(t.durationS > 0);
});

test('turnScore is the delta, not the total, on later balls', () => {
  const r = rec();
  const state = { mode: 'ready', score: 0 };
  idle(r, state);
  playBall(r, state, [0, 0], 'life'); // ball 1: 20
  const out = playBall(r, state, [0], 'life'); // ball 2: 10
  assert.equal(out[0].turnNo, 2);
  assert.equal(out[0].turnScore, 10);
  assert.equal(out[0].cumulativeScore, 30);
});

test('game over → turn record AND game record, same tick', () => {
  const r = rec();
  const state = { mode: 'ready', score: 0 };
  idle(r, state);
  playBall(r, state, [0, 1], 'life');
  const out = playBall(r, state, [0], 'over');
  assert.equal(out.length, 2);
  const [t, g] = out;
  assert.equal(t.kind, 'turn');
  assert.equal(g.kind, 'game');
  assert.equal(g.outcome, 'over');
  assert.equal(g.turns, 2);
  assert.equal(g.finalScore, 40);
  assert.equal(g.maxCombo, 2, 'best combo across the whole game');
  assert.equal(g.gameId, t.gameId);
});

test('board cleared → outcome won', () => {
  const r = rec();
  const state = { mode: 'ready', score: 0 };
  idle(r, state);
  const out = playBall(r, state, [0, 1, 2, 3], 'won');
  assert.equal(out[1].kind, 'game');
  assert.equal(out[1].outcome, 'won');
  assert.equal(out[1].turns, 1);
});

test('replay after game over starts a fresh game id at turn 1', () => {
  const r = rec();
  const state = { mode: 'ready', score: 0 };
  idle(r, state);
  const first = playBall(r, state, [0], 'over');
  // Player clicks replay: engine resets mode and score.
  state.mode = 'ready';
  state.score = 0;
  idle(r, state);
  const second = playBall(r, state, [0], 'life');
  assert.notEqual(second[0].gameId, first[0].gameId);
  assert.equal(second[0].turnNo, 1);
});

test('resize mid-flight abandons the game silently', () => {
  const r = rec();
  const state = { mode: 'ready', score: 0 };
  idle(r, state);
  state.mode = 'playing';
  idle(r, state);
  state.score = 50;
  brick(r, state, 0);
  const before = r.gameId;
  // resize() rebuilt the state: back to ready, score zeroed, NO life event.
  const out = tick(r, { mode: 'ready', score: 0 }, [], FRAME);
  assert.deepEqual(out, [], 'nothing emitted for the abandoned ball');
  assert.notEqual(r.gameId, before, 'new game id');
  assert.equal(r.turnNo, 0);
});

test('resize while waiting to launch (score rolls back) also resets', () => {
  const r = rec();
  const state = { mode: 'ready', score: 0 };
  idle(r, state);
  playBall(r, state, [0, 0], 'life'); // turn 1 banked, score 20, mode ready
  const before = r.gameId;
  // resize during the ready gap: same mode, but score snapped back to 0.
  idle(r, { mode: 'ready', score: 0 });
  assert.notEqual(r.gameId, before);
});

test('durations accumulate frame dt while the ball is live', () => {
  const r = rec();
  const state = { mode: 'ready', score: 0 };
  idle(r, state); // ready frames must NOT count
  idle(r, state);
  state.mode = 'playing';
  for (let i = 0; i < 120; i++) idle(r, state); // 2s of play
  state.mode = 'ready';
  const out = tick(r, { ...state }, [{ type: 'life' }], FRAME);
  assert.ok(Math.abs(out[0].durationS - 2) < 0.05, `got ${out[0].durationS}`);
});

test('CONTRACT: every emitted record passes the server validators', () => {
  const r = rec();
  const state = { mode: 'ready', score: 0 };
  idle(r, state);
  const records = [
    ...playBall(r, state, [0, 1, 2, 3, 4], 'life'),
    ...playBall(r, state, [], 'life'), // zero-brick ball
    ...playBall(r, state, [0, 1], 'over'),
  ];
  assert.equal(records.length, 4); // 3 turns + 1 game
  for (const { kind, ...payload } of records) {
    const v = kind === 'turn' ? validateTurn(payload) : validateGame(payload);
    assert.equal(v.ok, true, `${kind} rejected: ${v.error} — ${JSON.stringify(payload)}`);
  }
});

// --- transport ---

test('send: posts each record to /api/<kind>, stores responses in latest', async () => {
  const posted = [];
  const fakeFetch = async (url, opts) => {
    posted.push({ url, body: JSON.parse(opts.body) });
    return { ok: true, json: async () => ({ sampleSize: 7 }) };
  };
  send(
    [
      { kind: 'turn', gameId: 'x', turnNo: 1 },
      { kind: 'game', gameId: 'x', finalScore: 10 },
    ],
    fakeFetch
  );
  await new Promise((res) => setTimeout(res, 0)); // let promises settle
  assert.deepEqual(posted.map((p) => p.url), ['/api/turn', '/api/game']);
  assert.equal('kind' in posted[0].body, false, 'kind is routing, not payload');
  assert.deepEqual(latest.turn, { sampleSize: 7 });
});

test('send: network failure is swallowed, never throws', async () => {
  const fakeFetch = async () => {
    throw new Error('offline');
  };
  assert.doesNotThrow(() => send([{ kind: 'turn', gameId: 'x' }], fakeFetch));
  await new Promise((res) => setTimeout(res, 0));
});

test('send: non-2xx response is ignored', async () => {
  latest.turn = null;
  const fakeFetch = async () => ({ ok: false, json: async () => ({ error: 'nope' }) });
  send([{ kind: 'turn', gameId: 'x' }], fakeFetch);
  await new Promise((res) => setTimeout(res, 0));
  assert.equal(latest.turn, null);
});
