/*
 * A damped spring stepped on requestAnimationFrame, used for the drag
 * snapback. Force is divided by mass, so heavier pieces are laggier.
 */
const DiceMergePhysics = (() => {
  // Semi-implicit Euler.
  function stepSpring(value, velocity, target, stiffness, damping, dt, mass = 1) {
    const force = (target - value) * stiffness - velocity * damping;
    const acceleration = force / mass;
    const nextVelocity = velocity + acceleration * dt;
    const nextValue = value + nextVelocity * dt;
    return { value: nextValue, velocity: nextVelocity };
  }

  // Returns a cancel function. `maxMs` force-settles springs that never come to
  // rest (e.g. zero damping).
  function runSpring({ from, velocity = 0, target, stiffness, damping, mass = 1, onStep, onSettle, maxMs = 2000 }) {
    let value = from;
    let vel = velocity;
    let lastT = performance.now();
    const startT = lastT;
    let cancelled = false;

    function frame(now) {
      if (cancelled) return;
      // Clamped so a stalled frame can't make the integration explode.
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
