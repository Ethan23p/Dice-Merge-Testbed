/*
 * Wiring: DOM events <-> state transitions <-> render, plus a pointer-
 * based drag controller for placing pieces. Owns persistence (best
 * score, chosen board size) as the one piece of state that outlives a
 * single game.
 *
 * Interaction model: the current piece is dragged from its queue slot
 * onto the board; wherever a die of the piece is released determines
 * the anchor (not always the piece's own top-left cell — see
 * startDrag/updateDragPreview), so the placement matches whichever
 * part of the shape the player was actually holding. A press that
 * never moves past the drag threshold is treated as a tap, which
 * rotates the piece in place instead.
 */
(() => {
  const D = DiceMergeData;
  const S = DiceMergeState;
  const R = DiceMergeRender;

  const boardEl = document.getElementById('board');
  const currentPieceEl = document.getElementById('current-piece');
  const nextPieceEl = document.getElementById('next-piece');
  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best-score');
  const newGameBtn = document.getElementById('new-game-btn');
  const settingsBtn = document.getElementById('settings-btn');
  const settingsDialog = document.getElementById('settings-dialog');
  const closeSettingsBtn = document.getElementById('close-settings-btn');
  const boardSizeSelect = document.getElementById('board-size-select');
  const gameOverEl = document.getElementById('game-over');
  const gameOverScoreEl = document.getElementById('game-over-score');
  const playAgainBtn = document.getElementById('play-again-btn');

  const STORAGE_KEY = 'dice-merge-testbed:v2';
  const DRAG_THRESHOLD_PX = 6;

  function loadSaved() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch (err) {
      return {};
    }
  }

  function persist(patch) {
    saved = { ...saved, ...patch };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    } catch (err) {
      /* storage unavailable — game still works, just won't remember */
    }
  }

  let saved = loadSaved();
  let config = {
    ...D.DEFAULT_CONFIG,
    boardSize: saved.boardSize || D.DEFAULT_CONFIG.boardSize,
  };
  let bestScore = saved.bestScore || 0;
  let state = S.createState(config);

  function render() {
    R.renderBoard(boardEl, state);
    R.renderQueue(currentPieceEl, nextPieceEl, state);
    R.renderScore(scoreEl, state);
    bestEl.textContent = `Best ${bestScore}`;

    if (state.gameOver) {
      if (state.score > bestScore) {
        bestScore = state.score;
        persist({ bestScore });
        bestEl.textContent = `Best ${bestScore}`;
      }
      gameOverScoreEl.textContent = String(state.score);
      gameOverEl.hidden = false;
    } else {
      gameOverEl.hidden = true;
    }
  }

  function newGame() {
    state = S.createState(config);
    render();
  }

  // --- Drag / tap controller -------------------------------------------

  let drag = null; // { pointerId, pieceEl, grabDr, grabDc, startX, startY, dragging, target }

  function clearPreview() {
    boardEl.querySelectorAll('.cell.preview-valid, .cell.preview-invalid').forEach((el) => {
      el.classList.remove('preview-valid', 'preview-invalid');
    });
  }

  function boardCellAt(clientX, clientY) {
    const el = document.elementFromPoint(clientX, clientY);
    return el ? el.closest('.cell') : null;
  }

  // The anchor is derived from whichever piece cell was grabbed, not
  // always the piece's (0,0) offset — dropping the cell you're holding
  // onto a board square places the whole piece relative to that square.
  function anchorForHover(hoverR, hoverC) {
    return { r: hoverR - drag.grabDr, c: hoverC - drag.grabDc };
  }

  function updateDragPreview(clientX, clientY) {
    clearPreview();
    const cellEl = boardCellAt(clientX, clientY);
    if (!cellEl) {
      drag.target = null;
      return;
    }
    const hoverR = Number(cellEl.dataset.r);
    const hoverC = Number(cellEl.dataset.c);
    const { r, c } = anchorForHover(hoverR, hoverC);
    drag.target = { r, c };

    const piece = state.queue[0];
    const valid = S.canPlaceAt(state, piece, r, c);
    S.shapeCellsAt(piece, r, c).forEach(({ r: rr, c: cc }) => {
      if (!S.inBounds(state, rr, cc)) return;
      const el = boardEl.querySelector(`.cell[data-r="${rr}"][data-c="${cc}"]`);
      if (el) el.classList.add(valid ? 'preview-valid' : 'preview-invalid');
    });
  }

  function onPointerDown(e) {
    if (state.gameOver || drag) return;
    const slot = e.target.closest('[data-dr]');
    const pieceEl = currentPieceEl.querySelector('.piece');
    if (!slot || !pieceEl) return;

    drag = {
      pointerId: e.pointerId,
      pieceEl,
      grabDr: Number(slot.dataset.dr),
      grabDc: Number(slot.dataset.dc),
      startX: e.clientX,
      startY: e.clientY,
      dragging: false,
      target: null,
    };
    pieceEl.setPointerCapture(e.pointerId);
    pieceEl.addEventListener('pointermove', onPointerMove);
    pieceEl.addEventListener('pointerup', onPointerUp);
    pieceEl.addEventListener('pointercancel', onPointerCancel);
  }

  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;

    if (!drag.dragging) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      drag.dragging = true;
      drag.pieceEl.classList.add('piece--dragging');
    }

    drag.pieceEl.style.transform = `translate(${dx}px, ${dy}px)`;
    updateDragPreview(e.clientX, e.clientY);
  }

  function endDrag({ commit }) {
    if (!drag) return;
    const { pieceEl, dragging, target } = drag;
    pieceEl.removeEventListener('pointermove', onPointerMove);
    pieceEl.removeEventListener('pointerup', onPointerUp);
    pieceEl.removeEventListener('pointercancel', onPointerCancel);
    clearPreview();

    if (!dragging) {
      // A tap: rotate the piece in place instead of placing it.
      if (commit) {
        S.rotateQueueHead(state);
        R.renderQueue(currentPieceEl, nextPieceEl, state);
      }
      drag = null;
      return;
    }

    if (commit && target && S.canPlaceAt(state, state.queue[0], target.r, target.c)) {
      S.placePiece(state, target.r, target.c);
      render();
      drag = null;
      return;
    }

    // Invalid drop (or cancelled): snap the piece back to its slot.
    pieceEl.classList.add('piece--snapback');
    pieceEl.style.transform = 'translate(0, 0)';
    pieceEl.addEventListener(
      'transitionend',
      () => pieceEl.classList.remove('piece--dragging', 'piece--snapback'),
      { once: true }
    );
    drag = null;
  }

  function onPointerUp(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    endDrag({ commit: true });
  }

  function onPointerCancel(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    endDrag({ commit: false });
  }

  currentPieceEl.addEventListener('pointerdown', onPointerDown);

  // --- Toolbar / settings / game-over ------------------------------------

  newGameBtn.addEventListener('click', newGame);
  playAgainBtn.addEventListener('click', newGame);

  settingsBtn.addEventListener('click', () => settingsDialog.showModal());
  closeSettingsBtn.addEventListener('click', () => settingsDialog.close());
  settingsDialog.addEventListener('click', (e) => {
    if (e.target === settingsDialog) settingsDialog.close();
  });

  D.BOARD_SIZE_OPTIONS.forEach((size) => {
    const option = document.createElement('option');
    option.value = String(size);
    option.textContent = `${size} x ${size}`;
    boardSizeSelect.appendChild(option);
  });
  boardSizeSelect.value = String(config.boardSize);
  boardSizeSelect.addEventListener('change', (e) => {
    config = { ...config, boardSize: Number(e.target.value) };
    persist({ boardSize: config.boardSize });
    settingsDialog.close();
    newGame();
  });

  render();
})();
