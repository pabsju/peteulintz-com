# Build notes: stats + AI feature

Teaching journal for adding data persistence/aggregation + AI snark to the
breakout game. Written as we build, newest phase at the bottom. Private —
nothing under `docs/` is deployed (Cloudflare serves only `public/`).

## The goal

Demonstrate a full AI-era app loop on a static-looking site:

```
browser game ──POST──▶ Worker API ──SQL──▶ D1 (SQLite at the edge)
     ▲                    │
     └──percentiles───────┘          (Phase 3: Worker ──▶ Claude Sonnet → snark)
```

Phases: **1)** Worker + D1 + recording (this doc starts here) **2)** stats UI
**3)** AI snark (Sonnet, ~20s cadence, randomized canned fallbacks)
**4)** hardening, seeding, prod deploy.

Workflow rule: branch `stats-api`, because **pushes to `master` auto-deploy
to peteulintz.com**. Nothing merges until the integration oracle (below) passes.

---

## Phase 1

### Concept: Worker-with-assets (the platform shift)

Until now `wrangler.jsonc` had only an `assets` block — Cloudflare served
`public/` as dumb static files, no code of ours ran on the server. Adding
`"main": "worker/index.js"` changes the model:

1. Request comes in. If the path matches a file in `public/`, the static
   asset is served — the Worker never runs. Zero added latency for the site.
2. No matching file (e.g. `/api/turn`) → our Worker's `fetch()` handler runs.
3. `run_worker_first: ["/api/*"]` pins that down explicitly: API routes always
   hit the Worker, even if someone later drops an `api/` folder in `public/`.

So the site stays static and free; we bolt a tiny API onto the misses.

### Concept: D1 and bindings

D1 = SQLite, managed by Cloudflare, replicated at the edge. The Worker gets it
via a **binding**: the `d1_databases` block in wrangler.jsonc says "inject a
database client as `env.DB`". No connection strings, no driver, no pool —
`env.DB.prepare("SELECT ...").bind(x).first()`.

Locally, `wrangler dev` fakes the whole thing with a real SQLite file under
`.wrangler/state/` — works **without Cloudflare auth**. The `database_id` in
config only matters at deploy time (prod DB doesn't exist yet; creating it
needs `npx wrangler login` — deferred to Phase 4).

Migrations: numbered `.sql` files in `migrations/`. `wrangler d1 migrations
apply DB --local` runs the unapplied ones, tracked in a `d1_migrations` table.
Same command without `--local` does prod. One schema definition, two targets.

### Schema reasoning

Two tables, because we aggregate at two grains:

- `turns` — one row per ball played. Powers "your score after ball 2 vs
  everyone else's after ball 2" (`WHERE turn_no = 2`) and "this ball vs all
  balls" distributions. Inserted live, so even abandoned games contribute.
- `games` — one row per *completed* game. Powers final-score percentile and
  end-of-game summary stats. Inserted only at over/won.

No foreign key from turns→games: turns arrive before the game row exists
(game row is written at game end). FK would force a stub-row dance for zero
benefit at this scale.

Indexes mirror the two hot queries: `turns(turn_no, cumulative_score)` and
`games(final_score)`. SQLite can answer "how many games scored below X" from
the index alone.

### Concept: percentile without a percentile function

SQLite has no `PERCENT_RANK()` we want to lean on across D1 versions, and we
don't need it. Percentile rank of score X among N rows is just counting:

```
rank = (count_below + 0.5 * count_equal) / total
```

The `0.5 * ties` is the standard mid-rank convention: if 10 players all
scored exactly your score, you're treated as the middle of that clump, not
the bottom — keeps ranks symmetric (your percentile + the "from the top"
percentile = 100%). Two `COUNT`s in one SQL pass, math in a pure function.

### Test strategy (the oracle)

Four layers, cheapest first. The repo ethos is zero-dependency, so no vitest,
no miniflare — `node:test` everywhere:

1. **Pure unit** — percentile math, payload validation, the client-side turn
   recorder. No DOM, no network, no D1. Exhaustive edge cases here because
   it's free.
2. **Handler tests with a fake D1** — the Worker's route handlers take
   `(request, env)`; tests inject `env.DB` as a ~40-line fake implementing
   `prepare/bind/first/run`. Asserts SQL params, status codes, error paths
   (bad JSON, wrong method, oversized payload, unknown route).
3. **Real D1, real Worker** — `wrangler dev` + curl. Catches config mistakes
   the fakes can't (binding names, migration syntax).
4. **End-to-end** — headless chromium (`tools/cdp_smoke.mjs`) plays a real
   game against `wrangler dev`, then we query the local D1 and assert rows
   landed with sane values. This is the gate before anything merges.

### Client design: the recorder

`game.js` already calls `handleEvents(step(...))` every frame. We add one
line: a **recorder** that gets `(state, events, dt)` per frame. It's a pure
state machine (testable in node):

- `ready → playing` transition = ball launched, turn timer starts
- `brick` events = bricks++, track max combo tier
- `life`/`over`/`won` = turn ends → emit a turn record; `over`/`won` also
  emit a game record
- score reset while in `ready`/game-end = new game (player clicked replay or
  resized) → new game id

Turn boundaries live in the recorder, not the engine — the engine stays
untouched and pure. Emitted records go to a thin transport (`fetch`,
fire-and-forget, errors swallowed — **the game must never stutter or break
because the API is down**). Responses (percentiles) are stashed for Phase 2's
UI and console.logged for now.

`crypto.randomUUID()` names each game; no accounts, no cookies, no PII —
a game is just an anonymous row.

### Decisions log

| Decision | Why |
|----------|-----|
| Branch `stats-api`, no master pushes | master auto-deploys to prod |
| D1 over KV | need distributions (SQL), not key lookups |
| No FK turns→games | turns arrive before game row; scale doesn't justify it |
| Mid-rank percentile | symmetric, standard, ties handled sanely |
| node:test + fake D1, no miniflare | zero-dep ethos; fakes cover the seam |
| Fire-and-forget POSTs | API failure must never affect gameplay |
| Snark: Sonnet, ~20s cadence, randomized canned fallback | user call — quality over cost (Phase 3) |

### Phase 1 results & gotchas (2026-06-12)

**Done and verified.** 77 node tests green; curl checks against real
`wrangler dev` + local D1 hit every status path (200/400/405/413/422/500);
headless chromium played a full losing game through the real stack and the
D1 rows matched the played game turn-for-turn (970 final, 3 turns, a 10X
combo on ball 2). Live percentile math confirmed: 970 vs an earlier 150 →
75th percentile, exactly (1 below + 0.5×self-tie) / 2.

Gotchas worth remembering:

- **`node:sqlite` binding quirk** — anonymous `?` placeholders want
  positional args (`stmt.run(a, b)`), but numbered `?N` placeholders demand
  an object (`stmt.get({1: a, 2: b})`). Mixing them up throws
  "column index out of range" / "Unknown named parameter". The test D1
  adapter (test/helpers/d1.mjs) sniffs the SQL with `/\?\d/` and picks.
  D1 itself doesn't care — `.bind(a, b)` works for both styles.
- **node 23.3 needs `--experimental-sqlite`** (unflagged in 23.4+). Baked
  into the README test command.
- **`wrangler dev` + local D1 needs zero Cloudflare auth.** Migrations,
  queries, the whole Worker — all run against `.wrangler/state/`. Auth is
  only needed when the real D1 gets created at deploy time.
- **The smoke-test autoplayer never dies** (it tracks the ball perfectly),
  so it can't exercise turn/game records. `tools/integration_stats.mjs`
  parks the paddle in the corner instead — the worst player in the world,
  loses all 3 balls in ~10s, which is exactly what the pipeline needs.
- **The contract test is the keystone**: test/stats-recorder.test.mjs feeds
  the recorder synthetic games and asserts every emitted record passes the
  *server's* validators. Client and server can't drift apart silently.

---

## Phase 2 (2026-06-12): stats UI

### What was added

- **API grew distributions.** `/api/turn` and `/api/game` now return a
  `distribution` object — `{n, min, max, median, counts[20]}` — plus an echo
  of the score that was just submitted. The echo matters: the client needs
  to draw a "you are here" marker, and matching response-to-game by score is
  also the staleness guard (below). Histograms are built from at most 5000
  rows (`HISTOGRAM_ROW_CAP`); percentiles still use full COUNTs.
- **`worker/lib/histogram.js`** — pure bucketing + median. Design choices:
  empty data returns `null` (the UI tells the "no data" story, not a fake
  zero histogram); all-identical values return ONE spike bucket rather than
  20 empties.
- **`public/js/statsui.js`** — pure HTML builders (node-tested) + ~30 lines
  of DOM glue. Two cards: between-ball (bottom of the pane, in the dead zone
  above CLICK TO LAUNCH) and game-over summary (top quarter, clear of the
  canvas-drawn GAME OVER text). `pointer-events: none` so launch/replay
  clicks pass through the card into the canvas.

### Concept: staleness guarding without state coupling

The stats responses arrive async — possibly after the player already
relaunched, or even started a new game. Rather than threading game ids
through the UI, the card only shows when the response's echoed score equals
the live engine score (`latest.turn.cumulativeScore === state.score`).
A stale response can't match, so it can't render against the wrong game.
Cheap, no extra state, self-healing.

### Concept: duplicated 6-line function > shared module (here)

`bucketIndex` exists in both worker/lib/histogram.js and statsui.js because
`worker/` files aren't served as assets and restructuring the deploy to share
6 lines isn't worth it. The drift risk is handled by a test instead:
statsui.test.mjs recounts a real `summarize()` histogram through the client
copy and asserts identical buckets. If they ever diverge, CI says so.

### Verification

95/95 tests. E2e (`tools/integration_stats.mjs`, now screenshot-capable)
played a real game through `wrangler dev`: both cards rendered with live
data and correct math (final 1510 among {150, 970, 1510} → 83rd percentile,
median 970 — hand-checked). Screenshots eyeballed for placement after one
iteration (first cut put the turn card on top of the marquee text).

### Production bug #1 (caught pre-production): secure-context APIs

First real-browser viewing (http://192.168.1.30:8000, remote machine) showed
a blank game. Root cause chain worth remembering:

1. `crypto.randomUUID` is a **secure-context-only** API: available on https
   and on localhost, absent on plain-http LAN IPs. Every localhost test —
   unit, curl, headless e2e — passed while every LAN view was broken.
2. The recorder called it on frame one, threw, and the exception killed the
   whole requestAnimationFrame loop. Stats code took gameplay down — exactly
   what the design said must never happen. "Fire-and-forget" had covered the
   network but not the recorder itself.

Fixes: `uuidv4()` falls back to `crypto.getRandomValues` (available in all
contexts) with correct version/variant bits; and game.js now wraps the stats
calls in try/catch, so the never-break-gameplay rule is enforced
structurally instead of by good intentions. Lesson: test from a non-localhost
origin at least once — localhost is a privileged environment that hides a
whole class of failures.

---

## Phase 3 (2026-06-12): the snarky observer

### Shape

Client (`public/js/snark.js`) decides WHEN; server (`worker/lib/
commentary.js`) decides WHAT. Cadence: jittered 14-26s mid-play (a fixed 20s
would feel metronomic — jitter is what makes it feel like someone's actually
watching), a bonus jab on ball loss behind an 8s cooldown, and always a
closer at game end. One request in flight at a time; on any failure the
client falls back to canned lines.

### Concept: prompt-injection posture for a public LLM endpoint

`/api/commentary` is reachable by anyone with curl, and its input ends up in
a prompt. The defense is structural: **the snapshot is numbers and closed
enums only** — there is no field where a caller can write prose. The one
exception, `recentLines` (the model needs them to avoid repeating itself),
is capped at 3 × 160 chars and scrubbed to printable ASCII. Worst case, an
attacker steers the joke on their own screen. Output is sanitized to one
capped line, and `max_tokens: 80` bounds cost per call (~$0.002 with
Sonnet). Real rate limiting lands in Phase 4.

### Concept: the shuffle bag

Plain `random()` over 22 canned lines repeats embarrassingly fast (birthday
problem: ~50% chance of a repeat within 6 draws). A shuffle bag deals the
whole deck in random order before reshuffling, with one extra rule — never
the same line twice in a row across refills. Old game-dev trick; this is
what "random but doesn't feel broken" usually means in games.

### Persona prompt notes

Lives in `worker/lib/commentary.js` (`SYSTEM`). The parts that matter:
"about one time in four, go very short" (user wanted varied length — LLMs
otherwise converge on uniform-length output); "ground the joke in the
numbers, specific beats generic" (this is what makes it commentary rather
than a fortune cookie); explicit semantics for `percentile` and
`sampleSize` so the model can mock a thin sample ("42nd percentile of 6
games" deserves it); guardrails as content rules, not vibes (profanity cap,
mock the gameplay never the person).

### Verification

118/118 tests (validation, sanitizer, handler with fake fetcher, bag
no-repeat over 300 draws, cadence windows, snapshot↔validator contract).
Live: real Sonnet through `wrangler dev` produced grounded lines — the
ball died in ~1s and it said "One ball down in one second — that paddle
must be decorative." E2e captures snark lines and screenshots; the line
renders top-left, italic, with the orange `»`.

---

## Phase 4 (2026-06-12): hardening + seeding + voice tune

- **Persona shift (user call):** commentator is now Neil Peart — erudite,
  exacting, timekeeping metaphors. Material pool: Rush (titles/lore/tour
  moments, alluded not quoted — lyric passages are copyrighted, titles and
  bent phrases are not), Tool, cyberpunk, Dungeon Crawler Carl, The Library
  at Mount Char. Prompt instructs "roughly half plain dry observation" so
  references don't become a tic. Canned lines rewritten to match.
- **Game feel:** BALL_SPEED 620→660, comboWindow 1.2→1.3s.
- **Rate limiting** (`worker/lib/ratelimit.js`): per-IP fixed window in
  isolate memory — commentary 10/min (the Sonnet-cost one), turn 30/min,
  game 10/min, health unlimited. Honest scope: per-isolate counters mean a
  distributed abuser gets limit×isolates; this stops curl loops, not
  botnets, and that's the right tradeoff for a personal site (the durable
  alternative is a Durable Object). Verified live: 12 rapid posts → 429s.
- **Seeding** (`tools/seed_games.mjs`): plays REAL headless games at seven
  skill levels (paddle-tracking wander) — no synthetic rows, the
  distribution is made of actual plays through the actual pipeline. Run
  against prod once after deploy so player #1 isn't compared to an empty
  table. Local trial: skill 0.3 → 40 pts, skill 0.75 → 3490 pts.

### The character file (voice v4, elizaOS-style)

`public/js/character.js` is the single source of the commentator's voice —
served publicly on purpose (View Source reveals his soul; no secrets in it).
Structure borrowed from elizaOS character files: `bio` / `lore` /
`adjectives` / `topics` / `style` / `messageExamples`, adapted for a
one-shot heckler. Two ideas stolen outright:

1. **messageExamples as the funny-knob.** Few-shot situation→line pairs
   teach tone better than any instruction. They're keyed to our moments
   (mid/life/over/won) and the compiler guarantees the current moment is
   always represented — the model sees how to handle THIS situation.
2. **Per-request sampling.** `worker/lib/persona.js` compiles the prompt
   fresh each call, sampling 3 lore fragments and 6 examples. Consecutive
   heckles draw on different material → more variety, leaner prompt.

Voice history lives in the file header: v1 generic standup → v2 heavy Rush
homage (user: "not funny enough, folks won't get the Rush jokes") → v3/v4
wit-first, Peart as sensibility, references capped at 1-in-5 and legible
without knowing the band. The client's canned lines import from the same
file, so there's exactly one place to edit him.

### Difficulty modes (laptop/desktop)

Trackpad play at 720 px/s was hopeless (user, demoing on a laptop:
"impossible"). Legend toggle: laptop = 540 px/s ball, desktop = 720.
Speeds live in config (`ballSpeeds`); `BALL_SPEED` in engine.js is now just
the default for `createGame({ballSpeed})`.

The interesting part is the stats plumbing: scores aren't comparable across
modes, so `mode` rides every record (recorder → API → D1) and **every
aggregate query filters by it** — separate percentiles, histograms,
medians, best scores. Migration 0002 adds the column with DEFAULT
'desktop' (all pre-existing rows were desktop-speed) and re-cuts the
indexes mode-first. Toggling mid-game rebuilds the board, and the
recorder's existing abandon logic keeps a half-played laptop game from
finishing as a desktop record. The test D1 helper now applies ALL
migrations in order, so tests always see the prod schema. Snark snapshot
gained the mode too — the Professor knows you're on the slow ball.

Seeding note: `seed_games.mjs` takes a mode argument now; prod needs both
runs (`… 30 desktop` and `… 20 laptop`).

### Deploy checklist (the only part needing human auth)

1. `npx wrangler login` (interactive — user runs it)
2. `npx wrangler d1 create breakout-stats` → paste real `database_id` into
   wrangler.jsonc (replacing the zeros placeholder)
3. `npx wrangler d1 migrations apply breakout-stats --remote`
4. `npx wrangler secret put ANTHROPIC_API_KEY`
5. Merge `stats-api` → `master`, push (auto-deploys)
6. `node tools/seed_games.mjs https://peteulintz.com/ 30`
7. Verify: health endpoint, one played game, stats cards, a live snark line
