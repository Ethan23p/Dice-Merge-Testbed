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
 *     lastMerges: {                      // for the renderer/animations to react to
 *       r, c, value, massReleased, wave,
 *       consumed: { r, c, hop, path: {r,c}[] }[],
 *     }[]
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

  // Flood-fills the orthogonally-connected same-value region containing
  // (r, c) via BFS — not just to find the set of cells, but to record
  // each one's true shortest lateral hop-distance from the root and
  // the specific neighbor it was reached through. The renderer uses
  // that parent chain later to fly a consumed die back to the survivor
  // hop by hop along real lateral connectivity, rather than cutting a
  // straight (possibly diagonal) line through cells it was never
  // actually linked to.
  function floodCluster(state, r, c) {
    const value = state.board[r][c];
    const visited = new Set([`${r},${c}`]);
    const cluster = [{ r, c, hop: 0, parent: null }];
    const queue = [{ r, c, hop: 0 }];
    while (queue.length) {
      const { r: cr, c: cc, hop } = queue.shift();
      for (const [dr, dc] of D.DIRECTIONS) {
        const nr = cr + dr;
        const nc = cc + dc;
        const key = `${nr},${nc}`;
        if (visited.has(key)) continue;
        if (!inBounds(state, nr, nc)) continue;
        if (state.board[nr][nc] !== value) continue;
        visited.add(key);
        cluster.push({ r: nr, c: nc, hop: hop + 1, parent: { r: cr, c: cc } });
        queue.push({ r: nr, c: nc, hop: hop + 1 });
      }
    }
    return cluster;
  }

  // Starting from the cells a piece just occupied, merges any
  // same-value cluster of MERGE_MIN_CLUSTER+ by conserving its combined
  // mass (see D.resolveClusterMass) into a single die at the cell that
  // triggered it — a bigger cluster can jump more than one tier in one
  // go, since it's carrying more mass into the collapse. Re-checks that
  // cell afterward so a merge can chain into a bigger neighboring
  // cluster.
  //
  // Each merge is tagged with a `wave`: 0 for a merge triggered
  // directly by the placement (independent of any other merge from
  // this same placement), N for a merge only possible because a wave
  // (N-1) merge produced the die it consumes. The renderer uses this
  // to animate waves in causal order — merges within a wave are
  // independent and can play together, but a later wave has to wait
  // for the wave that fed it to visually resolve first.
  function resolveMerges(state, seedCells) {
    let scoreGained = 0;
    const merges = [];
    const worklist = seedCells.map((cell) => ({ cell, wave: 0 }));
    while (worklist.length) {
      const { cell, wave } = worklist.shift();
      const [r, c] = cell;
      if (!inBounds(state, r, c) || state.board[r][c] === 0) continue;
      const cluster = floodCluster(state, r, c);
      if (cluster.length >= D.MERGE_MIN_CLUSTER) {
        const value = state.board[r][c];
        const { newValue, massReleased, score } = D.resolveClusterMass(value, cluster.length);

        // Each consumed die's `path` is the lateral hop-by-hop chain
        // back to the survivor (r, c) — exactly the connectivity that
        // made it part of this cluster.
        const byKey = new Map(cluster.map((cell) => [`${cell.r},${cell.c}`, cell]));
        const pathToRoot = (cell) => {
          const path = [{ r: cell.r, c: cell.c }];
          let cur = cell;
          while (cur.parent) {
            cur = byKey.get(`${cur.parent.r},${cur.parent.c}`);
            path.push({ r: cur.r, c: cur.c });
          }
          return path;
        };

        // Cells other than the trigger cell disappear into it — recorded
        // so the renderer can animate them flying to the survivor along
        // their own lateral path before the board settles into its
        // merged state.
        const consumed = cluster
          .filter((cell) => !(cell.r === r && cell.c === c))
          .map((cell) => ({ r: cell.r, c: cell.c, hop: cell.hop, path: pathToRoot(cell) }));
        for (const cell of cluster) state.board[cell.r][cell.c] = 0;
        state.board[r][c] = newValue;
        scoreGained += score;
        merges.push({ r, c, value: newValue, consumed, massReleased, wave });
        worklist.push({ cell: [r, c], wave: wave + 1 });
      }
    }
    return { scoreGained, merges };
  }

  // `selected` (optional, absolute {r, c}) is the cell the player was
  // actually holding when they dropped the piece. Merge seeds are
  // checked in order and whichever seed is checked first "wins" a
  // forming cluster (its position survives, holding the bumped value,
  // while the rest of the cluster is cleared) — so putting the
  // selected cell first here means a merge converges on the die the
  // player was holding, not an arbitrary cell of the piece.
  function placePiece(state, r, c, selected) {
    if (state.gameOver) return state;
    const piece = state.queue[0];
    if (!canPlaceAt(state, piece, r, c)) return state;

    const placedCells = shapeCellsAt(piece, r, c);
    placedCells.forEach(({ r: rr, c: cc, value }) => {
      state.board[rr][cc] = value;
    });

    let seedCells = placedCells.map(({ r: rr, c: cc }) => [rr, cc]);
    if (selected) {
      seedCells = [
        [selected.r, selected.c],
        ...seedCells.filter(([rr, cc]) => !(rr === selected.r && cc === selected.c)),
      ];
    }

    const { scoreGained, merges } = resolveMerges(state, seedCells);
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
