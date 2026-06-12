import test from 'node:test';
import assert from 'node:assert/strict';
import { makeLimiter } from '../worker/lib/ratelimit.js';
import { route } from '../worker/index.js';
import { makeDB } from './helpers/d1.mjs';

test('limiter: allows up to the limit, blocks past it, per key', () => {
  const allow = makeLimiter({ limit: 3 });
  const t0 = 1_000_000;
  assert.equal(allow('a', t0), true);
  assert.equal(allow('a', t0 + 1), true);
  assert.equal(allow('a', t0 + 2), true);
  assert.equal(allow('a', t0 + 3), false, '4th in window blocked');
  assert.equal(allow('b', t0 + 3), true, 'other keys unaffected');
});

test('limiter: window resets', () => {
  const allow = makeLimiter({ limit: 1, windowMs: 60_000 });
  const t0 = 1_000_000;
  assert.equal(allow('a', t0), true);
  assert.equal(allow('a', t0 + 59_999), false);
  assert.equal(allow('a', t0 + 60_000), true, 'fresh window');
});

test('limiter: cleanup purges expired keys when the map grows large', () => {
  const allow = makeLimiter({ limit: 1, windowMs: 1 });
  // Fill past the cleanup threshold with instantly-expiring keys…
  for (let i = 0; i < 10_001; i++) allow(`k${i}`, 1000);
  // …then trip cleanup with a fresh window; must not throw or slow to a crawl.
  assert.equal(allow('fresh', 999_999_999), true);
});

test('router: commentary over the per-IP limit → 429 with retry-after', async () => {
  const env = { DB: makeDB() }; // no API key → would be 503, but 429 hits first
  const req = () => new Request('http://t.local/api/commentary', {
    method: 'POST',
    headers: { 'cf-connecting-ip': '203.0.113.7' },
    body: JSON.stringify({}),
  });
  let last;
  for (let i = 0; i < 11; i++) last = await route(req(), env);
  assert.equal(last.status, 429);
  assert.equal(last.headers.get('retry-after'), '60');
});

test('router: health is never rate limited', async () => {
  const env = { DB: makeDB() };
  for (let i = 0; i < 50; i++) {
    const res = await route(new Request('http://t.local/api/health', {
      headers: { 'cf-connecting-ip': '203.0.113.8' },
    }), env);
    assert.equal(res.status, 200);
  }
});
