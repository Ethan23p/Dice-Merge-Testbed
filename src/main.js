/*
 * Wiring: input, persistence, and the Settings dialog. The current piece
 * is dragged onto the board, anchored by whichever die was grabbed; a
 * press that never passes the drag threshold is a tap, which rotates.
 *
 * Tunables are read with CFG.get(id) at each use, so the Tuning panel
 * applies immediately.
 *
 * `hotData` is the artifact viewer's carried-over game after a
 * republish (see the snapshot at the end); empty otherwise.
 */
function start(hotData = {}) {
  const D = DiceMergeData;
  const S = DiceMergeState;
  const R = DiceMergeRender;
  const P = DiceMergePhysics;
  const Anim = DiceMergeAnimate;
  const CFG = DiceMergeConfig;
  const Panel = DiceMergePanel;

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

  const STORAGE_KEY = 'dice-merge:v3';

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
      /* storage unavailable: works for this session only */
    }
  }

  // Saved after every change, so a reload resumes the game. rng isn't saved.
  function persistGameState() {
    persist({
      game: {
        config: state.config,
        board: state.board,
        queue: state.queue,
        score: state.score,
        moves: state.moves,
        gameOver: state.gameOver,
      },
    });
  }

  // Only resumes a game saved at the currently selected board size.
  function restoredState(saved, config) {
    const g = saved.game;
    if (!g || !Array.isArray(g.board) || !Array.isArray(g.queue)) return null;
    if (!g.config || g.config.boardSize !== config.boardSize) return null;
    return {
      config: g.config,
      board: g.board,
      queue: g.queue,
      score: g.score || 0,
      moves: g.moves || 0,
      gameOver: !!g.gameOver,
      rng: Math.random,
    };
  }

  let saved = loadSaved();
  let config = hotData.config || {
    ...D.DEFAULT_CONFIG,
    boardSize: saved.boardSize || D.DEFAULT_CONFIG.boardSize,
  };
  let bestScore = hotData.bestScore ?? (saved.bestScore || 0);
  let state = hotData.board
    ? { config, board: hotData.board, queue: hotData.queue, score: hotData.score,
        moves: hotData.moves, gameOver: hotData.gameOver, rng: Math.random }
    : restoredState(saved, config) || S.createState(config);

  function render() {
    R.renderBoard(boardEl, state.board, {});
    R.renderQueue(currentPieceEl, nextPieceEl, state);
    // Only a genuinely new current piece gets the entrance pop; rotation calls
    // renderQueue directly and skips it.
    const enteringPieceEl = currentPieceEl.querySelector('.piece');
    if (enteringPieceEl) enteringPieceEl.classList.add('piece--entering');
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
    // The timeline would redraw its old boards over the new game.
    if (Anim.isPlaying()) return;
    state = S.createState(config);
    persistGameState();
    render();
  }

  function commitPlacement(target, selected) {
    const { steps } = S.placePiece(state, target.r, target.c, selected);
    persistGameState();

    if (steps.length <= 1) {
      render();
      return;
    }

    R.renderQueue(currentPieceEl, nextPieceEl, state);
    R.renderScore(scoreEl, state);
    Anim.playTimeline(boardEl, steps, render);
  }

  let rotateSettling = false;
  let rotateAnimatedDies = [];
  let rotateSettleTimeoutId = null;

  // Lets a press grab the piece mid-rotation: state is already final, this just
  // skips the rest of the tween.
  function interruptRotateSettle() {
    if (!rotateSettling) return;
    clearTimeout(rotateSettleTimeoutId);
    rotateAnimatedDies.forEach((dieEl) => {
      dieEl.style.transition = '';
      dieEl.style.transform = '';
    });
    rotateAnimatedDies = [];
    rotateSettling = false;
  }

  // Each die slides from its old slot to its new one (FLIP); the dice
  // themselves never rotate, so their pips stay upright.
  function rotateCurrentPiece() {
    const pieceEl = currentPieceEl.querySelector('.piece');
    if (!pieceEl) return;
    // Never make the player wait on an animation to pick the piece up.
    interruptRotateSettle();

    const oldPiece = state.queue[0];

    // A lone die has nowhere to move, so it spins instead.
    if (oldPiece.cells.length === 1) {
      S.rotateQueueHead(state);
      persistGameState();
      R.renderQueue(currentPieceEl, nextPieceEl, state);
      const dieEl = currentPieceEl.querySelector('.piece .die');
      if (dieEl) {
        dieEl.classList.remove('die--spin');
        void dieEl.offsetWidth;
        dieEl.classList.add('die--spin');
        dieEl.addEventListener('animationend', () => dieEl.classList.remove('die--spin'), { once: true });
      }
      return;
    }

    const rotatedPiece = D.rotatePiece(oldPiece);
    const mass = D.pieceMass(oldPiece);
    const rotateMs = Math.min(CFG.get('rotateMaxMs'), D.scaleWithMass(CFG.get('rotateBaseMs'), mass));

    const oldRects = oldPiece.cells.map(
      ({ dr, dc }) => pieceEl.querySelector(`.die[data-dr="${dr}"][data-dc="${dc}"]`)?.getBoundingClientRect()
    );

    rotateSettling = true;
    S.rotateQueueHead(state);
    persistGameState();
    R.renderQueue(currentPieceEl, nextPieceEl, state);

    const newPieceEl = currentPieceEl.querySelector('.piece');
    const animatedDies = [];
    rotatedPiece.cells.forEach(({ dr, dc }, i) => {
      const oldRect = oldRects[i];
      const dieEl = newPieceEl.querySelector(`.die[data-dr="${dr}"][data-dc="${dc}"]`);
      if (!oldRect || !dieEl) return;
      const newRect = dieEl.getBoundingClientRect();
      dieEl.style.transition = 'none';
      dieEl.style.transform = `translate(${oldRect.left - newRect.left}px, ${oldRect.top - newRect.top}px)`;
      animatedDies.push(dieEl);
    });

    void newPieceEl.offsetWidth;

    animatedDies.forEach((dieEl) => {
      dieEl.style.transition = `transform ${rotateMs}ms cubic-bezier(.3, .7, .4, 1)`;
      dieEl.style.transform = 'translate(0, 0)';
    });
    rotateAnimatedDies = animatedDies;

    rotateSettleTimeoutId = window.setTimeout(() => {
      rotateAnimatedDies.forEach((dieEl) => {
        dieEl.style.transition = '';
        dieEl.style.transform = '';
      });
      rotateAnimatedDies = [];
      rotateSettling = false;
    }, rotateMs + 40);
  }

  let drag = null;
  let dragLocked = false;
  let springBackCancelFns = [];
  let springBackPieceEl = null;

  function interruptSpringBack() {
    if (!dragLocked) return;
    springBackCancelFns.forEach((cancel) => cancel && cancel());
    springBackCancelFns = [];
    if (springBackPieceEl) {
      springBackPieceEl.classList.remove('piece--dragging', 'piece--tracking');
      springBackPieceEl.style.transform = '';
    }
    springBackPieceEl = null;
    dragLocked = false;
  }

  // Returns a rejected piece to its slot on two springs (x and y).
  function springBack(pieceEl, startX, startY, mass) {
    dragLocked = true;
    springBackPieceEl = pieceEl;
    const stiffness = CFG.get('snapbackStiffness');
    const damping = CFG.get('snapbackDamping');
    const pos = { x: startX, y: startY };
    let pending = 2;
    const applyTransform = () => {
      pieceEl.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
    };
    const onDone = () => {
      pending -= 1;
      if (pending > 0) return;
      pieceEl.classList.remove('piece--dragging');
      pieceEl.style.transform = '';
      dragLocked = false;
      springBackCancelFns = [];
      springBackPieceEl = null;
    };
    const cancelX = P.runSpring({
      from: startX,
      target: 0,
      stiffness,
      damping,
      mass,
      onStep: (v) => {
        pos.x = v;
        applyTransform();
      },
      onSettle: onDone,
    });
    const cancelY = P.runSpring({
      from: startY,
      target: 0,
      stiffness,
      damping,
      mass,
      onStep: (v) => {
        pos.y = v;
        applyTransform();
      },
      onSettle: onDone,
    });
    springBackCancelFns = [cancelX, cancelY];
  }

  // Heavier rejected pieces shake the cells harder.
  function shakeRejectedCells(cells, mass) {
    const strength = D.scaleWithMass(1, mass);
    cells.forEach(({ r, c }) => {
      const el = R.cellAt(boardEl, r, c);
      if (!el) return;
      el.style.setProperty('--reject-strength', String(strength));
      el.classList.remove('cell--shake');
      void el.offsetWidth;
      el.classList.add('cell--shake');
      el.addEventListener('animationend', () => el.classList.remove('cell--shake'), { once: true });
    });
  }

  function clearPreview() {
    boardEl.querySelectorAll('.cell.preview-valid, .cell.preview-invalid').forEach((el) => {
      el.classList.remove('preview-valid', 'preview-invalid');
    });
  }

  function boardCellAt(clientX, clientY) {
    const el = document.elementFromPoint(clientX, clientY);
    return el ? el.closest('.cell') : null;
  }

  // The piece's (0,0) position when the grabbed die is over (hoverR, hoverC).
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
      const el = R.cellAt(boardEl, rr, cc);
      if (el) el.classList.add(valid ? 'preview-valid' : 'preview-invalid');
    });
  }

  function onPointerDown(e) {
    if (state.gameOver || drag || Anim.isPlaying()) return;
    interruptRotateSettle();
    interruptSpringBack();
    const slot = e.target.closest('[data-dr]');
    const pieceEl = currentPieceEl.querySelector('.piece');
    if (!slot || !pieceEl) return;

    // The dragged piece floats above the finger, sized off the grabbed die.
    const liftPx = slot.getBoundingClientRect().height * CFG.get('dragLiftScale');

    drag = {
      pointerId: e.pointerId,
      pieceEl,
      mass: D.pieceMass(state.queue[0]),
      grabDr: Number(slot.dataset.dr),
      grabDc: Number(slot.dataset.dc),
      startX: e.clientX,
      startY: e.clientY,
      dragging: false,
      target: null,
      targetX: 0,
      targetY: 0,
      liftPx,
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
    drag.targetX = dx;
    drag.targetY = dy;

    if (!drag.dragging) {
      if (Math.hypot(dx, dy) < CFG.get('dragThresholdPx')) return;
      drag.dragging = true;
      // --tracking disables pointer events on the piece so elementFromPoint finds
      // the cell under it; it's dropped on release, while --dragging stays for the
      // springback.
      drag.pieceEl.classList.add('piece--dragging', 'piece--tracking');
    }

    drag.pieceEl.style.transform = `translate(${dx}px, ${dy - drag.liftPx}px)`;
    // Hit-test at the lifted position, where the piece is drawn.
    updateDragPreview(e.clientX, e.clientY - drag.liftPx);
  }

  function endDrag({ commit }) {
    if (!drag) return;
    const { pieceEl, dragging, target } = drag;
    pieceEl.removeEventListener('pointermove', onPointerMove);
    pieceEl.removeEventListener('pointerup', onPointerUp);
    pieceEl.removeEventListener('pointercancel', onPointerCancel);

    pieceEl.classList.remove('piece--tracking');
    clearPreview();

    if (!dragging) {
      if (commit) rotateCurrentPiece();
      drag = null;
      return;
    }

    if (commit && target && S.canPlaceAt(state, state.queue[0], target.r, target.c)) {
      const selected = { r: target.r + drag.grabDr, c: target.c + drag.grabDc };
      commitPlacement(target, selected);
      drag = null;
      return;
    }

    if (target) shakeRejectedCells(S.shapeCellsAt(state.queue[0], target.r, target.c), drag.mass);
    springBack(pieceEl, drag.targetX, drag.targetY - drag.liftPx, drag.mass);
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

  newGameBtn.addEventListener('click', () => {
    settingsDialog.close();
    newGame();
  });
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

  const gravityDirectionSelect = document.getElementById('gravity-direction-select');
  CFG.item('gravityDirection').options.forEach((opt) => {
    gravityDirectionSelect.append(new Option(opt.label, opt.value));
  });

  Panel.init();
  Panel.bind('gravityEnabled', document.getElementById('gravity-toggle'), {
    onSync: (on) => { gravityDirectionSelect.disabled = !on; },
  });
  Panel.bind('gravityDirection', gravityDirectionSelect);

  render();

  // Artifact viewer: carry the live game across a republish.
  if (window.claude?.hot?.snapshot) {
    window.claude.hot.snapshot(() => ({
      config: state.config,
      board: state.board,
      queue: state.queue,
      score: state.score,
      moves: state.moves,
      gameOver: state.gameOver,
      bestScore,
    }));
  }
}

if (window.claude?.hot?.ready) {
  window.claude.hot.ready(start);
} else {
  start(window.claude?.hot?.data ?? {});
}
