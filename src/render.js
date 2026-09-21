/*
 * Rendering: reads state, writes DOM. No game rules live here — a die is
 * drawn purely from its numeric value, and a piece purely from its cell
 * offsets, via the data tables in data.js. New values or shapes render
 * correctly with zero changes to this file.
 */
const DiceMergeRender = (() => {
  const D = DiceMergeData;

  function buildDieNode(value, variant = 'board') {
    const die = document.createElement('div');
    die.className = `die die--${variant}`;
    die.style.setProperty('--die-color', D.colorForValue(value));

    const layout = D.pipLayoutForValue(value);
    if (layout) {
      const grid = document.createElement('div');
      grid.className = 'die-pips';
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) {
          const pipCell = document.createElement('div');
          pipCell.className = 'pip-cell';
          if (layout.some(([pr, pc]) => pr === row && pc === col)) {
            const pip = document.createElement('div');
            pip.className = 'pip';
            pipCell.appendChild(pip);
          }
          grid.appendChild(pipCell);
        }
      }
      die.appendChild(grid);
    } else {
      const label = document.createElement('div');
      label.className = 'die-label';
      label.textContent = value;
      die.appendChild(label);
    }
    return die;
  }

  // Renders a piece as a small grid matching its own bounding box, so
  // a 1-, 2-, or 3-cell piece all read as one connected shape. Every
  // slot (die or empty spacer) carries its own (dr, dc) offset so a
  // drag can tell which part of the piece was grabbed.
  function buildPieceNode(piece, variant) {
    const rows = Math.max(...piece.cells.map((c) => c.dr)) + 1;
    const cols = Math.max(...piece.cells.map((c) => c.dc)) + 1;
    const byOffset = new Map(piece.cells.map((c) => [`${c.dr},${c.dc}`, c]));

    const wrap = document.createElement('div');
    wrap.className = `piece piece--${variant}`;
    wrap.style.setProperty('--piece-cols', cols);
    wrap.style.setProperty('--piece-rows', rows);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = byOffset.get(`${r},${c}`);
        const slot = cell ? buildDieNode(cell.value, variant) : document.createElement('div');
        if (!cell) slot.className = 'piece-spacer';
        slot.dataset.dr = r;
        slot.dataset.dc = c;
        wrap.appendChild(slot);
      }
    }
    return wrap;
  }

  // Board cells are plain, non-interactive tiles — placement now
  // happens by dragging the current piece over the board (see main.js),
  // so a cell only needs to display its die and expose its coordinates
  // for the drag controller's hit-testing. A placed die just appears —
  // no landing animation — so the moment of release reads as directly
  // placing the piece rather than watching it land first.
  //
  // `options.targetCells` marks the cell(s) a forming merge will
  // converge on, so main.js's merge animation can highlight where the
  // consumed dice are about to fly to. The actual fly-together motion
  // needs per-element geometry (source cell -> target cell), so it's
  // driven from main.js after this render, not from static classes here.
  function renderBoard(boardEl, state, options = {}) {
    boardEl.innerHTML = '';
    boardEl.style.setProperty('--board-size', state.config.boardSize);
    const justMerged = new Set(state.lastMerges.map((m) => `${m.r},${m.c}`));
    const targets = new Set((options.targetCells || []).map((c) => `${c.r},${c.c}`));
    // The mass released by the merge (see D.resolveClusterMass) drives
    // how hard the merge-pop impact hits — a bigger release visibly
    // lands with more force, the same quantity that fed the score.
    const impactByKey = new Map(
      state.lastMerges.map((m) => [`${m.r},${m.c}`, m.massReleased])
    );

    state.board.forEach((row, r) => {
      row.forEach((value, c) => {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.setAttribute('role', 'gridcell');
        cell.dataset.r = r;
        cell.dataset.c = c;
        cell.setAttribute('aria-label', value ? `die ${value}` : 'empty cell');
        if (value) {
          const key = `${r},${c}`;
          const die = buildDieNode(value, 'board');
          if (justMerged.has(key)) {
            die.classList.add('die--merge-pop');
            die.style.setProperty('--merge-impact', String(impactByKey.get(key)));
          }
          if (targets.has(key)) die.classList.add('die--merge-target');
          cell.appendChild(die);
        }
        boardEl.appendChild(cell);
      });
    });
  }

  function renderQueue(currentSlotEl, nextSlotEl, state) {
    currentSlotEl.innerHTML = '';
    currentSlotEl.appendChild(buildPieceNode(state.queue[0], 'current'));
    nextSlotEl.innerHTML = '';
    // Guards a shorter-than-2 queue (config.queueLength isn't actually
    // exposed anywhere today, but nothing enforces that it stays 2).
    if (state.queue[1]) nextSlotEl.appendChild(buildPieceNode(state.queue[1], 'next'));
  }

  function renderScore(scoreEl, state) {
    scoreEl.textContent = String(state.score);
  }

  return { buildDieNode, buildPieceNode, renderBoard, renderQueue, renderScore };
})();
