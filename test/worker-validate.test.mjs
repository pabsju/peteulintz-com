import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTurn, validateGame, LIMITS } from '../worker/lib/validate.js';

const UUID = 'a3f1c2d4-5b6e-4f70-8a91-b2c3d4e5f601';

// A payload that should pass: 12 bricks, scores between 12*10 and 12*100.
function goodTurn(overrides = {}) {
  return {
    gameId: UUID,
    mode: 'desktop',
    turnNo: 1,
    turnScore: 340,
    cumulativeScore: 340,
    bricks: 12,
    maxCombo: 5,
    durationS: 21.4,
    ...overrides,
  };
}

function goodGame(overrides = {}) {
  return {
    gameId: UUID,
    mode: 'laptop',
    finalScore: 1280,
    turns: 3,
    outcome: 'over',
    maxCombo: 7,
    durationS: 95.2,
    ...overrides,
  };
}

// --- structural ---

test('turn: rejects non-objects', () => {
  for (const bad of [null, undefined, 42, 'hi', [], true]) {
    assert.equal(validateTurn(bad).ok, false, String(bad));
  }
});

test('turn: accepts a plausible payload and normalizes it', () => {
  const r = validateTurn(goodTurn({ gameId: UUID.toUpperCase() }));
  assert.equal(r.ok, true);
  assert.equal(r.value.gameId, UUID, 'uuid lowercased');
  // Normalized object carries exactly the expected keys — nothing smuggled.
  assert.deepEqual(Object.keys(r.value).sort(), [
    'bricks', 'cumulativeScore', 'durationS', 'gameId', 'maxCombo', 'mode', 'turnNo', 'turnScore',
  ]);
});

test('turn/game: mode is a closed enum', () => {
  for (const bad of [undefined, '', 'tablet', 'DESKTOP', 7]) {
    assert.equal(validateTurn(goodTurn({ mode: bad })).ok, false, `turn ${bad}`);
    assert.equal(validateGame(goodGame({ mode: bad })).ok, false, `game ${bad}`);
  }
  assert.equal(validateTurn(goodTurn({ mode: 'laptop' })).ok, true);
  assert.equal(validateGame(goodGame({ mode: 'desktop' })).ok, true);
});

test('turn: extra fields are dropped, not stored', () => {
  const r = validateTurn(goodTurn({ evil: 'DROP TABLE', score: 1e9 }));
  assert.equal(r.ok, true);
  assert.equal('evil' in r.value, false);
  assert.equal('score' in r.value, false);
});

// --- gameId ---

test('turn: gameId must be a UUID', () => {
  for (const bad of [undefined, '', 'not-a-uuid', UUID + 'x', 42, UUID.replace('-', '')]) {
    assert.equal(validateTurn(goodTurn({ gameId: bad })).ok, false, String(bad));
  }
});

// --- ranges ---

test('turn: turnNo bounds', () => {
  assert.equal(validateTurn(goodTurn({ turnNo: 0 })).ok, false);
  assert.equal(validateTurn(goodTurn({ turnNo: LIMITS.maxTurns + 1 })).ok, false);
  assert.equal(validateTurn(goodTurn({ turnNo: 1.5 })).ok, false);
  assert.equal(validateTurn(goodTurn({ turnNo: LIMITS.maxTurns })).ok, true);
});

test('turn: numeric fields reject NaN/Infinity/strings', () => {
  for (const field of ['turnScore', 'cumulativeScore', 'bricks', 'maxCombo', 'durationS']) {
    for (const bad of [NaN, Infinity, -Infinity, '42', null, undefined]) {
      const r = validateTurn(goodTurn({ [field]: bad }));
      assert.equal(r.ok, false, `${field} = ${bad}`);
    }
  }
});

test('turn: negative values rejected everywhere', () => {
  for (const field of ['turnScore', 'cumulativeScore', 'bricks', 'durationS']) {
    assert.equal(validateTurn(goodTurn({ [field]: -1 })).ok, false, field);
  }
});

// --- scoring-math consistency (the interesting part) ---

test('turn: score must fit the brick count envelope', () => {
  // 12 bricks → score must be in [120, 1200].
  assert.equal(validateTurn(goodTurn({ turnScore: 119, cumulativeScore: 119 })).ok, false, 'below 1X floor');
  assert.equal(validateTurn(goodTurn({ turnScore: 120, cumulativeScore: 120 })).ok, true, 'exactly 1X every brick');
  assert.equal(validateTurn(goodTurn({ turnScore: 1200, cumulativeScore: 1200 })).ok, true, 'exactly 10X every brick');
  assert.equal(validateTurn(goodTurn({ turnScore: 1201, cumulativeScore: 1201 })).ok, false, 'above 10X ceiling');
});

test('turn: zero bricks means zero score and 1X combo', () => {
  const base = { bricks: 0, turnScore: 0, cumulativeScore: 0, maxCombo: 1 };
  assert.equal(validateTurn(goodTurn(base)).ok, true);
  assert.equal(validateTurn(goodTurn({ ...base, turnScore: 10, cumulativeScore: 10 })).ok, false);
  assert.equal(validateTurn(goodTurn({ ...base, maxCombo: 2 })).ok, false);
});

test('turn: maxCombo cannot exceed bricks hit', () => {
  // Reaching 5X takes at least 5 consecutive brick hits.
  assert.equal(validateTurn(goodTurn({ bricks: 4, maxCombo: 5, turnScore: 100, cumulativeScore: 100 })).ok, false);
  assert.equal(validateTurn(goodTurn({ bricks: 5, maxCombo: 5, turnScore: 150, cumulativeScore: 150 })).ok, true);
});

test('turn: cumulative cannot be less than this turn alone', () => {
  assert.equal(validateTurn(goodTurn({ cumulativeScore: 339 })).ok, false);
  assert.equal(validateTurn(goodTurn({ cumulativeScore: 340 })).ok, true);
  assert.equal(validateTurn(goodTurn({ cumulativeScore: 5000 })).ok, true, 'earlier turns add headroom');
});

test('turn: duration bounds', () => {
  assert.equal(validateTurn(goodTurn({ durationS: 0 })).ok, true);
  assert.equal(validateTurn(goodTurn({ durationS: LIMITS.maxTurnSeconds + 1 })).ok, false);
});

// --- game payloads ---

test('game: accepts a plausible payload', () => {
  const r = validateGame(goodGame());
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.value).sort(), [
    'durationS', 'finalScore', 'gameId', 'maxCombo', 'mode', 'outcome', 'turns',
  ]);
});

test('game: outcome is a closed enum', () => {
  for (const bad of ['lost', 'WIN', '', null, 7]) {
    assert.equal(validateGame(goodGame({ outcome: bad })).ok, false, String(bad));
  }
  assert.equal(validateGame(goodGame({ outcome: 'won' })).ok, true);
});

test('game: rejects non-objects and bad uuids', () => {
  assert.equal(validateGame(null).ok, false);
  assert.equal(validateGame(goodGame({ gameId: 'nope' })).ok, false);
});

test('game: range checks', () => {
  assert.equal(validateGame(goodGame({ finalScore: -1 })).ok, false);
  assert.equal(validateGame(goodGame({ turns: 0 })).ok, false);
  assert.equal(validateGame(goodGame({ turns: LIMITS.maxTurns + 1 })).ok, false);
  assert.equal(validateGame(goodGame({ maxCombo: 0 })).ok, false);
  assert.equal(validateGame(goodGame({ maxCombo: 11 })).ok, false);
  assert.equal(validateGame(goodGame({ durationS: -0.1 })).ok, false);
});
