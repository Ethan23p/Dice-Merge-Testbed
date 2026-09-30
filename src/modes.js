/*
 * The game modes. A preset pins config items (by id) to its own values while
 * it is active; Custom pins nothing, so it plays by whatever the player has
 * chosen in the menu and the Tuning panel. Pure data, no DOM.
 */
const DiceMergeModes = (() => {
  // `face` picks the die drawn on the card (and so its color).
  const MODES = [
    {
      id: 'stacked',
      name: 'Stacked',
      face: 2,
      boardSize: 4,
      rules: { gravityEnabled: true, gravityDirection: 'up', maxPieceSize: 2, mergeMinCluster: 3, forcePairInTriple: true },
    },
    {
      id: 'packed',
      name: 'Packed',
      face: 3,
      boardSize: 6,
      rules: { gravityEnabled: false, maxPieceSize: 3, mergeMinCluster: 3, forcePairInTriple: true },
    },
    { id: 'custom', name: 'Custom', face: 6, custom: true, rules: {} },
  ];

  function byId(id) {
    return MODES.find((m) => m.id === id);
  }

  // The values that describe a mode's play, whether pinned or the player's.
  function resolve(mode, customBoardSize, getConfig) {
    const pick = (id) => (id in mode.rules ? mode.rules[id] : getConfig(id));
    return {
      boardSize: mode.custom ? customBoardSize : mode.boardSize,
      gravityEnabled: pick('gravityEnabled'),
      gravityDirection: pick('gravityDirection'),
      maxPieceSize: pick('maxPieceSize'),
      mergeMinCluster: pick('mergeMinCluster'),
    };
  }

  function describe({ boardSize, gravityEnabled, gravityDirection, maxPieceSize, mergeMinCluster }) {
    return [
      `${boardSize}×${boardSize}`,
      gravityEnabled ? `gravity ${gravityDirection}` : 'no gravity',
      maxPieceSize === 1 ? 'single dice' : `pieces up to ${maxPieceSize}`,
      `merge ${mergeMinCluster}`,
    ].join(' · ');
  }

  return { MODES, byId, resolve, describe };
})();
