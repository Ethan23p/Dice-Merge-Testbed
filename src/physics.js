/*
 * Lightweight physics primitives shared by the drag controller and the
 * placement/rejection animations: a damped spring, stepped by
 * requestAnimationFrame rather than CSS transitions, so motion can
 * carry real velocity across state changes (drag -> release, cancel ->
 * snapback) instead of every gesture starting and stopping at rest.
 */
const DiceMergePhysics = (() => {
  // Semi-implicit Euler integration of a damped spring: pulls `value`
  // toward `target`, accelerating/decelerating based on `velocity` so a
  // fast flick keeps moving briefly instead of snapping to a stop.
  function stepSpring(value, velocity, target, stiffness, damping, dt) {
    const force = (target - value) * stiffness - velocity * damping;
    const nextVelocity = velocity + force * dt;
    const nextValue = value + nextVelocity * dt;
    return { value: nextValue, velocity: nextVelocity };
  }

  // Runs a spring to rest via rAF, calling onStep(value, velocity) each
  // frame and onSettle() once it's close enough to target (or maxMs
  // elapses, as a safety net against never-quite-settling configs).
  // Returns a cancel function.
  function runSpring({ from, velocity = 0, target, stiffness, damping, onStep, onSettle, maxMs = 2000 }) {
    let value = from;
    let vel = velocity;
    let lastT = performance.now();
    const startT = lastT;
    let cancelled = false;

    function frame(now) {
      if (cancelled) return;
      const dt = Math.min((now - lastT) / 1000, 1 / 30);
      lastT = now;
      const stepped = stepSpring(value, vel, target, stiffness, damping, dt);
      value = stepped.value;
      vel = stepped.velocity;
      onStep(value, vel);

      const settled = Math.abs(value - target) < 0.05 && Math.abs(vel) < 0.05;
      if (settled || now - startT > maxMs) {
        onStep(target, 0);
        onSettle();
        return;
      }
      requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
    return () => {
      cancelled = true;
    };
  }

  return { stepSpring, runSpring };
})();
