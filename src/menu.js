/*
 * The menu screen: a card per mode, with the Custom options unfolding inside
 * Custom's card. It owns no game state; main.js supplies it through `host`
 * (see init) and starts games through host.play.
 */
const DiceMergeMenu = (() => {
  const D = DiceMergeData;
  const R = DiceMergeRender;
  const CFG = DiceMergeConfig;
  const M = DiceMergeModes;
  const Panel = DiceMergePanel;

  const DIRECTIONS = CFG.item('gravityDirection').options;
  const ARROWS = { up: '↑', down: '↓', left: '←', right: '→' };
  const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

  let host;
  let menuEl;
  let continueEl;
  let listEl;
  let customOpen = false;
  let customOptionsEl = null;
  let customDescEl = null;
  let customResumeBtn = null;

  function h(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function faceDie(face) {
    const die = R.buildDieNode(face, 'menu');
    die.style.setProperty('--die-color', 'var(--text)');
    return die;
  }

  // Buttons standing in for a select; `read`/`write` hide whether the value
  // lives in the config store or elsewhere.
  function segmentedRow(label, options, { read, write }) {
    const row = h('div', 'menu-row');
    const seg = h('div', 'segmented');
    const buttons = options.map((opt) => {
      const btn = h('button', 'segmented-btn', opt.label);
      btn.type = 'button';
      btn.addEventListener('click', () => write(opt.value));
      seg.append(btn);
      return { btn, value: opt.value };
    });
    row.append(h('span', 'menu-row-label', label), seg);
    function sync() {
      const current = read();
      buttons.forEach(({ btn, value }) => {
        btn.classList.toggle('is-on', value === current);
        btn.setAttribute('aria-pressed', String(value === current));
      });
    }
    sync();
    return { row, sync };
  }

  function configRow(id, label, options) {
    const { row, sync } = segmentedRow(label, options, {
      read: () => CFG.get(id),
      write: (value) => Panel.set(id, value),
    });
    Panel.watch(id, () => {
      sync();
      updateCustomDesc();
    });
    return row;
  }

  // Non-breaking inside each part, so a narrow card wraps between parts.
  function describeMode(mode) {
    return M.describe(M.resolve(mode, host.customBoardSize(), CFG.get))
      .split(' · ').map((part) => part.replace(/ /g, ' ')).join(' · ');
  }

  function updateCustomDesc() {
    if (customDescEl) customDescEl.textContent = describeMode(M.byId('custom'));
  }

  // Board size can change what's resumable, so this follows it.
  function updateCustomResume() {
    if (!customResumeBtn) return;
    const score = host.status('custom').resumeScore;
    customResumeBtn.hidden = score === null;
    if (score !== null) customResumeBtn.textContent = `Resume · ${score.toLocaleString()} pts`;
  }

  function buildCustomOptions() {
    const box = h('div', 'mode-options');

    const board = segmentedRow('Board size', D.BOARD_SIZE_OPTIONS.map((n) => ({ value: n, label: `${n}×${n}` })), {
      read: () => host.customBoardSize(),
      write: (size) => {
        host.setCustomBoardSize(size);
        board.sync();
        render();
      },
    });

    const gravityRow = h('div', 'menu-row');
    gravityRow.append(h('span', 'menu-row-label', 'Gravity'), Panel.boolToggle('gravityEnabled'));

    const direction = configRow('gravityDirection', 'Direction',
      DIRECTIONS.map((opt) => ({ value: opt.value, label: ARROWS[opt.value] })));
    Panel.watch('gravityEnabled', (on) => direction.classList.toggle('is-off', !on));

    const cluster = configRow('maxPieceSize', 'Cluster size', range(2, 3).map((n) => ({ value: n, label: String(n) })));
    const threshold = configRow('mergeMinCluster', 'Merge threshold', range(2, 5).map((n) => ({ value: n, label: String(n) })));

    const start = h('button', 'btn-primary', 'Start Custom Game');
    start.type = 'button';
    start.addEventListener('click', () => host.play('custom', { resume: false }));

    customResumeBtn = h('button', 'btn-primary btn-primary--ghost', 'Resume');
    customResumeBtn.type = 'button';
    customResumeBtn.addEventListener('click', () => host.play('custom', { resume: true }));

    box.append(board.row, gravityRow, direction, cluster, threshold, start, customResumeBtn);
    return box;
  }

  function cardFor(mode) {
    const status = host.status(mode.id);
    const card = h('div', `mode${mode.custom && customOpen ? ' is-open' : ''}`);
    card.style.setProperty('--mode-color', `var(--die-${mode.face})`);

    const head = h('div', 'mode-head');
    const main = h('button', 'mode-main');
    main.type = 'button';
    const tile = h('span', 'mode-tile');
    tile.append(faceDie(mode.face));
    const desc = h('span', 'mode-desc', describeMode(mode));
    const meta = [`Best ${status.best.toLocaleString()}`];
    if (status.resumeScore !== null) meta.push('In progress');
    const text = h('span', 'mode-text');
    text.append(h('span', 'mode-name', mode.name), desc, h('span', 'mode-meta', meta.join(' · ')));
    main.append(tile, text);
    head.append(main);

    if (mode.custom) {
      customDescEl = desc;
      main.append(h('span', 'mode-chevron', '›'));
      main.setAttribute('aria-expanded', String(customOpen));
      main.addEventListener('click', () => {
        customOpen = !customOpen;
        render();
        if (customOpen) listEl.lastElementChild.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
      card.append(head);
      if (customOpen) {
        customOptionsEl = customOptionsEl || buildCustomOptions();
        card.append(customOptionsEl);
        updateCustomResume();
      }
      return card;
    }

    main.addEventListener('click', () => host.play(mode.id, { resume: status.resumeScore !== null }));
    if (status.resumeScore !== null) {
      const fresh = h('button', 'mode-new', 'New game');
      fresh.type = 'button';
      fresh.addEventListener('click', () => host.play(mode.id, { resume: false }));
      head.append(fresh);
    }
    card.append(head);
    return card;
  }

  function renderContinue() {
    const id = host.lastMode();
    const { resumeScore } = host.status(id);
    continueEl.hidden = resumeScore === null;
    if (resumeScore === null) return;
    const label = h('span', 'menu-continue-text');
    label.append(h('b', '', 'Continue'), h('span', '', `${M.byId(id).name} · ${resumeScore.toLocaleString()} pts`));
    continueEl.replaceChildren(label, h('span', 'menu-continue-go', '▶'));
    continueEl.onclick = () => host.play(id, { resume: true });
  }

  function render() {
    renderContinue();
    listEl.replaceChildren(...M.MODES.map(cardFor));
  }

  function show() {
    render();
    menuEl.hidden = false;
    menuEl.scrollTop = 0;
  }

  function hide() {
    menuEl.hidden = true;
  }

  // host: { status(modeId) -> { best, resumeScore | null }, lastMode(),
  //         customBoardSize(), setCustomBoardSize(n), play(modeId, { resume }) }
  function init(hostApi) {
    host = hostApi;
    menuEl = document.getElementById('menu');
    continueEl = document.getElementById('menu-continue');
    listEl = document.getElementById('mode-list');
    const logo = document.getElementById('menu-dice');
    [1, 2, 3, 4, 5, 6].forEach((v) => logo.append(R.buildDieNode(v, 'menu-logo')));
    const mystery = R.buildDieNode(7, 'menu-logo');
    mystery.classList.add('die--mystery');
    mystery.querySelector('.die-label').textContent = '?';
    logo.append(mystery);
  }

  return { init, show, hide };
})();
