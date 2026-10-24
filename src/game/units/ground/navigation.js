import { FIELD, BUILDINGS, riverDistance, CORRIDORS } from '../../config.js';
// The ground crossings between the cities. The name stays for older code and saves: since the sea
// map they are the two land corridors, not bridges.
export const BRIDGES = CORRIDORS,
  GROUND_LIMIT = 120;
const CELL = 24,
  // The lattice keeps the alignment of the original valley grid (origin -864, -576).
  OX = -864 - Math.floor((FIELD.x - 864) / CELL) * CELL,
  OZ = -576 - Math.floor((FIELD.z - 576) / CELL) * CELL,
  WIDTH = Math.floor((FIELD.x - OX) / CELL) + 1,
  DEPTH = Math.floor((FIELD.z - OZ) / CELL) + 1;
const masks = new WeakMap();
export function walkable(s, x, z, radius = 3, ignore = null) {
  if (Math.abs(x) > FIELD.x || Math.abs(z) > FIELD.z) return false;
  if (riverDistance(x, z) < 77 + radius) return false;
  return !s.buildings.some(
    (b) =>
      b.id !== ignore &&
      !b.demolished &&
      Math.abs(x - b.x) < (BUILDINGS[b.key]?.size || 30) * 0.56 + radius &&
      Math.abs(z - b.z) < (BUILDINGS[b.key]?.size || 30) * 0.56 + radius,
  );
}
// Bounded A* over the whole field with a binary heap, no diagonal corner cutting.
export function groundPath(s, from, to, radius = 3) {
  const clear = (a, b) => {
    // Sample finer than a footprint corner so a straight leg never grazes a building.
    const n = Math.ceil(Math.hypot(a.x - b.x, a.z - b.z) / 3);
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
  const closed = new Uint8Array(blocked.length),
    goal = point(end),
    heap = [];
  const heuristic = (i) => {
    const p = point(i);
    return Math.hypot(goal.x - p.x, goal.z - p.z);
  };
  // Min-heap of [score, cell]; stale entries are skipped when popped.
  const push = (score, i) => {
    heap.push([score, i]);
    let k = heap.length - 1;
    while (k) {
      const parent = (k - 1) >> 1;
      if (
        heap[parent][0] < heap[k][0] ||
        (heap[parent][0] === heap[k][0] && heap[parent][1] <= heap[k][1])
      )
        break;
      [heap[parent], heap[k]] = [heap[k], heap[parent]];
      k = parent;
    }
  };
  const pop = () => {
    const top = heap[0],
      last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = k * 2 + 1,
          r = l + 1;
        let m = k;
        const less = (a, b) =>
          heap[a][0] < heap[b][0] || (heap[a][0] === heap[b][0] && heap[a][1] < heap[b][1]);
        if (l < heap.length && less(l, m)) m = l;
        if (r < heap.length && less(r, m)) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top;
  };
  push(heuristic(start), start);
  while (heap.length) {
    const current = pop()[1];
    if (closed[current]) continue;
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
        push(score + heuristic(next), next);
      }
    }
  }
  return [];
}
