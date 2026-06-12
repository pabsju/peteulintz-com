import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize, bucketIndex } from '../worker/lib/histogram.js';

test('empty input → null, not an empty histogram', () => {
  assert.equal(summarize([]), null);
  assert.equal(summarize(undefined), null);
  assert.equal(summarize(null), null);
});

test('single value → one spike bucket', () => {
  assert.deepEqual(summarize([42]), { n: 1, min: 42, max: 42, median: 42, counts: [1] });
});

test('all-identical values → one spike bucket, not 20 empties', () => {
  const s = summarize([7, 7, 7, 7]);
  assert.deepEqual(s.counts, [4]);
  assert.equal(s.median, 7);
});

test('median: odd and even counts', () => {
  assert.equal(summarize([1, 2, 3]).median, 2);
  assert.equal(summarize([1, 2, 3, 4]).median, 2.5);
  assert.equal(summarize([3, 1, 4, 2]).median, 2.5, 'unsorted input');
});

test('counts sum to n and max lands in the last bucket', () => {
  const values = Array.from({ length: 100 }, (_, i) => i * 10);
  const s = summarize(values);
  assert.equal(s.counts.length, 20);
  assert.equal(s.counts.reduce((a, b) => a + b, 0), 100);
  assert.ok(s.counts[19] > 0, 'max value must not fall off the end');
  assert.equal(s.min, 0);
  assert.equal(s.max, 990);
});

test('uniform spread fills buckets evenly', () => {
  const values = Array.from({ length: 200 }, (_, i) => i); // 0..199, 20 buckets of 10
  const s = summarize(values);
  assert.ok(s.counts.every((c) => c === 10), JSON.stringify(s.counts));
});

test('custom bucket count', () => {
  const s = summarize([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 5);
  assert.equal(s.counts.length, 5);
  assert.deepEqual(s.counts, [2, 2, 2, 2, 2]);
});

test('bucketIndex: clamps, handles edges, null without spread', () => {
  assert.equal(bucketIndex(0, 0, 100, 20), 0);
  assert.equal(bucketIndex(100, 0, 100, 20), 19, 'max clamps into last bucket');
  assert.equal(bucketIndex(50, 0, 100, 20), 10);
  assert.equal(bucketIndex(-5, 0, 100, 20), 0, 'below-range clamps');
  assert.equal(bucketIndex(105, 0, 100, 20), 19, 'above-range clamps');
  assert.equal(bucketIndex(5, 5, 5, 20), null, 'no spread');
});

test('bucketIndex agrees with summarize bucketing', () => {
  const values = [10, 25, 31, 47, 58, 64, 79, 92, 100, 3];
  const s = summarize(values);
  // Recount via bucketIndex; must reproduce counts exactly.
  const recount = new Array(s.counts.length).fill(0);
  for (const v of values) recount[bucketIndex(v, s.min, s.max, s.counts.length)] += 1;
  assert.deepEqual(recount, s.counts);
});
