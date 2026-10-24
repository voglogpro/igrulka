// Historical position along the same parabola used by the simulation. No sampled history pool.
export function projectileTrailPoint(p, secondsBack, out) {
  const t = Math.max(0, Math.min(p.life, secondsBack));
  out.x = p.x - p.vx * t;
  out.z = p.z - p.vz * t;
  if (p.arc && p.flight > 0) {
    const k = Math.max(0, Math.min(1, (p.life - t) / p.flight));
    out.y = (p.originY ?? 6) * (1 - k) + 2 * k + 4 * p.arc * k * (1 - k);
  } else out.y = p.y - p.vy * t - 0.5 * (p.gravity || 0) * t * t;
  return out;
}
