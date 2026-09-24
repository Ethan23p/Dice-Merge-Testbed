/*
 * Every tunable value and its store. The SCHEMA is the only place
 * defaults live. Each item has:
 *   initial  the shipped value (fixed)
 *   default  the player's saved baseline (persisted)
 *   current  the live value (persisted)
 * and an `apply` that routes the live value to where it's read:
 *   data         DiceMergeData.params[key]
 *   pieceWeight  DiceMergeData.PIECE_SIZE_WEIGHTS[index].weight
 *   css          a --cfg-* custom property on :root
 *   main         nothing; read with get(id) at the point of use
 * Items are numeric sliders unless `type` is 'bool' or 'select'.
 */
const DiceMergeConfig = (() => {
  const STORAGE_KEY = 'dice-merge:config:v1';

  // Ranges go well past sensible, on purpose. Floors that stay above zero
  // prevent real breakage: mergeMinCluster < 2 merges forever, and
  // massBase/spawnValuePool are capped so masses stay finite.
  const SCHEMA = [
    { id: 'rotateBaseMs', group: 'Rotation', label: 'Rotate duration (base)', unit: 'ms', initial: 30, min: 0, max: 5000, step: 10, apply: { type: 'main' } },
    { id: 'rotateMaxMs', group: 'Rotation', label: 'Rotate duration (heavy-piece cap)', unit: 'ms', initial: 100, min: 0, max: 8000, step: 20, apply: { type: 'main' } },
    { id: 'singleDieSpinMs', group: 'Rotation', label: 'Single-die tap spin duration', unit: 'ms', initial: 440, min: 0, max: 4000, step: 10, apply: { type: 'css', varName: '--cfg-single-die-spin', unit: 'ms' } },

    { id: 'hopBaseMs', group: 'Merge Timing', label: 'Hop duration (base)', unit: 'ms', initial: 170, min: 0, max: 4000, step: 10, apply: { type: 'main' } },
    { id: 'hopMaxMs', group: 'Merge Timing', label: 'Hop duration (cap)', unit: 'ms', initial: 260, min: 0, max: 6000, step: 20, apply: { type: 'main' } },
    { id: 'settleMaxMs', group: 'Merge Timing', label: 'Cascade wave time cap', unit: 'ms', initial: 900, min: 0, max: 15000, step: 50, apply: { type: 'main' } },
    { id: 'settleBeatMs', group: 'Merge Timing', label: 'Pause between cascade waves', unit: 'ms', initial: 70, min: 0, max: 3000, step: 10, apply: { type: 'main' } },
    { id: 'landingBeatMs', group: 'Merge Timing', label: 'Pause before a merge starts converging', unit: 'ms', initial: 0, min: 0, max: 3000, step: 10, apply: { type: 'main' } },

    { id: 'pulseRingPx', group: 'Merge Impact', label: 'Merge-target pulse ring size', unit: 'px', initial: 10, min: 0, max: 250, step: 2, apply: { type: 'css', varName: '--cfg-pulse-ring', unit: 'px' } },
    { id: 'pulseDurationMs', group: 'Merge Impact', label: 'Merge-target pulse duration', unit: 'ms', initial: 220, min: 0, max: 4000, step: 10, apply: { type: 'css', varName: '--cfg-pulse-duration', unit: 'ms' } },
    { id: 'pulseBurstDurationMs', group: 'Merge Impact', label: 'Extra pulse ring duration (merges over 3 dice)', unit: 'ms', initial: 220, min: 0, max: 2000, step: 5, apply: { type: 'main' } },
    { id: 'pulseBurstIntervalMs', group: 'Merge Impact', label: 'Time between extra pulses', unit: 'ms', initial: 80, min: 0, max: 1000, step: 5, apply: { type: 'main' } },
    { id: 'popBaseScale', group: 'Merge Impact', label: 'Merge-pop base scale', unit: '×', initial: 1.15, min: 0.1, max: 8, step: 0.05, apply: { type: 'css', varName: '--cfg-merge-pop-base', unit: '' } },
    { id: 'popPerImpactScale', group: 'Merge Impact', label: 'Merge-pop scale per unit impact', unit: '×', initial: 0.09, min: 0, max: 3, step: 0.01, apply: { type: 'css', varName: '--cfg-merge-pop-per-impact', unit: '' } },
    { id: 'popScaleCap', group: 'Merge Impact', label: 'Merge-pop scale cap', unit: '×', initial: 1.6, min: 1, max: 15, step: 0.1, apply: { type: 'css', varName: '--cfg-merge-pop-cap', unit: '' } },
    { id: 'popGlowBasePx', group: 'Merge Impact', label: 'Merge-pop glow base', unit: 'px', initial: 8, min: 0, max: 200, step: 2, apply: { type: 'css', varName: '--cfg-merge-pop-glow-base', unit: 'px' } },
    { id: 'popGlowPerImpactPx', group: 'Merge Impact', label: 'Merge-pop glow per unit impact', unit: 'px', initial: 3, min: 0, max: 100, step: 1, apply: { type: 'css', varName: '--cfg-merge-pop-glow-per-impact', unit: 'px' } },
    { id: 'popGlowCapPx', group: 'Merge Impact', label: 'Merge-pop glow cap', unit: 'px', initial: 24, min: 0, max: 500, step: 5, apply: { type: 'css', varName: '--cfg-merge-pop-glow-cap', unit: 'px' } },
    { id: 'popDurationMs', group: 'Merge Impact', label: 'Merge-pop duration', unit: 'ms', initial: 360, min: 0, max: 4000, step: 10, apply: { type: 'css', varName: '--cfg-merge-pop-duration', unit: 'ms' } },

    { id: 'snapbackStiffness', group: 'Rejected Drop', label: 'Snapback stiffness', unit: '', initial: 785, min: 0, max: 6000, step: 5, apply: { type: 'main' } },
    { id: 'snapbackDamping', group: 'Rejected Drop', label: 'Snapback damping', unit: '', initial: 95, min: 0, max: 600, step: 1, apply: { type: 'main' } },
    { id: 'shakeAmpPx', group: 'Rejected Drop', label: 'Shake amplitude (base)', unit: 'px', initial: 4, min: 0, max: 150, step: 1, apply: { type: 'css', varName: '--cfg-shake-amp', unit: 'px' } },
    { id: 'shakeCapPx', group: 'Rejected Drop', label: 'Shake amplitude (cap)', unit: 'px', initial: 10, min: 0, max: 250, step: 1, apply: { type: 'css', varName: '--cfg-shake-cap', unit: 'px' } },
    { id: 'shakeDurationMs', group: 'Rejected Drop', label: 'Shake duration', unit: 'ms', initial: 220, min: 0, max: 4000, step: 10, apply: { type: 'css', varName: '--cfg-shake-duration', unit: 'ms' } },

    { id: 'dragThresholdPx', group: 'Input Feel', label: 'Drag threshold', unit: 'px', initial: 38, min: 0, max: 300, step: 1, apply: { type: 'main' } },
    { id: 'hoverDurationMs', group: 'Input Feel', label: 'Cell hover-preview transition', unit: 'ms', initial: 70, min: 0, max: 3000, step: 10, apply: { type: 'css', varName: '--cfg-hover-duration', unit: 'ms' } },
    { id: 'dragLiftScale', group: 'Input Feel', label: 'Drag lift (× piece cell size)', unit: '×', initial: 1.2, min: 0, max: 10, step: 0.1, apply: { type: 'main' } },

    { id: 'entranceScale', group: 'Piece Entrance', label: 'Entrance start scale', unit: '×', initial: 0.85, min: 0, max: 3, step: 0.01, apply: { type: 'css', varName: '--cfg-entrance-scale', unit: '' } },
    { id: 'entranceDurationMs', group: 'Piece Entrance', label: 'Entrance duration', unit: 'ms', initial: 160, min: 0, max: 4000, step: 10, apply: { type: 'css', varName: '--cfg-entrance-duration', unit: 'ms' } },

    { id: 'massBase', group: 'Balance & Spawn', label: 'Mass-doubling base', unit: '×', initial: 2, min: 0.1, max: 20, step: 0.1, apply: { type: 'data', key: 'massBase' } },
    { id: 'massExponent', group: 'Balance & Spawn', label: 'Mass→feel exponent', unit: '', initial: 0.5, min: -2, max: 5, step: 0.05, apply: { type: 'data', key: 'massExponent' } },
    { id: 'scoreMultiplier', group: 'Balance & Spawn', label: 'Score per mass point', unit: '', initial: 10, min: 0, max: 1000, step: 1, apply: { type: 'data', key: 'scoreMultiplier' } },
    { id: 'spawnTemperature', group: 'Balance & Spawn', label: 'Spawn rarity temperature', unit: '', initial: 2, min: 0, max: 50, step: 0.1, apply: { type: 'data', key: 'spawnTemperature' } },
    { id: 'spawnValuePool', group: 'Balance & Spawn', label: 'Spawn value pool ceiling', unit: '', initial: 8, min: 2, max: 24, step: 1, apply: { type: 'data', key: 'spawnValuePool' } },
    { id: 'pieceWeight1', group: 'Balance & Spawn', label: 'Piece-size weight: 1-cell', unit: '', initial: 40, min: 0, max: 1000, step: 1, apply: { type: 'pieceWeight', index: 0 } },
    { id: 'pieceWeight2', group: 'Balance & Spawn', label: 'Piece-size weight: 2-cell', unit: '', initial: 35, min: 0, max: 1000, step: 1, apply: { type: 'pieceWeight', index: 1 } },
    { id: 'pieceWeight3', group: 'Balance & Spawn', label: 'Piece-size weight: 3-cell', unit: '', initial: 25, min: 0, max: 1000, step: 1, apply: { type: 'pieceWeight', index: 2 } },
    { id: 'mergeMinCluster', group: 'Balance & Spawn', label: 'Merge threshold (dice needed)', unit: '', initial: 3, min: 2, max: 20, step: 1, apply: { type: 'data', key: 'mergeMinCluster' } },
    { id: 'noRepeatInCluster', group: 'Balance & Spawn', label: 'No repeat die value in a piece', unit: '', type: 'bool', initial: false, apply: { type: 'data', key: 'noRepeatInCluster' } },
    { id: 'forcePairInTriple', group: 'Balance & Spawn', label: '3-cell pieces: force one repeated pair', unit: '', type: 'bool', initial: true, apply: { type: 'data', key: 'forcePairInTriple' } },

    { id: 'gravityEnabled', group: 'Gravity', label: 'Gravity', unit: '', type: 'bool', initial: false, apply: { type: 'data', key: 'gravityEnabled' } },
    { id: 'gravityDirection', group: 'Gravity', label: 'Gravity direction', unit: '', type: 'select', initial: 'down', options: [
      { value: 'up', label: 'Up' },
      { value: 'down', label: 'Down' },
      { value: 'left', label: 'Left' },
      { value: 'right', label: 'Right' },
    ], apply: { type: 'data', key: 'gravityDirection' } },
  ];

  const byId = new Map(SCHEMA.map((item) => [item.id, item]));

  function loadStore() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (err) {
      return {};
    }
  }

  function saveStore() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch (err) {
      /* storage unavailable: works for this session only */
    }
  }

  const store = loadStore();
  store.defaults = store.defaults || {};
  store.current = store.current || {};
  store.pinned = Array.isArray(store.pinned) ? store.pinned : [];

  // Applied on read too, so out-of-range stored values can't leak through.
  function clamp(item, value) {
    if (item.type === 'bool') return typeof value === 'boolean' ? value : Boolean(item.initial);
    if (item.type === 'select') return item.options.some((o) => o.value === value) ? value : item.initial;
    if (typeof value !== 'number' || Number.isNaN(value)) return item.initial;
    return Math.min(item.max, Math.max(item.min, value));
  }

  function item(id) {
    return byId.get(id);
  }

  function initialOf(id) {
    return byId.get(id).initial;
  }

  function defaultOf(id) {
    const item = byId.get(id);
    return clamp(item, id in store.defaults ? store.defaults[id] : item.initial);
  }

  function currentOf(id) {
    const item = byId.get(id);
    return clamp(item, id in store.current ? store.current[id] : defaultOf(id));
  }

  function applyOne(item, value) {
    const D = DiceMergeData;
    switch (item.apply.type) {
      case 'data':
        D.params[item.apply.key] = value;
        break;
      case 'pieceWeight':
        D.PIECE_SIZE_WEIGHTS[item.apply.index].weight = value;
        break;
      case 'css':
        document.documentElement.style.setProperty(item.apply.varName, `${value}${item.apply.unit}`);
        break;
      case 'main':
        break;
    }
  }

  function applyAll() {
    SCHEMA.forEach((item) => applyOne(item, currentOf(item.id)));
  }

  function get(id) {
    return currentOf(id);
  }

  function set(id, value) {
    const item = byId.get(id);
    const clamped = clamp(item, value);
    store.current[id] = clamped;
    saveStore();
    applyOne(item, clamped);
  }

  function setAsDefault(id) {
    store.defaults[id] = currentOf(id);
    saveStore();
  }

  function resetToInitial(id) {
    delete store.current[id];
    delete store.defaults[id];
    saveStore();
    applyOne(byId.get(id), currentOf(id));
  }

  function resetToDefault(id) {
    delete store.current[id];
    saveStore();
    applyOne(byId.get(id), currentOf(id));
  }

  function forIds(ids, fn) {
    ids.forEach(fn);
  }

  function setAllAsDefault() {
    forIds(SCHEMA.map((i) => i.id), setAsDefault);
  }
  function resetAllToInitial() {
    forIds(SCHEMA.map((i) => i.id), resetToInitial);
  }
  function resetAllToDefault() {
    forIds(SCHEMA.map((i) => i.id), resetToDefault);
  }
  function setPinnedAsDefault() {
    forIds(store.pinned, setAsDefault);
  }
  function resetPinnedToInitial() {
    forIds(store.pinned, resetToInitial);
  }
  function resetPinnedToDefault() {
    forIds(store.pinned, resetToDefault);
  }

  function isPinned(id) {
    return store.pinned.includes(id);
  }

  function setPinned(id, pinned) {
    const has = isPinned(id);
    if (pinned && !has) store.pinned.push(id);
    if (!pinned && has) store.pinned = store.pinned.filter((p) => p !== id);
    saveStore();
  }

  function pinnedIds() {
    return store.pinned.slice();
  }

  // Plain text meant for pasting into a conversation.
  function exportText() {
    const lines = [`Dice Merge config export — ${new Date().toISOString()}`, ''];
    let group = null;
    SCHEMA.forEach((item) => {
      if (item.group !== group) {
        group = item.group;
        lines.push(`# ${group}`);
      }
      const cur = currentOf(item.id);
      const def = defaultOf(item.id);
      const init = initialOf(item.id);
      const changedFromDefault = cur !== def;
      const changedFromInitial = def !== init;
      lines.push(
        `${item.id}: current=${cur}${item.unit} default=${def}${item.unit} initial=${init}${item.unit}` +
        (changedFromDefault ? '  [current != default]' : '') +
        (changedFromInitial ? '  [default != initial]' : '')
      );
    });
    return lines.join('\n');
  }

  applyAll();

  return {
    SCHEMA,
    item,
    get,
    set,
    setAsDefault,
    resetToInitial,
    resetToDefault,
    setAllAsDefault,
    resetAllToInitial,
    resetAllToDefault,
    setPinnedAsDefault,
    resetPinnedToInitial,
    resetPinnedToDefault,
    isPinned,
    setPinned,
    pinnedIds,
    initialOf,
    defaultOf,
    currentOf,
    exportText,
  };
})();
