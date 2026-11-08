// Generalized Pazuju game engine - board-size-agnostic version of the
// pazuju_puzzle_308_v2.html mockup. Consumes the plain-object puzzle shape
// produced by pazuju-xml-loader.js and renders/drives a single puzzle instance
// inside caller-supplied DOM elements.
class PazujuGame {
  constructor({ boardEl, trayEl, statusEl, numberPadEl, onSolved, onStateChange, boardMaxPx, trayMode, highlightErrors, staggerPad }) {
    this.boardEl = boardEl;
    this.trayEl = trayEl;
    this.statusEl = statusEl;
    this.numberPadEl = numberPadEl;
    this.onSolved = onSolved;
    this.onStateChange = onStateChange;
    // Offsets alternating number-pad chips up/down into a "torn paper tab"
    // look instead of one flat row - defaults off, but both the website
    // (play.html) and the app now pass staggerPad: true. See _renderNumberPad().
    this.staggerPad = !!staggerPad;
    // Lets a smaller embed (e.g. the homepage teaser) render a more compact
    // board than the full play page without touching the sizing logic itself.
    this.boardMaxPx = boardMaxPx || 520;
    // "list" (default) stacks every unplaced piece in trayEl, as the website
    // does. "paged" (the app's own layout) shows a fixed-size circular
    // sliding window of trayWindowSize pieces, with trayShiftLeft()/
    // trayShiftRight() to move through the rest one piece at a time - see
    // _renderTray()/_renderTrayPaged().
    this.trayMode = trayMode === "paged" ? "paged" : "list";
    this.trayWindowSize = 3;
    this.trayWindowStart = 0;
    this.dragging = null;
    this.selectedCell = null;
    this.highlightValue = null;
    this._hasCelebrated = false;
    this._animating = false;
    // Whether an ordinary row/col/piece duplicate-value conflict (NOT a
    // given-vs-given collision, which always shows - see _renderBoard) turns
    // a cell red. A settings toggle, defaults on to match prior behavior -
    // see setHighlightErrors()/toggleNotesMode() for the caller-facing API.
    this.highlightErrors = highlightErrors !== false;
    // Pencil-mark mode: while on, tapping a number-pad digit toggles it in a
    // cell's small candidate-notes set (this.notes) instead of setting its
    // real value - see _onPadClick()/toggleNotesMode().
    this.notesMode = false;

    this._onDragMove = this._onDragMove.bind(this);
    this._onDragEnd = this._onDragEnd.bind(this);
  }

  setHighlightErrors(on) {
    this.highlightErrors = !!on;
    this._renderAll();
  }

  toggleNotesMode() {
    this.notesMode = !this.notesMode;
    this._renderAll();
  }

  // Wipes every pencil-mark candidate on the board at once (the "Clear
  // notes" game-menu item) - an undoable action like any other, not a
  // confirm-dialog-gated one, since Undo already covers an accidental tap.
  clearNotes() {
    if (!Object.keys(this.notes).length) return;
    const before = this._snapshot();
    this.notes = {};
    this._commitHistory(before);
    this._renderAll();
  }

  // Swaps in a new puzzle. Safe to call repeatedly on the same instance.
  loadPuzzle(puzzle) {
    this._endDrag();
    this.size = puzzle.size;
    this.valueMin = puzzle.valueMin;
    this.valueMax = puzzle.valueMax;
    this.boardGivens = puzzle.boardGivens;
    this.solutionGrid = puzzle.solutionGrid;
    this.fixedPieceIds = new Set(puzzle.fixedPieces.map(p => p.id));
    // The puzzle's true piece count, fixed at load time - _renderBoard()'s
    // "all placed" check compares against this instead of re-deriving a
    // total from whatever's currently in placed/unplaced, which would
    // silently shrink (and falsely report ready-for-numbers) if a piece
    // were ever lost from both, e.g. by the mid-drag sync race fixed in
    // getState()/restoreState() above.
    this._totalPieceCount = puzzle.fixedPieces.length + puzzle.trayPieces.length;

    const palette = this._buildPalette(puzzle.fixedPieces.length + puzzle.trayPieces.length);
    let colorIndex = 0;

    this.placed = puzzle.fixedPieces.map(p => ({
      id: p.id,
      color: palette[colorIndex++],
      origin: { ...p.origin },
      cells: p.cells.map(c => [...c]),
      givens: { ...p.givens },
    }));
    this.unplaced = puzzle.trayPieces.map(p => ({
      id: p.id,
      color: palette[colorIndex++],
      cells: p.cells.map(c => [...c]),
      givens: { ...p.givens },
      solved: { origin: { ...p.solved.origin }, cells: p.solved.cells.map(c => [...c]), givens: { ...p.solved.givens } },
    }));
    this.userValues = {};
    // Pencil-mark candidates per cell ("r,c" -> sorted array of digits) - a
    // player memory aid, cleared for a cell the moment it gets a real value
    // (see _onPadClick). Independent of userValues/lockedCells.
    this.notes = {};
    // Keys ("r,c") of user-filled cells confirmed correct by a past
    // "check numbers" - rendered and treated like given/starter cells from
    // then on (locked, not re-editable). See checkNumbers().
    this.lockedCells = new Set();
    this.history = [];
    this.selectedCell = null;
    this.highlightValue = null;
    this._hasCelebrated = false;
    this._animating = false;
    this.trayWindowStart = 0;
    this.notesMode = false;

    this._applyCellSizing();
    this._renderAll();
  }

  // Undo history: each entry is a deep-copied snapshot of the puzzle state
  // (pieces + entered numbers) from just before one player action. undo()
  // pops them one at a time, so repeated presses walk back in order.
  _snapshot() {
    return JSON.stringify({
      placed: this.placed,
      unplaced: this.unplaced,
      userValues: this.userValues,
      notes: this.notes,
      lockedCells: [...this.lockedCells],
    });
  }

  // Records `before` as an undo step, unless the action turned out to be a
  // no-op (e.g. a rotate that didn't fit, or a piece dropped back on its own
  // spot) - placed pieces are compared order-insensitively, since re-placing
  // a piece moves it to the end of `placed` without changing anything visible.
  _commitHistory(before) {
    const normalize = (json) => {
      const st = JSON.parse(json);
      st.placed.sort((a, b) => String(a.id).localeCompare(String(b.id)));
      return JSON.stringify(st);
    };
    if (normalize(before) === normalize(this._snapshot())) return;
    this.history.push(before);
  }

  canUndo() {
    return this.history.length > 0 && !this.dragging && !this._animating && !this._hasCelebrated;
  }

  // Plain-object snapshot of persistable player progress (placed pieces,
  // unplaced pieces, entered numbers, locked cells) - for a caller to sync
  // to a backend. Deliberately excludes UI-only state (selectedCell,
  // highlightValue, drag state). See restoreState() for the inverse.
  getState() {
    let placed = this.placed;
    // A snapshot taken mid-drag (app losing focus for an ad, screen lock,
    // task switch) would otherwise catch a board piece in limbo: it's pulled
    // out of `placed` the instant a re-drag is confirmed (see _onDragMove)
    // and only rejoins `placed`/`unplaced` once the drag ends, so a sync
    // right then would persist it as missing from both, permanently. Put it
    // back in its pre-drag spot here so that can't happen (tray-sourced
    // drags don't need this - that piece stays in `unplaced` the whole time,
    // only removed on a successful drop).
    if (this.dragging && this.dragging.moved && this.dragging.source === "board") {
      placed = [...placed, this.dragging.piece];
    }
    return {
      placed,
      unplaced: this.unplaced,
      userValues: this.userValues,
      notes: this.notes,
      lockedCells: [...this.lockedCells],
      solved: this._hasCelebrated,
    };
  }

  // Restores a previously-captured snapshot (see getState()) onto the puzzle
  // that's already been loaded via loadPuzzle() - for resuming progress
  // synced from a backend. Assumes the same puzzle (piece ids/cells/givens
  // unchanged); only overwrites the player's own placement/entry state.
  // Clears undo history since the restored pieces didn't come from a chain
  // of local actions the player could step back through.
  restoreState(state) {
    if (!state) return;
    if (state.placed && state.unplaced) {
      const savedIds = new Set([...state.placed, ...state.unplaced].map(p => p.id));
      // Recover any piece the freshly-loaded puzzle (still sitting in
      // this.placed/this.unplaced from the loadPuzzle() call just before
      // this) knows about but the saved snapshot doesn't - e.g. one lost
      // mid-drag by an interrupted sync (see getState()) - by returning it
      // to the tray instead of leaving it vanished forever.
      const recovered = [...this.placed, ...this.unplaced].filter(p => !savedIds.has(p.id));
      this.placed = state.placed;
      this.unplaced = recovered.length ? state.unplaced.concat(recovered) : state.unplaced;
    } else {
      if (state.placed) this.placed = state.placed;
      if (state.unplaced) this.unplaced = state.unplaced;
    }
    // Guard against a placed piece whose saved origin overlaps another
    // piece or falls outside the board - e.g. one written mid-drag by an
    // older client build that predates getState()'s pre-drag fix above.
    // That piece is present by id (so the recovery pass just above never
    // catches it) but silently steals a cell from whoever it overlaps,
    // leaving that other cell uncovered forever with nothing flagging it
    // as wrong. Re-validate geometry on every restore, same as a piece
    // missing outright: anything that doesn't fit cleanly bounces to the
    // tray instead of corrupting the board.
    const seen = Array.from({ length: this.size }, () => Array(this.size).fill(false));
    const validPlaced = [];
    const bounced = [];
    for (const p of this.placed) {
      const ok = p.cells.every(([r, c]) => {
        const rr = p.origin.r + r, cc = p.origin.c + c;
        return rr >= 0 && rr < this.size && cc >= 0 && cc < this.size && !seen[rr][cc];
      });
      if (ok) {
        p.cells.forEach(([r, c]) => { seen[p.origin.r + r][p.origin.c + c] = true; });
        validPlaced.push(p);
      } else {
        bounced.push(p);
      }
    }
    this.placed = validPlaced;
    if (bounced.length) this.unplaced = this.unplaced.concat(bounced);
    this.userValues = state.userValues || {};
    this.notes = state.notes || {};
    this.lockedCells = new Set(state.lockedCells || []);
    this.history = [];
    this._hasCelebrated = !!state.solved;
    this._renderAll();
  }

  undo() {
    if (!this.canUndo()) return false;
    const st = JSON.parse(this.history.pop());
    this.placed = st.placed;
    this.unplaced = st.unplaced;
    this.userValues = st.userValues;
    this.notes = st.notes || {};
    this.lockedCells = new Set(st.lockedCells);
    this._renderAll();
    return true;
  }

  _applyCellSizing() {
    this.cell = this._computeCellSize(this.size);
    // Paged mode (the app) renders tray pieces noticeably smaller than list
    // mode (the website, unaffected - 0.62 unchanged there) - the user asked
    // for the free-piece area to shrink by scaling the pieces themselves
    // down, not just clipping/overflowing a same-sized piece out of a
    // shorter box (see the "Old App" screenshots this was modeled on).
    const trayScale = this.trayMode === "paged" ? 0.42 : 0.62;
    this.trayCell = Math.max(this.trayMode === "paged" ? 12 : 16, Math.round(this.cell * trayScale));
    this.boardEl.style.width = (this.size * this.cell) + "px";
    this.boardEl.style.height = (this.size * this.cell) + "px";
    this.boardEl.style.backgroundSize = `${this.cell}px ${this.cell}px`;
    if (this.trayMode === "paged") {
      // Fixed height, independent of which pieces are currently in the
      // window or how they're rotated - a piece that rotates into a taller
      // bounding box doesn't resize this area, it just pokes out past the
      // edge instead (see native.css's #tray overflow:visible). Sized for
      // roughly ONE (now smaller-scaled, see trayScale above) cell tall plus
      // a little breathing room - most pieces (even in their default
      // orientation) run taller than this and will routinely overflow, which
      // is the explicit trade-off requested: a thin strip that gives almost
      // all the vertical space back to the board, matching the reference
      // app's proportions (see the "Old App 3/4" screenshots this was
      // modeled on). Tuned over several rounds of feedback: a stray
      // min-height:250px leftover from the website's tray style (see
      // native.css, now fixed) was masking the real computed value, which
      // turned out "way too small" (floor 26) once found; floor 40, then
      // floor 56, were each still "too short" - this doubles that last one.
      this.trayEl.style.height = Math.max(112, Math.round(this.trayCell * 4 + 40)) + "px";
    }
  }

  // Lets the caller re-fit the board to the viewport (e.g. on resize/rotate)
  // without reloading the puzzle - only geometry changes, all placed pieces
  // and entered numbers are preserved.
  setBoardMaxPx(boardMaxPx) {
    this.boardMaxPx = boardMaxPx;
    if (!this.size) return;
    this._applyCellSizing();
    this._renderAll();
  }

  _computeCellSize(size) {
    const targetBoardPx = this.boardMaxPx;
    return Math.max(20, Math.min(60, Math.floor(targetBoardPx / size)));
  }

  _buildPalette(count) {
    // Golden-angle hue steps give visually distinct pastel colors for any piece count.
    const colors = [];
    for (let i = 0; i < count; i++) {
      const hue = (i * 137.508) % 360;
      colors.push(`hsl(${hue.toFixed(0)}, 42%, 78%)`);
    }
    return colors;
  }

  _coverGrid() {
    const g = Array.from({ length: this.size }, () => Array(this.size).fill(null));
    this.placed.forEach(p => {
      p.cells.forEach(([r, c]) => {
        const rr = p.origin.r + r, cc = p.origin.c + c;
        if (rr >= 0 && rr < this.size && cc >= 0 && cc < this.size) g[rr][cc] = p;
      });
    });
    return g;
  }

  _findConflicts(grid, cover) {
    const conflicts = new Set();
    const scan = (cells) => {
      const seen = {};
      cells.forEach(([rr, cc]) => {
        const v = grid[rr][cc];
        if (v === null) return;
        const key = "v" + v;
        (seen[key] = seen[key] || []).push([rr, cc]);
      });
      Object.values(seen).forEach(list => {
        if (list.length > 1) list.forEach(([rr, cc]) => conflicts.add(rr + "," + cc));
      });
    };
    for (let r = 0; r < this.size; r++) scan(Array.from({ length: this.size }, (_, c) => [r, c]));
    for (let c = 0; c < this.size; c++) scan(Array.from({ length: this.size }, (_, r) => [r, c]));

    const byPiece = {};
    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        const p = cover[r][c];
        if (p) (byPiece[p.id] = byPiece[p.id] || []).push([r, c]);
      }
    }
    Object.values(byPiece).forEach(scan);
    return conflicts;
  }

  _renderBoard() {
    const { boardEl, size, cell } = this;
    boardEl.innerHTML = "";
    const cover = this._coverGrid();
    const grid = Array.from({ length: size }, () => Array(size).fill(null));
    const givenOnlyGrid = Array.from({ length: size }, () => Array(size).fill(null));
    const givenGrid = Array.from({ length: size }, () => Array(size).fill(false));
    // A piece placed in the wrong rotation can carry one of its own printed
    // givens onto a square that already has a different given printed on the
    // board itself - two clues can't both be true, so that's a placement
    // conflict distinct from (and not caught by) the row/col/piece
    // duplicate-value scan below, which only ever sees the one value that
    // happened to win the overwrite.
    const givenCollisions = new Set();

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const p = cover[r][c];
        const key = r + "," + c;
        let val = this.boardGivens[r][c];
        let given = val !== null;
        if (p) {
          const relKey = (r - p.origin.r) + "," + (c - p.origin.c);
          const pieceGiven = p.givens[relKey];
          if (pieceGiven !== undefined) {
            if (val !== null && val !== pieceGiven) givenCollisions.add(r + "," + c);
            val = pieceGiven;
            given = true;
          } else if (val === null) {
            val = this.userValues[key] ?? null;
            // A value confirmed correct by "check numbers" is locked in -
            // render/treat it like a given from now on (see checkNumbers()).
            if (val !== null && this.lockedCells.has(key)) given = true;
          }
        }
        grid[r][c] = val;
        givenGrid[r][c] = given;
        givenOnlyGrid[r][c] = given ? val : null;
      }
    }

    const conflicts = this._findConflicts(grid, cover);
    givenCollisions.forEach(k => conflicts.add(k));
    // Conflicts that exist among the clues alone (piece givens vs. board
    // givens vs. each other), ignoring anything the player has typed in -
    // these can only be fixed by re-placing a piece, so they gate whether
    // the puzzle is even ready to move into the number-filling stage.
    const givenConflicts = new Set([...givenCollisions, ...this._findConflicts(givenOnlyGrid, cover)]);

    const totalPieces = this._totalPieceCount;
    const allPlaced = this.placed.length === totalPieces;
    this._allPiecesPlaced = allPlaced;
    const readyForNumbers = allPlaced && givenConflicts.size === 0;
    this._readyForNumbers = readyForNumbers;

    const valueCounts = {};
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const v = grid[r][c];
        if (v !== null) valueCounts[v] = (valueCounts[v] || 0) + 1;
      }
    }
    this._valueCounts = valueCounts;

    const filledCount = Object.values(valueCounts).reduce((a, b) => a + b, 0);
    const solved = allPlaced && conflicts.size === 0 && filledCount === size * size;
    // Fire the celebration exactly once per puzzle: even if the player later
    // clears/re-enters a value (e.g. double-tapping a pad number toggles it
    // off then back on) and the board briefly leaves and re-reaches "solved",
    // it should not set off fireworks again.
    if (solved && !this._hasCelebrated) {
      this._hasCelebrated = true;
      if (typeof this.onSolved === "function") this.onSolved();
    }

    if (this.selectedCell) {
      const { r, c } = this.selectedCell;
      if (!cover[r][c] || givenGrid[r][c] || !readyForNumbers) this.selectedCell = null;
    }

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const div = document.createElement("div");
        div.className = "cell";
        div.dataset.r = r;
        div.dataset.c = c;
        div.style.width = cell + "px";
        div.style.height = cell + "px";
        div.style.left = (c * cell) + "px";
        div.style.top = (r * cell) + "px";
        div.style.fontSize = Math.round(cell * 0.4) + "px";
        const p = cover[r][c];
        if (p) {
          div.style.background = p.color;
          // Thicken/darken the cell's outer edges (where a neighbor cell
          // belongs to a different piece, or is empty) so each assembled
          // piece's shape reads clearly against its neighbors on the board.
          if (r === 0 || cover[r - 1][c] !== p) { div.style.borderTopWidth = "3px"; div.style.borderTopColor = "rgba(58,42,28,0.85)"; }
          if (r === size - 1 || cover[r + 1][c] !== p) { div.style.borderBottomWidth = "3px"; div.style.borderBottomColor = "rgba(58,42,28,0.85)"; }
          if (c === 0 || cover[r][c - 1] !== p) { div.style.borderLeftWidth = "3px"; div.style.borderLeftColor = "rgba(58,42,28,0.85)"; }
          if (c === size - 1 || cover[r][c + 1] !== p) { div.style.borderRightWidth = "3px"; div.style.borderRightColor = "rgba(58,42,28,0.85)"; }
        } else {
          div.classList.add("empty-bg");
        }
        const val = grid[r][c];
        const editable = !!p && !givenGrid[r][c];
        // A piece the player placed themselves (not one of the puzzle's
        // fixed starting pieces), while still in the assembly stage, can be
        // dragged back off the board or tapped to rotate in place - see
        // _startBoardDrag/_rotatePlacedPiece.
        const movable = p && !this.fixedPieceIds.has(p.id) && !readyForNumbers;
        const key = r + "," + c;
        if (givenGrid[r][c]) div.classList.add("given");
        // Given-vs-given collisions always show (they block progression, not
        // an optional assist) - ordinary row/col/piece duplicate highlighting
        // is gated behind the highlightErrors setting (see setHighlightErrors()).
        if (givenCollisions.has(key) || (this.highlightErrors && conflicts.has(key))) div.classList.add("conflict");
        if (this.selectedCell && this.selectedCell.r === r && this.selectedCell.c === c) div.classList.add("selected");
        if (this.highlightValue !== null && val === this.highlightValue) div.classList.add("value-match");
        if (val !== null) {
          const chip = document.createElement("span");
          chip.className = "num-chip";
          chip.textContent = val;
          div.appendChild(chip);
        } else if (editable && this.notes[key] && this.notes[key].length) {
          const notesEl = document.createElement("span");
          notesEl.className = "cell-notes";
          notesEl.textContent = this.notes[key].join(" ");
          div.appendChild(notesEl);
        }
        if (movable) {
          div.style.cursor = "grab";
          div.addEventListener("pointerdown", (e) => {
            if (this._animating) return;
            // Capture is best-effort - document-level move/up listeners
            // already track the gesture regardless, so a capture failure
            // shouldn't leave the drag dead.
            try { div.setPointerCapture(e.pointerId); } catch { /* ignore */ }
            this._startBoardDrag(e, p);
          });
        } else if (val !== null || editable) {
          if (!p && val !== null) div.style.cursor = "pointer";
          div.addEventListener("click", () => {
            if (this._animating) return;
            const wasSelected = this.selectedCell && this.selectedCell.r === r && this.selectedCell.c === c;
            this.highlightValue = val !== null ? (this.highlightValue === val ? null : val) : null;
            this.selectedCell = (editable && readyForNumbers) ? (wasSelected ? null : { r, c }) : null;
            this._renderAll();
          });
        }
        boardEl.appendChild(div);
      }
    }

    this.statusEl.textContent = !allPlaced
      ? `${this.placed.length} of ${totalPieces} pieces placed.`
      : solved
        ? "🎉 Solved! Great job."
        : givenConflicts.size > 0
          ? "Two clues conflict on the red squares - re-place that piece (rotate or try another spot) before filling in numbers."
          : (conflicts.size === 0 ? "All pieces placed. Fill in the numbers." : "All pieces placed, but some numbers conflict, check the red squares.");
  }

  _pieceBounds(cells) {
    const rows = cells.map(c => c[0]), cols = cells.map(c => c[1]);
    return { w: Math.max(...cols) + 1, h: Math.max(...rows) + 1 };
  }

  _renderTray() {
    this.trayEl.querySelectorAll(".piece-wrap").forEach(el => el.remove());
    if (this.trayMode === "paged") {
      this._renderTrayPaged();
      return;
    }
    // Static header controls (see play.html) live in the tray markup outside
    // the piece-wraps this method manages - just keep their enabled state in
    // sync with whether there's anything left to cycle through.
    this.trayEl.querySelectorAll(".tray-cycle-btn").forEach(btn => {
      btn.disabled = this.unplaced.length < 2;
    });
    this.unplaced.forEach(p => {
      const wrap = document.createElement("div");
      wrap.className = "piece-wrap";
      this._layoutPieceWrap(wrap, p, this.trayCell);
      wrap.addEventListener("pointerdown", (e) => this._startDrag(e, p, wrap));
      this.trayEl.appendChild(wrap);
    });
  }

  // Cycles the tray order so a different piece lands in the reachable top
  // slot - on a phone, only the first piece or two are easily reachable
  // without scrolling, and the easiest piece to start with isn't always the
  // one the generator happened to list first. List mode only (website).
  cycleTrayUp() {
    if (this.trayMode !== "list" || this.unplaced.length < 2) return;
    this.unplaced.push(this.unplaced.shift());
    this._renderTray();
  }

  cycleTrayDown() {
    if (this.trayMode !== "list" || this.unplaced.length < 2) return;
    this.unplaced.unshift(this.unplaced.pop());
    this._renderTray();
  }

  // Paged tray mode (the app's own layout, see trayMode in the constructor) -
  // shows a fixed-size circular sliding window (this.trayWindowSize pieces,
  // default 3) into this.unplaced rather than every piece at once. Pressing
  // "shift left" advances the window by exactly one piece and wraps around
  // (e.g. with 6 pieces: [1,2,3] -> [2,3,4] -> [3,4,5] -> [4,5,6] -> [5,6,1]);
  // "shift right" moves back by one, also wrapping. this.trayWindowStart is
  // re-clamped (mod unplaced.length) on every render, so it self-corrects
  // after any placement/return/skip-assembly change to this.unplaced without
  // needing to track every mutation site individually.
  _renderTrayPaged() {
    const total = this.unplaced.length;
    const windowSize = Math.min(this.trayWindowSize, total);
    if (total === 0) {
      this.trayWindowStart = 0;
    } else {
      this.trayWindowStart = ((this.trayWindowStart % total) + total) % total;
    }

    const canCycle = total > this.trayWindowSize;
    this.trayEl.querySelectorAll(".tray-page-btn").forEach(btn => {
      btn.disabled = !canCycle;
    });

    for (let i = 0; i < windowSize; i++) {
      const p = this.unplaced[(this.trayWindowStart + i) % total];
      const wrap = document.createElement("div");
      wrap.className = "piece-wrap";
      this._layoutPieceWrap(wrap, p, this.trayCell);
      wrap.addEventListener("pointerdown", (e) => this._startDrag(e, p, wrap));
      this.trayEl.appendChild(wrap);
    }
  }

  // Called by the "shift left" button - advances the window by one piece
  // (the piece that falls off the left becomes reachable again by shifting
  // right), wrapping circularly through this.unplaced.
  trayShiftLeft() {
    if (this.trayMode !== "paged" || this.unplaced.length <= this.trayWindowSize) return;
    this.trayWindowStart += 1;
    this._renderTray();
  }

  // Called by the "shift right" button - moves the window back by one piece.
  trayShiftRight() {
    if (this.trayMode !== "paged" || this.unplaced.length <= this.trayWindowSize) return;
    this.trayWindowStart -= 1;
    this._renderTray();
  }

  // Fills a piece-wrap element with cell divs for the given piece at the
  // given cell size. Used both for the shrunken tray view and to expand a
  // piece back to full board size once the player actually starts dragging it.
  _layoutPieceWrap(wrap, p, cellSize) {
    wrap.innerHTML = "";
    const b = this._pieceBounds(p.cells);
    wrap.style.width = (b.w * cellSize) + "px";
    wrap.style.height = (b.h * cellSize) + "px";
    p.cells.forEach(([r, c]) => {
      const div = document.createElement("div");
      div.className = "cell";
      div.style.width = cellSize + "px";
      div.style.height = cellSize + "px";
      div.style.left = (c * cellSize) + "px";
      div.style.top = (r * cellSize) + "px";
      div.style.fontSize = Math.round(cellSize * 0.4) + "px";
      div.style.background = p.color;
      const g = p.givens[r + "," + c];
      if (g !== undefined) {
        div.classList.add("given");
        const chip = document.createElement("span");
        chip.className = "num-chip";
        chip.textContent = g;
        div.appendChild(chip);
      }
      wrap.appendChild(div);
    });
  }

  _rotateCells(cells) {
    const maxR = Math.max(...cells.map(c => c[0]));
    return cells.map(([r, c]) => [c, maxR - r]);
  }

  _rotateGivens(givens, cells) {
    const maxR = Math.max(...cells.map(c => c[0]));
    const out = {};
    Object.entries(givens).forEach(([key, val]) => {
      const [r, c] = key.split(",").map(Number);
      out[c + "," + (maxR - r)] = val;
    });
    return out;
  }

  _renderAll() {
    this._renderBoard();
    this._renderTray();
    this._renderNumberPad();
    if (typeof this.onStateChange === "function") {
      this.onStateChange({
        readyForNumbers: this._readyForNumbers,
        canUndo: this.canUndo(),
        allPiecesPlaced: this._allPiecesPlaced,
        hasUserValues: Object.keys(this.userValues).length > 0,
      });
    }
  }

  // Compares every player-entered number against the puzzle's solution and
  // animates the wrong ones off the board instead of just deleting them.
  // Correct ones get locked in (see lockedCells) so they read and behave
  // like given/starter cells from then on. Only ever touches userValues -
  // givens are guaranteed conflict-free by the time readyForNumbers is true
  // (see _renderBoard), so there's nothing of the puzzle's own clues for
  // this to second-guess.
  checkNumbers() {
    if (!this._readyForNumbers || this._animating) return { checked: 0, wrong: 0 };
    const wrong = [];
    Object.keys(this.userValues).forEach(key => {
      const [r, c] = key.split(",").map(Number);
      if (this.userValues[key] !== this.solutionGrid[r][c]) wrong.push({ r, c, key });
      else { this.lockedCells.add(key); delete this.notes[key]; }
    });
    const checked = Object.keys(this.userValues).length;
    // A check is a checkpoint, not an undoable step - undoing past it would
    // restore the wrong numbers it just revealed and unlock the confirmed
    // ones, effectively handing out a free check.
    this.history = [];
    // Re-render right away so newly-locked cells switch to the given look
    // immediately, even before any wrong ones finish falling away.
    this._renderAll();
    if (wrong.length === 0) return { checked, wrong: 0 };

    this._animating = true;
    this._animateFallAway(wrong, () => {
      wrong.forEach(({ key }) => delete this.userValues[key]);
      this._animating = false;
      this._renderAll();
    });
    return { checked, wrong: wrong.length };
  }

  // Animates the given board cells' number chips falling away, then calls
  // onDone. Board interaction is blocked (see the _animating checks above)
  // for the duration so a re-render can't cut the animation off early.
  _animateFallAway(cells, onDone) {
    const chipEls = cells
      .map(({ r, c }) => this.boardEl.querySelector(`.cell[data-r="${r}"][data-c="${c}"] .num-chip`))
      .filter(Boolean);

    if (chipEls.length === 0) { onDone(); return; }

    chipEls.forEach((chip, i) => {
      const drift = Math.round(Math.random() * 70 - 35);
      const spin = Math.round(Math.random() * 320 - 160);
      chip.style.setProperty("--fall-x", drift + "px");
      chip.style.setProperty("--fall-rot", spin + "deg");
      chip.style.transitionDelay = (i * 70) + "ms";
      void chip.offsetWidth; // force layout so the delayed transition starts from here, not the end state
      chip.classList.add("chip-fall");
    });

    const totalMs = 700 + (chipEls.length - 1) * 70;
    setTimeout(onDone, totalMs);
  }

  // Auto-places every remaining tray piece at its correct solved position and
  // rotation (regardless of whatever rotation it currently sits at in the
  // tray), skipping straight to the number-filling stage.
  skipAssembly() {
    if (this.unplaced.length === 0) return;
    const before = this._snapshot();
    this.unplaced.forEach(piece => {
      const { origin, cells, givens } = piece.solved;
      this.placed.push({ id: piece.id, color: piece.color, origin: { ...origin }, cells: cells.map(c => [...c]), givens: { ...givens } });
    });
    this.unplaced = [];
    this._commitHistory(before);
    this._renderAll();
  }

  // Number pad below the board: tap a board square to select it (see the
  // click handler in _renderBoard), then tap the value here to fill it in.
  // Chip size is derived from boardMaxPx (same viewport-driven cap the board
  // itself uses) so the whole row fits on a phone screen in one line instead
  // of wrapping/misaligning at a fixed desktop size.
  _renderNumberPad() {
    if (!this.numberPadEl) return;
    this.numberPadEl.innerHTML = "";
    if (!this._readyForNumbers) {
      this.numberPadEl.style.display = "none";
      return;
    }
    this.numberPadEl.style.display = "";
    // Lets the chips themselves look different while notes mode is on (see
    // .number-pad.notes-mode in site.css), not just the toolbar toggle
    // button - a persistent reminder of which mode taps will apply.
    this.numberPadEl.classList.toggle("notes-mode", this.notesMode);
    const count = this.valueMax - this.valueMin + 1;
    const maxGap = 10;
    const minGap = 4;
    const minChipSize = 24;
    const maxChipSize = 48;
    // Chips need to fit inside boardMaxPx net of the pad's own horizontal
    // padding/border (site.css's .number-pad) - sizing the chip row to the
    // full boardMaxPx and ignoring that chrome made the whole pad render
    // ~46px wider than boardMaxPx, overflowing past the right edge on
    // narrow screens (most visible on the app's tight fixed frame). Read
    // live from computed style rather than hardcoding, so a future CSS
    // tweak can't silently reintroduce the overflow.
    const padStyle = getComputedStyle(this.numberPadEl);
    const padChrome = parseFloat(padStyle.paddingLeft) + parseFloat(padStyle.paddingRight) +
      parseFloat(padStyle.borderLeftWidth) + parseFloat(padStyle.borderRightWidth);
    const availableWidth = this.boardMaxPx - padChrome;
    let gap = maxGap;
    let chipSize = Math.min(maxChipSize, Math.floor((availableWidth - gap * (count - 1)) / count));
    // A 10-value pad (10x10 boards) on a narrow phone can't fit at both the
    // max gap AND the minChipSize tap-target floor - rather than shrink chips
    // below that floor (or silently overflow the pad's own padding box, which
    // is what used to happen here), shrink the gap first. Chips stay a
    // readable/tappable 24px; the row just sits a little tighter.
    if (chipSize < minChipSize) {
      chipSize = minChipSize;
      gap = Math.max(minGap, Math.floor((availableWidth - chipSize * count) / (count - 1)));
    }
    this.numberPadEl.style.gap = gap + "px";
    let i = 0;
    for (let v = this.valueMin; v <= this.valueMax; v++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "num-chip pad-chip";
      btn.style.width = chipSize + "px";
      btn.style.height = chipSize + "px";
      btn.style.fontSize = Math.round(chipSize * 0.42) + "px";
      // "Torn paper tab" stagger (app-only, see native.css) - every other
      // chip sits higher/further back (positive margin-bottom pulls a
      // flex-end-aligned item's visible box up off the row's bottom edge),
      // in real px derived from this chip's own size rather than a CSS
      // percentage margin (which resolves against the row's WIDTH, not each
      // chip's height, and would come out wrong).
      if (this.staggerPad && i % 2 === 1) btn.style.marginBottom = Math.round(chipSize * 0.4) + "px";
      if (!this.selectedCell) btn.classList.add("disabled");
      if (this.highlightValue === v) btn.classList.add("active");
      if ((this._valueCounts[v] || 0) >= this.size) btn.classList.add("complete");
      btn.textContent = v;
      btn.addEventListener("click", () => this._onPadClick(v));
      this.numberPadEl.appendChild(btn);
      i++;
    }
  }

  _onPadClick(value) {
    if (this._animating || !this.selectedCell) return;
    const { r, c } = this.selectedCell;
    const key = r + "," + c;
    const before = this._snapshot();
    if (this.notesMode) {
      // Pencil-mark mode: toggle the digit in this cell's candidate set
      // instead of setting a real value - leaves userValues untouched.
      const set = new Set(this.notes[key] || []);
      if (set.has(value)) set.delete(value); else set.add(value);
      if (set.size) this.notes[key] = [...set].sort((a, b) => a - b);
      else delete this.notes[key];
    } else {
      if (this.userValues[key] === value) delete this.userValues[key];
      else this.userValues[key] = value;
      // A real value makes any pencil marks in this cell moot.
      delete this.notes[key];
    }
    this._commitHistory(before);
    this.highlightValue = value;
    this._renderAll();
  }

  _startDrag(e, piece, el) {
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    this.dragging = { source: "tray", piece, el, before: this._snapshot(), startX: e.clientX, startY: e.clientY, origLeft: rect.left, origTop: rect.top, moved: false };
    try { el.setPointerCapture(e.pointerId); } catch { /* best-effort, see _startBoardDrag */ }
    document.addEventListener("pointermove", this._onDragMove);
    document.addEventListener("pointerup", this._onDragEnd);
  }

  // Picks up a piece already on the board (pointer capture is set by the
  // caller in _renderBoard, on the actual cell that received the pointerdown).
  // Nothing changes yet - the piece stays put and no floating clone exists
  // until _onDragMove confirms this is a real drag rather than a tap (see
  // _onDragEnd's "not moved" branch, which rotates it in place instead).
  _startBoardDrag(e, piece) {
    e.preventDefault();
    const boardRect = this.boardEl.getBoundingClientRect();
    this.dragging = {
      source: "board",
      piece,
      el: null,
      before: this._snapshot(),
      startX: e.clientX,
      startY: e.clientY,
      origLeft: boardRect.left + piece.origin.c * this.cell,
      origTop: boardRect.top + piece.origin.r * this.cell,
      moved: false,
    };
    document.addEventListener("pointermove", this._onDragMove);
    document.addEventListener("pointerup", this._onDragEnd);
  }

  _onDragMove(e) {
    if (!this.dragging) return;
    const dx = e.clientX - this.dragging.startX;
    const dy = e.clientY - this.dragging.startY;
    if (!this.dragging.moved) {
      if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
      this.dragging.moved = true;
      if (this.dragging.source === "board") {
        // Confirmed a real drag, not a tap-to-rotate - pull the piece off
        // the board now and follow the cursor with a floating clone.
        this.placed = this.placed.filter(x => x.id !== this.dragging.piece.id);
        const wrap = document.createElement("div");
        wrap.className = "piece-wrap";
        document.body.appendChild(wrap);
        this.dragging.el = wrap;
        this._renderAll();
      }
      const el = this.dragging.el;
      // Expand/draw the piece at full board-cell size now that it's actually being dragged.
      this._layoutPieceWrap(el, this.dragging.piece, this.cell);
      el.style.position = "fixed";
      el.style.left = this.dragging.origLeft + "px";
      el.style.top = this.dragging.origTop + "px";
      el.style.zIndex = 1000;
    }
    this.dragging.el.style.left = (this.dragging.origLeft + dx) + "px";
    this.dragging.el.style.top = (this.dragging.origTop + dy) + "px";
  }

  _onDragEnd(e) {
    if (!this.dragging) return;
    const { source, piece, moved, before } = this.dragging;

    if (!moved) {
      if (source === "board") {
        this._rotatePlacedPiece(piece);
      } else {
        piece.givens = this._rotateGivens(piece.givens, piece.cells);
        piece.cells = this._rotateCells(piece.cells);
      }
      this._commitHistory(before);
      this._endDrag();
      // Full render (not just the tray) so onStateChange reports the new canUndo.
      this._renderAll();
      return;
    }

    const boardRect = this.boardEl.getBoundingClientRect();
    const elRect = this.dragging.el.getBoundingClientRect();
    const targetCol = Math.round((elRect.left - boardRect.left) / this.cell);
    const targetRow = Math.round((elRect.top - boardRect.top) / this.cell);
    const cover = this._coverGrid();
    const cells = piece.cells.map(([r, c]) => [targetRow + r, targetCol + c]);
    const fits = cells.every(([r, c]) => r >= 0 && r < this.size && c >= 0 && c < this.size && !cover[r][c]);

    if (fits) {
      if (source === "tray") this.unplaced = this.unplaced.filter(p => p.id !== piece.id);
      this.placed.push({ id: piece.id, color: piece.color, origin: { r: targetRow, c: targetCol }, cells: piece.cells, givens: piece.givens, solved: piece.solved });
    } else if (source === "board") {
      // Didn't land on an open spot - send it back to the tray, same as the old remove button used to.
      this.unplaced.push({ id: piece.id, color: piece.color, cells: piece.cells, givens: piece.givens, solved: piece.solved });
    }
    // A tray piece that doesn't fit anywhere just stays in `unplaced`, untouched.
    this.dragging.el.remove();
    this._commitHistory(before);
    this._endDrag();
    this._renderAll();
  }

  // Rotates a piece already on the board in place (tap-to-rotate), only if
  // the rotated shape still fits at its current origin - on the board and
  // not overlapping another placed piece. Silently no-ops otherwise; the
  // player can drag it somewhere with more room and try again.
  _rotatePlacedPiece(piece) {
    const newCells = this._rotateCells(piece.cells);
    const cover = this._coverGrid();
    const fits = newCells.every(([r, c]) => {
      const rr = piece.origin.r + r, cc = piece.origin.c + c;
      if (rr < 0 || rr >= this.size || cc < 0 || cc >= this.size) return false;
      const occupant = cover[rr][cc];
      return !occupant || occupant.id === piece.id;
    });
    if (!fits) return;
    piece.givens = this._rotateGivens(piece.givens, piece.cells);
    piece.cells = newCells;
    this._renderAll();
  }

  _endDrag() {
    document.removeEventListener("pointermove", this._onDragMove);
    document.removeEventListener("pointerup", this._onDragEnd);
    this.dragging = null;
  }
}
