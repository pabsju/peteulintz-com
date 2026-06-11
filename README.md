# peteulintz.com

Personal site. One file: `index.html` (HTML + embedded CSS, no build step, no dependencies).

Stack: single static file → **Cloudflare Pages** hosting → domain via **Porkbun**.
Progress tracked in [`changelog.md`](changelog.md).

---

## Editing content

Everything lives in `index.html`. Search for `EDIT:` comments — those mark the spots to change.

### Portrait
In `<header>`. Drop a photo at `images/pete.jpg` (square crop looks best; ~400px works). Update the `src` if you name it differently. Rendered as a 7rem circle.

### Bio
In `<section id="about">`. Edit the paragraph text directly.

### Currently reading (cover images + comment)
In `<section id="reading">`. One `<figure>` per book in the `.covers` grid:

```html
<figure>
  <img src="images/mybook.jpg" alt="Book Title — Author Name">
  <figcaption>Your comment, ~200 chars max.</figcaption>
</figure>
```

1. Drop the cover image in `images/` (JPG/PNG, ~300–500px tall is plenty).
2. Set `alt` to "Title — Author".
3. `<figcaption>` is the comment — keep it ≲200 chars. For no comment, leave it empty or delete the line.
4. **Bump the date** in `<p class="updated">` so the list reads as current.

> Note: this is static HTML, so the 200-char limit is a guideline you follow when editing — nothing enforces it.

### Finished reading (dated list)
In `<section id="finished">`. One `<li>` per book, newest on top:

```html
<li>
  <em>Book Title</em> <span class="book-author">— Author Name</span>
  <span class="date-finished">· May 2026</span>
</li>
```

### Links
In `<section id="links">`. Replace `USERNAME` in the GitHub URL with your handle. Add links the same way:

```html
<a href="https://example.com">Label</a>
```

### Preview locally
```bash
cd /home/pabsju/Projects/website
python3 -m http.server 8000
# open http://localhost:8000
```
Resize the browser narrow to check mobile. Toggle OS dark mode to check both themes.

---

## Deploy

### 1. Register the domain (Porkbun)
1. Buy `peteulintz.com` at https://porkbun.com.
2. Leave WHOIS privacy on (free). DNS config comes after Cloudflare setup.

### 2. Put the repo on GitHub
```bash
cd /home/pabsju/Projects/website
git init
git add .
git commit -m "Initial site"
gh repo create peteulintz-com --public --source=. --push   # or create via web UI
```

### 3. Cloudflare Pages
1. https://dash.cloudflare.com → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
2. Pick the repo. Build settings: **Framework preset = None**, **Build command = empty**, **Output directory = `/`** (root). It just serves `index.html`.
3. **Save and Deploy.** You get a `https://<project>.pages.dev` URL. Confirm it loads.

Every `git push` to the main branch now auto-deploys.

### 4. Custom domain
1. In the Pages project → **Custom domains** → **Set up a domain** → enter `peteulintz.com`.
2. Cloudflare gives you DNS instructions. Two options:

   **A. Move nameservers to Cloudflare (simplest, recommended).**
   - Add the site to Cloudflare (free plan), it gives you two nameservers.
   - In Porkbun → domain → **Authoritative Nameservers** → replace with Cloudflare's two.
   - Cloudflare then manages DNS; the Pages custom domain wires up automatically.

   **B. Keep DNS at Porkbun.**
   - In Porkbun DNS, add the `CNAME`/`A` records Cloudflare shows for `peteulintz.com`.
   - Apex `CNAME` flattening: Porkbun supports `ALIAS`/`CNAME` on root.

3. Wait for DNS propagation (minutes to a couple hours). Cloudflare issues HTTPS automatically.
4. (Optional) Add `www.peteulintz.com` as a custom domain too; redirect to apex.

### 5. Verify
- `https://peteulintz.com` loads with a padlock.
- Check the changelog boxes in `changelog.md`.

---

## Updating later
Edit `index.html` → commit → push. Live in ~30s.
```bash
git add index.html && git commit -m "Update reading list" && git push
```
