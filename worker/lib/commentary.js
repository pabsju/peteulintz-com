// /api/commentary — the snarky observer. Takes a numbers-only snapshot of
// the current game, asks Claude Sonnet for one heckle, returns {line}.
//
// Prompt-injection posture: the client can POST anything, so nothing
// free-text from the payload reaches the prompt. Every field is numeric or
// a closed enum — EXCEPT recentLines (needed so the model doesn't repeat
// itself), which is length-capped, charset-scrubbed, and only ever contains
// text that originated from this endpoint or the canned list anyway.

const MODEL = 'claude-sonnet-4-6';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MAX_LINE_CHARS = 160;

const PHASES = new Set(['mid', 'life', 'over', 'won']);

const SYSTEM = `You are the unseen color commentator for a tiny ASCII breakout game on a personal website. You heckle in one-liners.

Persona: a razor-sharp standup doing crowd work — quick, observational, a little merciless, never cruel. The player clicked into this; they want to be roasted.

Rules:
- ONE line. No preamble, no quotes around it, no emoji, no hashtags.
- Usually under 22 words. About one time in four, go very short: 2-6 words.
- Ground the joke in the numbers. Specific beats generic. A 12th-percentile score deserves different material than a 91st.
- "percentile" compares this player to everyone who has ever played (higher is better). "sampleSize" is how many plays that comparison rests on — mock tiny sample sizes if you like.
- Do not repeat or lightly rephrase the recent lines provided.
- Profanity no stronger than damn/hell. Mock the gameplay, never the person's identity.
- Moments: mid = mid-ball check-in; life = they just lost a ball; over = game just ended in defeat; won = they cleared the whole board (rare — be impressed, but stay in character).`;

const fail = (error) => ({ ok: false, error });

function intIn(v, lo, hi) {
  return Number.isInteger(v) && v >= lo && v <= hi;
}

function pctOrNull(v) {
  return v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100);
}

/** Numbers-only snapshot validation. Returns {ok, value|error}. */
export function validateSnapshot(p) {
  if (typeof p !== 'object' || p === null || Array.isArray(p)) return fail('payload must be an object');
  if (!PHASES.has(p.phase)) return fail('bad phase');
  if (!intIn(p.score, 0, 4_000_000)) return fail('score out of range');
  if (!intIn(p.lives, 0, 10)) return fail('lives out of range');
  if (!intIn(p.turnNo, 0, 10)) return fail('turnNo out of range');
  if (!intIn(p.bricksLeft, 0, 10_000)) return fail('bricksLeft out of range');
  if (!intIn(p.maxCombo, 1, 10)) return fail('maxCombo out of range');
  if (typeof p.secondsElapsed !== 'number' || !Number.isFinite(p.secondsElapsed)
    || p.secondsElapsed < 0 || p.secondsElapsed > 14_400) return fail('secondsElapsed out of range');
  if (!pctOrNull(p.percentile ?? null)) return fail('percentile out of range');
  if (!intIn(p.sampleSize ?? 0, 0, 100_000_000)) return fail('sampleSize out of range');
  const lines = Array.isArray(p.recentLines) ? p.recentLines.slice(0, 3) : [];
  if (!lines.every((l) => typeof l === 'string')) return fail('recentLines must be strings');
  return {
    ok: true,
    value: {
      phase: p.phase,
      score: p.score,
      lives: p.lives,
      turnNo: p.turnNo,
      bricksLeft: p.bricksLeft,
      maxCombo: p.maxCombo,
      secondsElapsed: Math.round(p.secondsElapsed),
      percentile: p.percentile ?? null,
      sampleSize: p.sampleSize ?? 0,
      recentLines: lines.map(sanitizeLine),
    },
  };
}

/** One displayable line: printable chars only, collapsed whitespace, capped. */
export function sanitizeLine(s) {
  return String(s)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, MAX_LINE_CHARS);
}

export function buildUserMessage(snap) {
  const { recentLines, ...numbers } = snap;
  const recent = recentLines.length
    ? `\nRecent lines you must not repeat:\n${recentLines.map((l) => `- ${l}`).join('\n')}`
    : '';
  return `Current play:\n${JSON.stringify(numbers)}${recent}\n\nYour line:`;
}

/**
 * POST /api/commentary. `fetcher` is injectable for tests; defaults to the
 * platform fetch. 503 when no key is configured (client falls back to canned
 * lines), 502 when Anthropic errors.
 */
export async function handleCommentary(request, env, fetcher = fetch) {
  let parsed;
  try {
    parsed = JSON.parse(await request.text());
  } catch {
    return jsonRes({ error: 'invalid JSON' }, 400);
  }
  const v = validateSnapshot(parsed);
  if (!v.ok) return jsonRes({ error: v.error }, 422);
  if (!env.ANTHROPIC_API_KEY) return jsonRes({ error: 'commentary not configured' }, 503);

  const res = await fetcher(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 80,
      temperature: 1,
      system: SYSTEM,
      messages: [{ role: 'user', content: buildUserMessage(v.value) }],
    }),
  });
  if (!res.ok) return jsonRes({ error: 'commentary unavailable' }, 502);
  const data = await res.json();
  const raw = data?.content?.[0]?.text ?? '';
  const line = sanitizeLine(raw);
  if (!line) return jsonRes({ error: 'empty line' }, 502);
  return jsonRes({ line });
}

function jsonRes(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
