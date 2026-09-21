/*
 * Wiring: DOM events <-> state transitions <-> render, plus a pointer-
 * based drag controller for placing pieces. Owns persistence — best
 * score, chosen board size, and the game in progress itself, so a
 * reload resumes exactly where the player left off.
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
  const CFG = DiceMergeConfig;

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
  const configToggleBtn = document.getElementById('config-toggle-btn');
  const configPanelEl = document.getElementById('config-panel');
  const configBodyEl = document.getElementById('config-body');
  const pinnedHudEl = document.getElementById('pinned-config');
  const exportBtn = document.getElementById('config-export-btn');

  const STORAGE_KEY = 'dice-merge-testbed:v2';

  // Every timing/spring/threshold constant below is sourced live from
  // the config panel (see config.js) via CFG.get(id) at the point of
  // use, rather than being a fixed const read once — so dragging a
  // slider in the panel takes effect on the very next rotate/merge/
  // drag, no reload needed. hopDurationForValue reads its two inputs
  // the same way, every time it's called.
  function hopDurationForValue(value) {
    return Math.min(CFG.get('hopMaxMs'), D.scaleWithMass(CFG.get('hopBaseMs'), D.massForValue(value)));
  }

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

  // Persists the live game (board/queue/score/moves/gameOver) so a
  // reload resumes where the player left off, not just best score and
  // board size. Called right after every state mutation, independent
  // of whatever animation is still playing it out visually — the
  // logical state is already final at that point (see S.placePiece).
  // rng is never saved (not serializable, and a resumed game doesn't
  // need to replay it) — it just gets a fresh Math.random().
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

  // A saved game only resumes if it matches the board size currently
  // selected — a size change (or a first visit, or cleared storage)
  // starts fresh instead of trying to replay a mismatched board.
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
      lastMerges: [],
      rng: Math.random,
    };
  }

  let saved = loadSaved();
  let config = {
    ...D.DEFAULT_CONFIG,
    boardSize: saved.boardSize || D.DEFAULT_CONFIG.boardSize,
  };
  let bestScore = saved.bestScore || 0;
  let state = restoredState(saved, config) || S.createState(config);

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

  // True from the moment a merge cascade starts animating until its
  // final wave has visually resolved. Placement, rotation, New Game and
  // a board-size change all read state synchronously and would produce
  // a perfectly consistent result if run mid-cascade — but the wave
  // animation's own intermediate re-renders (see playMergeWaves) draw
  // from a `workingBoard` snapshot taken back when the cascade started,
  // not from live state, so an action that lands in that window could
  // get visually clobbered by the cascade's next scheduled frame. Cheaper
  // to just block input for the (sub-second) duration of the cascade than
  // to make every intermediate render re-derive itself from live state.
  let mergeAnimating = false;

  function finishMergeAnimation() {
    mergeAnimating = false;
    render();
  }

  function newGame() {
    // Resetting state out from under a cascade still writing to
    // workingBoard is exactly the race mergeAnimating exists to
    // prevent, so this quietly no-ops during one, the same way a
    // pointerdown does.
    if (mergeAnimating) return;
    state = S.createState(config);
    persistGameState();
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
    persistGameState();
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

    mergeAnimating = true;
    R.renderBoard(
      boardEl,
      { config: state.config, board: workingBoard, lastMerges: [] },
      { targetCells: merges.map((m) => ({ r: m.r, c: m.c })) }
    );
    R.renderQueue(currentPieceEl, nextPieceEl, state);
    R.renderScore(scoreEl, state);

    // The placed piece has no landing animation to wait out, so the
    // very frame that shows it placed is already the frame a merge
    // converges from — released and placed IS the start of the merge,
    // unless the panel has dialed in a deliberate pause here.
    const landingBeatMs = CFG.get('landingBeatMs');
    if (landingBeatMs > 0) {
      window.setTimeout(() => playMergeWaves(waves, 0, workingBoard), landingBeatMs);
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
      finishMergeAnimation();
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
    waveMs = Math.min(CFG.get('settleMaxMs'), waveMs);

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
          finishMergeAnimation();
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
      }, CFG.get('settleBeatMs'));
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

    // A single die has no position to move to — rotatePiece is a
    // geometric no-op for one cell, so the usual position-FLIP below
    // would animate nothing. Spin the die in place instead, fast, so a
    // tap on a lone die still reads as having registered.
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

    // rotatePiece maps cells 1:1 by array index, so pairing old cell i
    // with rotated cell i identifies which specific die moved where.
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
      springBackPieceEl.classList.remove('piece--dragging', 'piece--tracking');
      springBackPieceEl.style.transform = '';
    }
    springBackPieceEl = null;
    dragLocked = false;
  }

  // Springs a rejected/cancelled piece from wherever it was released
  // back to (0, 0) in its slot. Starts from rest — the piece was
  // tracking the pointer 1:1 while held (no animation, no velocity of
  // its own; see onPointerMove) — so this is the only motion the piece
  // has. Mass flows through here too (F=ma in P.stepSpring), so a
  // heavier piece overshoots and settles more slowly on the way back.
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
    if (state.gameOver || drag || mergeAnimating) return;
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
      mass: D.pieceMass(state.queue[0]),
      grabDr: Number(slot.dataset.dr),
      grabDc: Number(slot.dataset.dc),
      startX: e.clientX,
      startY: e.clientY,
      dragging: false,
      target: null,
      targetX: 0,
      targetY: 0,
    };
    pieceEl.setPointerCapture(e.pointerId);
    pieceEl.addEventListener('pointermove', onPointerMove);
    pieceEl.addEventListener('pointerup', onPointerUp);
    pieceEl.addEventListener('pointercancel', onPointerCancel);
  }

  // While held, the piece tracks the pointer exactly (translate by the
  // same delta the pointer has moved from the press point) — no lag,
  // no lean, no animation of its own.
  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    drag.targetX = dx;
    drag.targetY = dy;

    if (!drag.dragging) {
      if (Math.hypot(dx, dy) < CFG.get('dragThresholdPx')) return;
      drag.dragging = true;
      // 'piece--tracking' is what actually turns off pointer-events (so
      // elementFromPoint below can see the board cell under the piece,
      // not the piece itself). It's scoped tightly to live dragging and
      // dropped the instant the pointer is released — unlike
      // 'piece--dragging', which stays through the springback so the
      // piece keeps its elevated/shadowed look while it animates home.
      drag.pieceEl.classList.add('piece--dragging', 'piece--tracking');
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
    // Pointer tracking is over the instant the pointer lifts, whether or
    // not a springback follows — drop the pointer-events block right
    // here so the piece is grabbable/tappable again immediately, instead
    // of staying inert for the whole springback animation.
    pieceEl.classList.remove('piece--tracking');
    clearPreview();

    if (!dragging) {
      // A tap: rotate the piece in place instead of placing it.
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

    // Invalid drop (or cancelled): the piece springs back to its slot
    // from wherever it was released, and any cells it was hovering
    // over shake, as if it bounced off them.
    if (target) shakeRejectedCells(S.shapeCellsAt(state.queue[0], target.r, target.c), drag.mass);
    springBack(pieceEl, drag.targetX, drag.targetY, drag.mass);
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

  // --- Tuning panel --------------------------------------------------
  //
  // Every row is built from CFG.SCHEMA and reads/writes through CFG
  // (config.js) — main.js never touches localStorage or CFG's internal
  // store directly. A row can exist in two places at once: the full
  // panel's body (built once, stays in the DOM the whole session) and
  // the pinned HUD (rebuilt whenever the pinned set changes). Editing
  // either copy has to update the other, so every DOM node a row
  // creates is registered here by config id and kept in sync.

  const rowRegistry = new Map(); // id -> { valueEls: Set<{input, valueEl, scope}>, pinEls: Set<{input, scope}> }

  function registryFor(id) {
    if (!rowRegistry.has(id)) rowRegistry.set(id, { valueEls: new Set(), pinEls: new Set() });
    return rowRegistry.get(id);
  }

  function clearScope(scope) {
    rowRegistry.forEach((entry) => {
      entry.valueEls.forEach((rec) => {
        if (rec.scope === scope) entry.valueEls.delete(rec);
      });
      entry.pinEls.forEach((rec) => {
        if (rec.scope === scope) entry.pinEls.delete(rec);
      });
    });
  }

  function decimalsFor(step) {
    const s = String(step);
    return s.includes('.') ? s.split('.')[1].length : 0;
  }

  function formatValue(item, value) {
    return `${value.toFixed(decimalsFor(item.step))}${item.unit}`;
  }

  function syncValueDisplays(id) {
    const item = CFG.SCHEMA.find((i) => i.id === id);
    const value = CFG.get(id);
    registryFor(id).valueEls.forEach(({ input, valueEl }) => {
      if (document.activeElement !== input) input.value = String(value);
      valueEl.textContent = formatValue(item, value);
    });
  }

  function syncPinDisplays(id) {
    const pinned = CFG.isPinned(id);
    registryFor(id).pinEls.forEach(({ input }) => {
      input.checked = pinned;
    });
  }

  function refreshAllDisplays() {
    CFG.SCHEMA.forEach((item) => syncValueDisplays(item.id));
  }

  function buildPinToggle(item, scope) {
    const label = document.createElement('label');
    label.className = 'pin-toggle';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = CFG.isPinned(item.id);
    input.setAttribute('aria-label', `Pin "${item.label}" to the game view`);
    const track = document.createElement('span');
    track.className = 'pin-toggle-track';
    input.addEventListener('change', () => {
      CFG.setPinned(item.id, input.checked);
      syncPinDisplays(item.id);
      renderPinnedHud();
    });
    label.appendChild(input);
    label.appendChild(track);
    registryFor(item.id).pinEls.add({ input, scope });
    return label;
  }

  // `compact` drops the min/max footer (used in the pinned HUD, where
  // space is at a premium); `scope` tags this row's DOM nodes so a HUD
  // rebuild can find and drop exactly its own previous nodes without
  // touching the panel body's permanent copies.
  function buildConfigRow(item, { compact = false, scope = 'panel' } = {}) {
    const row = document.createElement('div');
    row.className = 'config-row';

    const head = document.createElement('div');
    head.className = 'config-row-head';
    const label = document.createElement('span');
    label.className = 'config-row-label';
    label.textContent = item.label;
    const valueEl = document.createElement('span');
    valueEl.className = 'config-row-value';
    valueEl.textContent = formatValue(item, CFG.get(item.id));
    head.appendChild(label);
    head.appendChild(valueEl);
    row.appendChild(head);

    const control = document.createElement('div');
    control.className = 'config-row-control';
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(item.min);
    input.max = String(item.max);
    input.step = String(item.step);
    input.value = String(CFG.get(item.id));
    input.addEventListener('input', () => {
      CFG.set(item.id, Number(input.value));
      syncValueDisplays(item.id);
    });
    control.appendChild(input);
    control.appendChild(buildPinToggle(item, scope));
    row.appendChild(control);

    if (!compact) {
      const bounds = document.createElement('div');
      bounds.className = 'config-row-bounds';
      const lo = document.createElement('span');
      lo.textContent = `${item.min}${item.unit}`;
      const hi = document.createElement('span');
      hi.textContent = `${item.max}${item.unit}`;
      bounds.appendChild(lo);
      bounds.appendChild(hi);
      row.appendChild(bounds);
    }

    registryFor(item.id).valueEls.add({ input, valueEl, scope });
    return row;
  }

  function renderConfigBody() {
    configBodyEl.innerHTML = '';
    let currentGroup = null;
    CFG.SCHEMA.forEach((item) => {
      if (item.group !== currentGroup) {
        currentGroup = item.group;
        const heading = document.createElement('div');
        heading.className = 'config-group-heading';
        heading.textContent = currentGroup;
        configBodyEl.appendChild(heading);
      }
      configBodyEl.appendChild(buildConfigRow(item, { scope: 'panel' }));
    });
  }

  function renderPinnedHud() {
    clearScope('hud');
    pinnedHudEl.innerHTML = '';
    const ids = CFG.pinnedIds();
    pinnedHudEl.hidden = ids.length === 0;
    ids.forEach((id) => {
      const item = CFG.SCHEMA.find((i) => i.id === id);
      pinnedHudEl.appendChild(buildConfigRow(item, { compact: true, scope: 'hud' }));
    });
  }

  let configPanelOpen = false;
  function setConfigPanelOpen(open) {
    configPanelOpen = open;
    configPanelEl.hidden = !open;
  }
  configToggleBtn.addEventListener('click', () => setConfigPanelOpen(!configPanelOpen));

  document.getElementById('cfg-set-all-default').addEventListener('click', () => {
    CFG.setAllAsDefault();
  });
  document.getElementById('cfg-reset-all-initial').addEventListener('click', () => {
    CFG.resetAllToInitial();
    refreshAllDisplays();
  });
  document.getElementById('cfg-reset-all-default').addEventListener('click', () => {
    CFG.resetAllToDefault();
    refreshAllDisplays();
  });
  document.getElementById('cfg-set-pinned-default').addEventListener('click', () => {
    CFG.setPinnedAsDefault();
  });
  document.getElementById('cfg-reset-pinned-initial').addEventListener('click', () => {
    CFG.resetPinnedToInitial();
    refreshAllDisplays();
  });
  document.getElementById('cfg-reset-pinned-default').addEventListener('click', () => {
    CFG.resetPinnedToDefault();
    refreshAllDisplays();
  });

  // Clipboard first (the fast path); only fall back to a file download
  // if the Clipboard API is unavailable or permission is denied — not
  // every export needs to also drop a file when the copy worked fine.
  exportBtn.addEventListener('click', () => {
    const text = CFG.exportText();
    const download = () => {
      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'dice-merge-config.txt';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(download);
    } else {
      download();
    }
  });

  renderConfigBody();
  renderPinnedHud();

  render();
})();
