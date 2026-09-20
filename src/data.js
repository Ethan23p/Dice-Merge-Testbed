/*
 * Static game data: dice pip layouts, colors, spawn weights, scoring.
 * Nothing here knows about the DOM or about "the board" as an object —
 * it's just tables and pure functions over them, so new dice values,
 * palettes, or spawn rules are additions to data, not new code paths.
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

  function scoreForMerge(newValue) {
    return newValue * 2;
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
    scoreForMerge,
    DEFAULT_CONFIG,
    BOARD_SIZE_OPTIONS,
  };
})();
