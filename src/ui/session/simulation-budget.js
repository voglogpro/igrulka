const STEP = 0.05;
// Catch-up work must yield to input/rendering between expensive army steps.
// The remaining simulation time stays in the accumulator rather than running
// five slow ticks back-to-back in the same browser task.
export function advanceSimulationFrame(
  state,
  accumulator,
  dt,
  step,
  now = () => performance.now(),
) {
  let remainder = Math.min(0.25, accumulator + Math.max(0, dt)),
    steps = 0;
  const started = now();
  while (remainder >= STEP && steps < 2) {
    if (steps && now() - started >= 8) break;
    step(state, STEP);
    remainder -= STEP;
    steps++;
  }
  return { remainder, steps };
}
