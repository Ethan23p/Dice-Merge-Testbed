/*
 * Game state as plain data, and the rules that change it. No DOM.
 *
 *   state = { config: { boardSize, queueLength }, board, queue, score, moves, gameOver, rng }
 *   board[r][c]: 0 = empty, N = a die showing N
 *   piece = { cells: [{ dr, dc, value }] }
 *
 * placePiece returns { steps }: the placement and everything it caused,
 * in order, for the animator to play.
 *   step = {
 *     board,                          // board after this step
 *     moves: [{ value, path }],       // dice travelling, path = [{ r, c }, ...]
 *     pops:  [{ r, c, massReleased, size }],  // merge results to flash
 *   }
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

  function shapeCellsAt(piece, r, c) {
    return piece.cells.map((cell) => ({ r: r + cell.dr, c: c + cell.dc, value: cell.value }));
  }

  function canPlaceAt(state, piece, r, c) {
    return shapeCellsAt(piece, r, c).every(
      ({ r: rr, c: cc }) => inBounds(state, rr, cc) && state.board[rr][cc] === 0
    );
  }

  // Any rotation, any anchor.
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

  // Which cell of a merging cluster keeps the new die: the die the player was
  // holding, else any die from the piece just placed, else random. Never scan
  // order. `heldCell` is a key; `heldPieceCells` is a Set of keys.
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

  // Each cell's route to `root` through the cluster, one orthogonal hop at a
  // time. Uses only the cluster's own membership, never the board, so clusters
  // resolving in the same generation can't affect each other.
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

  // Resolves every cluster found this generation. Survivors and paths are all
  // computed before any cell changes. A cluster containing piece dice passes that
  // status to its survivor for later generations.
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

  const GRAVITY_VECTORS = {
    up: { dr: -1, dc: 0 },
    down: { dr: 1, dc: 0 },
    left: { dr: 0, dc: -1 },
    right: { dr: 0, dc: 1 },
  };

  // Packs every row or column toward `direction`, keeping order. A die only ever
  // slides in a straight line, so each move's path is just its two endpoints.
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

  function shiftDestinations(moves) {
    return new Map(moves.map(({ path }) => {
      const from = path[0];
      const to = path[path.length - 1];
      return [key(from.r, from.c), key(to.r, to.c)];
    }));
  }

  // Runs gravity and merges to a fixed point. Each generation reads the board
  // the previous one left. Gravity goes first, so clusters only merge once
  // settled. Can't loop forever (shifts only pack, merges only remove dice);
  // the cap is a safety net.
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

  // Swaps any queued piece that fits nowhere for one that does, so an
  // unplaceable piece is never shown. Only runs when the board has a free cell,
  // so a lone die always fits.
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

  // `selected` is the board cell under the die the player was holding.
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

    // settle() leaves nothing to merge or fall, so a full board is the only loss.
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
