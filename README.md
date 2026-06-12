# peteulintz.com

Personal site. Two panes, modeled on claude.com/code-with-claude:

- **Left**: bio, current AI item, reading list (warm paper, serif).
- **Right**: ASCII breakout — giant 3D extruded ASCII text as the brick field,
  mouse-controlled paddle. Click to launch; 3 balls per game.

### Game rules

- Each character cell is a brick worth 10 points times the combo multiplier.
- Combo: bricks hit within the combo window (`comboWindow`, 1.3s) climb a ten-step ladder —
  1X, 2X, 3X … 10X — and the hit "ping" climbs ten pentatonic tones with
  it (C5 → A6). Miss the window and it resets to 1X.
- Every brick hit shows an expanding ring at the impact point and pops the
  multiplier earned.
- The paddle shrinks as the combo climbs: full width at 1X, 55% at 10X.
- Paddle hits make a low "pock". All audio is synthesized in WebAudio,
  no sound files. Legend (upper right) has score, balls, and a sound toggle.
- Lose all 3 balls: game over. Clear the board: ENCORE. Click to replay.
- Lives, combo window, and points per brick live in `public/js/config.js` (`game`).

### Tuning the game

Two places to look, depending on the knob:

**Content & scoring** — `public/js/config.js` (`SITE_CONFIG.game`):

| Knob | Field |
|------|-------|
| Balls per game | `lives` |
| Combo reset window (seconds) | `comboWindow` |
| Points per brick (before multiplier) | `brickPoints` |

**Physics & feel** — exported constants at the top of `public/js/engine.js`:

| Knob | Constant / line |
|------|-----------------|
| Ball speed (px/s) | `BALL_SPEED` |
| Paddle chase rate | `PADDLE_LERP` |
| Combo ladder steps | `MULTIPLIERS` |
| Paddle shrink at max combo | `PADDLE_MIN_SCALE` |
| Text thickness/size | `TEXT_SCALE` |
| Base (1X) paddle width | `makeGame()`: `Math.max(70, width * 0.12)` |

Worked example — make the 1X paddle slightly smaller: in
`public/js/engine.js`, find in `makeGame()`

```js
const paddleW = Math.max(70, width * 0.12);
```

and lower the fraction (e.g. `0.10`) and/or the `70`px floor (the floor wins
on narrow screens). To instead shrink the paddle only at high combos, lower
`PADDLE_MIN_SCALE` (0.55 → 10X paddle is 55% of base; intermediate tiers
interpolate linearly).

After any change: `node --test test/*.mjs` (engine tests assert the
combo-shrink math), then `node tools/cdp_smoke.mjs` to watch it play.

### Headless smoke test

```bash
node tools/cdp_smoke.mjs            # plays the game for 6s, prints state, saves /tmp/smoke.png
```

Drives the real game in headless chromium over CDP in real wall-clock time
(`--virtual-time-budget` starves rAF, freezing the game on its first frame).
Injects an autoplayer that tracks the ball and clicks to launch/restart.

Static site, zero build step, zero dependencies. Vanilla ES modules.

## Run locally

```bash
npx wrangler d1 migrations apply breakout-stats --local   # once, and after new migrations
npx wrangler dev --port 8787
# → http://localhost:8787  (site + /api/* + local D1, no Cloudflare auth needed)
```

Site-only (no stats API): `python3 -m http.server 8000 -d public` still works;
the game runs fine and silently drops its stats POSTs.

## Test

```bash
node --experimental-sqlite --test test/*.mjs
```

(The flag gives node's built-in SQLite to the API tests — they run the real
migration + real SQL against an in-memory DB. Unflagged in node ≥ 23.4.)

Game logic (`public/js/engine.js`, `public/js/glyphs.js`) is pure and
DOM-free, so the physics, collision, and text rasterization are tested in
node directly. The stats pipeline is tested at four layers — see
`docs/build-notes.md`. End-to-end check against a running `wrangler dev`:

```bash
node tools/integration_stats.mjs http://localhost:8787/   # plays a losing game, asserts API round trip
```

## Stats API

The Worker (`worker/index.js`) records anonymous game stats in D1 and
answers with percentiles. `POST /api/turn` (one ball), `POST /api/game`
(one finished game), `GET /api/health`. Schema in `migrations/`, client
recorder in `public/js/stats.js`, design notes in `docs/build-notes.md`.

`POST /api/commentary` is the snarky observer: Claude Sonnet heckles the
player based on live numbers (`worker/lib/commentary.js`, client cadence in
`public/js/snark.js`). Needs `ANTHROPIC_API_KEY` — locally via a gitignored
`.dev.vars` file (`ANTHROPIC_API_KEY=sk-...`), in prod via
`npx wrangler secret put ANTHROPIC_API_KEY`. Without it the endpoint
returns 503 and the client falls back to canned lines.

## Editing content

| What | Where |
|------|-------|
| Game text (next concert) | `marqueeLines` in `public/js/config.js` |
| Current AI item + link | `aiItem` in `public/js/config.js` |
| Bio, books, links | `public/index.html` (look for `EDIT:` comments) |
| Book covers / photos | `public/images/` |

Game text supports `A-Z 0-9 space . , ! ' & / -`. Add glyphs in
`public/js/glyphs.js` if you need more.

## Layout

```
public/           everything deployed as static assets
  index.html      markup, left-pane content
  css/style.css   all styling
  js/config.js    editable content (game words, AI item, game tuning)
  js/glyphs.js    5x7 bitmap font + rasterizer (pure)
  js/engine.js    game physics + state (pure) — paddle/ball/combo constants
  js/stats.js     turn/game recorder + API client (recorder is pure)
  js/game.js      canvas rendering + input (browser only)
  images/         headshot, book covers
worker/           stats API (runs on asset misses; /api/* forced to Worker)
  index.js        router
  lib/            validation, percentile math, handlers (all node-testable)
migrations/       D1 schema, applied via wrangler d1 migrations
test/             node:test suites (private)
tools/            headless smoke + integration tests (private)
docs/             build notes / teaching journal (private)
```

## Deploy

Already set up on Cloudflare Workers (peteulintz-com.pulintz.workers.dev →
peteulintz.com). Pushes to `master` auto-deploy; `wrangler.jsonc` serves
`./public` as static assets, so README/changelog/tests stay private.
