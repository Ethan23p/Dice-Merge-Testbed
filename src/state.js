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
 *     rng: () => number
 *   }
 * A Piece is { cells: [{ dr, dc, value }, ...] }, offsets relative to
 * the anchor cell the player clicks. No part of this file touches the DOM.
 *
 * placePiece doesn't just mutate state — it also *returns* `{ steps }`,
 * an ordered timeline of every board change the placement caused
 * (the piece landing, its own merge cascade, gravity's shifts and
 * whatever those bring into contact). This is the one shape the
 * animator (animate.js) needs, whatever caused a given step:
 *   step = {
 *     board: number[][],                      // the board once this step lands
 *     moves: { value, path: {r,c}[] }[],       // dice in flight this step, along their real route
 *     pops: { r, c, massReleased }[],          // cells to flash as newly merged, once step.board is shown
 *   }
 * A step is never returned or stored on `state` itself — it describes
 * a transition, not a resting state, so it has nowhere to live once
 * the animation that plays it is done.
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

  // Is there any (rotation, anchor) combination that fits `piece`
  // somewhere on the board? Defaults to the queue head, but takes any
  // piece so cullUnplaceablePieces can also ask this about a candidate
  // replacement piece — a piece with nowhere to go is never itself a
  // loss condition (see isBoardFull/hasPendingMerge below), just
  // something that gets swapped out before the player ever sees it.
  function hasAnyValidPlacement(state, piece = state.queue[0]) {
    const size = state.config.boardSize;
    let variant = piece;
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

  function isBoardFull(state) {
    return state.board.every((row) => row.every((value) => value !== 0));
  }

  // Whole-board scan for any same-value orthogonal cluster already at
  // or past the merge threshold. Should never actually be true in
  // practice — every placement resolves merges touching its own cells
  // immediately via resolveMerges — but game over is defined directly
  // against this rather than assumed, so the definition ("the board is
  // full and there's nothing left to merge") holds on its own even if
  // that invariant were ever violated, instead of silently relying on it.
  function hasPendingMerge(state) {
    const size = state.config.boardSize;
    const seen = new Set();
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const key = `${r},${c}`;
        if (seen.has(key) || state.board[r][c] === 0) continue;
        const cluster = floodCluster(state, r, c);
        cluster.forEach((cell) => seen.add(`${cell.r},${cell.c}`));
        if (cluster.length >= D.params.mergeMinCluster) return true;
      }
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
  // same-value cluster of MERGE_MIN_CLUSTER+ into a single value+1 die
  // at the cell that triggered it (see D.resolveClusterMass) — always
  // exactly one tier, however large the cluster. Re-checks that cell
  // afterward so a merge can chain into a bigger neighboring cluster.
  //
  // The worklist carries a `wave` per entry (0 for the seeds, N+1 for
  // a merge only possible because a wave-N merge produced the die it
  // consumes) purely to batch this call's own steps in causal order —
  // it never leaves this function. Because the worklist is FIFO and a
  // push always carries the popped item's wave + 1, every wave-N entry
  // is processed before any wave-(N+1) entry exists, so a wave
  // boundary is exactly "the next popped item's wave changed"; that's
  // where a step gets flushed; a trailing flush after the loop catches
  // the last wave (no boundary follows it).
  function resolveMerges(state, seedCells) {
    let scoreGained = 0;
    const steps = [];
    let waveMoves = [];
    let wavePops = [];
    let currentWave = 0;

    function flushWave() {
      if (wavePops.length) {
        steps.push({ board: state.board.map((row) => row.slice()), moves: waveMoves, pops: wavePops });
      }
      waveMoves = [];
      wavePops = [];
    }

    const worklist = seedCells.map((cell) => ({ cell, wave: 0 }));
    while (worklist.length) {
      const { cell, wave } = worklist.shift();
      if (wave !== currentWave) {
        flushWave();
        currentWave = wave;
      }
      const [r, c] = cell;
      if (!inBounds(state, r, c) || state.board[r][c] === 0) continue;
      const cluster = floodCluster(state, r, c);
      if (cluster.length >= D.params.mergeMinCluster) {
        const value = state.board[r][c];
        const { newValue, massReleased, score } = D.resolveClusterMass(value, cluster.length);

        // Each consumed die's `path` is the lateral hop-by-hop chain
        // back to the survivor (r, c) — exactly the connectivity that
        // made it part of this cluster. It travels as its own
        // (pre-merge) value; every cell in a cluster shares that value
        // by construction, so there's no ambiguity in using `value`
        // for every move this cluster produces.
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

        cluster
          .filter((cell) => !(cell.r === r && cell.c === c))
          .forEach((cell) => waveMoves.push({ value, path: pathToRoot(cell) }));
        for (const cell of cluster) state.board[cell.r][cell.c] = 0;
        state.board[r][c] = newValue;
        scoreGained += score;
        wavePops.push({ r, c, massReleased });
        worklist.push({ cell: [r, c], wave: wave + 1 });
      }
    }
    flushWave();
    return { scoreGained, steps };
  }

  // Each direction as the (dr, dc) every die tries to move toward.
  const GRAVITY_VECTORS = {
    up: { dr: -1, dc: 0 },
    down: { dr: 1, dc: 0 },
    left: { dr: 0, dc: -1 },
    right: { dr: 0, dc: 1 },
  };

  // Slides every die on the board as far as it can go toward
  // `direction`, independently per row or column — the same "gravity"
  // a falling-block or match-3 board has, just usable in any of the 4
  // cardinal directions instead of always down. Each line's dice keep
  // their relative order, they just pack against the near edge with
  // every gap squeezed to the far edge. Returns the list of dice that
  // actually moved, each as a move (see the `steps` shape at the top
  // of this file) along the straight line it slid — a die's own
  // relative order within its line never changes, so pairing the k-th
  // occupied cell before the shift with the k-th packed slot after it
  // is exactly which die went where; no cell along the way is ever
  // occupied, so the path is just the two endpoints.
  function shiftBoard(state, direction) {
    const { dr, dc } = GRAVITY_VECTORS[direction];
    const size = state.config.boardSize;
    const moves = [];
    const vertical = dc === 0;
    for (let i = 0; i < size; i++) {
      const cells = [];
      for (let j = 0; j < size; j++) {
        const r = vertical ? j : i;
        const c = vertical ? i : j;
        const value = state.board[r][c];
        if (value !== 0) cells.push({ r, c, value });
      }
      const towardStart = vertical ? dr < 0 : dc < 0;
      const start = towardStart ? 0 : size - cells.length;
      const packed = Array(size).fill(0);
      cells.forEach((cell, k) => { packed[start + k] = cell.value; });
      for (let j = 0; j < size; j++) {
        if (vertical) state.board[j][i] = packed[j];
        else state.board[i][j] = packed[j];
      }
      cells.forEach((cell, k) => {
        const newJ = start + k;
        const newR = vertical ? newJ : i;
        const newC = vertical ? i : newJ;
        if (newR !== cell.r || newC !== cell.c) {
          moves.push({ value: cell.value, path: [{ r: cell.r, c: cell.c }, { r: newR, c: newC }] });
        }
      });
    }
    return moves;
  }

  // A constant directional pull, nothing more: shift everything toward
  // the configured edge, then resolve whatever clusters that shift just
  // brought into contact (dice that weren't touching before can be
  // touching now). A resolved merge leaves a fresh gap behind it, so
  // shift-then-merge repeats until a whole pass changes nothing —
  // bounded defensively (mirrors CULL_MAX_ATTEMPTS' style below) even
  // though a real board can't actually loop that long: every merge
  // strictly shrinks the occupied-cell count, and a board that's fully
  // packed against the gravity edge has nothing left to shift.
  const GRAVITY_MAX_PASSES = 200;
  function applyGravity(state) {
    if (!D.params.gravityEnabled) return { scoreGained: 0, steps: [] };
    const direction = D.params.gravityDirection;
    const size = state.config.boardSize;
    let scoreGained = 0;
    const steps = [];
    for (let pass = 0; pass < GRAVITY_MAX_PASSES; pass++) {
      const moves = shiftBoard(state, direction);
      if (moves.length) {
        steps.push({ board: state.board.map((row) => row.slice()), moves, pops: [] });
      }
      const seeds = [];
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          if (state.board[r][c] !== 0) seeds.push([r, c]);
        }
      }
      const result = resolveMerges(state, seeds);
      scoreGained += result.scoreGained;
      steps.push(...result.steps);
      if (!moves.length && result.steps.length === 0) break;
    }
    return { scoreGained, steps };
  }

  // Shuffles in place with the game's own rng, so which of several
  // equally-valid seed cells "wins" a merge is a deliberate coin flip
  // recorded by the same random stream as everything else, rather than
  // silently falling out of whatever order a piece's shape happened to
  // list its cells in.
  function shuffleInPlace(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // A piece with nowhere to go (in any rotation) never sits in the
  // queue waiting to be dealt with — it's silently swapped for a
  // freshly generated replacement instead, so the player is never
  // stuck holding something structurally unplaceable. Retried a bounded
  // number of times against the normal weighted generator; as long as
  // the board has any empty cell at all (guaranteed by only calling
  // this once game over has been ruled out — see placePiece), a lone
  // die always fits somewhere, so the guaranteed-fit fallback below
  // only ever matters if the weight table itself has been tuned to
  // never spawn one.
  const CULL_MAX_ATTEMPTS = 200;
  function cullUnplaceablePieces(state) {
    state.queue = state.queue.map((piece) => {
      if (hasAnyValidPlacement(state, piece)) return piece;
      for (let i = 0; i < CULL_MAX_ATTEMPTS; i++) {
        const candidate = D.generatePiece(state.rng);
        if (hasAnyValidPlacement(state, candidate)) return candidate;
      }
      return { cells: [{ dr: 0, dc: 0, value: D.rollSpawnValue(state.rng) }] };
    });
    return state;
  }

  // `selected` (optional, absolute {r, c}) is the cell the player was
  // actually holding when they dropped the piece. Merge seeds are
  // checked in order and whichever seed is checked first "wins" a
  // forming cluster (its position survives, holding the bumped value,
  // while the rest of the cluster is cleared) — so putting the
  // selected cell first here means a merge converges on the die the
  // player was holding, not an arbitrary cell of the piece. When the
  // selected cell isn't itself part of the cluster that ends up
  // forming, the remaining seeds are shuffled first so the survivor
  // among *them* is picked at random instead of by shape-array order.
  //
  // Returns `{ steps }`: the full timeline of this placement, from the
  // piece landing through its own merge cascade through whatever
  // gravity does afterward — one flat, causally-ordered sequence, with
  // no marker for which part came from the placement and which from
  // gravity. The animator (animate.js) plays every step the same way;
  // there's nothing left in this shape that would let it tell gravity
  // and placement apart, because nothing downstream needs to.
  function placePiece(state, r, c, selected) {
    if (state.gameOver) return { steps: [] };
    const piece = state.queue[0];
    if (!canPlaceAt(state, piece, r, c)) return { steps: [] };

    const placedCells = shapeCellsAt(piece, r, c);
    placedCells.forEach(({ r: rr, c: cc, value }) => {
      state.board[rr][cc] = value;
    });
    const steps = [{ board: state.board.map((row) => row.slice()), moves: [], pops: [] }];

    let seedCells = shuffleInPlace(placedCells.map(({ r: rr, c: cc }) => [rr, cc]), state.rng);
    if (selected) {
      seedCells = [
        [selected.r, selected.c],
        ...seedCells.filter(([rr, cc]) => !(rr === selected.r && cc === selected.c)),
      ];
    }

    const placementResult = resolveMerges(state, seedCells);
    state.score += placementResult.scoreGained;
    steps.push(...placementResult.steps);
    state.moves += 1;

    const gravityResult = applyGravity(state);
    state.score += gravityResult.scoreGained;
    steps.push(...gravityResult.steps);

    state.queue.shift();
    state.queue.push(D.generatePiece(state.rng));

    // Losing means the board filled up with nothing left to merge —
    // never "the piece you were dealt doesn't fit." A piece (or both
    // queued pieces) having nowhere to go is handled by replacing it
    // (see cullUnplaceablePieces), not by ending the game.
    if (isBoardFull(state) && !hasPendingMerge(state)) {
      state.gameOver = true;
    } else {
      cullUnplaceablePieces(state);
    }

    return { steps };
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
    cullUnplaceablePieces,
    isBoardFull,
    hasPendingMerge,
    shiftBoard,
    applyGravity,
    inBounds,
  };
})();
