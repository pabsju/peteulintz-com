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

**Still owed before merge to master** (deploy checklist, Phase 4):
`npx wrangler login` → `wrangler d1 create breakout-stats` → paste real
`database_id` into wrangler.jsonc → `wrangler d1 migrations apply
breakout-stats --remote` → merge. Until then the branch is local-only.
