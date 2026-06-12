// The snarky observer, client side. Decides WHEN to heckle (pure, tested),
// asks /api/commentary for a line, and falls back to canned material when
// the API is missing or down. Display is a fading line top-left of the pane.
//
// Cadence (user spec): roughly every 20s mid-play (jittered 14-26s so it
// never feels metronomic), a bonus jab when a ball is lost (cooldown-gated),
// and always a closer at game end.

// --- canned fallback --------------------------------------------------------

// Voice: Neil Peart watching you drop beats. Rush/Tool/cyberpunk/dungeon-
// crawler material, same as the live commentator's system prompt.
export const CANNED = [
  "A modern-day warrior. With a paddle. Allegedly.",
  "The Spirit of Radio called. It wants less dead air.",
  "Subdivisions: where the ball went, and your attention didn't.",
  "2112 is a score, not a prophecy. Dream big.",
  "YYZ changes time signatures more smoothly than you change direction.",
  "That wasn't a combo. That was a grace note.",
  "La Villa Strangiato was unrehearsable. This, apparently, is too.",
  "Closer to the Heart. Farther from the brick.",
  "Freewill means you chose that angle on purpose.",
  "A drum solo has fewer dropped beats than this run.",
  "Your ice is weak, console cowboy.",
  "Roll for initiative. Or keep standing there. Classic.",
  "New achievement: Brick Apologist.",
  "The announcer would have given that death a sponsor.",
  "The Library at Mount Char keeps a catalog of your misses. It's the long wing.",
  "Lateralus is in 9/8. You're in no time signature at all.",
  "Working Man? Watching man.",
  "Exit... the warrior. The ball, also exiting.",
  "I've kept time through three-hour sets. You lost it in nine seconds.",
  "The meek shall inherit this score.",
  "Limelight: not where this is headed.",
  "Every brick you miss, somewhere a cowbell goes unstruck.",
];

/**
 * Shuffle bag: hands out items in random order, no repeats until the bag
 * empties, and never the same item twice in a row across refills.
 */
export function makeBag(items, rng = Math.random) {
  let bag = [];
  let last = null;
  return function next() {
    if (bag.length === 0) {
      bag = [...items];
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
      // refill could lead with what we just said — swap it deeper
      if (bag.length > 1 && bag[bag.length - 1] === last) {
        [bag[bag.length - 1], bag[0]] = [bag[0], bag[bag.length - 1]];
      }
    }
    last = bag.pop();
    return last;
  };
}

// --- cadence (pure) ---------------------------------------------------------

const MID_MIN = 14, MID_SPREAD = 12; // next mid-play jab in 14-26s
const LIFE_COOLDOWN = 8; // no life-lost jab within 8s of any line

export function createSnark(rng = Math.random) {
  return {
    rng,
    sinceLast: 999, // long ago — game-start heckle eligibility
    untilMid: MID_MIN + rng() * MID_SPREAD,
    inflight: false,
    recent: [], // last 3 lines shown, for the no-repeat prompt
  };
}

/**
 * One frame of cadence. Returns a phase string when it's time to heckle
 * ('mid' | 'life' | 'over' | 'won'), else null. Caller owns the request.
 */
export function decide(snark, state, events, dt) {
  snark.sinceLast += dt;
  for (const e of events) {
    if (e.type === 'over' || e.type === 'won') return e.type; // always close
    if (e.type === 'life' && snark.sinceLast >= LIFE_COOLDOWN) return 'life';
  }
  if (state.mode !== 'playing') return null; // clock only runs during play
  snark.untilMid -= dt;
  if (snark.untilMid <= 0 && snark.sinceLast >= LIFE_COOLDOWN) return 'mid';
  return null;
}

/** Reset timers after a line goes out (any source). */
export function noteSpoken(snark, line) {
  snark.sinceLast = 0;
  snark.untilMid = MID_MIN + snark.rng() * MID_SPREAD;
  snark.recent.push(line);
  if (snark.recent.length > 3) snark.recent.shift();
}

/**
 * Snapshot for /api/commentary — numbers only (the endpoint enforces this;
 * see worker/lib/commentary.js for why). Percentile source depends on the
 * moment: game-end phases use the final-score percentile when it's already
 * arrived, otherwise the latest between-ball one.
 */
export function buildSnapshot(phase, state, recorder, latestStats, recentLines = []) {
  const gameEnd = phase === 'over' || phase === 'won';
  const src = gameEnd && latestStats.game ? latestStats.game : latestStats.turn;
  const percentile = src
    ? (src.scorePercentile ?? src.cumulativePercentile ?? null)
    : null;
  return {
    phase,
    score: state.score,
    lives: state.lives,
    turnNo: recorder.turnNo,
    bricksLeft: state.total - state.destroyed,
    maxCombo: recorder.gameMaxCombo,
    secondsElapsed: Math.round(recorder.gameTime * 10) / 10,
    percentile,
    sampleSize: src ? src.sampleSize : 0,
    recentLines: [...recentLines],
  };
}

// --- DOM driver --------------------------------------------------------------

const HIDE_AFTER_MS = 9000;

let el = null;
let hideTimer = null;
let snarkState = null;
let bag = null;

export function initSnark() {
  el = document.getElementById('snark');
  snarkState = createSnark();
  bag = makeBag(CANNED);
}

function show(line) {
  if (!el) return;
  noteSpoken(snarkState, line);
  el.textContent = line;
  el.hidden = false;
  el.classList.remove('show');
  void el.offsetWidth; // restart the fade transition
  el.classList.add('show');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => el.classList.remove('show'), HIDE_AFTER_MS);
}

/** Frame hook, called from game.js (inside its stats try/catch). */
export function snarkTick(state, events, dt, recorder, latestStats) {
  if (!snarkState) return;
  const phase = decide(snarkState, state, events, dt);
  if (!phase || snarkState.inflight) return;
  snarkState.inflight = true;
  const snapshot = buildSnapshot(phase, state, recorder, latestStats, snarkState.recent);
  fetch('/api/commentary', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(snapshot),
  })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => show(data?.line || bag()))
    .catch(() => show(bag()))
    .finally(() => { snarkState.inflight = false; });
}
