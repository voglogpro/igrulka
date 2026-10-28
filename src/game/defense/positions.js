import { GROUND_UNITS, isInfantry } from '../config.js';
import { allied, hostile } from '../factions.js';
import { staticObjectsInBounds } from '../shared/static-spatial.js';
import { walkable } from '../units/ground/navigation.js';
import { FORTIFICATION as C, FRONTLINE } from './config.js';
import { TRENCH_FOOTPRINT, trenchContains, trenchSlotPoint } from './trench-footprint.js';

export function trenchContested(s, t, side, exceptId = null, observedOnly = false) {
  // Remote planning uses only the owner's already observed coordinates. It
  // must not learn that a concealed soldier moved into an otherwise empty
  // trench. The physical capture interaction checks actual occupancy on arrival.
  if (observedOnly)
    return (s.frontlineMemory?.[side]?.seen || []).some(
      (v) => s.time - v.time <= FRONTLINE.memorySeconds && trenchContains(t, v.x, v.z),
    );
  return s.groundUnits.some(
    (v) =>
      v.id !== exceptId &&
      v.hp > 0 &&
      !v.carrierId &&
      !v.downed &&
      hostile(s, v.side, side) &&
      trenchContains(t, v.x, v.z),
  );
}

// Reservations are derived from live bodies and current posts, never saved separately.
export function availableTrenchSlots(s, u, t) {
  const slots = TRENCH_FOOTPRINT.slotOffsets.map((_, index) => trenchSlotPoint(t, index));
  const occupied = new Set();
  for (const v of s.groundUnits) {
    if (v.id === u.id || v.hp <= 0 || v.downed || v.carrierId || !allied(s, v.side, u.side))
      continue;
    const points = [v.guard, v.defenseTask?.home, v];
    for (const p of points) {
      if (!p || !trenchContains(t, p.x, p.z)) continue;
      let nearest = 1;
      for (let i = 0; i < slots.length; i++)
        if (
          Math.hypot(p.x - slots[i].x, p.z - slots[i].z) <
          Math.hypot(p.x - slots[nearest].x, p.z - slots[nearest].z)
        )
          nearest = i;
      occupied.add(nearest);
      // Large bodies outside their nearest slot still cannot physically overlap a new defender.
      for (let i = 0; i < slots.length; i++)
        if (
          Math.hypot(p.x - slots[i].x, p.z - slots[i].z) <
          (GROUND_UNITS[u.key].size + (GROUND_UNITS[v.key]?.size || 0)) * 0.5
        )
          occupied.add(i);
    }
  }
  return slots.filter(
    (p, i) => !occupied.has(i) && walkable(s, p.x, p.z, GROUND_UNITS[u.key].size * 0.42),
  );
}

// A replacement reuses one of the three physical places of the former defenders.
export function persistentDefensePoint(s, u, point) {
  if (!isInfantry(u.key)) return point;
  const margin = C.postRadius + 4,
    radius = TRENCH_FOOTPRINT.queryRadius + margin;
  const positions = staticObjectsInBounds(
    s,
    'trenches',
    point.x - radius,
    point.z - radius,
    point.x + radius,
    point.z + radius,
  )
    .filter(
      (t) =>
        trenchContains(t, point.x, point.z, margin) && !trenchContested(s, t, u.side, u.id, true),
    )
    .sort(
      (a, b) =>
        Number(!allied(s, a.side, u.side)) - Number(!allied(s, b.side, u.side)) ||
        Math.hypot(a.x - point.x, a.z - point.z) - Math.hypot(b.x - point.x, b.z - point.z) ||
        a.id - b.id,
    );
  for (const t of positions) {
    const slots = availableTrenchSlots(s, u, t);
    // An existing guard remains in its slot when the same nominal post is validated again.
    const target = u.guard && trenchContains(t, u.guard.x, u.guard.z) ? u.guard : point;
    slots.sort(
      (a, b) =>
        Math.hypot(a.x - target.x, a.z - target.z) - Math.hypot(b.x - target.x, b.z - target.z) ||
        Math.hypot(a.x - t.x, a.z - t.z) - Math.hypot(b.x - t.x, b.z - t.z),
    );
    if (slots.length) return slots[0];
  }
  return positions.length ? null : point;
}
