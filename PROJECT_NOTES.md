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
- **Domain**: `pazuju.com`, registered through Netfirms (domain-only, no Netfirms hosting plan). DNS is pointed at GitHub Pages: 4 A records on `@` to GitHub's Pages IPs (185.199.108/109/110/111.153) and a CNAME on `www` to `pazuju-website.github.io.`. `http://pazuju.com` is confirmed live. **DNS cleanup 2026-09-20**: found and removed 3 stray legacy records left over from Netfirms' old parking setup that were breaking HTTPS — a root `A @` and wildcard `A *` both pointing at an unrelated Google Cloud IP (`146.148.78.159`, dated 2016), plus a duplicate/conflicting `www` CNAME. **HTTPS fixed 2026-09-20**: after the DNS cleanup, GitHub's "DNS Check" on the custom-domain field in Settings → Pages was stuck on a stale failed state from before the cleanup; re-clicking "Save" on that field (with the domain unchanged) forced GitHub to redo the check, which passed, and it then auto-provisioned a real Let's Encrypt cert for `pazuju.com` (confirmed via `openssl s_client` — was serving the wrong generic `*.github.io` cert before, causing browsers to refuse the connection). "Enforce HTTPS" in Pages settings has since been **checked and confirmed enabled** — `http://pazuju.com` now 301-redirects to `https://`. HTTPS is fully done.
- `index.html` — marketing/landing page with rules.
- `play.html` — the actual game page. Fetches `puzzles/manifest.json`, shows a date picker restricted to released dates, loads `puzzles/{date}/{size}.xml` per selection.
- `Online Game/js/pazuju-xml-loader.js` — parses the puzzle XML into a plain-object shape, including the puzzle's numeric `difficultyLevel`.
- `Online Game/js/pazuju-engine.js` — the `PazujuGame` class: renders the board/tray, handles drag-to-place, click-to-rotate, number entry, conflict checking, win detection.
- `css/site.css` — shared styling.
- `Online Game/engine-test.html` and `Online Game/pazuju_puzzle_308_v2.html` are older standalone/mockup files, not part of the live site — treat as reference only unless told otherwise.
- **Difficulty taxonomy**: difficulty is a property of the individual puzzle (how many solving rules it takes), not of the board size — every size can land at any tier on a given day. Computed client-side in `play.html`'s `difficultyCategory()` from the XML's `<difficultyLevel>`: 1.0–1.9 Beginner, 2.0–2.9 Intermediate, 3.0–5.9 Advanced, 6.0+ Expert (no Expert puzzles exist in the generator batch delivered so far). Never display the raw numeric value in the UI, only the tier name.
- **Creature branding**: 6×6 = Grasshopper, 8×8 = Snake, 10×10 = Dragon. Plaque images at `images/plaque-grasshopper.jpg`, `images/plaque-snake.jpg`, `images/plaque-dragon.jpg` (cropped from a single user-supplied composite, downscaled + re-encoded as JPEG for size). Referenced via `creature`/`icon` fields on each entry in `manifest.json`'s `sizes` array.
- **`xml/`** (repo root, gitignored): a large raw batch dropped in by the external generator — puzzles organized as `xml/Size {6,8,10}/{difficultyLevel}/PuzzleN.xml`, ~300 puzzles per size (200 Beginner, 60 Intermediate, 40 Advanced). This is the source pool `puzzles/` folders get drawn from; not needed by the live site itself.
- **Piece-placement conflict detection**: each puzzle XML's `<tile>` list encodes the full solved layout (every tile has a `<number>`, given or not) - `pazuju-xml-loader.js` parses this into `solutionGrid` (used by "check numbers") and gives every tray piece a `solved` snapshot (its true pre-scramble origin/cells/givens, used by "skip assembly"). The engine (`pazuju-engine.js`) separately detects when a piece's own printed given lands on a board square that already has a *different* printed given (`givenCollisions`, e.g. placing a straight piece in the wrong rotation) - this is distinct from ordinary row/col/piece duplicate-value conflicts and previously went completely undetected. `readyForNumbers` (gates the number pad, the remove-piece buttons, and cell selection) is now `allPiecesPlaced && no given-conflicts`, so a misassembled board blocks moving to the number-filling stage but still lets you pull pieces back off the board to fix it.
- **Board border-alignment fix**: `#board` needs `box-sizing: content-box` (overriding the site's global `border-box`) so the engine's `size*cell`-px sizing is the cell grid's actual content area, not shrunk by the 3px border - otherwise the grid overflowed past the border on the right/bottom.
- **Check numbers / skip assembly** (`play.html` toolbar, `Online Game/js/ads.js`): "Check numbers" grades the player's entered numbers against `solutionGrid` and animates wrong ones falling off the board (`.chip-fall` in `site.css`) rather than just deleting them; free uses per puzzle are 1 (Grasshopper), 2 (Snake), 3 (Dragon), tracked per day+size in `localStorage` (key `pazuju-checks-{date}-{sizeKey}`). Design intent (currently switched off, see below): once free checks run out, Snake and Dragon offer one more check per rewarded-ad view, Grasshopper has no ad option at all. "Skip assembly" auto-places every remaining piece at its true solved position via `game.skipAssembly()`; design intent is always ad-gated (no free uses). `ads.js` is a **placeholder** - no real ad account exists yet, so it simulates a rewarded ad with a timed modal (`PazujuAds.watchRewardedAd()` → `Promise<boolean>`). Swapping in a real ad SDK later only touches that one file. **2026-09-20**: investigated a report that the free checks "aren't there" for Grasshopper/Snake - confirmed the logic itself is correct (verified by clearing `localStorage` and reloading, which correctly showed 1/2/3 remaining); the checks had simply already been used up in that browser during earlier manual testing that same day. Not a bug, just confusing UX with no "come back tomorrow" messaging when checks hit 0 - worth a small UX pass later if it keeps confusing people. **2026-09-21: `ADS_ENABLED = false` in `play.html`** turns off both ad gates while there's no ad network and no traffic yet - skip assembly is unconditionally free, and check numbers hard-caps at the free allowance with no ad upsell shown. All the ad-gating code/logic (`SIZE_ALLOWS_AD_CHECK`, `sizeAllowsAdCheck()`, the `PazujuAds.watchRewardedAd()` call paths, the ad-tag markup) is left in place, not deleted - flip the flag back to `true` once a real ad SDK is wired in, to restore the design intent described above.
- **Books page** (`books.html`): lists physical books for sale, linking out to their Amazon listings (`target="_blank" rel="noopener"`, never anything embedded/checkout-flow). Data-driven from a `BOOKS` array in the page's own inline script (`title`, `author`, `blurb`, `url`, `cover`) so adding a second book later is just another array entry - nothing else on the page changes. Currently one entry: "Pazuju: The Evolution of the Number Game Is Here" by Jonathan Tillger, cover image at `images/book-pazuju-cover.avif` (user-supplied). "Books" added to the nav on every page alongside Home/Play.
- **Landing page (`index.html`)**: hero embeds a **static, non-interactive** preview of the engine's board/tray rendering (reuses `PazujuGame`'s rendering code for visual fidelity, but `.demo-play-area` is `pointer-events: none` so nothing is clickable/draggable - it was briefly a live playable demo but the user asked for it to go back to just a preview), plus three small hand-built CSS/HTML diagrams (not images) illustrating each rule in "How to play." **Important gotcha already hit once**: the demo's board/tray must use the exact ids `board`/`tray` (matching site.css's `#board`/`#tray` ID selectors) - using different ids silently drops the board's positioning/border/background CSS, since `position:relative` no longer applies and its absolutely-positioned cells fall back to the nearest *other* positioned ancestor.
- **Landing-page demo puzzle**: always loads `puzzles/demo-grasshopper.xml` (a copy of `xml/Size 6/1.6/Puzzle134.xml` from the generator pool, hand-picked and committed outside the gitignored `xml/` folder specifically for this) rather than "today's" puzzle - a fixed Beginner 6×6 with exactly 3 already-placed pieces + 3 compact tray pieces (chosen because its tray pieces have a max bounding-box dimension of 4, unlike most of the pool which runs to 5, so nothing looks awkwardly stretched at demo scale). Keeps the preview's look stable and non-spoiler regardless of the date. `boardMaxPx: 240` for the board; `#board` and `#tray` both get `flex-shrink: 0` in the demo so the flex row can't compress the board narrower than its inline JS-set pixel size and misalign its absolutely-positioned cells against its own border (this is what "the board doesn't line up with its boundary" looked like before the fix).
- **Hero fade-in animation containing-block bug (fixed, now largely moot since the demo is static)**: `.hero-copy`/`.hero-demo` originally faded in via `animation: heroFadeUp ... both` using `transform: translateY(...)`. Because the animation's `both` fill-mode holds the final keyframe forever, `transform` never went back to `none`, which makes the element a new *containing block* for any `position: fixed` descendant - silently breaking `position: fixed`-based dragging inside `.hero-demo` (the engine positions a dragged piece with `fixed`). Fixed by animating `top` on a `position: relative` element instead of `transform` - `top` doesn't create a containing block. Worth remembering if drag-to-place interactivity is ever added back to a hero/animated container anywhere on the site.
- **Puzzle timer + share result** (`play.html`, added 2026-09-21): a `#puzzleTimer` element above the board starts counting up (`startTimer()`) the moment `selectSize()` opens a puzzle, and freezes (`stopTimer()`) in `handleSolved()` once `onSolved` fires - runs continuously through assembly + number-filling as one elapsed time per puzzle, not persisted across reloads. On solve, a `#sharePanel` appears below the status line with a text summary (creature/size/difficulty/time, no solution/spoiler content) and four actions: "Share result" (uses `navigator.share` where available - covers messaging apps and social apps in one native sheet - falling back to copying the summary+link to the clipboard on browsers without Web Share, mainly desktop), plus direct `Share on X` / `Share on Facebook` / `Share on WhatsApp` links built from intent URLs. The share link is `play.html?date=YYYY-MM-DD`; `init()` now reads that query param so a friend opening a shared link lands on the same day's puzzles instead of today's (falls back to today if the date is missing/unreleased). Verified end-to-end in-browser: timer ticks, skip-assembly-then-fill-solution triggers the share panel with correct text and working Facebook/WhatsApp hrefs, and the `?date=` deep link loads the right day.

## Feature status

- [x] Core engine: place pieces, rotate, fill numbers, conflict detection, win celebration
- [x] Rotate pieces by clicking the shape directly (no separate rotate icon)
- [x] Tray pieces render smaller than board cells, expand to full size when dragged out
- [x] Piece-placement conflict detection (given-vs-given collisions block the number-filling stage; pieces stay removable) - see Architecture
- [x] Board border-alignment fix (see Architecture)
- [x] Check numbers (1/2/3 free per size; design intent is ad-gated beyond that except Grasshopper, currently switched off - see Architecture) with a fall-away animation for wrong entries
- [x] Skip assembly (design intent is ad-gated, currently unconditionally free - see Architecture)
- [x] Placeholder rewarded-ad modal (`ads.js`) - no real ad network connected yet, and the ad gates that would use it are switched off for now, see Open questions
- [x] Per-puzzle timer + share-result panel (native share sheet / X / Facebook / WhatsApp, with a `?date=` deep link) - see Architecture
- [x] Landing page redesign: static (non-interactive) puzzle preview in the hero, using a fixed hand-picked Beginner demo puzzle, + visual "how to play" diagrams, replacing the old plain static text
- [x] Multi-day archive (date picker in `play.html`, driven by `manifest.json`) — **45 days registered, 2026-09-17 through 2026-10-31**, drawn from the `xml/` generator pool per the difficulty-mix rule above; needs extending again before November
- [x] Difficulty taxonomy (Beginner/Intermediate/Advanced/Expert) decoupled from board size, computed from each puzzle's own `difficultyLevel`, shown as a tier name only (no raw number) in `play.html` and the size cards
- [x] Creature branding (Grasshopper/Snake/Dragon plaque images) on the size cards on both `index.html` and `play.html`
- [x] Books page (`books.html`) linking out to Amazon, extensible to more titles later - see Architecture
- [x] Git version control set up, pushed to GitHub
- [x] Live hosting: **pazuju.com is live** via GitHub Pages + Netfirms DNS (as of 2026-09-19), **HTTPS fixed and enforced** (as of 2026-09-20, see Architecture) — `http://` now redirects to `https://`, fully done.
- [ ] Shared backend/database so future web + mobile apps read from one source — **not started, not designed yet**
- [ ] Native Android app
- [ ] Native iOS app

## Open questions / not yet decided

- What backend/database to use for the shared data layer (once mobile apps are underway)
- Whether the manual XML-upload step should eventually be automated
- **Real ad network — ON HOLD, see below**: investigated 2026-09-21, deprioritized in favor of getting traffic/analytics first. Once resumed: swap the inside of `PazujuAds.watchRewardedAd()` in `Online Game/js/ads.js` for the real SDK call - nothing else needs to change, callers just await the same `Promise<boolean>`. Also worth a privacy-policy/cookie-consent pass once real ad tracking is live (GDPR/CCPA).
- **No analytics on the site at all** (found 2026-09-21): grepped all HTML for gtag/Google Analytics/GTM - nothing present. GitHub Pages gives no visitor analytics for a custom domain either. So there's currently zero visibility into visitor count, location, or session length. **NEXT UP - see "Where we left off."**

## Where we left off (2026-09-21)

Session focus was Google Ads setup, but it pivoted to analytics after investigation.

**Google Ad Manager investigated and put on hold**: navigated the live Ad Manager signup flow in Chrome. Both "Get started" and "Sign in" on admanager.google.com now route to the same sales-contact questionnaire ("What best describes your business?") - there is no instant self-serve "log in and create a network" path anymore. Google appears to have consolidated the old free/small-publisher tier; a brand-new, low-traffic site like pazuju.com would be going through a sales review with no guaranteed approval/timeline, not an instant signup. AdSense was identified as the alternative with true self-serve signup, but it has no native rewarded-video ad unit (would need a banner/interstitial approach instead) - not decided.

**User's call**: before spending more effort on ad-network setup, the real first priority is **getting traffic to the site**, and before that, **knowing what traffic exists at all** - the site currently has no analytics whatsoever.

**Ad gates switched off in the meantime**: since there's no ad network and no traffic yet, the user asked to stop requiring a rewarded ad for "skip assembly" (now unconditionally free) and to stop offering an ad to unlock extra "check numbers" uses beyond the free per-size allowance. Implemented via a single `ADS_ENABLED = false` flag in `play.html` rather than deleting the ad-gating code - see Architecture's "Check numbers / skip assembly" entry for exactly what that flag controls. Verified locally in the browser: skip assembly now completes instantly with no ad modal, and the check-numbers badge no longer offers "Ad" once free checks run out. This is committed.

### Next session: set up Google Analytics (GA4)

Plan agreed with the user:
1. Walk the user through creating a GA4 property in Google Analytics - this **is** genuinely self-serve (unlike Ad Manager), just sign in and create a property to get a measurement ID.
2. Add the `gtag.js` tracking snippet to `index.html`, `play.html`, and `books.html`.
3. Commit and push.

This gives visitor count, geography, and session duration (what the user asked for), plus page-level engagement if we want it later (e.g. which puzzle sizes get played). Ad network setup (Ad Manager sales form vs. AdSense trade-off) and traffic-growth work remain open, to revisit after analytics is in place.

**Local dev server**: was running via `node serve.js 8080` but gets killed automatically by Claude Code's low-memory background-process reaper during idle periods - just restart it (`node serve.js 8080` in the repo root) when resuming, no code issue.

## Resuming a session

At the start of a new session, say:

> Read PROJECT_NOTES.md in this project and pick up from the "Where we left off" section.

That's enough for a fresh session to load full context without re-explaining the project.
