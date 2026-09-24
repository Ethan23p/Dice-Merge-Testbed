/*
 * The Tuning panel and pinned HUD, built from DiceMergeConfig.SCHEMA.
 * A config item can have several controls at once (panel row, HUD row,
 * or any control passed to bind()); all of them stay in sync.
 */
const DiceMergePanel = (() => {
  const CFG = DiceMergeConfig;

  // id -> Set<{ input, valueEl, scope, onSync }>
  const controls = new Map();
  // id -> Set<{ input, scope }>
  const pins = new Map();

  let bodyEl;
  let hudEl;

  function entry(map, id) {
    if (!map.has(id)) map.set(id, new Set());
    return map.get(id);
  }

  function dropScope(scope) {
    for (const map of [controls, pins]) {
      map.forEach((set) => set.forEach((rec) => rec.scope === scope && set.delete(rec)));
    }
  }

  function decimalsFor(step) {
    const s = String(step);
    return s.includes('.') ? s.split('.')[1].length : 0;
  }

  function formatValue(item, value) {
    if (item.type === 'bool') return value ? 'On' : 'Off';
    if (item.type === 'select') return item.options.find((o) => o.value === value)?.label ?? String(value);
    return `${value.toFixed(decimalsFor(item.step))}${item.unit}`;
  }

  function readInput(item, input) {
    if (item.type === 'bool') return input.checked;
    if (item.type === 'select') return input.value;
    return Number(input.value);
  }

  function sync(id) {
    const item = CFG.item(id);
    const value = CFG.get(id);
    entry(controls, id).forEach(({ input, valueEl, onSync }) => {
      // Don't fight a slider the user is dragging.
      if (document.activeElement !== input) {
        if (item.type === 'bool') input.checked = Boolean(value);
        else input.value = String(value);
      }
      if (valueEl) valueEl.textContent = formatValue(item, value);
      if (onSync) onSync(value);
    });
  }

  function syncAll() {
    CFG.SCHEMA.forEach((item) => sync(item.id));
  }

  function register(id, input, { valueEl = null, scope, onSync } = {}) {
    const item = CFG.item(id);
    entry(controls, id).add({ input, valueEl, scope, onSync });
    input.addEventListener(item.type === 'bool' || item.type === 'select' ? 'change' : 'input', () => {
      CFG.set(id, readInput(item, input));
      sync(id);
    });
  }

  // Attaches an existing control (e.g. in the Settings dialog) to a config item.
  function bind(id, input, { onSync } = {}) {
    register(id, input, { scope: 'external', onSync });
    sync(id);
  }

  function toggle(className, ariaLabel) {
    const label = document.createElement('label');
    label.className = className;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('aria-label', ariaLabel);
    const track = document.createElement('span');
    track.className = `${className}-track`;
    label.append(input, track);
    return { label, input };
  }

  function buildControl(item) {
    if (item.type === 'bool') {
      const { label, input } = toggle('bool-toggle', item.label);
      return { el: label, input };
    }
    if (item.type === 'select') {
      const input = document.createElement('select');
      item.options.forEach((opt) => input.append(new Option(opt.label, opt.value)));
      return { el: input, input };
    }
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(item.min);
    input.max = String(item.max);
    input.step = String(item.step);
    return { el: input, input };
  }

  function buildPin(item, scope) {
    const { label, input } = toggle('pin-toggle', `Pin "${item.label}" to the game view`);
    input.checked = CFG.isPinned(item.id);
    input.addEventListener('change', () => {
      CFG.setPinned(item.id, input.checked);
      entry(pins, item.id).forEach((rec) => { rec.input.checked = input.checked; });
      renderHud();
    });
    entry(pins, item.id).add({ input, scope });
    return label;
  }

  function buildRow(item, { compact, scope }) {
    const row = document.createElement('div');
    row.className = 'config-row';

    const head = document.createElement('div');
    head.className = 'config-row-head';
    const label = document.createElement('span');
    label.className = 'config-row-label';
    label.textContent = item.label;
    const valueEl = document.createElement('span');
    valueEl.className = 'config-row-value';
    head.append(label, valueEl);

    const controlRow = document.createElement('div');
    controlRow.className = 'config-row-control';
    const { el, input } = buildControl(item);
    controlRow.append(el, buildPin(item, scope));
    row.append(head, controlRow);

    if (!compact && !item.type) {
      const bounds = document.createElement('div');
      bounds.className = 'config-row-bounds';
      bounds.append(
        Object.assign(document.createElement('span'), { textContent: `${item.min}${item.unit}` }),
        Object.assign(document.createElement('span'), { textContent: `${item.max}${item.unit}` }),
      );
      row.append(bounds);
    }

    register(item.id, input, { valueEl, scope });
    return row;
  }

  function renderBody() {
    bodyEl.innerHTML = '';
    let group = null;
    CFG.SCHEMA.forEach((item) => {
      if (item.group !== group) {
        group = item.group;
        const heading = document.createElement('div');
        heading.className = 'config-group-heading';
        heading.textContent = group;
        bodyEl.append(heading);
      }
      bodyEl.append(buildRow(item, { compact: false, scope: 'panel' }));
    });
  }

  function renderHud() {
    dropScope('hud');
    hudEl.innerHTML = '';
    const ids = CFG.pinnedIds();
    hudEl.hidden = ids.length === 0;
    ids.forEach((id) => hudEl.append(buildRow(CFG.item(id), { compact: true, scope: 'hud' })));
    syncAll();
  }

  async function saveFile(text) {
    const filename = 'dice-merge-config.txt';
    // The artifact viewer's sandbox blocks anchor downloads.
    if (window.claude?.use) {
      try {
        const downloads = await window.claude.use('downloads');
        if (downloads) await downloads.save({ filename, data: text });
      } catch (err) {
        /* declined or unavailable */
      }
      return;
    }
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function exportConfig() {
    const text = CFG.exportText();
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).catch(() => saveFile(text));
    else saveFile(text);
  }

  function init() {
    const $ = (id) => document.getElementById(id);
    bodyEl = $('config-body');
    hudEl = $('pinned-config');
    const panelEl = $('config-panel');

    $('config-toggle-btn').addEventListener('click', () => { panelEl.hidden = !panelEl.hidden; });

    const actions = {
      'cfg-set-all-default': CFG.setAllAsDefault,
      'cfg-reset-all-initial': CFG.resetAllToInitial,
      'cfg-reset-all-default': CFG.resetAllToDefault,
      'cfg-set-pinned-default': CFG.setPinnedAsDefault,
      'cfg-reset-pinned-initial': CFG.resetPinnedToInitial,
      'cfg-reset-pinned-default': CFG.resetPinnedToDefault,
    };
    Object.entries(actions).forEach(([id, action]) => {
      $(id).addEventListener('click', () => { action(); syncAll(); });
    });
    $('config-export-btn').addEventListener('click', exportConfig);

    renderBody();
    renderHud();
  }

  return { init, bind };
})();
