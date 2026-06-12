// Persona compiler tests: the character file is data, the compiler is
// logic, and the prompt the model sees is their product — so the product
// is what gets asserted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSystem, sampleK, sampleExamples } from '../worker/lib/persona.js';
import { CHARACTER } from '../public/js/character.js';

const seqRng = (vals) => {
  let i = 0;
  return () => vals[i++ % vals.length];
};

test('character file shape: every example has a valid moment, cue, line', () => {
  const moments = new Set(['mid', 'life', 'over', 'won']);
  for (const e of CHARACTER.messageExamples) {
    assert.ok(moments.has(e.moment), e.moment);
    assert.ok(e.cue.length > 0 && e.line.length > 0);
  }
  assert.ok(CHARACTER.messageExamples.length >= 12, 'few-shot pool stays meaty');
});

test('character file: fallback lines unique (a dupe defeats the shuffle bag)', () => {
  assert.equal(new Set(CHARACTER.fallbackLines).size, CHARACTER.fallbackLines.length);
});

test('sampleK: k of n, order preserved, whole array when k >= n', () => {
  const arr = ['a', 'b', 'c', 'd', 'e'];
  const picked = sampleK(arr, 3, seqRng([0.1, 0.5, 0.9, 0.3]));
  assert.equal(picked.length, 3);
  // order preserved means picked appears in original order
  assert.deepEqual(picked, arr.filter((x) => picked.includes(x)));
  assert.deepEqual(sampleK(arr, 99), arr);
});

test('sampleExamples: current moment always represented', () => {
  for (const phase of ['mid', 'life', 'over', 'won']) {
    const picked = sampleExamples(CHARACTER.messageExamples, phase, Math.random);
    const ofPhase = picked.filter((e) => e.moment === phase).length;
    assert.ok(ofPhase >= 2, `${phase}: only ${ofPhase} of its own examples`);
    assert.ok(picked.length <= 6);
  }
});

test('buildSystem: all fixed sections present, every style rule verbatim', () => {
  const sys = buildSystem('mid');
  assert.match(sys, /You are The Professor/);
  assert.match(sys, /WHO YOU ARE/);
  assert.match(sys, /WHAT MAKES YOUR LINES FUNNY/);
  assert.match(sys, /EXAMPLES OF YOUR VOICE/);
  assert.match(sys, /REFERENCES \(garnish, not the meal\)/);
  assert.match(sys, /RULES/);
  for (const rule of CHARACTER.style) {
    assert.ok(sys.includes(rule), `missing rule: ${rule.slice(0, 40)}…`);
  }
  for (const bio of CHARACTER.bio) {
    assert.ok(sys.includes(bio), 'bio lines all included');
  }
});

test('buildSystem: deterministic under a fixed rng', () => {
  const a = buildSystem('life', { rng: seqRng([0.2, 0.7, 0.4, 0.9, 0.1, 0.6]) });
  const b = buildSystem('life', { rng: seqRng([0.2, 0.7, 0.4, 0.9, 0.1, 0.6]) });
  assert.equal(a, b);
});

test('buildSystem: sampling actually varies the prompt across calls', () => {
  const prompts = new Set();
  for (let i = 0; i < 20; i++) prompts.add(buildSystem('mid'));
  assert.ok(prompts.size > 1, 'two identical prompts in 20 draws would be suspicious');
});

test('buildSystem: phase examples surface for the requested moment', () => {
  const sys = buildSystem('won', { rng: seqRng([0.01, 0.5, 0.99, 0.3, 0.7]) });
  assert.match(sys, /clean board|click track/, 'a won-moment example made it in');
});
