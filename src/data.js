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

  // A cluster of 3+ same-value dice merges into one die of value+1.
  // Bigger clusters and higher values are worth more.
  const MERGE_MIN_CLUSTER = 3;

  function scoreForMerge(newValue, clusterSize) {
    return newValue * clusterSize * 2;
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
  // with an independent random value on each cell.
  function generatePiece(rng = Math.random) {
    const size = rollPieceSize(rng);
    const shapes = SHAPE_LIBRARY[size];
    const shape = shapes[Math.floor(rng() * shapes.length)];
    const cells = shape.map(([dr, dc]) => ({ dr, dc, value: rollSpawnValue(rng) }));
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
    MERGE_MIN_CLUSTER,
    scoreForMerge,
    SHAPE_LIBRARY,
    PIECE_SIZE_WEIGHTS,
    rollPieceSize,
    generatePiece,
    rotatePiece,
    DEFAULT_CONFIG,
    BOARD_SIZE_OPTIONS,
  };
})();
