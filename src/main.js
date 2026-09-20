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
  const P = DiceMergePhysics;

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
  const ROTATE_ANIMATION_MS = 180;
  // A consumed die's flight is paced per lateral hop, not as one total
  // divided across however many hops it has — so a longer path takes
  // proportionally longer instead of the same total time getting cut
  // into thinner, harder-to-follow slices.
  const BASE_HOP_MS = 170;
  // Every *_MS above is tuned for a mass-1 (value-1) die and scaled up
  // from there via D.scaleWithMass — these caps just stop an extreme
  // late-game value from stretching an animation absurdly long.
  const MAX_ROTATE_MS = 360;
  const MAX_HOP_MS = 260;
  const MAX_SETTLE_MS = 900;
  // A placement has no landing animation of its own (see render.js), so
  // there's nothing to wait out before a merge starts converging —
  // released and placed IS the first frame a merge plays from. Only a
  // beat between cascade waves remains, so a wave's dice visibly finish
  // arriving before the next wave's convergence starts.
  const LANDING_BEAT_MS = 0;
  const SETTLE_BEAT_MS = 70;

  function hopDurationForValue(value) {
    return Math.min(MAX_HOP_MS, D.scaleWithMass(BASE_HOP_MS, D.massForValue(value)));
  }

  // Drag-follow spring: near-critically-damped, so the held piece lags
  // the pointer just enough to read as having weight without feeling
  // laggy to control. Snapback is deliberately underdamped so a
  // rejected drop overshoots and settles like it bounced off a wall,
  // carrying over whatever velocity the piece had when released. Both
  // are real spring constants now, not per-value tuning — P.stepSpring
  // divides by the dragged piece's actual mass (F=ma), so the SAME
  // stiffness/damping here already makes heavier dice feel heavier
  // without any extra per-tier number.
  const DRAG_SPRING_STIFFNESS = 340;
  const DRAG_SPRING_DAMPING = 34;
  const SNAPBACK_STIFFNESS = 170;
  const SNAPBACK_DAMPING = 11;
  const MAX_TILT_DEG = 6;
  const TILT_PER_VELOCITY = 0.01; // deg of "lean" per px/s of lateral speed

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

  function render(boardOptions = {}) {
    R.renderBoard(boardEl, state, boardOptions);
    R.renderQueue(currentPieceEl, nextPieceEl, state);
    // Only this general render path means "a piece genuinely entered
    // the slot" (a new game, or the next piece moving up after a
    // placement) — rotation redraws the same piece by calling
    // R.renderQueue directly, without this class, so spinning a piece
    // never also replays its entrance pop.
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
    state = S.createState(config);
    render();
  }

  // Places the current piece and animates the result. A merge-free
  // placement just appears — no landing animation (see render.js). A
  // merge instead plays out wave by wave (see S.resolveMerges): each
  // wave's consumed dice fly to their survivor along their own real
  // lateral connectivity, and the next wave only starts once this one
  // has visually resolved, so a cascade never appears to begin before
  // the merge that caused it has finished. `selected` is the absolute
  // cell the player was holding — passed through so a forming merge
  // converges there rather than on an arbitrary cell of the piece.
  function commitPlacement(target, selected) {
    const piece = state.queue[0];
    const preBoard = state.board.map((row) => row.slice());
    const placedCells = S.shapeCellsAt(piece, target.r, target.c);

    S.placePiece(state, target.r, target.c, selected);
    const merges = state.lastMerges;

    if (!merges.length) {
      render();
      return;
    }

    const workingBoard = preBoard.map((row) => row.slice());
    placedCells.forEach(({ r, c, value }) => {
      workingBoard[r][c] = value;
    });

    const waves = [];
    merges.forEach((m) => {
      (waves[m.wave] || (waves[m.wave] = [])).push(m);
    });

    R.renderBoard(
      boardEl,
      { config: state.config, board: workingBoard, lastMerges: [] },
      { targetCells: merges.map((m) => ({ r: m.r, c: m.c })) }
    );
    R.renderQueue(currentPieceEl, nextPieceEl, state);
    R.renderScore(scoreEl, state);

    // The placed piece has no landing animation to wait out, so the
    // very frame that shows it placed is already the frame a merge
    // converges from — released and placed IS the start of the merge.
    if (LANDING_BEAT_MS > 0) {
      window.setTimeout(() => playMergeWaves(waves, 0, workingBoard), LANDING_BEAT_MS);
    } else {
      playMergeWaves(waves, 0, workingBoard);
    }
  }

  // Plays one wave's convergence, waits for it to visually resolve,
  // then renders the intermediate board that wave produced before
  // recursing into the next wave — or, once every wave has played,
  // renders the true final state. (Waves are synchronized as whole
  // batches, not per independent cascade chain: if a single placement
  // starts two unrelated clusters that both happen to cascade, the
  // faster one waits for the slower one in its wave before its own
  // cascade starts. A rare case, and still correct — just not maximally
  // parallel.)
  function playMergeWaves(waves, waveIndex, workingBoard) {
    const waveMerges = waves[waveIndex];
    if (!waveMerges) {
      render();
      return;
    }

    // This wave's total flight time is however long its longest actual
    // path takes at a legible per-hop pace — not a flat mass-based
    // guess — so the next wave never starts before every die in this
    // one has visibly finished traveling.
    let waveMs = 0;
    waveMerges.forEach((m) => {
      const hopMs = hopDurationForValue(m.value);
      const maxHops = m.consumed.reduce((max, c) => Math.max(max, c.path.length - 1), 0);
      waveMs = Math.max(waveMs, maxHops * hopMs);
    });
    waveMs = Math.min(MAX_SETTLE_MS, waveMs);

    animateMergeConvergence(waveMerges);

    window.setTimeout(() => {
      // Every consumed die has now arrived and is stacked on its
      // survivor (see flyDieAlongPath) — hold that a beat so "they've
      // gathered" reads as its own moment before the stack quietly
      // clears (nothing to see: it's hidden underneath the topmost
      // die already) and the survivor visibly transforms.
      window.setTimeout(() => {
        const nextWave = waves[waveIndex + 1];
        if (!nextWave) {
          render();
          return;
        }
        waveMerges.forEach((m) => {
          m.consumed.forEach(({ r, c }) => {
            workingBoard[r][c] = 0;
          });
          workingBoard[m.r][m.c] = m.value;
        });
        R.renderBoard(
          boardEl,
          { config: state.config, board: workingBoard, lastMerges: waveMerges },
          { targetCells: nextWave.map((m) => ({ r: m.r, c: m.c })) }
        );
        playMergeWaves(waves, waveIndex + 1, workingBoard);
      }, SETTLE_BEAT_MS);
    }, waveMs);
  }

  function cellCenter(r, c) {
    const el = boardEl.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  // Flies each consumed die to its survivor along the exact lateral
  // path that connected it to the cluster (resolveMerges' `path`) —
  // never a diagonal cut through cells it was never linked to. A die
  // farther from the survivor (bigger `hop`) renders above nearer
  // ones, so it visibly slides over them as the cluster gathers rather
  // than passing beneath. Every hop travels at the same pace
  // (hopDurationForValue), so a longer path just takes proportionally
  // longer rather than being squeezed into the same total time.
  function animateMergeConvergence(merges) {
    merges.forEach((m) => {
      const hopMs = hopDurationForValue(m.value);
      m.consumed.forEach(({ path, hop }) => {
        const start = path[0];
        const dieEl = boardEl.querySelector(`.cell[data-r="${start.r}"][data-c="${start.c}"] .die`);
        if (dieEl) flyDieAlongPath(dieEl, path, hopMs, hop);
      });
    });
  }

  // A consumed die never shrinks or fades — it slides at constant size
  // and lands stacked exactly on its survivor (z-index by hop keeps
  // farther dice on top), the way a physical die sliding across a
  // table would. It stays there, fully solid, through the settle beat
  // in playMergeWaves; only once that beat ends does the wave's
  // re-render clear the now-hidden stack and pop the survivor — so
  // nothing here ever needs to fight over `transform` with another
  // animation (placed dice have none — see render.js).
  function flyDieAlongPath(dieEl, path, hopMs, hop) {
    const segments = path.length - 1;
    if (segments <= 0) return;

    dieEl.style.position = 'relative';
    dieEl.style.zIndex = String(5 + hop);

    let totalDx = 0;
    let totalDy = 0;
    let i = 0;

    function step() {
      const from = cellCenter(path[i].r, path[i].c);
      const to = cellCenter(path[i + 1].r, path[i + 1].c);
      i += 1;
      if (!from || !to) return;
      totalDx += to.x - from.x;
      totalDy += to.y - from.y;
      dieEl.style.transition = `transform ${hopMs}ms ${i === segments ? 'cubic-bezier(.4, 0, .2, 1)' : 'linear'}`;
      dieEl.style.transform = `translate(${totalDx}px, ${totalDy}px)`;
      if (i < segments) window.setTimeout(step, hopMs);
    }
    requestAnimationFrame(step);
  }

  let rotateSettling = false; // true while dice are still sliding into their new grid slots after a rotation
  let rotateAnimatedDies = []; // dice mid-FLIP-transition, so a pickup can snap them to rest instead of waiting
  let rotateSettleTimeoutId = null;

  // Snaps any in-progress rotate FLIP straight to its resting state.
  // The state and DOM were already updated synchronously at the start
  // of rotateCurrentPiece — only the visual transition is still
  // playing — so cutting it short here just skips the tween, it never
  // leaves state and DOM out of sync. Lets a pickup grab the piece the
  // instant it's pressed instead of waiting on the spin to finish.
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

  // Rotates the queued piece 90° clockwise. Individual dice never spin
  // in place — only their positions move, each die sliding in a
  // straight line from its old grid slot to its new one (a FLIP
  // animation: capture each die's on-screen rect before the state
  // change, apply the new arrangement instantly, then transition each
  // die back from its old rect to its new one). Spinning the whole
  // piece as one rigid transform looked wrong once dice carried
  // asymmetric detail (pips, a beveled edge) — the pips and bevel
  // would visibly rotate with the piece, then snap back the instant
  // the freshly-rendered (upright) shape swapped in.
  function rotateCurrentPiece() {
    const pieceEl = currentPieceEl.querySelector('.piece');
    if (!pieceEl) return;
    interruptRotateSettle();

    const oldPiece = state.queue[0];
    const rotatedPiece = D.rotatePiece(oldPiece);
    const mass = D.massForValue(oldPiece.cells[0].value);
    const rotateMs = Math.min(MAX_ROTATE_MS, D.scaleWithMass(ROTATE_ANIMATION_MS, mass));

    // rotatePiece maps cells 1:1 by array index, so pairing old cell i
    // with rotated cell i identifies which specific die moved where.
    const oldRects = oldPiece.cells.map(
      ({ dr, dc }) => pieceEl.querySelector(`.die[data-dr="${dr}"][data-dc="${dc}"]`)?.getBoundingClientRect()
    );

    rotateSettling = true;
    S.rotateQueueHead(state);
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

    // Force layout so the "start" transform above actually applies
    // before it's switched back to 0 below — otherwise the browser
    // would collapse the two writes and there'd be nothing to animate.
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

  // --- Drag / tap controller -------------------------------------------

  let drag = null; // { pointerId, pieceEl, grabDr, grabDc, startX, startY, dragging, target, ...physics }
  let dragLocked = false; // true while a released piece is still springing back into its slot
  let springBackCancelFns = []; // cancels the in-progress springBack, so a pickup can interrupt it
  let springBackPieceEl = null;

  // Stops an in-progress springBack immediately and leaves the piece
  // usable — lets a pickup grab a piece that's still snapping back
  // from a rejected drop instead of waiting for it to settle.
  function interruptSpringBack() {
    if (!dragLocked) return;
    springBackCancelFns.forEach((cancel) => cancel && cancel());
    springBackCancelFns = [];
    if (springBackPieceEl) {
      springBackPieceEl.classList.remove('piece--dragging');
      springBackPieceEl.style.transform = '';
    }
    springBackPieceEl = null;
    dragLocked = false;
  }

  // Runs every frame while a piece is held: the piece's on-screen
  // position chases the pointer's offset (drag.targetX/Y) through a
  // damped spring instead of matching it 1:1, and a lateral "lean"
  // proportional to the spring's own velocity sells the piece as
  // something with mass being carried, not a cursor decal.
  function startDragFollow(d) {
    d.physicsActive = true;
    let lastT = performance.now();
    function frame(now) {
      if (!d.physicsActive) return;
      const dt = Math.min((now - lastT) / 1000, 1 / 30);
      lastT = now;
      const stepX = P.stepSpring(d.visX, d.visVelX, d.targetX, DRAG_SPRING_STIFFNESS, DRAG_SPRING_DAMPING, dt, d.mass);
      const stepY = P.stepSpring(d.visY, d.visVelY, d.targetY, DRAG_SPRING_STIFFNESS, DRAG_SPRING_DAMPING, dt, d.mass);
      d.visX = stepX.value;
      d.visVelX = stepX.velocity;
      d.visY = stepY.value;
      d.visVelY = stepY.velocity;
      const tilt = Math.max(-MAX_TILT_DEG, Math.min(MAX_TILT_DEG, d.visVelX * TILT_PER_VELOCITY));
      d.pieceEl.style.transform = `translate(${d.visX}px, ${d.visY}px) rotate(${tilt.toFixed(2)}deg)`;
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  // Springs a rejected/cancelled piece from wherever it was released
  // back to (0, 0) in its slot, carrying its current velocity so the
  // motion reads as continuous rather than restarting from rest. Mass
  // flows through here too (F=ma in P.stepSpring), so a heavier piece
  // overshoots and settles more slowly on the way back.
  function springBack(pieceEl, startX, startY, velX, velY, mass) {
    dragLocked = true;
    springBackPieceEl = pieceEl;
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
      velocity: velX,
      target: 0,
      stiffness: SNAPBACK_STIFFNESS,
      damping: SNAPBACK_DAMPING,
      mass,
      onStep: (v) => {
        pos.x = v;
        applyTransform();
      },
      onSettle: onDone,
    });
    const cancelY = P.runSpring({
      from: startY,
      velocity: velY,
      target: 0,
      stiffness: SNAPBACK_STIFFNESS,
      damping: SNAPBACK_DAMPING,
      mass,
      onStep: (v) => {
        pos.y = v;
        applyTransform();
      },
      onSettle: onDone,
    });
    springBackCancelFns = [cancelX, cancelY];
  }

  // Shakes the board cells a rejected placement would have occupied —
  // the piece bounced off something solid there, harder if it was
  // carrying more mass. Reuses the (previously unused) .cell--shake
  // keyframe, restarting it via a reflow in the rare case the same
  // cell gets shaken again before it finishes.
  function shakeRejectedCells(cells, mass) {
    const strength = D.scaleWithMass(1, mass); // sqrt(mass), read by the keyframe
    cells.forEach(({ r, c }) => {
      const el = boardEl.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`);
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
    // Picking up the piece is never blocked by an animation still
    // playing on it — a mid-flight rotate or a not-yet-settled
    // snapback is interrupted (not waited out) so the piece is always
    // grabbable the instant it's pressed.
    interruptRotateSettle();
    interruptSpringBack();
    const slot = e.target.closest('[data-dr]');
    const pieceEl = currentPieceEl.querySelector('.piece');
    if (!slot || !pieceEl) return;

    drag = {
      pointerId: e.pointerId,
      pieceEl,
      mass: D.massForValue(state.queue[0].cells[0].value),
      grabDr: Number(slot.dataset.dr),
      grabDc: Number(slot.dataset.dc),
      startX: e.clientX,
      startY: e.clientY,
      dragging: false,
      target: null,
      targetX: 0,
      targetY: 0,
      visX: 0,
      visY: 0,
      visVelX: 0,
      visVelY: 0,
      physicsActive: false,
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
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      drag.dragging = true;
      drag.pieceEl.classList.add('piece--dragging');
      startDragFollow(drag);
    }

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
      // A tap: rotate the piece in place instead of placing it. The
      // spin plays even when the shape is symmetric (a single die) so
      // the tap always reads as having registered.
      if (commit) rotateCurrentPiece();
      drag = null;
      return;
    }

    drag.physicsActive = false;

    if (commit && target && S.canPlaceAt(state, state.queue[0], target.r, target.c)) {
      const selected = { r: target.r + drag.grabDr, c: target.c + drag.grabDc };
      commitPlacement(target, selected);
      drag = null;
      return;
    }

    // Invalid drop (or cancelled): the piece springs back to its slot
    // carrying whatever velocity it was released with — a hard flick
    // overshoots and settles instead of teleporting home — and any
    // cells it was hovering over shake, as if it bounced off them.
    if (target) shakeRejectedCells(S.shapeCellsAt(state.queue[0], target.r, target.c), drag.mass);
    springBack(pieceEl, drag.visX, drag.visY, drag.visVelX, drag.visVelY, drag.mass);
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
