import { BUILDINGS, GROUND_UNITS, MAP } from './config.js';
import { buildingConnected } from './city/road-network.js';

// Fog of intelligence: enemy buildings are always known, but enemy units and launches are only
// seen by a friendly observer nearby. A powered radar shows everything. The check is a lookup in a
// coarse per-side grid rebuilt a few times per second.
export const VISION = { radar: 320 };
export const GRID = {
  cell: 40,
  cols: Math.ceil(MAP.width / 40),
  rows: Math.ceil(MAP.depth / 40),
  ox: -MAP.width / 2,
  oz: -MAP.depth / 2,
};
const REFRESH = 0.2;
const caches = new WeakMap();

// Radars that actually work: they need power from the connected grid.
export function radarSources(s, side) {
  const buildings = s.buildings.filter((b) => b.side === side && b.hp > 0 && b.progress >= 1);
  let power = 10,
    demand = 0;
  for (const b of buildings) {
    const d = BUILDINGS[b.key];
    if (!d) continue;
    if (d.power < 0)
      power -=
        d.power * (0.5 + (0.5 * b.hp) / b.maxHp) * (buildingConnected(s, b, d.size) ? 1 : 0.2);
    else demand += d.power;
  }
  return power < demand * 0.5
    ? []
    : buildings
        .filter((b) => b.key === 'radar')
        .map((b) => ({ x: b.x, z: b.z, air: VISION.radar, kind: 'radar', id: b.id }));
}

// Rain, fog and night shrink every observation circle; radar is not affected.
export const weatherVisibility = (s) => s.weather?.visibility ?? 1;

// Seeing distance of an observer. Weather and night shrink the sight but never below the range
// of its own direct-fire weapon, so a gun can always shoot at what it could reach.
export function observerRadius(o, scale = 1) {
  const d = GROUND_UNITS[o.key];
  if (d) {
    const reach = d.indirect ? 0 : Math.max(d.groundRange || 0, d.range || 0);
    return Math.max((d.sight || 150) * scale, reach);
  }
  const b = BUILDINGS[o.key];
  const sight = o.key === 'hq' ? 260 : 150;
  return Math.max(sight * scale, b?.range || 0);
}

function build(s, side) {
  const grid = new Uint8Array(GRID.cols * GRID.rows),
    scale = weatherVisibility(s),
    mark = (x, z, radius) => {
      const r = radius,
        c0 = Math.max(0, Math.floor((x - r - GRID.ox) / GRID.cell)),
        c1 = Math.min(GRID.cols - 1, Math.floor((x + r - GRID.ox) / GRID.cell)),
        r0 = Math.max(0, Math.floor((z - r - GRID.oz) / GRID.cell)),
        r1 = Math.min(GRID.rows - 1, Math.floor((z + r - GRID.oz) / GRID.cell));
      for (let row = r0; row <= r1; row++) {
        const cz = GRID.oz + (row + 0.5) * GRID.cell;
        for (let col = c0; col <= c1; col++) {
          const cx = GRID.ox + (col + 0.5) * GRID.cell;
          // A cell is seen when its centre is inside the circle widened by half a cell.
          if ((cx - x) ** 2 + (cz - z) ** 2 <= (r + GRID.cell * 0.5) ** 2)
            grid[row * GRID.cols + col] = 1;
        }
      }
    };
  for (const b of s.buildings)
    if (b.side === side && b.hp > 0 && b.progress >= 1 && !b.demolished)
      mark(b.x, b.z, observerRadius(b, scale));
  for (const u of s.groundUnits || [])
    if (u.side === side && u.hp > 0 && !u.carrierId) mark(u.x, u.z, observerRadius(u, scale));
  return { radar: radarSources(s, side).length > 0, grid };
}

export function visionOf(s, side) {
  let cache = caches.get(s);
  if (!cache) {
    cache = [null, null];
    caches.set(s, cache);
  }
  const entry = cache[side];
  if (
    entry &&
    s.time - entry.time < REFRESH &&
    s.time >= entry.time &&
    entry.revision === s.networkRevision &&
    entry.units === (s.groundUnits?.length || 0)
  )
    return entry;
  const fresh = {
    ...build(s, side),
    time: s.time,
    revision: s.networkRevision,
    units: s.groundUnits?.length || 0,
  };
  cache[side] = fresh;
  return fresh;
}

// Whether a point is inside the area side `side` currently observes.
export function fogVisible(s, side, x, z) {
  const v = visionOf(s, side);
  if (v.radar) return true;
  const col = Math.floor((x - GRID.ox) / GRID.cell),
    row = Math.floor((z - GRID.oz) / GRID.cell);
  if (col < 0 || row < 0 || col >= GRID.cols || row >= GRID.rows) return false;
  return v.grid[row * GRID.cols + col] === 1;
}
