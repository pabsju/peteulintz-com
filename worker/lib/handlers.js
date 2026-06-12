// Route handlers for the stats API. Each takes (request, env) and returns a
// Response; env.DB is the D1 binding (or a fake in tests — anything with
// prepare().bind().first()/run()).
//
// Write path is idempotent: duplicate (game_id, turn_no) or game id inserts
// are ignored, so a retried POST can't double-count.

import { validateTurn, validateGame } from './validate.js';
import { percentileRank, roundPercentile } from './stats.js';
import { summarize } from './histogram.js';

// Histograms are built from at most this many rows. Percentiles always use
// the full table (COUNT scales fine); only the shape is sampled.
const HISTOGRAM_ROW_CAP = 5000;

const MAX_BODY_BYTES = 4096;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Parse a small JSON body; returns {ok, value | error, status}. */
async function readJson(request) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > MAX_BODY_BYTES) return { ok: false, error: 'payload too large', status: 413 };
  let text;
  try {
    text = await request.text();
  } catch {
    return { ok: false, error: 'unreadable body', status: 400 };
  }
  if (text.length > MAX_BODY_BYTES) return { ok: false, error: 'payload too large', status: 413 };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, error: 'invalid JSON', status: 400 };
  }
}

/**
 * POST /api/turn — record one ball, answer with where it sits in the
 * distribution of everyone's ball N.
 */
export async function handleTurn(request, env) {
  const body = await readJson(request);
  if (!body.ok) return json({ error: body.error }, body.status);
  const v = validateTurn(body.value);
  if (!v.ok) return json({ error: v.error }, 422);
  const t = v.value;

  await env.DB.prepare(
    `INSERT INTO turns (game_id, mode, turn_no, turn_score, cumulative_score, bricks, max_combo, duration_s)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (game_id, turn_no) DO NOTHING`
  ).bind(t.gameId, t.mode, t.turnNo, t.turnScore, t.cumulativeScore, t.bricks, t.maxCombo, t.durationS).run();

  // One pass over everyone's ball-N rows IN THIS MODE: counts below/at this
  // player's cumulative score and this ball's score. Laptop and desktop
  // scores aren't comparable, so they never share a distribution.
  const agg = await env.DB.prepare(
    `SELECT COUNT(*) AS total,
            SUM(cumulative_score < ?1) AS cum_below,
            SUM(cumulative_score = ?1) AS cum_ties,
            SUM(turn_score < ?2) AS turn_below,
            SUM(turn_score = ?2) AS turn_ties
     FROM turns WHERE turn_no = ?3 AND mode = ?4`
  ).bind(t.cumulativeScore, t.turnScore, t.turnNo, t.mode).first();

  // Distribution of everyone's cumulative score after ball N — the client
  // draws this with a "you are here" marker.
  const dist = await env.DB.prepare(
    `SELECT cumulative_score FROM turns WHERE turn_no = ? AND mode = ? LIMIT ${HISTOGRAM_ROW_CAP}`
  ).bind(t.turnNo, t.mode).all();

  return json({
    turnNo: t.turnNo,
    mode: t.mode,
    cumulativeScore: t.cumulativeScore, // echoed for the client's marker
    turnScore: t.turnScore,
    sampleSize: agg.total,
    cumulativePercentile: roundPercentile(
      percentileRank(agg.cum_below ?? 0, agg.cum_ties ?? 0, agg.total)),
    turnPercentile: roundPercentile(
      percentileRank(agg.turn_below ?? 0, agg.turn_ties ?? 0, agg.total)),
    distribution: summarize((dist.results ?? []).map((r) => r.cumulative_score)),
  });
}

/**
 * POST /api/game — record a completed game, answer with final-score
 * percentile and headline aggregates for the summary screen.
 */
export async function handleGame(request, env) {
  const body = await readJson(request);
  if (!body.ok) return json({ error: body.error }, body.status);
  const v = validateGame(body.value);
  if (!v.ok) return json({ error: v.error }, 422);
  const g = v.value;

  await env.DB.prepare(
    `INSERT INTO games (id, mode, final_score, turns, outcome, max_combo, duration_s)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO NOTHING`
  ).bind(g.gameId, g.mode, g.finalScore, g.turns, g.outcome, g.maxCombo, g.durationS).run();

  const agg = await env.DB.prepare(
    `SELECT COUNT(*) AS total,
            SUM(final_score < ?1) AS below,
            SUM(final_score = ?1) AS ties,
            MAX(final_score) AS best,
            SUM(outcome = 'won') AS wins
     FROM games WHERE mode = ?2`
  ).bind(g.finalScore, g.mode).first();

  const dist = await env.DB.prepare(
    `SELECT final_score FROM games WHERE mode = ? LIMIT ${HISTOGRAM_ROW_CAP}`
  ).bind(g.mode).all();

  return json({
    finalScore: g.finalScore, // echoed for the client's marker
    mode: g.mode,
    sampleSize: agg.total,
    scorePercentile: roundPercentile(
      percentileRank(agg.below ?? 0, agg.ties ?? 0, agg.total)),
    bestScore: agg.best ?? null,
    gamesWon: agg.wins ?? 0,
    distribution: summarize((dist.results ?? []).map((r) => r.final_score)),
  });
}

/** GET /api/health — liveness + DB reachability, used by the smoke test. */
export async function handleHealth(request, env) {
  try {
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM games').first();
    return json({ ok: true, games: row.n });
  } catch (e) {
    return json({ ok: false, error: 'db unavailable' }, 503);
  }
}
