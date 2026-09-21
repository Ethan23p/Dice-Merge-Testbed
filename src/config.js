/*
 * The tuning schema and the store behind the debug config panel.
 *
 * Every tunable tracks three values, not one:
 *   - initial: what shipped in this file today. Fixed, never written to.
 *   - default: the player's own declared baseline. Starts equal to
 *     initial; "set as default" in the panel overwrites it.
 *   - current: whatever's live right now. Can differ from both.
 * Only default/current are persisted (localStorage) — initial lives
 * here as plain data, which is itself the permanent record of "what we
 * started with."
 *
 * Applying a value at runtime takes one of three forms, named by each
 * schema entry's `apply`:
 *   - { type: 'data', key }        -> DiceMergeData.params[key] = value
 *   - { type: 'pieceWeight', i }   -> DiceMergeData.PIECE_SIZE_WEIGHTS[i].weight = value
 *   - { type: 'css', varName, unit } -> a CSS custom property on :root
 *   - { type: 'main' }             -> nothing to push; main.js reads
 *     DiceMergeConfig.get(id) directly at each use site, so it's
 *     already live on the next read.
 */
const DiceMergeConfig = (() => {
  const STORAGE_KEY = 'dice-merge-testbed:config:v1';

  const SCHEMA = [
    // --- Rotation ---
    { id: 'rotateBaseMs', group: 'Rotation', label: 'Rotate duration (base)', unit: 'ms', initial: 180, min: 0, max: 1000, step: 10, apply: { type: 'main' } },
    { id: 'rotateMaxMs', group: 'Rotation', label: 'Rotate duration (heavy-piece cap)', unit: 'ms', initial: 360, min: 100, max: 2000, step: 10, apply: { type: 'main' } },
    { id: 'singleDieSpinMs', group: 'Rotation', label: 'Single-die tap spin duration', unit: 'ms', initial: 220, min: 50, max: 800, step: 10, apply: { type: 'css', varName: '--cfg-single-die-spin', unit: 'ms' } },

    // --- Merge timing ---
    { id: 'hopBaseMs', group: 'Merge Timing', label: 'Hop duration (base)', unit: 'ms', initial: 170, min: 20, max: 800, step: 10, apply: { type: 'main' } },
    { id: 'hopMaxMs', group: 'Merge Timing', label: 'Hop duration (cap)', unit: 'ms', initial: 260, min: 50, max: 1200, step: 10, apply: { type: 'main' } },
    { id: 'settleMaxMs', group: 'Merge Timing', label: 'Cascade wave time cap', unit: 'ms', initial: 900, min: 200, max: 3000, step: 50, apply: { type: 'main' } },
    { id: 'settleBeatMs', group: 'Merge Timing', label: 'Pause between cascade waves', unit: 'ms', initial: 70, min: 0, max: 500, step: 10, apply: { type: 'main' } },
    { id: 'landingBeatMs', group: 'Merge Timing', label: 'Pause before a merge starts converging', unit: 'ms', initial: 0, min: 0, max: 500, step: 10, apply: { type: 'main' } },

    // --- Merge impact ---
    { id: 'pulseRingPx', group: 'Merge Impact', label: 'Merge-target pulse ring size', unit: 'px', initial: 10, min: 0, max: 40, step: 1, apply: { type: 'css', varName: '--cfg-pulse-ring', unit: 'px' } },
    { id: 'pulseDurationMs', group: 'Merge Impact', label: 'Merge-target pulse duration', unit: 'ms', initial: 220, min: 50, max: 800, step: 10, apply: { type: 'css', varName: '--cfg-pulse-duration', unit: 'ms' } },
    { id: 'popBaseScale', group: 'Merge Impact', label: 'Merge-pop base scale', unit: '×', initial: 1.15, min: 1, max: 3, step: 0.05, apply: { type: 'css', varName: '--cfg-merge-pop-base', unit: '' } },
    { id: 'popPerImpactScale', group: 'Merge Impact', label: 'Merge-pop scale per unit impact', unit: '×', initial: 0.09, min: 0, max: 0.5, step: 0.01, apply: { type: 'css', varName: '--cfg-merge-pop-per-impact', unit: '' } },
    { id: 'popScaleCap', group: 'Merge Impact', label: 'Merge-pop scale cap', unit: '×', initial: 1.6, min: 1, max: 4, step: 0.05, apply: { type: 'css', varName: '--cfg-merge-pop-cap', unit: '' } },
    { id: 'popGlowBasePx', group: 'Merge Impact', label: 'Merge-pop glow base', unit: 'px', initial: 8, min: 0, max: 40, step: 1, apply: { type: 'css', varName: '--cfg-merge-pop-glow-base', unit: 'px' } },
    { id: 'popGlowPerImpactPx', group: 'Merge Impact', label: 'Merge-pop glow per unit impact', unit: 'px', initial: 3, min: 0, max: 20, step: 1, apply: { type: 'css', varName: '--cfg-merge-pop-glow-per-impact', unit: 'px' } },
    { id: 'popGlowCapPx', group: 'Merge Impact', label: 'Merge-pop glow cap', unit: 'px', initial: 24, min: 0, max: 100, step: 1, apply: { type: 'css', varName: '--cfg-merge-pop-glow-cap', unit: 'px' } },
    { id: 'popDurationMs', group: 'Merge Impact', label: 'Merge-pop duration', unit: 'ms', initial: 360, min: 60, max: 1200, step: 10, apply: { type: 'css', varName: '--cfg-merge-pop-duration', unit: 'ms' } },

    // --- Rejected drop ---
    { id: 'snapbackStiffness', group: 'Rejected Drop', label: 'Snapback stiffness', unit: '', initial: 170, min: 20, max: 800, step: 5, apply: { type: 'main' } },
    { id: 'snapbackDamping', group: 'Rejected Drop', label: 'Snapback damping', unit: '', initial: 11, min: 1, max: 100, step: 1, apply: { type: 'main' } },
    { id: 'shakeAmpPx', group: 'Rejected Drop', label: 'Shake amplitude (base)', unit: 'px', initial: 4, min: 0, max: 20, step: 1, apply: { type: 'css', varName: '--cfg-shake-amp', unit: 'px' } },
    { id: 'shakeCapPx', group: 'Rejected Drop', label: 'Shake amplitude (cap)', unit: 'px', initial: 10, min: 2, max: 40, step: 1, apply: { type: 'css', varName: '--cfg-shake-cap', unit: 'px' } },
    { id: 'shakeDurationMs', group: 'Rejected Drop', label: 'Shake duration', unit: 'ms', initial: 220, min: 50, max: 800, step: 10, apply: { type: 'css', varName: '--cfg-shake-duration', unit: 'ms' } },

    // --- Input feel ---
    { id: 'dragThresholdPx', group: 'Input Feel', label: 'Drag threshold', unit: 'px', initial: 6, min: 0, max: 40, step: 1, apply: { type: 'main' } },
    { id: 'hoverDurationMs', group: 'Input Feel', label: 'Cell hover-preview transition', unit: 'ms', initial: 100, min: 0, max: 400, step: 10, apply: { type: 'css', varName: '--cfg-hover-duration', unit: 'ms' } },

    // --- Piece entrance ---
    { id: 'entranceScale', group: 'Piece Entrance', label: 'Entrance start scale', unit: '×', initial: 0.85, min: 0.3, max: 1, step: 0.01, apply: { type: 'css', varName: '--cfg-entrance-scale', unit: '' } },
    { id: 'entranceDurationMs', group: 'Piece Entrance', label: 'Entrance duration', unit: 'ms', initial: 160, min: 30, max: 600, step: 10, apply: { type: 'css', varName: '--cfg-entrance-duration', unit: 'ms' } },

    // --- Balance & spawn ---
    { id: 'massBase', group: 'Balance & Spawn', label: 'Mass-doubling base', unit: '×', initial: 2, min: 1.2, max: 4, step: 0.1, apply: { type: 'data', key: 'massBase' } },
    { id: 'massExponent', group: 'Balance & Spawn', label: 'Mass→feel exponent', unit: '', initial: 0.5, min: 0, max: 1.5, step: 0.05, apply: { type: 'data', key: 'massExponent' } },
    { id: 'scoreMultiplier', group: 'Balance & Spawn', label: 'Score per mass point', unit: '', initial: 10, min: 1, max: 100, step: 1, apply: { type: 'data', key: 'scoreMultiplier' } },
    { id: 'spawnTemperature', group: 'Balance & Spawn', label: 'Spawn rarity temperature', unit: '', initial: 2, min: 0.3, max: 10, step: 0.1, apply: { type: 'data', key: 'spawnTemperature' } },
    { id: 'spawnValuePool', group: 'Balance & Spawn', label: 'Spawn value pool ceiling', unit: '', initial: 8, min: 3, max: 12, step: 1, apply: { type: 'data', key: 'spawnValuePool' } },
    { id: 'pieceWeight1', group: 'Balance & Spawn', label: 'Piece-size weight: 1-cell', unit: '', initial: 40, min: 0, max: 100, step: 1, apply: { type: 'pieceWeight', index: 0 } },
    { id: 'pieceWeight2', group: 'Balance & Spawn', label: 'Piece-size weight: 2-cell', unit: '', initial: 35, min: 0, max: 100, step: 1, apply: { type: 'pieceWeight', index: 1 } },
    { id: 'pieceWeight3', group: 'Balance & Spawn', label: 'Piece-size weight: 3-cell', unit: '', initial: 25, min: 0, max: 100, step: 1, apply: { type: 'pieceWeight', index: 2 } },
    { id: 'mergeMinCluster', group: 'Balance & Spawn', label: 'Merge threshold (dice needed)', unit: '', initial: 3, min: 2, max: 6, step: 1, apply: { type: 'data', key: 'mergeMinCluster' } },
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
      /* storage unavailable — panel still works for this session */
    }
  }

  const store = loadStore();
  store.defaults = store.defaults || {};
  store.current = store.current || {};
  store.pinned = Array.isArray(store.pinned) ? store.pinned : [];

  // Clamps to the schema's own declared range. Applied on every read as
  // well as on set(), so a value that got into storage out of range —
  // hand-edited localStorage, or a caller that bypassed the panel's
  // slider — can't stay out of range either.
  function clamp(item, value) {
    if (typeof value !== 'number' || Number.isNaN(value)) return item.initial;
    return Math.min(item.max, Math.max(item.min, value));
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

  // Pushes one item's current value into the system that actually
  // reads it. 'main' items are a no-op here — main.js calls get(id)
  // itself at each use site, so they're already live on the next read.
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

  // Plain-text dump of defaults + current, meant to be pasted into a
  // conversation — the only way this state reaches outside the browser.
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
