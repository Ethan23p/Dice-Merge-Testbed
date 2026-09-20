/*
 * Game state as plain data plus pure(ish) functions that transform it.
 * State shape:
 *   {
 *     config: { boardSize, queueLength },
 *     board: number[][]                 // 0 = empty, N = die showing value N
 *     queue: Piece[]                     // upcoming pieces, queue[0] is placed next
 *     score: number,
 *     moves: number,
 *     gameOver: boolean,
 *     lastMerges: { r, c, value }[]      // for the renderer/animations to react to
 *     rng: () => number
 *   }
 * A Piece is { cells: [{ dr, dc, value }, ...] }, offsets relative to
 * the anchor cell the player clicks. No part of this file touches the DOM.
 */
const DiceMergeState = (() => {
  const D = DiceMergeData;

  function createState(config = D.DEFAULT_CONFIG, rng = Math.random) {
    const size = config.boardSize;
    const board = Array.from({ length: size }, () => Array(size).fill(0));
    const queue = Array.from({ length: config.queueLength }, () => D.generatePiece(rng));
    return {
      config: { ...config },
      board,
      queue,
      score: 0,
      moves: 0,
      gameOver: false,
      lastMerges: [],
      rng,
    };
  }

  function inBounds(state, r, c) {
    const size = state.config.boardSize;
    return r >= 0 && r < size && c >= 0 && c < size;
  }

  // Absolute board coordinates a piece would occupy if its (0,0)
  // offset landed on (r, c).
  function shapeCellsAt(piece, r, c) {
    return piece.cells.map((cell) => ({ r: r + cell.dr, c: c + cell.dc, value: cell.value }));
  }

  function canPlaceAt(state, piece, r, c) {
    return shapeCellsAt(piece, r, c).every(
      ({ r: rr, c: cc }) => inBounds(state, rr, cc) && state.board[rr][cc] === 0
    );
  }

  // Is there any (rotation, anchor) combination that fits the current
  // piece somewhere on the board? Checked after every placement to
  // decide game over — the board can be non-full and still be stuck.
  function hasAnyValidPlacement(state) {
    const size = state.config.boardSize;
    let variant = state.queue[0];
    for (let rot = 0; rot < 4; rot++) {
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          if (canPlaceAt(state, variant, r, c)) return true;
        }
      }
      variant = D.rotatePiece(variant);
    }
    return false;
  }

  // Flood-fills the orthogonally-connected same-value region containing (r, c).
  function floodCluster(state, r, c) {
    const value = state.board[r][c];
    const visited = new Set();
    const cluster = [];
    const stack = [[r, c]];
    while (stack.length) {
      const [cr, cc] = stack.pop();
      const key = `${cr},${cc}`;
      if (visited.has(key)) continue;
      if (!inBounds(state, cr, cc)) continue;
      if (state.board[cr][cc] !== value) continue;
      visited.add(key);
      cluster.push([cr, cc]);
      for (const [dr, dc] of D.DIRECTIONS) stack.push([cr + dr, cc + dc]);
    }
    return cluster;
  }

  // Starting from the cells a piece just occupied, merges any
  // same-value cluster of MERGE_MIN_CLUSTER+ into a single die at the
  // cell that triggered it, one value higher. Re-checks that cell
  // afterward so a merge can chain into a bigger neighboring cluster.
  function resolveMerges(state, seedCells) {
    let scoreGained = 0;
    const merges = [];
    const worklist = [...seedCells];
    while (worklist.length) {
      const [r, c] = worklist.shift();
      if (!inBounds(state, r, c) || state.board[r][c] === 0) continue;
      const cluster = floodCluster(state, r, c);
      if (cluster.length >= D.MERGE_MIN_CLUSTER) {
        const newValue = state.board[r][c] + 1;
        // Cells other than the trigger cell disappear into it — recorded
        // so the renderer can animate them shrinking away before the
        // board settles into its merged state.
        const consumed = cluster
          .filter(([cr, cc]) => !(cr === r && cc === c))
          .map(([cr, cc]) => ({ r: cr, c: cc }));
        for (const [cr, cc] of cluster) state.board[cr][cc] = 0;
        state.board[r][c] = newValue;
        scoreGained += D.scoreForMerge(newValue, cluster.length);
        merges.push({ r, c, value: newValue, consumed });
        worklist.push([r, c]);
      }
    }
    return { scoreGained, merges };
  }

  function placePiece(state, r, c) {
    if (state.gameOver) return state;
    const piece = state.queue[0];
    if (!canPlaceAt(state, piece, r, c)) return state;

    const placedCells = shapeCellsAt(piece, r, c);
    placedCells.forEach(({ r: rr, c: cc, value }) => {
      state.board[rr][cc] = value;
    });

    const { scoreGained, merges } = resolveMerges(
      state,
      placedCells.map(({ r: rr, c: cc }) => [rr, cc])
    );
    state.score += scoreGained;
    state.lastMerges = merges;
    state.moves += 1;

    state.queue.shift();
    state.queue.push(D.generatePiece(state.rng));

    if (!hasAnyValidPlacement(state)) {
      state.gameOver = true;
    }

    return state;
  }

  function rotateQueueHead(state) {
    state.queue[0] = D.rotatePiece(state.queue[0]);
    return state;
  }

  return {
    createState,
    placePiece,
    rotateQueueHead,
    resolveMerges,
    shapeCellsAt,
    canPlaceAt,
    hasAnyValidPlacement,
    inBounds,
  };
})();
