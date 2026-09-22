/*
 * Lightweight physics primitives shared by the drag controller and the
 * placement/rejection animations: a damped spring, stepped by
 * requestAnimationFrame rather than CSS transitions, so motion can
 * carry real velocity across state changes (drag -> release, cancel ->
 * snapback) instead of every gesture starting and stopping at rest.
 */
const DiceMergePhysics = (() => {
  // Semi-implicit Euler integration of a damped spring — real F=ma, not
  // a shortcut that assumes every dragged object weighs the same:
  // spring force and damping force are divided by `mass` to get
  // acceleration, exactly like a real spring-and-mass system. `mass`
  // defaults to 1 so a caller that doesn't pass one gets the original
  // behavior unchanged. Passing the actual game-mass of whatever's
  // being dragged (see D.massForValue) means the same tuned stiffness/
  // damping constants make heavier dice feel heavier — laggier to move,
  // slower and bouncier to settle — without inventing a new per-tier
  // multiplier; it falls out of the equation of motion.
  function stepSpring(value, velocity, target, stiffness, damping, dt, mass = 1) {
    const force = (target - value) * stiffness - velocity * damping;
    const acceleration = force / mass;
    const nextVelocity = velocity + acceleration * dt;
    const nextValue = value + nextVelocity * dt;
    return { value: nextValue, velocity: nextVelocity };
  }

  // Runs a spring to rest via rAF, calling onStep(value, velocity) each
  // frame and onSettle() once it's close enough to target (or maxMs
  // elapses, as a safety net against never-quite-settling configs).
  // Returns a cancel function.
  function runSpring({ from, velocity = 0, target, stiffness, damping, mass = 1, onStep, onSettle, maxMs = 2000 }) {
    let value = from;
    let vel = velocity;
    let lastT = performance.now();
    const startT = lastT;
    let cancelled = false;

    function frame(now) {
      if (cancelled) return;
      const dt = Math.min((now - lastT) / 1000, 1 / 30);
      lastT = now;
      const stepped = stepSpring(value, vel, target, stiffness, damping, dt, mass);
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
