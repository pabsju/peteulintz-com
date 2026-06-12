// Stats overlay: between-ball percentile card and game-over summary.
// Pure builders (exported, node-tested) produce HTML strings; a thin DOM
// layer swaps them into #stats-card. The overlay is pointer-events:none so
// click-to-launch/replay still lands on the canvas underneath.
//
// Staleness guard: a card only shows when the API response's echoed score
// matches the live game score — responses from a previous game (or one that
// arrived after a replay) can never be shown against the wrong game.

// --- pure helpers -----------------------------------------------------------

/** 1 → '1ST', 2 → '2ND', 11 → '11TH', 103 → '103RD' */
export function ordinal(n) {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}TH`;
  const suffix = { 1: 'ST', 2: 'ND', 3: 'RD' }[n % 10] || 'TH';
  return `${n}${suffix}`;
}

// Same bucketing as the server (worker/lib/histogram.js) — duplicated
// because worker/ files are not served as assets.
export function bucketIndex(value, min, max, bucketCount) {
  if (!(max > min) || bucketCount < 1) return null;
  const idx = Math.floor(((value - min) / (max - min)) * bucketCount);
  return Math.max(0, Math.min(bucketCount - 1, idx));
}

/**
 * Bar specs for a histogram: heights as % of the tallest bucket, the
 * player's bucket flagged. Returns [] when there's nothing worth drawing
 * (no distribution, or a single spike that IS the player).
 */
export function barSpecs(distribution, markerValue) {
  if (!distribution || distribution.counts.length < 2) return [];
  const top = Math.max(...distribution.counts);
  const mine = bucketIndex(markerValue, distribution.min, distribution.max, distribution.counts.length);
  return distribution.counts.map((c, i) => ({
    pct: top ? Math.round((c / top) * 100) : 0,
    me: i === mine,
  }));
}

function barsHTML(distribution, markerValue) {
  const specs = barSpecs(distribution, markerValue);
  if (!specs.length) return '';
  const bars = specs
    .map((b) => `<i class="${b.me ? 'bar me' : 'bar'}" style="height:${Math.max(4, b.pct)}%"></i>`)
    .join('');
  return `<div class="bars">${bars}</div>`;
}

/** Between-ball card. `data` is the /api/turn response. */
export function buildTurnCard(data) {
  const p = data.cumulativePercentile;
  if (data.sampleSize <= 1 || p === null) {
    return [
      `<div class="stats-title">BALL ${data.turnNo} BANKED — ${data.cumulativeScore} PTS</div>`,
      `<div class="stats-dim">FIRST BALL-${data.turnNo} ON RECORD. YOU SET THE BAR.</div>`,
    ].join('');
  }
  return [
    `<div class="stats-title">BALL ${data.turnNo} BANKED — ${data.cumulativeScore} PTS</div>`,
    `<div class="stats-big">${ordinal(Math.round(p))} PERCENTILE</div>`,
    barsHTML(data.distribution, data.cumulativeScore),
    `<div class="stats-dim">SCORE AFTER BALL ${data.turnNo}, ${data.sampleSize} ${(data.mode || '').toUpperCase()} PLAYS · ` +
      `THIS BALL ALONE: ${ordinal(Math.round(data.turnPercentile))} PCTL</div>`,
  ].join('');
}

/** Game-over summary card. `data` is the /api/game response. */
export function buildGameCard(data) {
  const p = data.scorePercentile;
  if (data.sampleSize <= 1 || p === null) {
    return [
      `<div class="stats-title">THE NUMBERS</div>`,
      `<div class="stats-dim">FIRST GAME ON RECORD. EVERYTHING YOU DID IS A WORLD RECORD.</div>`,
    ].join('');
  }
  const d = data.distribution;
  return [
    `<div class="stats-title">THE NUMBERS</div>`,
    `<div class="stats-big">${ordinal(Math.round(p))} PERCENTILE OF ${data.sampleSize} ${(data.mode || '').toUpperCase()} GAMES</div>`,
    barsHTML(d, data.finalScore),
    `<div class="stats-dim">MEDIAN ${Math.round(d.median)} · BEST ${data.bestScore} · ` +
      `BOARD CLEARED ${data.gamesWon}X EVER</div>`,
  ].join('');
}

// --- DOM layer --------------------------------------------------------------

const latest = { turn: null, game: null };
let card = null;
let showing = ''; // '', 'turn', 'game' — avoids re-rendering every frame

/** Call once from game.js after the DOM exists. */
export function initStatsUI() {
  card = document.getElementById('stats-card');
  window.addEventListener('breakout-stats', (e) => {
    latest[e.detail.kind] = e.detail.data;
  });
}

/**
 * Call every frame with the live engine state. Decides which card (if any)
 * is visible. Score-equality guards keep stale responses off screen.
 */
export function updateStatsUI(state) {
  if (!card) return;
  let want = '';
  if (state.mode === 'ready' && latest.turn && latest.turn.cumulativeScore === state.score && state.score > 0) {
    want = 'turn';
  } else if ((state.mode === 'over' || state.mode === 'won')
    && latest.game && latest.game.finalScore === state.score) {
    want = 'game';
  }
  if (want === showing) return;
  showing = want;
  if (!want) {
    card.hidden = true;
    return;
  }
  card.innerHTML = want === 'turn' ? buildTurnCard(latest.turn) : buildGameCard(latest.game);
  card.classList.toggle('at-top', want === 'game');
  card.hidden = false;
}
