/*
 * Static game data: dice pip layouts, colors, piece shapes, spawn
 * weights, scoring. Nothing here knows about the DOM or about "the
 * board" as an object — it's just tables and pure functions over them,
 * so new dice values, shapes, or spawn rules are additions to data,
 * not new code paths.
 */
const DiceMergeData = (() => {
  const DIRECTIONS = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];

  // 3x3 grid coordinates for standard die faces 1-6.
  const PIP_LAYOUTS = {
    1: [[1, 1]],
    2: [[0, 0], [2, 2]],
    3: [[0, 0], [1, 1], [2, 2]],
    4: [[0, 0], [0, 2], [2, 0], [2, 2]],
    5: [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]],
    6: [[0, 0], [0, 2], [1, 0], [1, 2], [2, 0], [2, 2]],
  };

  // Values beyond the palette length fall back to a generated hue so
  // merge chains never run out of colors.
  const BASE_PALETTE = [
    '#c9c9c9', // 1
    '#4f8ef7', // 2
    '#57c15d', // 3
    '#f5a623', // 4
    '#e8534f', // 5
    '#9b6bd6', // 6
  ];

  function colorForValue(value) {
    const idx = value - 1;
    if (idx >= 0 && idx < BASE_PALETTE.length) return BASE_PALETTE[idx];
    const hue = (idx * 47) % 360;
    return `hsl(${hue}, 62%, 55%)`;
  }

  function pipLayoutForValue(value) {
    return PIP_LAYOUTS[value] || null;
  }

  // Balance knobs that the config panel (see config.js) can retune
  // live. Read through `params.X` at call time everywhere below,
  // rather than closed-over constants, so a panel change takes effect
  // on the very next roll/merge — no reload needed. This object's
  // starting values ARE the "initial" values recorded in config.js's
  // schema; keep the two in sync if either changes.
  const params = {
    massBase: 2, // mass(value) = massBase ** (value - 1)
    massExponent: 0.5, // scaleWithMass(base, mass) = base * mass ** massExponent
    scoreMultiplier: 10, // score = massReleased * scoreMultiplier
    mergeMinCluster: 3, // dice needed, same-value and touching, to merge
    spawnTemperature: 2, // higher = flatter spawn-rarity curve
    spawnValuePool: 8, // highest value ever rolled for as a spawn
  };

  // Every die value stands for a "mass" that grows per tier — used for
  // scoring and animation weight (a heavier die drops/impacts harder),
  // not for deciding what a merge turns into. With the default base of
  // 2 this doubles per tier: mass(1)=1, mass(2)=2, mass(3)=4, ...
  function massForValue(value) {
    return params.massBase ** (value - 1);
  }

  // 3+ same-value dice reaching critical mass together (a fusion
  // threshold, not a value threshold) is what triggers a merge at all.
  function resolveClusterMass(value, clusterSize) {
    const newValue = value + 1;
    const massReleased = massForValue(value) * clusterSize - massForValue(newValue);
    return { newValue, massReleased, score: massReleased * params.scoreMultiplier };
  }

  // What spawns is governed by the same mass law, not a separate hand-
  // picked table: heavier values are exponentially rarer, the way
  // higher-energy states are in a Boltzmann distribution — one
  // temperature constant sets how sharply rarity falls off with mass,
  // rather than a percentage being chosen per value. The default
  // temperature of 2 reproduces roughly the old hand-tuned 55/30/15
  // split for values 1-3, but — because it's a real curve rather than
  // a lookup table with a hard edge — it also lets a rare 4 or 5 spawn
  // instead of never happening at all above the old table's top entry.
  function spawnWeight(value) {
    return Math.exp(-massForValue(value) / params.spawnTemperature);
  }

  function rollSpawnValue(rng = Math.random) {
    const weights = [];
    let total = 0;
    for (let value = 1; value <= params.spawnValuePool; value++) {
      const w = spawnWeight(value);
      weights.push(w);
      total += w;
    }
    let roll = rng() * total;
    for (let i = 0; i < weights.length; i++) {
      if (roll < weights[i]) return i + 1;
      roll -= weights[i];
    }
    return 1;
  }

  // Real materials take longer to settle the more massive they are — a
  // spring's natural period scales with mass**massExponent/stiffness —
  // so any animation whose length or intensity should reflect "how
  // much mass is involved" scales through this one function instead of
  // each spot picking its own per-tier multiplier. At mass=1 this is a
  // no-op (returns `base` unchanged), so the lightest die reproduces
  // exactly whatever baseline feel `base` was tuned for. Default
  // exponent is 0.5 (square root).
  function scaleWithMass(base, mass) {
    return base * mass ** params.massExponent;
  }

  // Piece shapes: relative (dr, dc) offsets, normalized so the
  // top-left occupied cell is (0, 0). Weighted by size so most pieces
  // stay small and the board doesn't fill too fast.
  const SHAPE_LIBRARY = {
    1: [
      [[0, 0]],
    ],
    2: [
      [[0, 0], [0, 1]],
      [[0, 0], [1, 0]],
    ],
    3: [
      [[0, 0], [0, 1], [0, 2]], // I horizontal
      [[0, 0], [1, 0], [2, 0]], // I vertical
      [[0, 0], [0, 1], [1, 0]], // L, missing bottom-right
      [[0, 0], [0, 1], [1, 1]], // L, missing bottom-left
      [[0, 0], [1, 0], [1, 1]], // L, missing top-right
      [[0, 1], [1, 0], [1, 1]], // L, missing top-left
    ],
  };

  const PIECE_SIZE_WEIGHTS = [
    { size: 1, weight: 40 },
    { size: 2, weight: 35 },
    { size: 3, weight: 25 },
  ];

  function rollPieceSize(rng = Math.random) {
    const total = PIECE_SIZE_WEIGHTS.reduce((sum, e) => sum + e.weight, 0);
    let roll = rng() * total;
    for (const entry of PIECE_SIZE_WEIGHTS) {
      if (roll < entry.weight) return entry.size;
      roll -= entry.weight;
    }
    return PIECE_SIZE_WEIGHTS[0].size;
  }

  // A piece is { cells: [{ dr, dc, value }, ...] } — a small polyomino
  // whose cells are shuffled independently: each rolls its own value
  // off the same spawn curve as a lone die (rollSpawnValue), rather
  // than the whole piece sharing one roll. Shape (where it sits) and
  // value (what each cell is made of) are independent axes.
  function generatePiece(rng = Math.random) {
    const size = rollPieceSize(rng);
    const shapes = SHAPE_LIBRARY[size];
    const shape = shapes[Math.floor(rng() * shapes.length)];
    const cells = shape.map(([dr, dc]) => ({ dr, dc, value: rollSpawnValue(rng) }));
    return { cells };
  }

  // A piece's total mass, for physics/animation feel (snapback weight,
  // rotate duration, reject-shake strength) — the sum of each cell's
  // own mass, since a piece's cells can each hold a different value
  // (see generatePiece) and a real multi-part object's mass is the sum
  // of its parts, not just whichever part you'd ask first.
  function pieceMass(piece) {
    return piece.cells.reduce((sum, cell) => sum + massForValue(cell.value), 0);
  }

  // Rotates a piece 90° clockwise and re-normalizes so it keeps a
  // non-negative, top-left-anchored offset list. Works for any shape —
  // no per-shape special casing.
  function rotatePiece(piece) {
    const rotated = piece.cells.map((cell) => ({
      dr: cell.dc,
      dc: -cell.dr,
      value: cell.value,
    }));
    const minR = Math.min(...rotated.map((c) => c.dr));
    const minC = Math.min(...rotated.map((c) => c.dc));
    return {
      cells: rotated.map((c) => ({ dr: c.dr - minR, dc: c.dc - minC, value: c.value })),
    };
  }

  const DEFAULT_CONFIG = {
    boardSize: 5,
    queueLength: 2,
  };

  const BOARD_SIZE_OPTIONS = [4, 5, 6];

  return {
    DIRECTIONS,
    PIP_LAYOUTS,
    BASE_PALETTE,
    colorForValue,
    pipLayoutForValue,
    params,
    spawnWeight,
    rollSpawnValue,
    massForValue,
    resolveClusterMass,
    scaleWithMass,
    SHAPE_LIBRARY,
    PIECE_SIZE_WEIGHTS,
    rollPieceSize,
    generatePiece,
    pieceMass,
    rotatePiece,
    DEFAULT_CONFIG,
    BOARD_SIZE_OPTIONS,
  };
})();
