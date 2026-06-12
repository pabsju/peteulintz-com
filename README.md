# peteulintz.com

Personal site. Two panes, modeled on claude.com/code-with-claude:

- **Left**: bio, current AI item, reading list (warm paper, serif).
- **Right**: ASCII breakout — giant 3D extruded ASCII text as the brick field,
  mouse-controlled paddle. Click to launch; 3 balls per game.

### Game rules

- Each character cell is a brick worth 10 points times the combo multiplier.
- Combo: bricks hit within 0.2s of each other climb a ten-step ladder —
  1X, 2X, 3X … 10X — and the hit "ping" climbs ten pentatonic tones with
  it (C5 → A6). Miss the window and it resets to 1X.
- Every brick hit shows an expanding ring at the impact point and pops the
  multiplier earned.
- The paddle shrinks as the combo climbs: full width at 1X, 55% at 10X.
- Paddle hits make a low "pock". All audio is synthesized in WebAudio,
  no sound files. Legend (upper right) has score, balls, and a sound toggle.
- Lose all 3 balls: game over. Clear the board: ENCORE. Click to replay.
- Lives, combo window, and points per brick live in `js/config.js` (`game`).

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
python3 -m http.server 8000
# → http://localhost:8000
```

(Any static server works. ES modules need http://, not file://.)

## Test

```bash
node --test test/
```

Game logic (`js/engine.js`, `js/glyphs.js`) is pure and DOM-free, so the
physics, collision, and text rasterization are tested in node directly.

## Editing content

| What | Where |
|------|-------|
| Game text (next concert) | `marqueeLines` in `js/config.js` |
| Current AI item + link | `aiItem` in `js/config.js` |
| Bio, books, links | `index.html` (look for `EDIT:` comments) |
| Book covers / photos | `images/` |

Game text supports `A-Z 0-9 space . , ! ' & / -`. Add glyphs in
`js/glyphs.js` if you need more.

## Layout

```
index.html        markup, left-pane content
css/style.css     all styling
js/config.js      editable content (game words, AI item)
js/glyphs.js      5x7 bitmap font + rasterizer (pure)
js/engine.js      game physics + state (pure)
js/game.js        canvas rendering + input (browser only)
test/             node:test suites for the pure modules
images/           headshot, book covers
```

## Deploy

Already set up on Cloudflare Workers (peteulintz-com.pulintz.workers.dev →
peteulintz.com). Upload this directory as static assets.
