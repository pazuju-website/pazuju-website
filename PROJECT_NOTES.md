# Pazuju — Project Notes

Living notes on what we're building and where things stand. Update this file as work progresses instead of re-explaining context each session.

## The game

A daily piece-placement puzzle. Plays like Sudoku (every number appears once per row, once per column, and once per piece), but the board starts empty — the player must first drag and rotate irregularly-shaped pieces into place to fully cover the grid, then fill in the numbers. Rules text lives in `index.html`.

Three sizes published per day: 6×6 (easy), 8×8 (medium), 10×10 (hard).

## Puzzle generation & publishing

- Puzzles are authored by an **external generator program** (outside this repo). It can export `.csv`, `.html`, or `.xml`. **`.xml` is the format the web engine consumes.**
- Uploading/publishing is a **manual step** the user does — there is no automated pipeline pushing generator output into the site.
- To publish a new day's puzzles:
  1. Run the generator, get the three `.xml` files (6x6, 8x8, 10x10).
  2. Drop them into a new folder `puzzles/YYYY-MM-DD/`.
  3. Add `"YYYY-MM-DD"` to the `dates` array in `puzzles/manifest.json`.
  4. It automatically becomes selectable via the date picker on `play.html`.
- **Difficulty mix rule per day**: 2 of the 3 sizes must be Beginner, the 3rd must be Intermediate or Advanced, and which size gets the harder puzzle should be randomized day to day (not always the same size). This is a curation rule for humans/scripts picking puzzles — the site itself doesn't enforce it, it just displays whatever difficulty each XML declares.
- **2026-09-20 batch**: generated all 45 days from 2026-09-17 through 2026-10-31 from the `xml/` generator pool, following the difficulty-mix rule above via a one-off Node script (not committed — was scratch tooling, easy to recreate if another batch is needed later). Pool remaining after that batch: 6×6 167 Beginner / 88 harder, 8×8 173 Beginner / 82 harder, 10×10 170 Beginner / 85 harder — plenty left for the next batch whenever it's time to extend past October.

## Architecture (as of 2026-09-20)

- Static site, no backend/database. `serve.js` is a zero-dependency static file server for local testing (`node serve.js [port]`, then open `http://localhost:8080/index.html`).
- **Version control**: git repo initialized locally and pushed to GitHub at `https://github.com/pazuju-website/pazuju-website` (branch `main`). Git was freshly installed via winget on this machine. Push auth is handled by Git Credential Manager (already authorized), so pushes work without further prompts.
- **Hosting**: deploying via GitHub Pages (Settings → Pages, source = `main` branch / root). `CNAME` file in repo root maps the custom domain.
- **Domain**: `pazuju.com`, registered through Netfirms (domain-only, no Netfirms hosting plan). DNS is pointed at GitHub Pages: 4 A records on `@` to GitHub's Pages IPs (185.199.108/109/110/111.153) and a CNAME on `www` to `pazuju-website.github.io.`. `http://pazuju.com` is confirmed live. **DNS cleanup 2026-09-20**: found and removed 3 stray legacy records left over from Netfirms' old parking setup that were breaking HTTPS — a root `A @` and wildcard `A *` both pointing at an unrelated Google Cloud IP (`146.148.78.159`, dated 2016), plus a duplicate/conflicting `www` CNAME (old one pointed at `pazuju.com` itself, new one at `pazuju-website.github.io.` — two CNAMEs on the same name is invalid and was causing `www` to resolve back through the apex instead of to GitHub). User removed all 3; re-check that the apex `A @ 146.148.78.159` record is actually gone (it was still resolving in a spot-check right after removal — likely just propagation lag, but worth confirming) and then enable "Enforce HTTPS" in the Pages settings once the cert finishes provisioning.
- `index.html` — marketing/landing page with rules.
- `play.html` — the actual game page. Fetches `puzzles/manifest.json`, shows a date picker restricted to released dates, loads `puzzles/{date}/{size}.xml` per selection.
- `Online Game/js/pazuju-xml-loader.js` — parses the puzzle XML into a plain-object shape, including the puzzle's numeric `difficultyLevel`.
- `Online Game/js/pazuju-engine.js` — the `PazujuGame` class: renders the board/tray, handles drag-to-place, click-to-rotate, number entry, conflict checking, win detection.
- `css/site.css` — shared styling.
- `Online Game/engine-test.html` and `Online Game/pazuju_puzzle_308_v2.html` are older standalone/mockup files, not part of the live site — treat as reference only unless told otherwise.
- **Difficulty taxonomy**: difficulty is a property of the individual puzzle (how many solving rules it takes), not of the board size — every size can land at any tier on a given day. Computed client-side in `play.html`'s `difficultyCategory()` from the XML's `<difficultyLevel>`: 1.0–1.9 Beginner, 2.0–2.9 Intermediate, 3.0–5.9 Advanced, 6.0+ Expert (no Expert puzzles exist in the generator batch delivered so far). Never display the raw numeric value in the UI, only the tier name.
- **Creature branding**: 6×6 = Grasshopper, 8×8 = Snake, 10×10 = Dragon. Plaque images at `images/plaque-grasshopper.jpg`, `images/plaque-snake.jpg`, `images/plaque-dragon.jpg` (cropped from a single user-supplied composite, downscaled + re-encoded as JPEG for size). Referenced via `creature`/`icon` fields on each entry in `manifest.json`'s `sizes` array.
- **`xml/`** (repo root, gitignored): a large raw batch dropped in by the external generator — puzzles organized as `xml/Size {6,8,10}/{difficultyLevel}/PuzzleN.xml`, ~300 puzzles per size (200 Beginner, 60 Intermediate, 40 Advanced). This is the source pool `puzzles/` folders get drawn from; not needed by the live site itself.

## Feature status

- [x] Core engine: place pieces, rotate, fill numbers, conflict detection, win celebration
- [x] Rotate pieces by clicking the shape directly (no separate rotate icon)
- [x] Tray pieces render smaller than board cells, expand to full size when dragged out
- [x] Multi-day archive (date picker in `play.html`, driven by `manifest.json`) — **45 days registered, 2026-09-17 through 2026-10-31**, drawn from the `xml/` generator pool per the difficulty-mix rule above; needs extending again before November
- [x] Difficulty taxonomy (Beginner/Intermediate/Advanced/Expert) decoupled from board size, computed from each puzzle's own `difficultyLevel`, shown as a tier name only (no raw number) in `play.html` and the size cards
- [x] Creature branding (Grasshopper/Snake/Dragon plaque images) on the size cards on both `index.html` and `play.html`
- [x] Git version control set up, pushed to GitHub
- [x] Live hosting: **pazuju.com is live** via GitHub Pages + Netfirms DNS (as of 2026-09-19). **2026-09-20**: found and removed 3 stray/conflicting DNS records that were blocking HTTPS certificate provisioning (see Architecture section) — re-verify the apex `146.148.78.159` record is actually gone once DNS propagates, then check "Enforce HTTPS" in Pages settings.
- [ ] Shared backend/database so future web + mobile apps read from one source — **not started, not designed yet**
- [ ] Native Android app
- [ ] Native iOS app

## Open questions / not yet decided

- What backend/database to use for the shared data layer (once mobile apps are underway)
- Whether the manual XML-upload step should eventually be automated

## Resuming a session

At the start of a new session, say:

> Read PROJECT_NOTES.md in this project and pick up from the "Feature status" section.

That's enough for a fresh session to load full context without re-explaining the project.
