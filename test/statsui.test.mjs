// Pure-builder tests for the stats overlay. The DOM layer is two functions
// of glue verified by the e2e screenshot pass; everything that can be wrong
// in interesting ways (text, ordinals, bars, staleness inputs) is here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ordinal, bucketIndex, barSpecs, histogramHTML, buildTurnCard, buildGameCard } from '../public/js/statsui.js';
import { summarize } from '../worker/lib/histogram.js';

test('ordinal: the cursed English suffixes', () => {
  const cases = [
    [1, '1ST'], [2, '2ND'], [3, '3RD'], [4, '4TH'],
    [11, '11TH'], [12, '12TH'], [13, '13TH'], // teens are all TH
    [21, '21ST'], [22, '22ND'], [23, '23RD'],
    [50, '50TH'], [101, '101ST'], [111, '111TH'], [113, '113TH'],
  ];
  for (const [n, want] of cases) assert.equal(ordinal(n), want);
});

test('client bucketIndex matches server bucketing', () => {
  const values = [10, 25, 31, 47, 58, 64, 79, 92, 100, 3];
  const s = summarize(values);
  const recount = new Array(s.counts.length).fill(0);
  for (const v of values) recount[bucketIndex(v, s.min, s.max, s.counts.length)] += 1;
  assert.deepEqual(recount, s.counts, 'duplicated function must not drift');
});

test('barSpecs: heights relative to tallest bucket, player flagged', () => {
  const dist = { n: 6, min: 0, max: 100, median: 40, counts: [3, 1, 0, 2] };
  const specs = barSpecs(dist, 95); // lands in the last bucket
  assert.equal(specs.length, 4);
  assert.equal(specs[0].pct, 100, 'tallest bucket is full height');
  assert.equal(specs[1].pct, 33);
  assert.equal(specs[2].pct, 0);
  assert.deepEqual(specs.map((s) => s.me), [false, false, false, true]);
});

test('barSpecs: nothing to draw for null or single-spike distributions', () => {
  assert.deepEqual(barSpecs(null, 50), []);
  assert.deepEqual(barSpecs({ n: 4, min: 7, max: 7, median: 7, counts: [4] }, 7), []);
});

test('histogram: labeled axes — y runs 0 to tallest bucket, x runs min to max', () => {
  const dist = { n: 15, min: 0, max: 900, median: 300, counts: [5, 4, 3, 2, 1] };
  const html = histogramHTML(dist, 80, 'BALL SCORE', 'BALLS');
  assert.match(html, /class="histo-y"><span>5<\/span>/, 'y top tick = tallest bucket');
  assert.match(html, /<span>0<\/span><\/div>/, 'y bottom tick = 0');
  assert.match(html, /histo-ylabel">BALLS</);
  assert.match(html, /histo-x"><span>0<\/span>/, 'x left tick = min');
  assert.match(html, /<span>900<\/span>/, 'x right tick = max');
  assert.match(html, /histo-xlabel">BALL SCORE</);
  assert.match(html, /bar me/, 'player marker present');
});

test('histogram: empty for null or single-spike distributions', () => {
  assert.equal(histogramHTML(null, 50, 'X', 'Y'), '');
  assert.equal(histogramHTML({ n: 4, min: 7, max: 7, median: 7, counts: [4] }, 7, 'X', 'Y'), '');
});

test('turn card: this ball ranked alone against all balls ever', () => {
  const html = buildTurnCard({
    turnNo: 2, mode: 'laptop', cumulativeScore: 230, turnScore: 80, sampleSize: 15,
    turnPercentile: 38.2,
    distribution: { n: 15, min: 0, max: 900, median: 300, counts: [5, 4, 3, 2, 1] },
  });
  assert.match(html, /BALL 2 — 80 PTS/);
  assert.match(html, /38TH PERCENTILE OF 15 LAPTOP BALLS/);
  assert.match(html, /GAME SO FAR: 230 PTS/);
  assert.match(html, /histo-xlabel">BALL SCORE</);
  assert.match(html, /bar me/, 'player marker present');
  assert.doesNotMatch(html, /AFTER BALL|cumulativePercentile/, 'no as-of-this-point stat');
});

test('turn card: sample of one gets the set-the-bar line, no bars, no NaN', () => {
  const html = buildTurnCard({
    turnNo: 1, cumulativeScore: 100, turnScore: 100, sampleSize: 1,
    turnPercentile: 50,
    distribution: { n: 1, min: 100, max: 100, median: 100, counts: [1] },
  });
  assert.match(html, /FIRST BALL ON RECORD/);
  assert.doesNotMatch(html, /PERCENTILE/);
  assert.doesNotMatch(html, /NaN|null|undefined/);
});

test('game card: two distributions — total score and avg per ball', () => {
  const html = buildGameCard({
    finalScore: 970, avgPerBall: 323.3333, mode: 'desktop', sampleSize: 4,
    scorePercentile: 87.5, avgPercentile: 62.5, bestScore: 1240, gamesWon: 1,
    distribution: { n: 4, min: 150, max: 1240, median: 560, counts: [2, 1, 0, 1] },
    avgDistribution: { n: 4, min: 50, max: 413.3, median: 186.7, counts: [2, 1, 0, 1] },
  });
  assert.match(html, /88TH PERCENTILE OF 4 DESKTOP GAMES/);
  assert.match(html, /histo-xlabel">TOTAL SCORE</);
  assert.match(html, /323 PTS PER BALL — 63RD PCTL/);
  assert.match(html, /histo-xlabel">AVG SCORE PER BALL</);
  assert.match(html, /MEDIAN 560/);
  assert.match(html, /BEST 1240/);
  assert.match(html, /CLEARED 1X EVER/);
  assert.match(html, /bar me/);
  assert.doesNotMatch(html, /NaN|null|undefined|\d\.\d+ PTS/, 'avg rounded for display');
});

test('game card: first game ever gets the world-record line, no NaN', () => {
  const html = buildGameCard({
    finalScore: 300, avgPerBall: 100, sampleSize: 1, scorePercentile: 50, avgPercentile: 50,
    bestScore: 300, gamesWon: 0,
    distribution: { n: 1, min: 300, max: 300, median: 300, counts: [1] },
    avgDistribution: { n: 1, min: 100, max: 100, median: 100, counts: [1] },
  });
  assert.match(html, /WORLD RECORD/);
  assert.doesNotMatch(html, /NaN|null|undefined/);
});

test('cards never emit NaN/undefined for fractional percentiles', () => {
  // Math.round applied to e.g. 83.3 → 83RD, never "83.3TH".
  const html = buildTurnCard({
    turnNo: 3, cumulativeScore: 970, turnScore: 10, sampleSize: 3,
    turnPercentile: 83.3,
    distribution: { n: 3, min: 10, max: 970, median: 200, counts: [2, 1] },
  });
  assert.match(html, /83RD PERCENTILE/);
  assert.doesNotMatch(html, /NaN|null|undefined/);
});
