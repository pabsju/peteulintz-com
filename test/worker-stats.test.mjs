import test from 'node:test';
import assert from 'node:assert/strict';
import { percentileRank, roundPercentile } from '../worker/lib/stats.js';

test('empty distribution returns null, not a fake rank', () => {
  assert.equal(percentileRank(0, 0, 0), null);
  assert.equal(percentileRank(0, 0, -1), null);
  assert.equal(percentileRank(0, 0, NaN), null);
  assert.equal(percentileRank(0, 0, undefined), null);
});

test('sole observation sits at the median', () => {
  // One row, and it's you (ties=1): mid-rank says 50th percentile.
  assert.equal(percentileRank(0, 1, 1), 50);
});

test('strictly best and strictly worst', () => {
  // 99 below you out of 100, you tie only yourself.
  assert.equal(percentileRank(99, 1, 100), 99.5);
  // 99 above you.
  assert.equal(percentileRank(0, 1, 100), 0.5);
});

test('ties take the mid-rank', () => {
  // 10 observations: 4 below, 2 tied (incl. you), 4 above → exactly 50.
  assert.equal(percentileRank(4, 2, 10), 50);
});

test('symmetry: rank from below + rank from above = 100', () => {
  const cases = [
    [3, 2, 10],
    [0, 5, 5],
    [7, 1, 20],
  ];
  for (const [below, ties, total] of cases) {
    const above = total - below - ties;
    const fromBelow = percentileRank(below, ties, total);
    const fromAbove = percentileRank(above, ties, total);
    assert.equal(fromBelow + fromAbove, 100, `case ${below}/${ties}/${total}`);
  }
});

test('value not in the distribution (ties=0) still ranks', () => {
  // Comparing a new score against existing rows without inserting it first.
  assert.equal(percentileRank(5, 0, 10), 50);
  assert.equal(percentileRank(10, 0, 10), 100);
  assert.equal(percentileRank(0, 0, 10), 0);
});

test('roundPercentile: one decimal, null passes through', () => {
  assert.equal(roundPercentile(null), null);
  assert.equal(roundPercentile(33.333333), 33.3);
  assert.equal(roundPercentile(99.95), 100);
  assert.equal(roundPercentile(0), 0);
});
