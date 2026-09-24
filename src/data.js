/*
 * Game data and pure rules: dice appearance, the mass law, spawning,
 * and piece shapes. No DOM.
 */
const DiceMergeData = (() => {
  const DIRECTIONS = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];

  // Pip positions on a 3x3 grid for faces 1-6.
  const PIP_LAYOUTS = {
    1: [[1, 1]],
    2: [[0, 0], [2, 2]],
    3: [[0, 0], [1, 1], [2, 2]],
    4: [[0, 0], [0, 2], [2, 0], [2, 2]],
    5: [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]],
    6: [[0, 0], [0, 2], [1, 0], [1, 2], [2, 0], [2, 2]],
  };

  const BASE_PALETTE = [
    'var(--die-1)', 'var(--die-2)', 'var(--die-3)',
    'var(--die-4)', 'var(--die-5)', 'var(--die-6)',
  ];

  function colorForValue(value) {
    const idx = value - 1;
    if (idx >= 0 && idx < BASE_PALETTE.length) return BASE_PALETTE[idx];
    const hue = (idx * 47) % 360;
    return `hsl(${hue}, 55%, 52%)`;
  }

  function pipLayoutForValue(value) {
    return PIP_LAYOUTS[value] || null;
  }

  // Balance knobs, filled from config.js SCHEMA at load. Read at call time so
  // tuning applies immediately.
  const params = {};

  // Each tier is massBase times heavier than the last. Mass drives score and
  // animation weight, not what a merge produces.
  function massForValue(value) {
    return params.massBase ** (value - 1);
  }

  // A cluster always becomes one die of value+1; score is the mass it consumed.
  // Clamped because some massBase/mergeMinCluster combinations would go negative.
  function resolveClusterMass(value, clusterSize) {
    const newValue = value + 1;
    const massReleased = Math.max(0, massForValue(value) * clusterSize - massForValue(newValue));
    return { newValue, massReleased, score: massReleased * params.scoreMultiplier };
  }

  // Boltzmann-style: heavier values are exponentially rarer.
  function spawnWeight(value) {
    return Math.exp(-massForValue(value) / params.spawnTemperature);
  }

  // Picks an item with probability proportional to its weight; the first item
  // if every weight is zero.
  function weightedPick(items, weightOf, rng) {
    const weights = items.map(weightOf);
    const total = weights.reduce((a, b) => a + b, 0);
    if (!(total > 0)) return items[0];
    let roll = rng() * total;
    for (let i = 0; i < items.length; i++) {
      if (roll < weights[i]) return items[i];
      roll -= weights[i];
    }
    return items[items.length - 1];
  }

  function spawnPool() {
    return Array.from({ length: params.spawnValuePool }, (_, i) => i + 1);
  }

  function rollSpawnValue(rng = Math.random) {
    return weightedPick(spawnPool(), spawnWeight, rng);
  }

  function rollSpawnValueExcluding(exclude, rng = Math.random) {
    const pool = spawnPool().filter((v) => !exclude.has(v));
    return pool.length ? weightedPick(pool, spawnWeight, rng) : rollSpawnValue(rng);
  }

  // The one place mass turns into duration or intensity (base * mass^exponent),
  // so a mass-1 die gets exactly `base`.
  function scaleWithMass(base, mass) {
    return base * mass ** params.massExponent;
  }

  // Offsets per piece size, normalized to a (0,0) top-left.
  const SHAPE_LIBRARY = {
    1: [
      [[0, 0]],
    ],
    2: [
      [[0, 0], [0, 1]],
      [[0, 0], [1, 0]],
    ],
    3: [
      [[0, 0], [0, 1], [0, 2]],
      [[0, 0], [1, 0], [2, 0]],
      [[0, 0], [0, 1], [1, 0]],
      [[0, 0], [0, 1], [1, 1]],
      [[0, 0], [1, 0], [1, 1]],
      [[0, 1], [1, 0], [1, 1]],
    ],
  };

  // Weights filled from config.js SCHEMA at load.
  const PIECE_SIZE_WEIGHTS = [1, 2, 3].map((size) => ({ size, weight: 0 }));

  function rollPieceSize(rng = Math.random) {
    return weightedPick(PIECE_SIZE_WEIGHTS, (e) => e.weight, rng).size;
  }

  // Exactly one pair: the odd die is rolled excluding the pair value.
  function rollTriplePairValues(rng = Math.random) {
    const pairValue = rollSpawnValue(rng);
    const oddValue = rollSpawnValueExcluding(new Set([pairValue]), rng);
    const oddSlot = Math.floor(rng() * 3);
    return [0, 1, 2].map((i) => (i === oddSlot ? oddValue : pairValue));
  }

  // Each cell rolls its own value. For 3-cell pieces forcePairInTriple overrides
  // noRepeatInCluster, so the two can be combined.
  function generatePiece(rng = Math.random) {
    const size = rollPieceSize(rng);
    const shapes = SHAPE_LIBRARY[size];
    const shape = shapes[Math.floor(rng() * shapes.length)];

    let values;
    if (size === 3 && params.forcePairInTriple) {
      values = rollTriplePairValues(rng);
    } else {
      const used = new Set();
      values = shape.map(() => {
        const value = params.noRepeatInCluster
          ? rollSpawnValueExcluding(used, rng)
          : rollSpawnValue(rng);
        used.add(value);
        return value;
      });
    }

    const cells = shape.map(([dr, dc], i) => ({ dr, dc, value: values[i] }));
    return { cells };
  }

  function pieceMass(piece) {
    return piece.cells.reduce((sum, cell) => sum + massForValue(cell.value), 0);
  }

  // 90° clockwise, re-normalized to (0,0).
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
    rollSpawnValueExcluding,
    rollTriplePairValues,
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
