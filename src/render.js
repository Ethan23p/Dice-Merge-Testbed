/*
 * Rendering: reads state, writes DOM. No game rules live here — a die is
 * drawn purely from its numeric value via the data tables in data.js, so
 * new dice values render correctly with zero changes to this file.
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

  function renderBoard(boardEl, state, onCellClick) {
    boardEl.innerHTML = '';
    boardEl.style.setProperty('--board-size', state.config.boardSize);
    state.board.forEach((row, r) => {
      row.forEach((value, c) => {
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'cell';
        cell.setAttribute('aria-label', value ? `die ${value}` : 'empty cell');
        if (value) {
          cell.disabled = true;
          cell.appendChild(buildDieNode(value, 'board'));
        } else {
          cell.disabled = state.gameOver;
          cell.addEventListener('click', () => onCellClick(r, c));
        }
        boardEl.appendChild(cell);
      });
    });
  }

  function renderQueue(queueEl, state) {
    queueEl.innerHTML = '';
    state.queue.forEach((value, i) => {
      queueEl.appendChild(
        buildDieNode(value, i === 0 ? 'current' : 'next')
      );
    });
  }

  function renderScore(scoreEl, state) {
    scoreEl.textContent = String(state.score);
  }

  return { buildDieNode, renderBoard, renderQueue, renderScore };
})();
