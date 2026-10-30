import { weaponFamily } from './weapons.config.js';
export function flightRoute(origin, aim, key) {
  const points = [origin, ...(weaponFamily(key) === 'ballistic' ? [] : aim.waypoints || []), aim],
    path = [{ x: origin.x, z: origin.z, d: 0 }];
  const add = (p) => {
    const a = path.at(-1),
      d = Math.hypot(p.x - a.x, p.z - a.z);
    if (d > 0.01) path.push({ x: p.x, z: p.z, d: a.d + d });
  };
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1],
      b = points[i],
      c = points[i + 1],
      ab = Math.hypot(b.x - a.x, b.z - a.z) || 1,
      bc = Math.hypot(c.x - b.x, c.z - b.z) || 1,
      r = Math.min(30, ab * 0.22, bc * 0.22),
      p = { x: b.x + ((a.x - b.x) * r) / ab, z: b.z + ((a.z - b.z) * r) / ab },
      q = { x: b.x + ((c.x - b.x) * r) / bc, z: b.z + ((c.z - b.z) * r) / bc };
    add(p);
    for (let j = 1; j <= 8; j++) {
      const t = j / 8,
        v = 1 - t;
      add({
        x: v * v * p.x + 2 * v * t * b.x + t * t * q.x,
        z: v * v * p.z + 2 * v * t * b.z + t * t * q.z,
      });
    }
  }
  add(aim);
  return path;
}
export function pointOnRoute(route, travelled) {
  for (let i = 1; i < route.length; i++) {
    const b = route[i],
      a = route[i - 1];
    if (travelled <= b.d) {
      const t = Math.max(0, (travelled - a.d) / (b.d - a.d || 1));
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    }
  }
  return { ...route.at(-1) };
}
