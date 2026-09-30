/*
 * Plays a placePiece timeline (see state.js) on the board. Every step is
 * played the same way; merges and gravity shifts aren't distinguished.
 */
const DiceMergeAnimate = (() => {
  const D = DiceMergeData;
  const CFG = DiceMergeConfig;
  const R = DiceMergeRender;

  // True while a timeline plays; main.js blocks input meanwhile, since each
  // step redraws from its own board snapshot.
  let playing = false;
  function isPlaying() {
    return playing;
  }

  function hopDurationForValue(value) {
    return Math.min(CFG.get('hopMaxMs'), D.scaleWithMass(CFG.get('hopBaseMs'), D.massForValue(value)));
  }

  function cellCenter(boardEl, r, c) {
    const el = R.cellAt(boardEl, r, c);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  // Moves a die cell by cell along its path. Uses the `translate` property, not
  // `transform`: a merged die may still be running its scale-up animation, which
  // would override an inline transform and freeze it mid-fall.
  function flyDieAlongPath(boardEl, dieEl, path, hopMs, zIndex, delayMs = 0) {
    const segments = path.length - 1;
    if (segments <= 0) return;

    dieEl.style.position = 'relative';
    dieEl.style.zIndex = String(zIndex);

    let totalDx = 0;
    let totalDy = 0;
    let i = 0;

    function step() {
      const from = cellCenter(boardEl, path[i].r, path[i].c);
      const to = cellCenter(boardEl, path[i + 1].r, path[i + 1].c);
      i += 1;
      if (!from || !to) return;
      totalDx += to.x - from.x;
      totalDy += to.y - from.y;
      dieEl.style.transition = `translate ${hopMs}ms ${i === segments ? 'cubic-bezier(.4, 0, .2, 1)' : 'linear'}`;
      dieEl.style.translate = `${totalDx}px ${totalDy}px`;
      if (i < segments) window.setTimeout(step, hopMs);
    }
    if (delayMs > 0) window.setTimeout(() => requestAnimationFrame(step), delayMs);
    else requestAnimationFrame(step);
  }

  // One hop duration per step, from its heaviest die, so dice sharing a line
  // never overtake each other.
  function stepHopMs(step) {
    if (!step.moves.length) return 0;
    const maxValue = Math.max(...step.moves.map((m) => m.value));
    return hopDurationForValue(maxValue);
  }

  // Merges bigger than this send out one extra ripple per additional die.
  const EXTRA_PULSE_BASELINE = 3;

  function extraPulseCount(pop) {
    return Math.max(0, (pop.size || 0) - EXTRA_PULSE_BASELINE);
  }

  // How long a pop's ripples take to finish, so the reveal can wait for them.
  function pulseTrainMs(pop) {
    const extra = extraPulseCount(pop);
    if (extra === 0) return CFG.get('pulseDurationMs');
    return CFG.get('pulseDurationMs')
      + (extra - 1) * CFG.get('pulseBurstIntervalMs')
      + Math.max(CFG.get('pulseBurstIntervalMs'), CFG.get('pulseBurstDurationMs'));
  }

  // Marks the cells dice are converging on, on the already-drawn board. After
  // the first pulse, each die past the third adds a quick thump plus a ring,
  // each stronger than the last. The survivor sits above the incoming dice so
  // the train stays visible. `scale` is animated, never `transform`, which the
  // pulse/pop keyframes own.
  function highlightTargets(boardEl, pops) {
    pops.forEach((pop) => {
      const die = R.cellAt(boardEl, pop.r, pop.c)?.querySelector('.die');
      if (!die) return;
      die.classList.add('die--merge-target');
      const extra = extraPulseCount(pop);
      if (extra === 0) return;
      die.style.position = 'relative';
      die.style.zIndex = '999';
      const intervalMs = CFG.get('pulseBurstIntervalMs');
      const ringMs = CFG.get('pulseBurstDurationMs');
      for (let i = 0; i < extra; i++) {
        const delay = CFG.get('pulseDurationMs') + i * intervalMs;
        const strength = Math.min(1, (i + 1) / 4);
        die.animate(
          [{ scale: 1 }, { scale: 1 + 0.06 + 0.1 * strength }, { scale: 1 }],
          { duration: Math.max(40, intervalMs), delay, easing: 'ease-out' },
        );
        const ring = document.createElement('span');
        ring.className = 'merge-target-ring';
        die.appendChild(ring);
        ring.animate(
          [
            { opacity: 0.6 + 0.4 * strength, transform: 'scale(1)' },
            { opacity: 0, transform: `scale(${1.5 + 0.7 * strength})` },
          ],
          { duration: ringMs, delay, easing: 'ease-out', fill: 'backwards' },
        );
      }
    });
  }

  function animateMoves(boardEl, moves, hopMs) {
    moves.forEach((m, i) => {
      const start = m.path[0];
      const dieEl = R.cellAt(boardEl, start.r, start.c)?.querySelector('.die');
      if (dieEl) flyDieAlongPath(boardEl, dieEl, m.path, hopMs, 5 + (m.path.length - 1) * moves.length + i);
    });
  }

  // ---- Sonar merge effect -------------------------------------------------
  // The pulse train is caused by the dice: they leave for the survivor one at a
  // time, and each landing sends out one ring (and a small beat of the die).
  // The last landing is the redraw, so the pop is the climax of the train.
  // Rings live on a fixed overlay on <body>, not in the board, because the
  // redraw wipes the board and would cut them off mid-expansion.

  // A ring the size of the die at (r, c) that travels outward at constant
  // line width while fading. `amp` (0..1) scales its travel and brightness.
  function emitRing(boardEl, r, c, amp) {
    const cell = R.cellAt(boardEl, r, c);
    const die = cell?.querySelector('.die');
    if (!cell || !die) return;
    const rect = cell.getBoundingClientRect();
    const w = die.offsetWidth;
    const h = die.offsetHeight;
    const x = rect.left + (rect.width - w) / 2;
    const y = rect.top + (rect.height - h) / 2;
    const radius = parseFloat(getComputedStyle(die).borderTopLeftRadius) || 0;
    const travel = CFG.get('sonarRingPx') * (0.6 + 0.4 * amp);

    const ring = document.createElement('span');
    Object.assign(ring.style, {
      position: 'fixed',
      zIndex: '20',
      pointerEvents: 'none',
      boxSizing: 'border-box',
      border: `${CFG.get('sonarRingWidthPx')}px solid var(--accent)`,
    });
    document.body.appendChild(ring);
    const anim = ring.animate(
      [
        { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px`, borderRadius: `${radius}px`, opacity: 0.55 + 0.45 * amp },
        { left: `${x - travel}px`, top: `${y - travel}px`, width: `${w + 2 * travel}px`, height: `${h + 2 * travel}px`, borderRadius: `${radius + travel}px`, opacity: 0 },
      ],
      { duration: CFG.get('sonarRingMs'), easing: 'cubic-bezier(.15, .7, .3, 1)', fill: 'both' },
    );
    anim.onfinish = () => ring.remove();
  }

  // The die itself takes a short beat: fast attack, slower release.
  function beatDie(boardEl, r, c, amp) {
    const die = R.cellAt(boardEl, r, c)?.querySelector('.die');
    if (!die) return;
    const peak = 1 + (CFG.get('sonarBeatScale') - 1) * amp;
    die.animate(
      [{ scale: 1 }, { scale: peak, offset: 0.2, easing: 'ease-out' }, { scale: 1 }],
      { duration: Math.max(80, CFG.get('sonarBeatMs') * 1.5) },
    );
  }

  // Landing schedule for one merge: dice arrive nearest first, each at least one
  // beat after the one before, with the beat period shrinking by sonarSpeedUpPct
  // each time. Compressed toward settleMaxMs, but no die can land before its own
  // flight allows.
  function sonarSchedule(moves, hopMs) {
    const sorted = [...moves].sort((a, b) => a.path.length - b.path.length);
    const beat = CFG.get('sonarBeatMs');
    const keep = 1 - CFG.get('sonarSpeedUpPct') / 100;
    const landings = [];
    sorted.forEach((move, k) => {
      const flight = (move.path.length - 1) * hopMs;
      const gap = k === 0 ? 0 : Math.max(20, beat * keep ** (k - 1));
      landings.push(Math.max(flight, k === 0 ? 0 : landings[k - 1] + gap));
    });
    const total = landings[landings.length - 1] || 0;
    const squeeze = total > CFG.get('settleMaxMs') ? CFG.get('settleMaxMs') / total : 1;
    return sorted.map((move, k) => {
      const flight = (move.path.length - 1) * hopMs;
      const landing = Math.max(flight, landings[k] * squeeze);
      return { move, delay: landing - flight, landing };
    });
  }

  // Plays one merge step; returns when to redraw (ms from now).
  function startSonar(boardEl, step, hopMs) {
    const byTarget = new Map();
    step.moves.forEach((m) => {
      const end = m.path[m.path.length - 1];
      const key = `${end.r},${end.c}`;
      if (!byTarget.has(key)) byTarget.set(key, []);
      byTarget.get(key).push(m);
    });

    let redrawAt = 0;
    let order = 0;
    step.pops.forEach((pop) => {
      const targetDie = R.cellAt(boardEl, pop.r, pop.c)?.querySelector('.die');
      if (targetDie) {
        targetDie.style.position = 'relative';
        targetDie.style.zIndex = '999';
      }
      const schedule = sonarSchedule(byTarget.get(`${pop.r},${pop.c}`) || [], hopMs);
      const buildFrom = CFG.get('sonarBuildPct') / 100;
      schedule.forEach(({ move, delay, landing }, k) => {
        const start = move.path[0];
        const dieEl = R.cellAt(boardEl, start.r, start.c)?.querySelector('.die');
        if (dieEl) flyDieAlongPath(boardEl, dieEl, move.path, hopMs, 5 + order, delay);
        order += 1;
        const last = k === schedule.length - 1;
        const amp = schedule.length > 1 ? buildFrom + (1 - buildFrom) * (k / (schedule.length - 1)) : 1;
        window.setTimeout(() => {
          emitRing(boardEl, pop.r, pop.c, amp);
          if (!last) beatDie(boardEl, pop.r, pop.c, amp);
        }, landing);
        redrawAt = Math.max(redrawAt, landing);
      });
    });
    return redrawAt;
  }

  // A step with no moves is the piece landing: shown at once. Otherwise: flash
  // targets, fly dice, wait for the longer of flight and ripples (capped by
  // settleMaxMs), pause settleBeatMs, then draw the step's board. With the Sonar
  // effect a merge step instead redraws at its last landing and pauses after.
  function playTimeline(boardEl, steps, onDone) {
    playing = true;
    let i = 0;

    function playStep() {
      const step = steps[i];
      if (!step) {
        playing = false;
        onDone();
        return;
      }

      if (!step.moves.length) {
        R.renderBoard(boardEl, step.board, { pops: [] });
        i += 1;
        const beat = CFG.get('landingBeatMs');
        if (beat > 0 && steps[i]) window.setTimeout(playStep, beat);
        else playStep();
        return;
      }

      if (CFG.get('mergeFx') === 'sonar' && step.pops.length) {
        const redrawAt = startSonar(boardEl, step, stepHopMs(step));
        window.setTimeout(() => {
          R.renderBoard(boardEl, step.board, { pops: step.pops });
          i += 1;
          if (steps[i]) window.setTimeout(playStep, CFG.get('settleBeatMs'));
          else playStep();
        }, redrawAt);
        return;
      }

      highlightTargets(boardEl, step.pops);
      const hopMs = stepHopMs(step);
      const maxSegments = step.moves.reduce((max, m) => Math.max(max, m.path.length - 1), 0);

      const maxPulseTrainMs = step.pops.reduce((max, pop) => Math.max(max, pulseTrainMs(pop)), 0);
      const flightMs = Math.min(CFG.get('settleMaxMs'), Math.max(maxSegments * hopMs, maxPulseTrainMs));
      animateMoves(boardEl, step.moves, hopMs);

      window.setTimeout(() => {
        R.renderBoard(boardEl, step.board, { pops: step.pops });
        i += 1;
        playStep();
      }, flightMs + CFG.get('settleBeatMs'));
    }

    playStep();
  }

  return { isPlaying, playTimeline };
})();
