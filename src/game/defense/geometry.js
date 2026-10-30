import { allied, hqOf } from '../factions.js';
import { FIELD, SEA, COVER_PATCHES, riverDistance, seaDistance } from '../map.js';
import { DISTRICTS } from '../territory/districts.config.js';
import { FRONTLINE as C } from './config.js';

const directionOf = (side) => (side % 2 === 0 ? 1 : -1);
export function corridorGeometry(s, side, direction = directionOf(side)) {
  const ids = s.sides.length > 2 ? [hqOf(s, side).z < 0 ? 'north' : 'south'] : ['north', 'south'];
  return ids.map((id) => {
    const sign = id === 'north' ? -1 : 1;
    const district = DISTRICTS.find(
      (d) => Math.sign(d.z) === sign && (d.x === 0 || d.x * direction < 0),
    );
    const owned =
      district && s.districts?.some((d) => d.id === district.id && allied(s, d.owner, side));
    const x = owned
      ? district.x + direction * (district.radius + C.territoryAdvance)
      : -direction * C.homeLineX;
    let shore = SEA.halfZ - SEA.round;
    while (shore < FIELD.z && seaDistance(x, sign * shore) < 0) shore += 2;
    const edge = FIELD.z - C.edgeMargin;
    let inset = C.edgeCoverage;
    while (riverDistance(x, sign * (shore + inset)) < C.shoreClearance && inset < 80) inset += 2;
    const span = Math.max(0, edge - shore - inset - C.edgeCoverage);
    // Stable slot ids across ownership changes; the coast's +/-20m irregularity is included.
    const count = Math.max(
      2,
      Math.ceil((edge - SEA.halfZ + 20 - 2 * C.edgeCoverage) / C.postGap) + 1,
    );
    const slots = Array.from({ length: count }, (_, slot) => ({
      id: `${id}:${slot}`,
      slot,
      corridorId: id,
      x,
      z: sign * (shore + inset + (span * slot) / (count - 1)),
      row: 0,
    }));
    return {
      id,
      x,
      z: (sign * (shore + edge)) / 2,
      districtId: district?.id || null,
      depot: district ? { x: district.x, z: district.z, radius: district.radius } : null,
      secured: !!owned,
      points: [
        { x, z: sign * shore },
        { x, z: sign * edge },
      ],
      slots,
    };
  });
}

// Woods and tree lines are fixed map data. Bucket them once along the front axis.
const TREE_CELL = 64;
const treeCells = new Map();
for (const p of COVER_PATCHES) {
  if (!p.forest) continue;
  for (
    let cz = Math.floor((p.z - p.r) / TREE_CELL);
    cz <= Math.floor((p.z + p.r) / TREE_CELL);
    cz++
  )
    for (
      let cx = Math.floor((p.x - p.r - C.treeSnap) / TREE_CELL);
      cx <= Math.floor((p.x + p.r + C.treeSnap) / TREE_CELL);
      cx++
    ) {
      const key = cx + ',' + cz;
      if (!treeCells.has(key)) treeCells.set(key, []);
      treeCells.get(key).push(p);
    }
}
const treePoints = new Map();
// A post slides along the front axis onto the enemy-facing edge of a nearby tree line or wood,
// so a section holds the lesopolosa instead of the open field beside it. The shift is shorter
// than half the row spacing, so two rows of one slot can never take the same place.
export function treeLinePoint(point, direction) {
  const key = point.x + ',' + point.z + ',' + direction;
  let cached = treePoints.get(key);
  if (cached) return cached;
  let best = null,
    score = Infinity;
  for (const p of treeCells.get(
    Math.floor(point.x / TREE_CELL) + ',' + Math.floor(point.z / TREE_CELL),
  ) || []) {
    const dz = Math.abs(p.z - point.z),
      reach = p.r - 1.5;
    if (dz >= reach) continue;
    // The forward edge of the wood at this latitude, a few metres inside the trees.
    const x = p.x + direction * Math.sqrt(reach * reach - dz * dz),
      shift = Math.abs(x - point.x) - (p.belt ? 4 : 0);
    if (Math.abs(x - point.x) > C.treeSnap || shift >= score) continue;
    best = x;
    score = shift;
  }
  cached = best == null ? point : { x: best, z: point.z, treeLine: true };
  if (treePoints.size > 4096) treePoints.clear();
  treePoints.set(key, cached);
  return cached;
}

export function defensePostPoint(lines, reference, direction) {
  const line = lines.find((v) => v.id === reference?.corridorId);
  const slot = line?.slots[reference?.slot];
  if (!slot) return null;
  const row = reference.row;
  const nominal = {
    x: slot.x - direction * (row === 0 ? 0 : C.supportOffset + (row - 1) * C.rowSpacing),
    // The second infantry row and its vehicle support hold the actual depot.
    // Outer/rear rows still span the complete land corridor, including flanks.
    z:
      line.secured && [1, 2, 3].includes(row) && line.depot
        ? line.depot.z + (reference.slot - (line.slots.length - 1) / 2) * 20
        : slot.z,
  };
  const { x, z } = treeLinePoint(nominal, direction);
  return { x, z };
}

export function spreadOrder(count, centerFirst = true) {
  const result = [],
    remaining = Array.from({ length: count }, (_, i) => i);
  while (remaining.length) {
    remaining.sort((a, b) => {
      const score = (slot) =>
        result.length
          ? Math.min(...result.map((other) => Math.abs(slot - other)))
          : centerFirst
            ? count - Math.abs(slot - (count - 1) / 2)
            : count - slot;
      return score(b) - score(a) || a - b;
    });
    result.push(remaining.shift());
  }
  return result;
}
