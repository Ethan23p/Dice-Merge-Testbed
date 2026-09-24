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
 * an ordered timeline of every board change the placement caused (the
 * piece landing, then however many generations settle() takes to reach
 * a fixed point — gravity shifts and merges, freely interleaved). This
 * is the one shape the animator (animate.js) needs, whatever a given
 * step is:
 *   step = {
 *     board: number[][],                      // the board once this step lands
 *     moves: { value, path: {r,c}[] }[],       // dice in flight this step, along their real route
 *     pops: { r, c, massReleased, size }[],     // cells to flash as newly merged, once step.board is shown (size = dice consumed)
 *   }
 * A step is never returned or stored on `state` itself — it describes
 * a transition, not a resting state, so it has nowhere to live once
 * the animation that plays it is done.
 *
 * settle() is a fixed-point loop in the cellular-automaton sense: every
 * generation computes its result purely from the board as the
 * *previous* generation left it, in one full-board pass, never from a
 * board still being mutated mid-scan. There's no notion of "seed
 * cells" anywhere — a merge chain, a multi-line gravity settle, and a
 * cluster nobody's touched in ages all fall out of the same loop, with
 * no bookkeeping about which cells still need checking.
 */
const DiceMergeState = (() => {
  const D = DiceMergeData;

  const key = (r, c) => `${r},${c}`;
  const copyBoard = (board) => board.map((row) => row.slice());

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
  // loss condition (see isBoardFull below), just something that gets
  // swapped out before the player ever sees it.
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

  // The orthogonally-connected same-value region containing (r, c) —
  // plain BFS, just membership. Which member of a qualifying cluster
  // survives a merge is a separate decision (see clusterSurvivor) made
  // once the whole cluster is known, not baked into how it was found.
  function floodCluster(state, r, c) {
    const value = state.board[r][c];
    const visited = new Set([key(r, c)]);
    const cluster = [{ r, c }];
    const queue = [{ r, c }];
    while (queue.length) {
      const { r: cr, c: cc } = queue.shift();
      for (const [dr, dc] of D.DIRECTIONS) {
        const nr = cr + dr;
        const nc = cc + dc;
        const k = key(nr, nc);
        if (visited.has(k)) continue;
        if (!inBounds(state, nr, nc)) continue;
        if (state.board[nr][nc] !== value) continue;
        visited.add(k);
        cluster.push({ r: nr, c: nc });
        queue.push({ r: nr, c: nc });
      }
    }
    return cluster;
  }

  // Every qualifying same-value cluster on the board right now, as a
  // disjoint partition — one full-board scan, not a search seeded from
  // wherever something just changed. Whatever caused this generation
  // (a placement, a merge, a gravity shift), the rule is identical:
  // look at the whole board fresh and find every cluster at or past
  // the merge threshold.
  function findClusters(state) {
    const size = state.config.boardSize;
    const visited = new Set();
    const clusters = [];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const k = key(r, c);
        if (visited.has(k) || state.board[r][c] === 0) continue;
        const cluster = floodCluster(state, r, c);
        cluster.forEach((cell) => visited.add(key(cell.r, cell.c)));
        if (cluster.length >= D.params.mergeMinCluster) clusters.push(cluster);
      }
    }
    return clusters;
  }

  // Which member of a cluster survives (keeps this cell, now holding
  // the bumped value, while the rest are cleared) — one priority
  // order, applied the same way whatever produced the cluster, so the
  // outcome never depends on scan order:
  //   1. the exact die the player is holding, if it's in this cluster
  //      (see placePiece's `selected`) — a merge the player caused
  //      converges on the die they dropped;
  //   2. otherwise, any cell descended from the piece they just
  //      placed, if one's in this cluster (see `heldPieceCells`) —
  //      still "theirs" even if it wasn't the exact cell they grabbed;
  //   3. otherwise, uniformly at random among the whole cluster.
  // Ties within a tier (more than one piece cell in the same forming
  // cluster, or no held cell/piece at all) are also broken at random,
  // via the game's own rng — never by scan order.
  function clusterSurvivor(cluster, heldCell, heldPieceCells, rng) {
    function tier(cell) {
      const k = key(cell.r, cell.c);
      if (k === heldCell) return 0;
      if (heldPieceCells.has(k)) return 1;
      return 2;
    }
    let bestTier = 2;
    cluster.forEach((cell) => { bestTier = Math.min(bestTier, tier(cell)); });
    const candidates = bestTier === 2 ? cluster : cluster.filter((cell) => tier(cell) === bestTier);
    return candidates.length === 1 ? candidates[0] : candidates[Math.floor(rng() * candidates.length)];
  }

  // Each consumed cell's hop-by-hop path back to `root`, walked over
  // the cluster's own already-known membership list — never against
  // `state.board`, so it's safe to call after earlier clusters in the
  // same generation have already been applied. BFS over lateral
  // adjacency within the cluster, the same connectivity that made
  // these cells a cluster in the first place.
  function pathsFromRoot(cluster, root) {
    const byKey = new Map(cluster.map((cell) => [key(cell.r, cell.c), cell]));
    const parent = new Map();
    const visited = new Set([key(root.r, root.c)]);
    const queue = [root];
    while (queue.length) {
      const cur = queue.shift();
      for (const [dr, dc] of D.DIRECTIONS) {
        const nr = cur.r + dr;
        const nc = cur.c + dc;
        const k = key(nr, nc);
        if (visited.has(k) || !byKey.has(k)) continue;
        visited.add(k);
        parent.set(k, cur);
        queue.push(byKey.get(k));
      }
    }
    const paths = new Map();
    cluster.forEach((cell) => {
      const path = [{ r: cell.r, c: cell.c }];
      let cur = cell;
      while (parent.has(key(cur.r, cur.c))) {
        cur = parent.get(key(cur.r, cur.c));
        path.push({ r: cur.r, c: cur.c });
      }
      paths.set(key(cell.r, cell.c), path);
    });
    return paths;
  }

  // Applies one generation's worth of already-found clusters together.
  // Every survivor and every path is computed first, from each
  // cluster's own frozen membership (pathsFromRoot never reads
  // state.board) — only once all of that is known does any cluster
  // touch the board. However many clusters resolve this generation,
  // none of their mutations can leak into another's path.
  //
  // Also returns the piece-lineage set (see `heldPieceCells`) updated
  // for whatever happened: a cluster this generation that included any
  // piece cell has its whole membership swapped out for just its
  // survivor — the merged die is the piece's new "representative" for
  // priority in later generations, whether or not it was itself a
  // piece cell.
  function applyMergeGeneration(state, clusters, heldCell, heldPieceCells, rng) {
    const applications = clusters.map((cluster) => {
      const survivor = clusterSurvivor(cluster, heldCell, heldPieceCells, rng);
      const value = state.board[survivor.r][survivor.c];
      const { newValue, massReleased, score } = D.resolveClusterMass(value, cluster.length);
      const paths = pathsFromRoot(cluster, survivor);
      return { cluster, survivor, value, newValue, massReleased, score, paths };
    });

    let scoreGained = 0;
    const moves = [];
    const pops = [];
    const nextHeldPieceCells = new Set(heldPieceCells);
    applications.forEach(({ cluster, survivor, value, newValue, massReleased, score, paths }) => {
      const touchesPiece = cluster.some((cell) => nextHeldPieceCells.has(key(cell.r, cell.c)));
      cluster
        .filter((cell) => !(cell.r === survivor.r && cell.c === survivor.c))
        .forEach((cell) => moves.push({ value, path: paths.get(key(cell.r, cell.c)) }));
      cluster.forEach((cell) => {
        state.board[cell.r][cell.c] = 0;
        nextHeldPieceCells.delete(key(cell.r, cell.c));
      });
      state.board[survivor.r][survivor.c] = newValue;
      if (touchesPiece) nextHeldPieceCells.add(key(survivor.r, survivor.c));
      scoreGained += score;
      pops.push({ r: survivor.r, c: survivor.c, massReleased, size: cluster.length });
    });
    return { scoreGained, moves, pops, heldPieceCells: nextHeldPieceCells };
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
  // every gap squeezed to the far edge — a closed-form settle computed
  // once from the current board, not an iterated cell-by-cell fall.
  // Returns the dice that actually moved, each along the straight line
  // it slid — a die's own relative order within its line never
  // changes, so pairing the k-th occupied cell before the shift with
  // the k-th packed slot after it is exactly which die went where; no
  // cell along the way is ever occupied, so the path is just the two
  // endpoints.
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

  // Where each die a shift moved ended up, keyed by where it started.
  function shiftDestinations(moves) {
    return new Map(moves.map(({ path }) => {
      const from = path[0];
      const to = path[path.length - 1];
      return [key(from.r, from.c), key(to.r, to.c)];
    }));
  }

  // The one settle loop, run after every placement: a fixed-point
  // iteration in the cellular-automaton sense — every generation reads
  // the board exactly as the previous generation left it and computes
  // its own result from that single frozen snapshot, never from a
  // board still being mutated mid-generation. Gravity (when on) always
  // gets first refusal each generation: dice fall as far as they can
  // before anything's allowed to merge, so a cluster only ever
  // resolves once its members have actually settled against each
  // other, not wherever they happened to land. Once a generation finds
  // nothing left to shift and nothing left to merge, the board's at a
  // fixed point and the loop stops.
  //
  // Bounded defensively below, though a real board can't actually loop
  // that long: a shift generation only ever packs a line tighter
  // (monotonic, and idempotent once a line's fully packed), and a
  // merge generation strictly shrinks the occupied-cell count — so the
  // two alternating can't cycle forever.
  const SETTLE_MAX_GENERATIONS = 500;
  function settle(state, heldCellInit, heldPieceCellsInit) {
    const steps = [];
    let scoreGained = 0;
    let heldCell = heldCellInit ? key(heldCellInit.r, heldCellInit.c) : null;
    let heldPieceCells = new Set(heldPieceCellsInit || []);
    const gravityOn = D.params.gravityEnabled;
    const direction = D.params.gravityDirection;

    for (let gen = 0; gen < SETTLE_MAX_GENERATIONS; gen++) {
      if (gravityOn) {
        const moves = shiftBoard(state, direction);
        if (moves.length) {
          steps.push({ board: copyBoard(state.board), moves, pops: [] });
          const dest = shiftDestinations(moves);
          const follow = (k) => dest.get(k) || k;
          heldCell = heldCell && follow(heldCell);
          heldPieceCells = new Set([...heldPieceCells].map(follow));
          continue;
        }
      }
      const clusters = findClusters(state);
      if (!clusters.length) break;
      const result = applyMergeGeneration(state, clusters, heldCell, heldPieceCells, state.rng);
      scoreGained += result.scoreGained;
      heldPieceCells = result.heldPieceCells;
      steps.push({ board: copyBoard(state.board), moves: result.moves, pops: result.pops });
    }
    return { scoreGained, steps };
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
  // actually holding when they dropped the piece — settle()'s held-
  // cell priority (see clusterSurvivor) is what makes a forming merge
  // converge there rather than an arbitrary cell of the piece, and
  // keeps following that same die through however many gravity shifts
  // happen before it merges. Every other cell of the piece still gets
  // second priority (see `heldPieceCells`), so a merge the placement
  // caused converges somewhere in the piece the player just dropped
  // even when it doesn't happen to include the exact cell they grabbed.
  //
  // Returns `{ steps }`: the full timeline of this placement, from the
  // piece landing through however many generations settle() takes —
  // gravity shifts and merges, freely interleaved — as one flat,
  // causally-ordered sequence. The animator (see DiceMergeAnimate)
  // plays every step the same way; nothing in this shape says which
  // generation was "a merge" and which was "gravity," because nothing
  // downstream needs to know.
  function placePiece(state, r, c, selected) {
    if (state.gameOver) return { steps: [] };
    const piece = state.queue[0];
    if (!canPlaceAt(state, piece, r, c)) return { steps: [] };

    const placedCells = shapeCellsAt(piece, r, c);
    placedCells.forEach(({ r: rr, c: cc, value }) => {
      state.board[rr][cc] = value;
    });
    const steps = [{ board: copyBoard(state.board), moves: [], pops: [] }];

    const heldPieceCells = new Set(placedCells.map(({ r: rr, c: cc }) => key(rr, cc)));
    const settleResult = settle(state, selected || null, heldPieceCells);
    state.score += settleResult.scoreGained;
    steps.push(...settleResult.steps);
    state.moves += 1;

    state.queue.shift();
    state.queue.push(D.generatePiece(state.rng));

    // settle() always runs to a fixed point — no qualifying cluster
    // anywhere on the board, and (if gravity's on) nothing left to
    // fall — so losing is exactly "the board is full," never "there's
    // an unresolved merge nobody got to."
    if (isBoardFull(state)) {
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
    settle,
    findClusters,
    shapeCellsAt,
    canPlaceAt,
    hasAnyValidPlacement,
    cullUnplaceablePieces,
    isBoardFull,
    shiftBoard,
    inBounds,
  };
})();
