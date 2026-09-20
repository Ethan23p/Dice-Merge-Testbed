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
  // a 1-, 2-, or 3-cell piece all read as one connected shape.
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
        if (cell) {
          wrap.appendChild(buildDieNode(cell.value, variant));
        } else {
          const spacer = document.createElement('div');
          spacer.className = 'piece-spacer';
          wrap.appendChild(spacer);
        }
      }
    }
    return wrap;
  }

  function renderBoard(boardEl, state, handlers) {
    const { onCellClick, onCellEnter, onCellLeave } = handlers;
    boardEl.innerHTML = '';
    boardEl.style.setProperty('--board-size', state.config.boardSize);
    const justMerged = new Set(state.lastMerges.map((m) => `${m.r},${m.c}`));

    state.board.forEach((row, r) => {
      row.forEach((value, c) => {
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'cell';
        cell.dataset.r = r;
        cell.dataset.c = c;
        cell.setAttribute('aria-label', value ? `die ${value}` : 'empty cell');
        if (value) {
          cell.disabled = true;
          const die = buildDieNode(value, 'board');
          if (justMerged.has(`${r},${c}`)) die.classList.add('die--enter');
          cell.appendChild(die);
        } else {
          cell.disabled = state.gameOver;
          cell.addEventListener('click', () => onCellClick(r, c));
          cell.addEventListener('mouseenter', () => onCellEnter(r, c));
          cell.addEventListener('mouseleave', () => onCellLeave());
        }
        boardEl.appendChild(cell);
      });
    });
  }

  function renderQueue(currentSlotEl, nextSlotEl, state) {
    currentSlotEl.innerHTML = '';
    currentSlotEl.appendChild(buildPieceNode(state.queue[0], 'current'));
    nextSlotEl.innerHTML = '';
    nextSlotEl.appendChild(buildPieceNode(state.queue[1], 'next'));
  }

  function renderScore(scoreEl, state) {
    scoreEl.textContent = String(state.score);
  }

  return { buildDieNode, buildPieceNode, renderBoard, renderQueue, renderScore };
})();
