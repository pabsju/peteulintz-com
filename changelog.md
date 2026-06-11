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

- [ ] Register `peteulintz.com` at Porkbun
- [ ] Push repo to GitHub
- [ ] Create Cloudflare Pages project, connect GitHub repo
- [ ] First deploy succeeds on `*.pages.dev` URL
- [ ] Add custom domain `peteulintz.com` in Cloudflare Pages
- [ ] Point Porkbun DNS at Cloudflare (nameservers or CNAME — see README)
- [ ] HTTPS active, `https://peteulintz.com` loads
- [ ] `www.peteulintz.com` redirects to apex (optional)

## Log

### 2026-06-09
- Initialized project. Built single-file `index.html` (serif, minimal, dark-mode aware).
- Sections: intro/about, currently reading (cover-image grid, dated), finished reading (dated list), GitHub + email links.
- Chosen stack: single HTML+CSS file → Cloudflare Pages, domain via Porkbun.
