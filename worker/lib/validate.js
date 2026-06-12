// Server-side plausibility validation for stats payloads. The write endpoint
// is public, so nothing from the client is trusted: every field is checked
// for type, range, and internal consistency before touching the database.
//
// The consistency rules come from the game's own scoring math
// (public/js/engine.js): each brick scores brickPoints (10) times the combo
// multiplier (1-10), so a turn's score is bounded by its brick count:
//   bricks * 10  <=  turnScore  <=  bricks * 100
// and reaching multiplier M takes at least M consecutive brick hits.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const MODES = new Set(['laptop', 'desktop']);

export const LIMITS = {
  maxTurns: 10, // lives is 3 today; headroom in case config changes
  maxBricksPerTurn: 4000, // board is ~1400 cells today
  brickPoints: 10,
  maxMultiplier: 10,
  maxTurnSeconds: 3600,
  maxGameSeconds: 4 * 3600,
};

const fail = (error) => ({ ok: false, error });

function isInt(v, lo, hi) {
  return Number.isInteger(v) && v >= lo && v <= hi;
}

function isNum(v, lo, hi) {
  return typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
}

/**
 * Validate a turn payload. Returns {ok: true, value} with a normalized
 * object containing exactly the expected fields, or {ok: false, error}.
 */
export function validateTurn(p) {
  if (typeof p !== 'object' || p === null || Array.isArray(p)) return fail('payload must be an object');
  if (typeof p.gameId !== 'string' || !UUID_RE.test(p.gameId)) return fail('gameId must be a UUID');
  if (!MODES.has(p.mode)) return fail('mode must be laptop|desktop');
  if (!isInt(p.turnNo, 1, LIMITS.maxTurns)) return fail(`turnNo must be an integer 1-${LIMITS.maxTurns}`);
  if (!isInt(p.bricks, 0, LIMITS.maxBricksPerTurn)) return fail('bricks out of range');
  const maxScore = p.bricks * LIMITS.brickPoints * LIMITS.maxMultiplier;
  if (!isInt(p.turnScore, 0, maxScore)) return fail('turnScore out of range');
  if (p.bricks > 0 && p.turnScore < p.bricks * LIMITS.brickPoints) {
    return fail('turnScore too low for brick count');
  }
  if (p.bricks === 0 && p.turnScore !== 0) return fail('turnScore must be 0 with no bricks');
  if (!isInt(p.maxCombo, 1, LIMITS.maxMultiplier)) return fail('maxCombo out of range');
  if (p.maxCombo > Math.max(1, p.bricks)) return fail('maxCombo impossible for brick count');
  if (!isInt(p.cumulativeScore, p.turnScore, LIMITS.maxTurns * LIMITS.maxBricksPerTurn * 100)) {
    return fail('cumulativeScore out of range');
  }
  if (!isNum(p.durationS, 0, LIMITS.maxTurnSeconds)) return fail('durationS out of range');
  return {
    ok: true,
    value: {
      gameId: p.gameId.toLowerCase(),
      mode: p.mode,
      turnNo: p.turnNo,
      turnScore: p.turnScore,
      cumulativeScore: p.cumulativeScore,
      bricks: p.bricks,
      maxCombo: p.maxCombo,
      durationS: p.durationS,
    },
  };
}

/** Validate a completed-game payload. Same contract as validateTurn. */
export function validateGame(p) {
  if (typeof p !== 'object' || p === null || Array.isArray(p)) return fail('payload must be an object');
  if (typeof p.gameId !== 'string' || !UUID_RE.test(p.gameId)) return fail('gameId must be a UUID');
  if (!MODES.has(p.mode)) return fail('mode must be laptop|desktop');
  if (!isInt(p.finalScore, 0, LIMITS.maxTurns * LIMITS.maxBricksPerTurn * 100)) {
    return fail('finalScore out of range');
  }
  if (!isInt(p.turns, 1, LIMITS.maxTurns)) return fail('turns out of range');
  if (p.outcome !== 'over' && p.outcome !== 'won') return fail('outcome must be over|won');
  if (!isInt(p.maxCombo, 1, LIMITS.maxMultiplier)) return fail('maxCombo out of range');
  if (!isNum(p.durationS, 0, LIMITS.maxGameSeconds)) return fail('durationS out of range');
  return {
    ok: true,
    value: {
      gameId: p.gameId.toLowerCase(),
      mode: p.mode,
      finalScore: p.finalScore,
      turns: p.turns,
      outcome: p.outcome,
      maxCombo: p.maxCombo,
      durationS: p.durationS,
    },
  };
}
