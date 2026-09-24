/*
 * State to DOM. A die is drawn from its value alone; no game rules here.
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

  // Laid out on the piece's bounding box; every slot carries its (dr, dc) so a
  // drag knows which die was grabbed.
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

  function cellAt(boardEl, r, c) {
    return boardEl.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`);
  }

  // Takes a board matrix rather than state so the animator can draw any step.
  // `pops` flash as fresh merges, scaled by the mass they released.
  function renderBoard(boardEl, board, options = {}) {
    boardEl.innerHTML = '';
    boardEl.style.setProperty('--board-size', board.length);
    const pops = options.pops || [];

    const impactByKey = new Map(pops.map((p) => [`${p.r},${p.c}`, p.massReleased]));

    board.forEach((row, r) => {
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
          if (impactByKey.has(key)) {
            die.classList.add('die--merge-pop');
            die.style.setProperty('--merge-impact', String(impactByKey.get(key)));
          }
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

    if (state.queue[1]) nextSlotEl.appendChild(buildPieceNode(state.queue[1], 'next'));
  }

  function renderScore(scoreEl, state) {
    scoreEl.textContent = String(state.score);
  }

  return { cellAt, buildDieNode, buildPieceNode, renderBoard, renderQueue, renderScore };
})();
