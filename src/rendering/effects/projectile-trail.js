import { projectilePoint } from './tracer-path.js';

// Historical position along the same parabola used by the simulation. No sampled history pool.
export function projectileTrailPoint(p, secondsBack, out) {
  return projectilePoint(p, -Math.max(0, secondsBack), out);
}
