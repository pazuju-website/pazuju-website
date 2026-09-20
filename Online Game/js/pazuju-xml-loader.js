// Parses a Pazuju puzzle XML file (as produced for Puzzle1/2/3.xml) into the
// plain-object shape the engine (pazuju-engine.js) consumes:
//
//   {
//     size: 6,
//     difficulty: 1.7,
//     valueMin: 1, valueMax: 6,
//     boardGivens: [[null,3,null,...], ...]      // size x size, given numbers printed on the board itself
//     fixedPieces: [{ id, cells, givens, origin }, ...]   // pieces already sitting on the board
//     trayPieces:  [{ id, cells, givens }, ...]           // pieces waiting to be placed
//   }
//
// A tile's <active>YES</active> marks it as a given (fixed) value. Among givens,
// <onBlock>NO</onBlock> means the number is printed on the board itself (independent
// of whatever piece ends up covering that square), while <onBlock>YES</onBlock> means
// the number is printed on the piece and travels with it.
// Deterministic PRNG (mulberry32) seeded from a string hash (cyrb-style), so
// the same seed always produces the same sequence - used to pre-scramble tray
// piece orientation without relying on unseeded Math.random().
function _hashSeedString(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

function _mulberry32(seed) {
  let state = seed;
  return function () {
    state |= 0; state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Standalone copies of PazujuGame's rotation logic (pazuju-engine.js), used here
// to pre-rotate tray pieces before an engine instance exists.
function _rotateCells(cells) {
  const maxR = Math.max(...cells.map(c => c[0]));
  return cells.map(([r, c]) => [c, maxR - r]);
}

function _rotateGivens(givens, cells) {
  const maxR = Math.max(...cells.map(c => c[0]));
  const out = {};
  Object.entries(givens).forEach(([key, val]) => {
    const [r, c] = key.split(",").map(Number);
    out[c + "," + (maxR - r)] = val;
  });
  return out;
}

// `seed`, when provided, makes the tray-piece rotation scramble deterministic
// (e.g. derived from the puzzle's date+size) so every player sees the same
// scrambled orientations for "the same" puzzle. Omit it for unseeded/random
// scrambling (e.g. quick local testing).
function parsePazujuXML(xmlText, seed) {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  const parseError = doc.querySelector("parsererror");
  if (parseError) throw new Error("Invalid puzzle XML: " + parseError.textContent);

  const size = parseInt(doc.querySelector("gridSize").textContent, 10);
  const difficultyEl = doc.querySelector("difficultyLevel");
  const difficulty = difficultyEl ? parseFloat(difficultyEl.textContent) : null;

  const blocksOnGrid = new Set(
    [...doc.querySelectorAll("blocksOnGrid > blockNum")].map(el => parseInt(el.textContent, 10))
  );

  const tiles = [...doc.querySelectorAll("tiles > tile")].map(t => {
    const onBlockEl = t.querySelector("onBlock");
    return {
      number: parseInt(t.querySelector("number").textContent, 10),
      row: parseInt(t.querySelector("row").textContent, 10) - 1,
      col: parseInt(t.querySelector("col").textContent, 10) - 1,
      block: parseInt(t.querySelector("block").textContent, 10),
      active: t.querySelector("active").textContent.trim() === "YES",
      onBlock: onBlockEl ? onBlockEl.textContent.trim() === "YES" : false,
    };
  });

  if (tiles.length !== size * size) {
    throw new Error(`Puzzle XML declares gridSize ${size} but has ${tiles.length} tiles`);
  }

  let valueMin = Infinity, valueMax = -Infinity;
  tiles.forEach(t => {
    if (t.number < valueMin) valueMin = t.number;
    if (t.number > valueMax) valueMax = t.number;
  });

  const boardGivens = Array.from({ length: size }, () => Array(size).fill(null));
  tiles.forEach(t => {
    if (t.active && !t.onBlock) boardGivens[t.row][t.col] = t.number;
  });

  // Every tile carries its correct final number, active (a clue) or not -
  // that's the puzzle's solved layout, straight from the source data. Used
  // by the "check numbers" feature to grade what the player typed in, and by
  // "skip assembly" (via each tray piece's `solved` below) to know where a
  // piece truly belongs.
  const solutionGrid = Array.from({ length: size }, () => Array(size).fill(null));
  tiles.forEach(t => { solutionGrid[t.row][t.col] = t.number; });

  const byBlock = new Map();
  tiles.forEach(t => {
    if (!byBlock.has(t.block)) byBlock.set(t.block, []);
    byBlock.get(t.block).push(t);
  });

  const fixedPieces = [];
  const trayPieces = [];

  byBlock.forEach((blockTiles, blockId) => {
    const minR = Math.min(...blockTiles.map(t => t.row));
    const minC = Math.min(...blockTiles.map(t => t.col));
    const cells = blockTiles.map(t => [t.row - minR, t.col - minC]);
    const givens = {};
    blockTiles.forEach(t => {
      if (t.active && t.onBlock) givens[(t.row - minR) + "," + (t.col - minC)] = t.number;
    });

    const piece = { id: String(blockId), cells, givens };
    if (blocksOnGrid.has(blockId)) {
      fixedPieces.push({ ...piece, origin: { r: minR, c: minC } });
    } else {
      // Tray pieces are derived straight from their solved-board position, so
      // scramble each one's orientation before it reaches the tray - otherwise
      // the player never actually needs the rotate button. Keep the true
      // pre-scramble origin/cells/givens around as `solved` so "skip
      // assembly" can snap the piece straight to its correct spot later,
      // independent of whatever rotation it's scrambled to here.
      const solved = { origin: { r: minR, c: minC }, cells: cells.map(c => [...c]), givens: { ...givens } };
      const rand = seed !== undefined ? _mulberry32(_hashSeedString(`${seed}:${blockId}`)) : Math.random;
      const rotations = Math.floor(rand() * 4);
      for (let i = 0; i < rotations; i++) {
        piece.givens = _rotateGivens(piece.givens, piece.cells);
        piece.cells = _rotateCells(piece.cells);
      }
      trayPieces.push({ ...piece, solved });
    }
  });

  return { size, difficulty, valueMin, valueMax, boardGivens, solutionGrid, fixedPieces, trayPieces };
}
