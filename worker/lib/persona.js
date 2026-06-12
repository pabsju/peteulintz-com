// Persona compiler: character file → system prompt. Borrowing elizaOS's
// trick of SAMPLING from the personality pools per request instead of
// sending everything — the model gets slightly different lore and examples
// each call, which keeps the voice varied and the prompt lean.
//
// The voice itself lives in public/js/character.js (served publicly, on
// purpose). Edit that file to retune him; this one just assembles.

import { CHARACTER } from '../../public/js/character.js';

const LORE_PER_PROMPT = 3;
const EXAMPLES_PER_PROMPT = 6;
const PHASE_EXAMPLES_MIN = 2; // current moment always represented

/** k random items, order preserved. Injectable rng for tests. */
export function sampleK(arr, k, rng = Math.random) {
  if (k >= arr.length) return [...arr];
  const picked = new Set();
  while (picked.size < k) picked.add(Math.floor(rng() * arr.length));
  return arr.filter((_, i) => picked.has(i));
}

/**
 * Examples for this prompt: at least PHASE_EXAMPLES_MIN from the current
 * moment (the model sees how to handle THIS situation), rest from anywhere.
 */
export function sampleExamples(examples, phase, rng = Math.random) {
  const ofPhase = examples.filter((e) => e.moment === phase);
  const others = examples.filter((e) => e.moment !== phase);
  const phasePick = sampleK(ofPhase, Math.min(PHASE_EXAMPLES_MIN, ofPhase.length), rng);
  const rest = sampleK(others, EXAMPLES_PER_PROMPT - phasePick.length, rng);
  return [...phasePick, ...rest];
}

/** Compile the system prompt for one request. */
export function buildSystem(phase = 'mid', { character = CHARACTER, rng = Math.random } = {}) {
  const lore = sampleK(character.lore, LORE_PER_PROMPT, rng);
  const examples = sampleExamples(character.messageExamples, phase, rng);
  return [
    `You are ${character.name}, the unseen commentator for a tiny ASCII breakout game on a personal website. One line at a time, you observe a stranger play.`,
    '',
    'WHO YOU ARE',
    ...character.bio.map((b) => `- ${b}`),
    ...lore.map((l) => `- ${l}`),
    `In a word (or seven): ${character.adjectives.join(', ')}.`,
    '',
    'WHAT MAKES YOUR LINES FUNNY (the joke comes first)',
    ...character.comedy.map((c) => `- ${c}`),
    '',
    'YOUR HOME TURF',
    ...character.topics.map((t) => `- ${t}`),
    '',
    'EXAMPLES OF YOUR VOICE (situation → your line; match the energy, never reuse verbatim)',
    ...examples.map((e) => `- [${e.cue}] ${e.line}`),
    '',
    'REFERENCES (garnish, not the meal)',
    ...character.referencePolicy.map((r) => `- ${r}`),
    '',
    'RULES',
    ...character.style.map((s) => `- ${s}`),
  ].join('\n');
}
