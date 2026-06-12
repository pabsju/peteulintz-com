// Client snark tests: shuffle bag, cadence decisions, and the contract that
// every snapshot the client builds passes the server's validator.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CANNED, makeBag, createSnark, decide, noteSpoken, buildSnapshot } from '../public/js/snark.js';
import { validateSnapshot } from '../worker/lib/commentary.js';

// Deterministic rng from a fixed sequence (loops).
const seqRng = (vals) => {
  let i = 0;
  return () => vals[i++ % vals.length];
};

const FRAME = 1 / 60;

// --- shuffle bag ---

test('bag: every item exactly once per cycle', () => {
  const items = ['a', 'b', 'c', 'd', 'e'];
  const next = makeBag(items, seqRng([0.9, 0.1, 0.5, 0.3, 0.7]));
  const cycle = Array.from({ length: 5 }, next).sort();
  assert.deepEqual(cycle, items);
});

test('bag: no immediate repeat across refills, ever', () => {
  const items = ['a', 'b', 'c'];
  const next = makeBag(items, Math.random);
  let prev = null;
  for (let i = 0; i < 300; i++) {
    const line = next();
    assert.notEqual(line, prev, `repeat at draw ${i}`);
    prev = line;
  }
});

test('bag: canned list has no duplicates (a dupe would defeat the bag)', () => {
  assert.equal(new Set(CANNED).size, CANNED.length);
});

// --- cadence ---

test('mid-play heckle fires within the 14-26s window, not before', () => {
  const snark = createSnark(seqRng([0.5])); // untilMid = 14 + 6 = 20s
  const state = { mode: 'playing' };
  let fired = null;
  let t = 0;
  while (t < 30 && !fired) {
    t += FRAME;
    fired = decide(snark, state, [], FRAME) && t;
  }
  assert.ok(fired > 19.9 && fired < 20.1, `fired at ${fired}`);
});

test('clock pauses outside playing mode', () => {
  const snark = createSnark(seqRng([0.5]));
  // 60s of sitting on the ready screen: nothing.
  for (let i = 0; i < 3600; i++) {
    assert.equal(decide(snark, { mode: 'ready' }, [], FRAME), null);
  }
});

test('life lost triggers immediately, but respects the cooldown', () => {
  const snark = createSnark(seqRng([0.5]));
  const state = { mode: 'ready' }; // mode already flipped when life fires
  assert.equal(decide(snark, state, [{ type: 'life' }], FRAME), 'life');
  noteSpoken(snark, 'x');
  // 3s later, another death: too soon, stay quiet.
  for (let i = 0; i < 180; i++) decide(snark, { mode: 'playing' }, [], FRAME);
  assert.equal(decide(snark, state, [{ type: 'life' }], FRAME), null);
});

test('game end always gets the closer, even right after another line', () => {
  const snark = createSnark(seqRng([0.5]));
  noteSpoken(snark, 'just said something');
  assert.equal(decide(snark, { mode: 'over' }, [{ type: 'over' }], FRAME), 'over');
  assert.equal(decide(snark, { mode: 'won' }, [{ type: 'won' }], FRAME), 'won');
});

test('noteSpoken resets the clock and keeps only 3 recent lines', () => {
  const snark = createSnark(seqRng([0.5]));
  for (const l of ['one', 'two', 'three', 'four']) noteSpoken(snark, l);
  assert.deepEqual(snark.recent, ['two', 'three', 'four']);
  assert.equal(snark.sinceLast, 0);
});

// --- snapshot contract ---

test('CONTRACT: client snapshots pass the server validator in every phase', () => {
  const state = { mode: 'playing', score: 740, lives: 2, total: 1400, destroyed: 73 };
  const recorder = { mode: 'laptop', turnNo: 2, gameMaxCombo: 6, gameTime: 47.31 };
  const stats = {
    turn: { cumulativePercentile: 61.2, sampleSize: 19 },
    game: { scorePercentile: 88.8, sampleSize: 21 },
  };
  for (const phase of ['mid', 'life', 'over', 'won']) {
    const snap = buildSnapshot(phase, state, recorder, stats, ['a line']);
    const v = validateSnapshot(snap);
    assert.equal(v.ok, true, `${phase}: ${v.error}`);
  }
});

test('snapshot: no stats yet → null percentile, zero sample, still valid', () => {
  const state = { mode: 'playing', score: 0, lives: 3, total: 1400, destroyed: 0 };
  const recorder = { mode: 'desktop', turnNo: 1, gameMaxCombo: 1, gameTime: 2.5 };
  const snap = buildSnapshot('mid', state, recorder, { turn: null, game: null });
  assert.equal(snap.percentile, null);
  assert.equal(snap.sampleSize, 0);
  assert.equal(validateSnapshot(snap).ok, true);
});

test('snapshot: game-end phases prefer the final-score percentile', () => {
  const state = { mode: 'over', score: 500, lives: 0, total: 1400, destroyed: 50 };
  const recorder = { mode: 'desktop', turnNo: 3, gameMaxCombo: 4, gameTime: 90 };
  const stats = {
    turn: { cumulativePercentile: 40, sampleSize: 10 },
    game: { scorePercentile: 75, sampleSize: 11 },
  };
  assert.equal(buildSnapshot('over', state, recorder, stats).percentile, 75);
  assert.equal(buildSnapshot('mid', state, recorder, stats).percentile, 40);
});
