// Where a projectile is `ahead` seconds after its last simulation step (negative looks back along
// its path). The simulation runs at 20 Hz, so rounds drawn where they will be move smoothly at any
// frame rate, and tails follow the real parabola instead of a straight line.
export function projectilePoint(p, ahead, out) {
  if (p.domain === 'ground') {
    const flight = p.flight || 1,
      done = Math.min(p.life, flight),
      life = Math.max(0, Math.min(flight, p.life + ahead)),
      ox = p.originX ?? p.x - p.vx * done,
      oz = p.originZ ?? p.z - p.vz * done,
      peak = p.arc || p.loft;
    out.x = ox + p.vx * life;
    out.z = oz + p.vz * life;
    if (peak) {
      const k = life / flight,
        from = p.originY ?? 6,
        to = p.endY ?? 2;
      out.y = from * (1 - k) + to * k + 4 * peak * k * (1 - k);
    } else if (p.gravity) {
      // Direct fire saved by early 8.5 builds: plain gravity from the current state.
      const d = life - done;
      out.y = p.y + p.vy * d - 0.5 * p.gravity * d * d;
    } else out.y = p.y;
    return out;
  }
  const d = Math.max(-p.life, ahead),
    g = p.gravity || 0;
  out.x = p.x + p.vx * d;
  out.y = p.y + p.vy * d - 0.5 * g * d * d;
  out.z = p.z + p.vz * d;
  return out;
}

// Unit flight direction at the same moment, from two nearby points of the path.
export function projectileHeading(p, ahead, out, scratch) {
  projectilePoint(p, ahead, out);
  projectilePoint(p, ahead - 0.012, scratch);
  let dx = out.x - scratch.x,
    dy = out.y - scratch.y,
    dz = out.z - scratch.z,
    l = Math.hypot(dx, dy, dz);
  if (l < 1e-5) {
    dx = p.vx;
    dy = p.vy;
    dz = p.vz;
    l = Math.hypot(dx, dy, dz) || 1;
  }
  return { dx: dx / l, dy: dy / l, dz: dz / l };
}
