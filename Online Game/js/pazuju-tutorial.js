// Lightweight first-run coach-mark tutorial: a queue of floating tooltips
// anchored to real toolbar/board/tray elements, framework-free (plain
// getBoundingClientRect positioning) so it works identically wherever it's
// wired up - the website's list-mode tray or the app's paged-mode tray, with
// no awareness of which page it's running on. A page enqueues one group of
// steps at a time (e.g. "assembly stage" steps, then "number stage" steps
// once that stage is actually reached) rather than being handed one big plan
// up front, since a later group's targets may not exist/be visible yet.
class PazujuTutorial {
  constructor({ storageKey = "pazuju-tutorial-seen" } = {}) {
    this.storageKey = storageKey;
    this.queue = [];
    this.active = false;
    this.el = null;
    this._target = null;
    this._highlighted = null;
    this._reposition = this._reposition.bind(this);
  }

  hasBeenSeen() {
    try { return localStorage.getItem(this.storageKey) === "1"; } catch { return false; }
  }

  // Called as soon as an auto-run starts (not only once it finishes) - an
  // onboarding flow that only half-plays because the player closed the
  // puzzle shouldn't come back and nag them on the next one either.
  markSeen() {
    try { localStorage.setItem(this.storageKey, "1"); } catch { /* storage unavailable - will just auto-show again next load */ }
  }

  // Queues one or more {target, text} steps, starting to show them
  // immediately if nothing else is currently queued/showing. `target` is a
  // selector string or element; a step whose target doesn't currently exist
  // or isn't visible (e.g. the tray after assembly's already been skipped)
  // is silently skipped rather than floating in with nothing to point at.
  enqueue(steps) {
    this.queue.push(...steps);
    if (!this.active) this._showNext();
  }

  // Drops anything still queued and dismisses what's showing now - the
  // "Skip tutorial" action, and also called defensively at the start of a
  // fresh run (the game-menu replay) so two runs can never overlap.
  skipAll() {
    this.reset();
    this.markSeen();
  }

  // Same cleanup as skipAll() but without marking the tutorial as seen -
  // for a page to call when navigating away mid-run (switching puzzles,
  // closing the game) without that counting as having watched it.
  reset() {
    this.queue = [];
    this._dismissCurrent();
    this.active = false;
  }

  _showNext() {
    const step = this.queue.shift();
    if (!step) { this.active = false; return; }
    const target = typeof step.target === "string" ? document.querySelector(step.target) : step.target;
    if (!target || target.offsetParent === null) { this._showNext(); return; }
    this.active = true;
    this._renderBubble(target, step.text);
  }

  _renderBubble(target, text) {
    this._dismissCurrent();
    target.classList.add("tutorial-highlight");
    this._highlighted = target;
    this._target = target;

    const el = document.createElement("div");
    el.className = "tutorial-bubble";
    const p = document.createElement("p");
    p.textContent = text;
    const actions = document.createElement("div");
    actions.className = "tutorial-bubble-actions";
    const skipBtn = document.createElement("button");
    skipBtn.type = "button";
    skipBtn.className = "link-btn tutorial-skip";
    skipBtn.textContent = "Skip tutorial";
    skipBtn.addEventListener("click", () => this.skipAll());
    const nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "btn toolbar-btn tutorial-next";
    nextBtn.textContent = "Got it";
    nextBtn.addEventListener("click", () => this._advance());
    actions.append(skipBtn, nextBtn);
    el.append(p, actions);
    document.body.appendChild(el);
    this.el = el;

    this._reposition();
    window.addEventListener("resize", this._reposition);
    window.addEventListener("scroll", this._reposition, true);
  }

  _reposition() {
    if (!this.el || !this._target) return;
    const t = this._target.getBoundingClientRect();
    const b = this.el.getBoundingClientRect();
    const margin = 10;
    let top = t.bottom + margin;
    let above = false;
    if (top + b.height > window.innerHeight - margin) {
      top = t.top - b.height - margin;
      above = true;
    }
    top = Math.max(margin, Math.min(top, window.innerHeight - b.height - margin));
    let left = t.left + t.width / 2 - b.width / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - b.width - margin));
    this.el.style.top = top + "px";
    this.el.style.left = left + "px";
    this.el.classList.toggle("tutorial-bubble-above", above);
    // Points the tail at the target's own horizontal center, clamped so it
    // never pokes out past the bubble's own edges.
    const tailLeft = Math.max(14, Math.min(b.width - 14, (t.left + t.width / 2) - left));
    this.el.style.setProperty("--tail-left", tailLeft + "px");
  }

  // Re-validates the currently-showing step's target - for a page to call on
  // every engine render. Catches a target that silently became hidden after
  // its bubble already rendered (e.g. resumed progress jumping straight to
  // the number stage moments after the assembly-stage steps were enqueued,
  // before the player ever saw/dismissed the first one) and advances past it
  // instead of leaving the bubble pinned to a now-vanished element's
  // zero-size rect.
  recheck() {
    if (this.active && this._target && this._target.offsetParent === null) {
      this._dismissCurrent();
      this._showNext();
    }
  }

  _advance() {
    this._dismissCurrent();
    this._showNext();
  }

  _dismissCurrent() {
    if (this._highlighted) this._highlighted.classList.remove("tutorial-highlight");
    this._highlighted = null;
    this._target = null;
    if (this.el) this.el.remove();
    this.el = null;
    window.removeEventListener("resize", this._reposition);
    window.removeEventListener("scroll", this._reposition, true);
  }
}
