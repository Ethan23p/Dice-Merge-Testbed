/*
 * Plays a `state.js` timeline (see the `steps` shape documented at the
 * top of state.js) against the board. This is the only place that
 * knows how a `step` becomes motion on screen — state.js only ever
 * hands over data (a resulting board, dice in flight, cells to flash),
 * never a hint about why a step happened. One step is played exactly
 * like any other: a placement's own merge cascade and gravity's shifts
 * and merges are the same shape here, so there is nothing for this
 * file to branch on.
 */
const DiceMergeAnimate = (() => {
  const D = DiceMergeData;
  const CFG = DiceMergeConfig;
  const R = DiceMergeRender;

  let playing = false;
  function isPlaying() {
    return playing;
  }

  // Same law as everywhere else mass drives a duration (see
  // scaleWithMass in data.js): a heavier die's hop takes longer, up to
  // a configured cap, so a long cascade or a long gravity slide never
  // runs away.
  function hopDurationForValue(value) {
    return Math.min(CFG.get('hopMaxMs'), D.scaleWithMass(CFG.get('hopBaseMs'), D.massForValue(value)));
  }

  function cellCenter(boardEl, r, c) {
    const el = boardEl.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  // Slides one die along its exact route (state.js's `path`), hop by
  // hop, at constant size — never a diagonal cut through cells it
  // never actually crossed. `zIndex` layers a longer-traveling die
  // above a shorter one so a convergence reads as sliding over, not
  // under, dice that arrived first.
  //
  // Driven through the standalone `translate` property, not the
  // `transform` shorthand: a die that just survived a merge is still
  // mid-flight on its own `die--merge-pop` scale-up (styles.css), and a
  // CSS animation always wins over an inline style for whatever
  // property it's animating. `transform` here would have gone
  // nowhere for the pop's whole duration — the die would sit frozen
  // mid-pulse while gravity moved on without it, until the next
  // render snapped it into place. `translate` and `transform: scale()`
  // are independent properties that compose, so the fall and the pop
  // now play together instead of one blocking the other.
  function flyDieAlongPath(boardEl, dieEl, path, hopMs, zIndex) {
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
    requestAnimationFrame(step);
  }

  // One hop duration for every move in a step, not one per move — a
  // lighter die sharing a gravity line with a heavier one would
  // otherwise overtake it mid-slide. Driven by the heaviest value
  // actually in flight this step, so a step carrying a big merge (or a
  // heavy die sliding) still visibly takes its time.
  function stepHopMs(step) {
    if (!step.moves.length) return 0;
    const maxValue = Math.max(...step.moves.map((m) => m.value));
    return hopDurationForValue(maxValue);
  }

  // A merge beyond the 3-die baseline sends out one extra ring per die
  // past that — the bigger the cluster, the more it visibly builds
  // before landing.
  const EXTRA_PULSE_BASELINE = 3;

  function extraPulseCount(pop) {
    return Math.max(0, (pop.size || 0) - EXTRA_PULSE_BASELINE);
  }

  // How long a pop's own ring "train" takes to fully play out: the
  // base pulse, then (for an extra ring) however many staggered starts
  // it takes to fit them all, plus one full ring duration for the last
  // one to finish. Shared by highlightTargets (to time each ring's
  // delay) and playStep (to know how long to hold the reveal).
  function pulseTrainMs(pop) {
    const extra = extraPulseCount(pop);
    if (extra === 0) return CFG.get('pulseDurationMs');
    return CFG.get('pulseDurationMs')
      + (extra - 1) * CFG.get('pulseBurstIntervalMs')
      + CFG.get('pulseBurstDurationMs');
  }

  // Highlights the cells this step's dice are converging on or landing
  // on — pure DOM class toggling against whatever's already rendered
  // (the previous step's board), never a re-render, so it never
  // disturbs a fly animation already in progress. A cluster beyond the
  // 3-die baseline also gets one `.merge-target-ring` child per extra
  // die, each a one-way grow-and-fade ring (styles.css) with its own
  // start time staggered after the base pulse — a real emanation, not
  // a second animation squeezed onto the die's own box-shadow (that
  // reads as flicker, not distinct pulses; see styles.css). Ring
  // elements never need cleanup: the die itself is discarded whole by
  // the next renderBoard.
  function highlightTargets(boardEl, pops) {
    pops.forEach((pop) => {
      const die = boardEl.querySelector(`.cell[data-r="${pop.r}"][data-c="${pop.c}"] .die`);
      if (!die) return;
      die.classList.add('die--merge-target');
      const extra = extraPulseCount(pop);
      if (extra > 0) {
        die.style.position = 'relative';
        const intervalMs = CFG.get('pulseBurstIntervalMs');
        for (let i = 0; i < extra; i++) {
          const ring = document.createElement('span');
          ring.className = 'merge-target-ring';
          ring.style.animationDelay = `${CFG.get('pulseDurationMs') + i * intervalMs}ms`;
          die.appendChild(ring);
        }
      }
    });
  }

  function animateMoves(boardEl, moves, hopMs) {
    moves.forEach((m, i) => {
      const start = m.path[0];
      const dieEl = boardEl.querySelector(`.cell[data-r="${start.r}"][data-c="${start.c}"] .die`);
      if (dieEl) flyDieAlongPath(boardEl, dieEl, m.path, hopMs, 5 + (m.path.length - 1) * moves.length + i);
    });
  }

  // Plays every step in order. A step with no moves is just the piece
  // landing — shown immediately, with `landingBeatMs` as a beat before
  // whatever comes next starts converging. A step with moves (a merge
  // wave or a gravity shift, indistinguishable here) highlights its
  // targets, flies its dice, waits for the longest path to land, holds
  // `settleBeatMs` so the arrival reads as its own moment, then shows
  // the step's own board — which already reflects the result, so there
  // is nothing left to compute, only to reveal.
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

      highlightTargets(boardEl, step.pops);
      const hopMs = stepHopMs(step);
      const maxSegments = step.moves.reduce((max, m) => Math.max(max, m.path.length - 1), 0);
      // A big cluster's rapid-pulse train (highlightTargets, above) can
      // outlast the dice's own flight to it — a one-hop convergence
      // flies in ~200ms but an 8-die cluster's pulses alone take longer
      // than that. Reveal waits for whichever finishes last, so
      // renderBoard's innerHTML reset (which would cut a pulse train
      // off mid-burst) never fires early. Still capped by settleMaxMs
      // so an extreme cluster size can't stall the whole cascade.
      const maxPulseTrainMs = step.pops.reduce((max, pop) => Math.max(max, pulseTrainMs(pop)), 0);
      const flightMs = Math.min(CFG.get('settleMaxMs'), Math.max(maxSegments * hopMs, maxPulseTrainMs));
      animateMoves(boardEl, step.moves, hopMs);

      window.setTimeout(() => {
        window.setTimeout(() => {
          R.renderBoard(boardEl, step.board, { pops: step.pops });
          i += 1;
          playStep();
        }, CFG.get('settleBeatMs'));
      }, flightMs);
    }

    playStep();
  }

  return { isPlaying, playTimeline };
})();
