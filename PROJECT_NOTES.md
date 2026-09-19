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

## Architecture (as of 2026-09-19)

- Static site, no backend/database. `serve.js` is a zero-dependency static file server for local testing (`node serve.js [port]`, then open `http://localhost:8080/index.html`).
- **Version control**: git repo initialized locally and pushed to GitHub at `https://github.com/pazuju-website/pazuju-website` (branch `main`). Git was freshly installed via winget on this machine. Push auth is handled by Git Credential Manager (already authorized), so pushes work without further prompts.
- **Hosting**: deploying via GitHub Pages (Settings → Pages, source = `main` branch / root). `CNAME` file in repo root maps the custom domain.
- **Domain**: `pazuju.com`, registered through Netfirms (domain-only, no Netfirms hosting plan). DNS is pointed at GitHub Pages: 4 A records on `@` to GitHub's Pages IPs (185.199.108/109/110/111.153) and a CNAME on `www` to `pazuju-website.github.io.`. Both `pazuju.com` and `www.pazuju.com` are intended to work. DNS records were added 2026-09-19; propagation/HTTPS verification in progress.
- `index.html` — marketing/landing page with rules.
- `play.html` — the actual game page. Fetches `puzzles/manifest.json`, shows a date picker restricted to released dates, loads `puzzles/{date}/{size}.xml` per selection.
- `Online Game/js/pazuju-xml-loader.js` — parses the puzzle XML into a plain-object shape.
- `Online Game/js/pazuju-engine.js` — the `PazujuGame` class: renders the board/tray, handles drag-to-place, click-to-rotate, number entry, conflict checking, win detection.
- `css/site.css` — shared styling.
- `Online Game/engine-test.html` and `Online Game/pazuju_puzzle_308_v2.html` are older standalone/mockup files, not part of the live site — treat as reference only unless told otherwise.

## Feature status

- [x] Core engine: place pieces, rotate, fill numbers, conflict detection, win celebration
- [x] Rotate pieces by clicking the shape directly (no separate rotate icon)
- [x] Tray pieces render smaller than board cells, expand to full size when dragged out
- [x] Multi-day archive (date picker in `play.html`, driven by `manifest.json`) — **currently only `2026-09-17` is registered**; needs real puzzle folders/dates added
- [x] Git version control set up, pushed to GitHub
- [~] Live hosting: GitHub Pages configured, custom domain DNS set up at Netfirms — **verifying DNS/HTTPS propagation as of 2026-09-19, not yet confirmed live**
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
