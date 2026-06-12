import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateSnapshot, sanitizeLine, buildUserMessage, handleCommentary,
} from '../worker/lib/commentary.js';

function snap(overrides = {}) {
  return {
    phase: 'mid', mode: 'desktop', score: 230, ballsLeft: 2, ballsUsed: 1, turnNo: 1, bricksLeft: 1100,
    bricksTotal: 1400, maxCombo: 4, secondsElapsed: 41.7, percentile: 38.2, sampleSize: 19,
    recentLines: ['Nice paddle. Shame about the aim.'],
    ...overrides,
  };
}

const post = (body) => new Request('http://t.local/api/commentary', {
  method: 'POST',
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

// --- validation ---

test('snapshot: accepts a plausible payload, rounds seconds', () => {
  const v = validateSnapshot(snap());
  assert.equal(v.ok, true);
  assert.equal(v.value.secondsElapsed, 42);
});

test('snapshot: phase is a closed enum', () => {
  for (const bad of ['midgame', '', null, 7, 'OVER']) {
    assert.equal(validateSnapshot(snap({ phase: bad })).ok, false, String(bad));
  }
  for (const good of ['mid', 'life', 'over', 'won']) {
    assert.equal(validateSnapshot(snap({ phase: good })).ok, true, good);
  }
});

test('snapshot: numeric bounds enforced', () => {
  assert.equal(validateSnapshot(snap({ score: -1 })).ok, false);
  assert.equal(validateSnapshot(snap({ score: 1.5 })).ok, false);
  assert.equal(validateSnapshot(snap({ ballsLeft: 11 })).ok, false);
  assert.equal(validateSnapshot(snap({ ballsUsed: -1 })).ok, false);
  assert.equal(validateSnapshot(snap({ ballsUsed: undefined })).ok, false, 'field is required');
  assert.equal(validateSnapshot(snap({ percentile: 101 })).ok, false);
  assert.equal(validateSnapshot(snap({ percentile: null })).ok, true);
  assert.equal(validateSnapshot(snap({ secondsElapsed: NaN })).ok, false);
});

test('snapshot: recentLines capped at 3 and scrubbed', () => {
  const v = validateSnapshot(snap({
    recentLines: ['a', 'b', 'c', 'd', 'e'],
  }));
  assert.equal(v.ok, true);
  assert.equal(v.value.recentLines.length, 3);
  const dirty = validateSnapshot(snap({
    recentLines: ['line\nwith\nnewlines\tand\x00controls   spaces'],
  }));
  assert.equal(dirty.value.recentLines[0].includes('\n'), false);
  assert.equal(dirty.value.recentLines[0].includes('\x00'), false);
});

test('sanitizeLine: strips newlines/controls/unicode, collapses, caps at 160', () => {
  assert.equal(sanitizeLine('  two\nlines\r\nhere  '), 'two lines here');
  assert.equal(sanitizeLine('emoji 🎉 gone'), 'emoji gone');
  assert.equal(sanitizeLine('x'.repeat(500)).length, 160);
  assert.equal(sanitizeLine(''), '');
});

test('buildUserMessage: numbers as JSON, recent lines listed, no free text leaks', () => {
  const v = validateSnapshot(snap());
  const msg = buildUserMessage(v.value);
  assert.match(msg, /"score":230/);
  assert.match(msg, /must not repeat/);
  assert.match(msg, /- Nice paddle\. Shame about the aim\./);
  const empty = buildUserMessage(validateSnapshot(snap({ recentLines: [] })).value);
  assert.doesNotMatch(empty, /must not repeat/);
});

// --- handler ---

test('handler: no API key configured → 503 (client falls back to canned)', async () => {
  const res = await handleCommentary(post(snap()), {});
  assert.equal(res.status, 503);
});

test('handler: invalid payload → 422 before any API call', async () => {
  let called = false;
  const res = await handleCommentary(
    post(snap({ phase: 'nope' })),
    { ANTHROPIC_API_KEY: 'k' },
    async () => { called = true; }
  );
  assert.equal(res.status, 422);
  assert.equal(called, false);
});

test('handler: bad JSON → 400', async () => {
  const res = await handleCommentary(post('{nope'), { ANTHROPIC_API_KEY: 'k' });
  assert.equal(res.status, 400);
});

test('handler: happy path — calls Anthropic with the snapshot, returns sanitized line', async () => {
  let captured;
  const fakeFetch = async (url, opts) => {
    captured = { url, body: JSON.parse(opts.body), headers: opts.headers };
    return {
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: '  Two balls in\nand the bricks are undefeated.  ' }] }),
    };
  };
  const res = await handleCommentary(post(snap()), { ANTHROPIC_API_KEY: 'sk-test' }, fakeFetch);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.line, 'Two balls in and the bricks are undefeated.');
  assert.equal(captured.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(captured.headers['x-api-key'], 'sk-test');
  assert.equal(captured.body.model, 'claude-sonnet-4-6');
  assert.ok(captured.body.max_tokens <= 100, 'snark stays cheap');
  assert.match(captured.body.messages[0].content, /"score":230/);
  assert.match(captured.body.system, /ONE line/);
});

test('handler: Anthropic failure → 502; empty text → 502', async () => {
  const env = { ANTHROPIC_API_KEY: 'k' };
  const down = await handleCommentary(post(snap()), env, async () => ({ ok: false, status: 529 }));
  assert.equal(down.status, 502);
  const empty = await handleCommentary(post(snap()), env,
    async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: '   ' }] }) }));
  assert.equal(empty.status, 502);
});
