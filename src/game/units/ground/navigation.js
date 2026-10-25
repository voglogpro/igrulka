import { FIELD, BUILDINGS, riverDistance, CORRIDORS } from '../../config.js';
import { activeSettlementFootprints } from '../../territory/settlements.config.js';
import { GROUND_COMMAND_LIMIT } from './limits.js';
// The ground crossings between the cities. The name stays for older code and saves: since the sea
// map they are the two land corridors, not bridges.
export const BRIDGES = CORRIDORS,
  // Compatibility export: only a maximum number of IDs in one command.
  GROUND_LIMIT = GROUND_COMMAND_LIMIT;
const CELL = 24,
  // The lattice keeps the alignment of the original valley grid (origin -864, -576).
  OX = -864 - Math.floor((FIELD.x - 864) / CELL) * CELL,
  OZ = -576 - Math.floor((FIELD.z - 576) / CELL) * CELL,
  WIDTH = Math.floor((FIELD.x - OX) / CELL) + 1,
  DEPTH = Math.floor((FIELD.z - OZ) / CELL) + 1;
const masks = new WeakMap();
const movementObstacles = new WeakMap();
const OBSTACLE_CELL = 64,
  OBSTACLE_STRIDE = Math.ceil((FIELD.x * 2) / OBSTACLE_CELL) + 1;
const obstacleColumn = (x) => Math.floor((x + FIELD.x) / OBSTACLE_CELL);
const obstacleRow = (z) => Math.floor((z + FIELD.z) / OBSTACLE_CELL);
function movementBuckets(s) {
  const footprints = activeSettlementFootprints(s);
  let cache = movementObstacles.get(s);
  if (
    cache &&
    cache.revision === s.networkRevision &&
    cache.buildings === s.buildings &&
    cache.count === s.buildings.length &&
    cache.footprints === footprints
  )
    return cache.buckets;
  const buckets = new Map();
  for (const object of [...s.buildings, ...footprints]) {
    const half = object.r ?? (BUILDINGS[object.key]?.size || 30) * 0.56;
    const record = { object, half };
    for (let z = obstacleRow(object.z - half); z <= obstacleRow(object.z + half); z++)
      for (let x = obstacleColumn(object.x - half); x <= obstacleColumn(object.x + half); x++) {
        const key = z * OBSTACLE_STRIDE + x;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(record);
      }
  }
  cache = {
    revision: s.networkRevision,
    buildings: s.buildings,
    count: s.buildings.length,
    footprints,
    buckets,
  };
  movementObstacles.set(s, cache);
  return buckets;
}
// Terrain does not change during a campaign. Reuse it across factions and campaigns;
// new buildings only stamp their small bounding rectangles onto a copied mask.
const terrainMasks = new Map();
function compileMask(s, radius) {
  let terrain = terrainMasks.get(radius);
  if (!terrain) {
    terrain = new Uint8Array(WIDTH * DEPTH);
    for (let row = 0; row < DEPTH; row++)
      for (let col = 0; col < WIDTH; col++) {
        const x = OX + col * CELL,
          z = OZ + row * CELL;
        terrain[row * WIDTH + col] = riverDistance(x, z) < 77 + radius;
      }
    terrain = {
      blocked: terrain,
      checked: new Uint8Array(terrain.length),
      edges: new Uint8Array(terrain.length),
    };
    terrainMasks.set(radius, terrain);
    if (terrainMasks.size > 32) terrainMasks.delete(terrainMasks.keys().next().value);
  }
  const blocked = terrain.blocked.slice(),
    obstacles = new Map();
  for (const b of [...s.buildings, ...activeSettlementFootprints(s)]) {
    if (b.demolished) continue;
    const reach = (b.r ?? (BUILDINGS[b.key]?.size || 30) * 0.56) + radius;
    const firstX = Math.max(0, Math.ceil((b.x - reach - OX) / CELL));
    const lastX = Math.min(WIDTH - 1, Math.floor((b.x + reach - OX) / CELL));
    const firstZ = Math.max(0, Math.ceil((b.z - reach - OZ) / CELL));
    const lastZ = Math.min(DEPTH - 1, Math.floor((b.z + reach - OZ) / CELL));
    const rectangle = {
      left: b.x - reach,
      right: b.x + reach,
      top: b.z - reach,
      bottom: b.z + reach,
    };
    const firstBucketX = Math.max(0, obstacleColumn(rectangle.left));
    const lastBucketX = Math.min(OBSTACLE_STRIDE - 1, obstacleColumn(rectangle.right));
    const firstBucketZ = Math.max(0, obstacleRow(rectangle.top));
    const lastBucketZ = Math.min(
      Math.ceil((FIELD.z * 2) / OBSTACLE_CELL),
      obstacleRow(rectangle.bottom),
    );
    for (let row = firstBucketZ; row <= lastBucketZ; row++)
      for (let col = firstBucketX; col <= lastBucketX; col++) {
        const key = row * OBSTACLE_STRIDE + col;
        if (!obstacles.has(key)) obstacles.set(key, []);
        obstacles.get(key).push(rectangle);
      }
    for (let row = firstZ; row <= lastZ; row++)
      for (let col = firstX; col <= lastX; col++)
        if (Math.abs(OX + col * CELL - b.x) < reach && Math.abs(OZ + row * CELL - b.z) < reach)
          blocked[row * WIDTH + col] = 1;
  }
  return { blocked, obstacles, terrain };
}
function crossesRectangle(a, b, rectangle) {
  let low = 0,
    high = 1;
  for (const [start, delta, min, max] of [
    [a.x, b.x - a.x, rectangle.left + 1e-8, rectangle.right - 1e-8],
    [a.z, b.z - a.z, rectangle.top + 1e-8, rectangle.bottom - 1e-8],
  ]) {
    if (Math.abs(delta) < 1e-12) {
      if (start < min || start > max) return false;
      continue;
    }
    const enter = (min - start) / delta,
      exit = (max - start) / delta;
    low = Math.max(low, Math.min(enter, exit));
    high = Math.min(high, Math.max(enter, exit));
    if (low > high) return false;
  }
  return true;
}
function clearGridEdge(grid, a, b, size, current, bit) {
  const terrain = grid.terrain;
  if (!(terrain.checked[current] & bit)) {
    terrain.checked[current] |= bit;
    const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 3);
    let dry = true;
    for (let i = 0; i <= n; i++)
      if (riverDistance(a.x + ((b.x - a.x) * i) / n, a.z + ((b.z - a.z) * i) / n) < 77 + size) {
        dry = false;
        break;
      }
    if (dry) terrain.edges[current] |= bit;
  }
  if (!(terrain.edges[current] & bit)) return false;
  for (let row = obstacleRow(Math.min(a.z, b.z)); row <= obstacleRow(Math.max(a.z, b.z)); row++)
    for (
      let col = obstacleColumn(Math.min(a.x, b.x));
      col <= obstacleColumn(Math.max(a.x, b.x));
      col++
    )
      for (const rectangle of grid.obstacles.get(row * OBSTACLE_STRIDE + col) || [])
        if (crossesRectangle(a, b, rectangle)) return false;
  return true;
}
export function walkable(s, x, z, radius = 3, ignore = null) {
  if (Math.abs(x) > FIELD.x || Math.abs(z) > FIELD.z) return false;
  if (riverDistance(x, z) < 77 + radius) return false;
  const buckets = movementBuckets(s);
  for (let row = obstacleRow(z - radius); row <= obstacleRow(z + radius); row++)
    for (let col = obstacleColumn(x - radius); col <= obstacleColumn(x + radius); col++)
      for (const { object, half } of buckets.get(row * OBSTACLE_STRIDE + col) || [])
        if (
          object.id !== ignore &&
          !object.demolished &&
          Math.abs(x - object.x) < half + radius &&
          Math.abs(z - object.z) < half + radius
        )
          return false;
  return true;
}
// Bounded A* over the whole field with a binary heap, no diagonal corner cutting.
export function groundPath(s, from, to, radius = 3) {
  const clear = (a, b, footprint = radius) => {
    // Sample finer than a footprint corner so a straight leg never grazes a building.
    const n = Math.ceil(Math.hypot(a.x - b.x, a.z - b.z) / 3);
    for (let i = 0; i <= n; i++) {
      const t = i / (n || 1);
      if (!walkable(s, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, footprint)) return false;
    }
    return true;
  };
  if (clear(from, to)) return [{ x: to.x, z: to.z }];
  const point = (i) => ({ x: OX + (i % WIDTH) * CELL, z: OZ + Math.floor(i / WIDTH) * CELL });
  let cache = masks.get(s);
  const signature =
    s.networkRevision +
    ':' +
    s.buildings.length +
    ':' +
    (s.settlementHouseMask ?? 65535) +
    ':' +
    (s.settlementLayoutMask ?? 16777215);
  if (!cache || cache.signature !== signature) {
    cache = { signature, grids: new Map() };
    masks.set(s, cache);
  }
  const size = Math.ceil(radius * 2) / 2;
  let grid = cache.grids.get(size);
  if (!grid) {
    const compiled = compileMask(s, size);
    const { blocked } = compiled;
    grid = {
      ...compiled,
      checked: new Uint8Array(blocked.length),
      edges: new Uint8Array(blocked.length),
    };
    cache.grids.set(size, grid);
  }
  const { blocked, checked, edges } = grid;
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
    let direction = -1;
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
      direction++;
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
      // Dry endpoints alone cannot certify an edge along an irregular shoreline or wall.
      // Cache each short sweep per map revision/footprint so subsequent routes reuse it.
      const bit = 1 << direction;
      if (!(checked[current] & bit)) {
        checked[current] |= bit;
        if (clearGridEdge(grid, point(current), point(next), size, current, bit))
          edges[current] |= bit;
      }
      if (!(edges[current] & bit)) continue;
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
