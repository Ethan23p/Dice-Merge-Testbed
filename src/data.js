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

  // Relative weights, not percentages — rollSpawnValue normalizes.
  const SPAWN_TABLE = [
    { value: 1, weight: 55 },
    { value: 2, weight: 30 },
    { value: 3, weight: 15 },
  ];

  function rollSpawnValue(rng = Math.random) {
    const total = SPAWN_TABLE.reduce((sum, entry) => sum + entry.weight, 0);
    let roll = rng() * total;
    for (const entry of SPAWN_TABLE) {
      if (roll < entry.weight) return entry.value;
      roll -= entry.weight;
    }
    return SPAWN_TABLE[0].value;
  }

  // Every die value stands for a "mass" that doubles per tier — the one
  // physical law the rest of the merge/score system is derived from,
  // rather than each being its own hand-picked rule:
  //   mass(1)=1, mass(2)=2, mass(3)=4, mass(4)=8, ...
  // A merge is that mass being conserved, not an arbitrary "+1": a
  // cluster's combined mass collapses into the highest single die that
  // mass can support (so a big simultaneous cluster can jump several
  // tiers at once, not just one), and whatever mass doesn't fit into
  // that die is what got "released" — which is also, unmodified, the
  // score. Nothing here is tuned independently of massForValue.
  function massForValue(value) {
    return 2 ** (value - 1);
  }

  function valueForMass(mass) {
    // The tiny epsilon guards against float log2 landing just under an
    // exact tier boundary (e.g. log2(8) as 2.999999999998).
    return 1 + Math.floor(Math.log2(mass) + 1e-9);
  }

  const SCORE_PER_MASS = 10;

  // 3+ same-value dice reaching critical mass together (a fusion
  // threshold, not a value threshold) is what triggers a merge at all.
  const MERGE_MIN_CLUSTER = 3;

  // The single place a cluster's outcome is decided: how much its die
  // becomes, how much mass didn't fit and was released, and the score
  // that release is worth.
  function resolveClusterMass(value, clusterSize) {
    const massBefore = massForValue(value) * clusterSize;
    const newValue = valueForMass(massBefore);
    const massReleased = massBefore - massForValue(newValue);
    return { newValue, massReleased, score: massReleased * SCORE_PER_MASS };
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
  // that is ONE object with one value shared by every cell, the way a
  // real object has one mass rather than each part weighing something
  // unrelated to the rest of it. Shape (where it sits) and value (what
  // it's made of) are independent axes, but within one piece the value
  // is a single fact, not a separate roll per cell.
  function generatePiece(rng = Math.random) {
    const size = rollPieceSize(rng);
    const shapes = SHAPE_LIBRARY[size];
    const shape = shapes[Math.floor(rng() * shapes.length)];
    const value = rollSpawnValue(rng);
    const cells = shape.map(([dr, dc]) => ({ dr, dc, value }));
    return { cells };
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
    SPAWN_TABLE,
    rollSpawnValue,
    massForValue,
    valueForMass,
    SCORE_PER_MASS,
    MERGE_MIN_CLUSTER,
    resolveClusterMass,
    SHAPE_LIBRARY,
    PIECE_SIZE_WEIGHTS,
    rollPieceSize,
    generatePiece,
    rotatePiece,
    DEFAULT_CONFIG,
    BOARD_SIZE_OPTIONS,
  };
})();
