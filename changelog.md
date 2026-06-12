# Changelog — peteulintz.com

Test oracle. Tracks build + deploy progress. Newest entry on top.
Mark each step `[x]` done, `[ ]` pending.

---

## Build

- [x] Create project skeleton (`index.html`, `changelog.md`, `README.md`)
- [x] Single-file site: intro, currently-reading (dated), links sections
- [x] Responsive + dark-mode CSS (system preference)
- [x] Add portrait photo (images/headshot.jpg, wired in header)
- [x] Fill real bio text (replace EDIT placeholder in `#about`)
- [x] Replace GitHub `USERNAME` with real handle (pabsju)
- [x] Add real cover images to images/, wire up Currently-reading grid + update date
- [x] Fill Finished-reading list with real books + dates finished
- [ ] Preview locally (`python3 -m http.server`) and eyeball on phone width

## Deploy

- [x] Register `peteulintz.com` at Porkbun
- [x] Push repo to GitHub (github.com/pabsju/peteulintz-com)
- [x] Create Cloudflare Workers project (static assets), connect GitHub repo
- [x] First deploy succeeds (peteulintz-com.pulintz.workers.dev)
- [x] Add custom domain `peteulintz.com` + `www` in Cloudflare (Worker Domains tab)
- [x] Point Porkbun DNS at Cloudflare (nameservers: gene/trace.ns.cloudflare.com)
- [x] HTTPS active, `https://peteulintz.com` loads
- [x] `www.peteulintz.com` serves (200)

## Log

### 2026-06-09
- Initialized project. Built single-file `index.html` (serif, minimal, dark-mode aware).
- Sections: intro/about, currently reading (cover-image grid, dated), finished reading (dated list), GitHub + email links.
- Chosen stack: single HTML+CSS file → Cloudflare Pages, domain via Porkbun.

## 2026-06-12 — Stats + AI commentary live

Game now records anonymous per-ball/per-game stats to D1 via the Worker,
shows percentile cards (between balls + game-over summary), and runs live
Claude Sonnet color commentary ("The Professor", character file at
public/js/character.js). Difficulty modes: laptop (540 px/s) / desktop
(720), stats aggregated per mode. Distributions seeded with 50 headless
games. Full story: docs/build-notes.md.
