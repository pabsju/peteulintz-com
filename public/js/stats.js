// Turn/game recording for the stats API. Two halves:
//   1. A pure recorder (createRecorder + tick) — a state machine fed
//      (state, events, dt) every frame from game.js. No DOM, no network,
//      tested in node like the engine.
//   2. A thin transport (send) — fire-and-forget POSTs. The game must never
//      stutter or break because the API is slow or down, so every network
//      error is swallowed; responses go out as a window event for the
//      Phase-2 UI and into `latest` for the smoke test.

import { MULTIPLIERS } from './engine.js';

// --- pure recorder ---------------------------------------------------------

export function createRecorder({ newId } = {}) {
  return {
    newId: newId || (() => crypto.randomUUID()),
    gameId: null,
    prevMode: 'ready',
    lastScore: 0,
    turnNo: 0,
    turnActive: false,
    turnStartScore: 0,
    bricks: 0,
    maxCombo: 1,
    turnTime: 0,
    gameTime: 0,
    gameMaxCombo: 1,
  };
}

function startFreshGame(rec) {
  rec.gameId = rec.newId();
  rec.turnNo = 0;
  rec.turnActive = false;
  rec.gameTime = 0;
  rec.gameMaxCombo = 1;
}

function finishTurn(rec, state) {
  rec.turnActive = false;
  return {
    kind: 'turn',
    gameId: rec.gameId,
    turnNo: rec.turnNo,
    turnScore: state.score - rec.turnStartScore,
    cumulativeScore: state.score,
    bricks: rec.bricks,
    maxCombo: rec.maxCombo,
    durationS: Math.round(rec.turnTime * 100) / 100,
  };
}

function finishGame(rec, state, outcome) {
  return {
    kind: 'game',
    gameId: rec.gameId,
    finalScore: state.score,
    turns: rec.turnNo,
    outcome,
    maxCombo: rec.gameMaxCombo,
    durationS: Math.round(rec.gameTime * 100) / 100,
  };
}

/**
 * Feed one frame. Returns an array of records ready to POST (usually empty;
 * a turn record when a ball ends; turn + game records when the game ends).
 *
 * Mode transitions carry the meaning:
 *   ready→playing            ball launched, turn starts
 *   'life' event             ball lost, more remain — turn ends
 *   'over'/'won' event       game ends — turn and game both close
 *   over|won→ready           player clicked replay — fresh game id
 *   playing→ready, no 'life' state was rebuilt under us (resize) — abandon
 *   score went backwards     ditto, caught even when modes look unchanged
 */
export function tick(rec, state, events, dt) {
  const out = [];
  const mode = state.mode;

  if (rec.gameId === null) startFreshGame(rec);

  // Replay after game over, or a resize that rebuilt the game mid-flight:
  // both invalidate the current game id without anything to emit.
  const replay = (rec.prevMode === 'over' || rec.prevMode === 'won') && mode === 'ready';
  const lostLife = events.some((e) => e.type === 'life');
  const rebuilt =
    (rec.prevMode === 'playing' && mode === 'ready' && !lostLife) ||
    (mode === 'ready' && state.score < rec.lastScore);
  if (replay || rebuilt) startFreshGame(rec);

  if (rec.prevMode === 'ready' && mode === 'playing') {
    rec.turnActive = true;
    rec.turnNo += 1;
    rec.turnStartScore = state.score;
    rec.bricks = 0;
    rec.maxCombo = 1;
    rec.turnTime = 0;
  }

  if (rec.turnActive) {
    rec.turnTime += dt;
    rec.gameTime += dt;
  }

  for (const e of events) {
    if (e.type === 'brick' && rec.turnActive) {
      rec.bricks += 1;
      const mult = MULTIPLIERS[e.tier];
      if (mult > rec.maxCombo) rec.maxCombo = mult;
      if (mult > rec.gameMaxCombo) rec.gameMaxCombo = mult;
    } else if (e.type === 'life' && rec.turnActive) {
      out.push(finishTurn(rec, state));
    } else if ((e.type === 'over' || e.type === 'won') && rec.turnActive) {
      out.push(finishTurn(rec, state));
      out.push(finishGame(rec, state, e.type));
    }
  }

  rec.prevMode = mode;
  rec.lastScore = state.score;
  return out;
}

// --- transport --------------------------------------------------------------

/** Latest API responses, keyed by record kind. Smoke-test/debug handle. */
export const latest = { turn: null, game: null };

/**
 * POST records, fire-and-forget. Responses dispatch a 'breakout-stats'
 * CustomEvent on window (Phase 2 UI subscribes there). All failures are
 * silently dropped — stats are decoration, gameplay is the product.
 */
export function send(records, fetcher = globalThis.fetch) {
  for (const { kind, ...payload } of records) {
    fetcher(`/api/${kind}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true, // survives the tab closing mid-POST
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        latest[kind] = data;
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('breakout-stats', { detail: { kind, data } }));
        }
      })
      .catch(() => {});
  }
}
