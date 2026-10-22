import { MAP, BUILDINGS, riverDistance } from '../../config.js';
export const BRIDGES = [-270, 270],
  GROUND_LIMIT = 120;
const CELL = 24,
  WIDTH = 72,
  DEPTH = 48,
  OX = -864,
  OZ = -576;
const masks = new WeakMap();
export function walkable(s, x, z, radius = 3, ignore = null) {
  if (Math.abs(x) > MAP.width / 2 - 16 || Math.abs(z) > MAP.depth / 2 - 16) return false;
  if (riverDistance(x, z) < 77 + radius && !BRIDGES.some((b) => Math.abs(z - b) < 23 - radius))
    return false;
  return !s.buildings.some(
    (b) =>
      b.id !== ignore &&
      !b.demolished &&
      Math.abs(x - b.x) < (BUILDINGS[b.key]?.size || 30) * 0.56 + radius &&
      Math.abs(z - b.z) < (BUILDINGS[b.key]?.size || 30) * 0.56 + radius,
  );
}
// Bounded A*, no diagonal corner cutting. The navigation lattice covers only the playable valley.
export function groundPath(s, from, to, radius = 3) {
  const clear = (a, b) => {
    const n = Math.ceil(Math.hypot(a.x - b.x, a.z - b.z) / 6);
    for (let i = 0; i <= n; i++) {
      const t = i / (n || 1);
      if (!walkable(s, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, radius)) return false;
    }
    return true;
  };
  if (clear(from, to)) return [{ x: to.x, z: to.z }];
  const point = (i) => ({ x: OX + (i % WIDTH) * CELL, z: OZ + Math.floor(i / WIDTH) * CELL });
  let cache = masks.get(s);
  const signature = s.networkRevision + ':' + s.buildings.length;
  if (!cache || cache.signature !== signature) {
    cache = { signature, grids: new Map() };
    masks.set(s, cache);
  }
  const size = Math.ceil(radius * 2) / 2;
  let blocked = cache.grids.get(size);
  if (!blocked) {
    blocked = new Uint8Array(WIDTH * DEPTH);
    for (let i = 0; i < blocked.length; i++) {
      const p = point(i);
      blocked[i] = !walkable(s, p.x, p.z, size);
    }
    cache.grids.set(size, blocked);
  }
  const nearest = (p) => {
    let found = -1,
      best = Infinity;
    const cx = Math.max(0, Math.min(WIDTH - 1, Math.round((p.x - OX) / CELL)));
    const cz = Math.max(0, Math.min(DEPTH - 1, Math.round((p.z - OZ) / CELL)));
    const sourceWalkable = walkable(s, p.x, p.z, radius);
    const consider = (x, z) => {
      if (x < 0 || x >= WIDTH || z < 0 || z >= DEPTH) return;
      const i = z * WIDTH + x;
      if (blocked[i]) return;
      const q = point(i),
        dist = (q.x - p.x) ** 2 + (q.z - p.z) ** 2;
      if ((dist < best || (dist === best && i < found)) && (!sourceWalkable || clear(p, q))) {
        best = dist;
        found = i;
      }
    };
    // Nearby endpoints should never ray march to hundreds of distant cells first.
    for (let ring = 0; ring < Math.max(WIDTH, DEPTH); ring++) {
      if (ring === 0) consider(cx, cz);
      else {
        for (let x = cx - ring; x <= cx + ring; x++) {
          consider(x, cz - ring);
          consider(x, cz + ring);
        }
        for (let z = cz - ring + 1; z < cz + ring; z++) {
          consider(cx - ring, z);
          consider(cx + ring, z);
        }
      }
      let outside = Infinity;
      if (cx - ring > 0) outside = Math.min(outside, Math.abs(OX + (cx - ring - 1) * CELL - p.x));
      if (cx + ring < WIDTH - 1)
        outside = Math.min(outside, Math.abs(OX + (cx + ring + 1) * CELL - p.x));
      if (cz - ring > 0) outside = Math.min(outside, Math.abs(OZ + (cz - ring - 1) * CELL - p.z));
      if (cz + ring < DEPTH - 1)
        outside = Math.min(outside, Math.abs(OZ + (cz + ring + 1) * CELL - p.z));
      if (found >= 0 && best < outside * outside) break;
      if (outside === Infinity) break;
    }
    return found;
  };
  const start = nearest(from),
    end = nearest(to);
  if (start < 0 || end < 0) return [];
  const scores = new Float64Array(blocked.length);
  scores.fill(Infinity);
  scores[start] = 0;
  const prev = new Int32Array(blocked.length);
  prev.fill(-1);
  const open = new Set([start]),
    closed = new Uint8Array(blocked.length),
    goal = point(end);
  const heuristic = (i) => {
    const p = point(i);
    return Math.hypot(goal.x - p.x, goal.z - p.z);
  };
  while (open.size) {
    let current = -1,
      best = Infinity;
    for (const i of open) {
      const score = scores[i] + heuristic(i);
      if (score < best) {
        best = score;
        current = i;
      }
    }
    if (current === end) {
      const path = [];
      let i = end;
      while (i !== start) {
        path.push(point(i));
        i = prev[i];
      }
      path.reverse();
      if (walkable(s, to.x, to.z, radius)) path.push({ x: to.x, z: to.z });
      return [point(start), ...path];
    }
    open.delete(current);
    closed[current] = 1;
    const cx = current % WIDTH,
      cz = Math.floor(current / WIDTH);
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ]) {
      const nx = cx + dx,
        nz = cz + dz;
      if (nx < 0 || nx >= WIDTH || nz < 0 || nz >= DEPTH) continue;
      const next = nz * WIDTH + nx;
      if (
        blocked[next] ||
        closed[next] ||
        (dx && dz && (blocked[cz * WIDTH + nx] || blocked[nz * WIDTH + cx]))
      )
        continue;
      const score = scores[current] + CELL * (dx && dz ? Math.SQRT2 : 1);
      if (score < scores[next]) {
        scores[next] = score;
        prev[next] = current;
        open.add(next);
      }
    }
  }
  return [];
}
