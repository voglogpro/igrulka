import { GROUND_UNITS, isInfantry } from '../config.js';
import { allied, hostile } from '../factions.js';
import { staticObjectsInBounds } from '../shared/static-spatial.js';
import { walkable } from '../units/ground/navigation.js';
import { FORTIFICATION as C, FRONTLINE } from './config.js';

export function trenchContested(s, t, side, exceptId = null, observedOnly = false) {
  // Remote planning uses only the owner's already observed coordinates. It
  // must not learn that a concealed soldier moved into an otherwise empty
  // trench. The physical capture interaction checks actual occupancy on arrival.
  if (observedOnly)
    return (s.frontlineMemory?.[side]?.seen || []).some(
      (v) =>
        s.time - v.time <= FRONTLINE.memorySeconds &&
        Math.hypot(v.x - t.x, v.z - t.z) < C.coverRadius,
    );
  return s.groundUnits.some(
    (v) =>
      v.id !== exceptId &&
      v.hp > 0 &&
      !v.carrierId &&
      !v.downed &&
      hostile(s, v.side, side) &&
      Math.hypot(v.x - t.x, v.z - t.z) < C.coverRadius,
  );
}

// A replacement reuses the physical position of the former defender, including
// the last few metres between its nominal post and the point where it dug in.
export function persistentDefensePoint(s, u, point) {
  if (!isInfantry(u.key)) return point;
  const radius = C.postRadius + 4;
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
        Math.hypot(t.x - point.x, t.z - point.z) <= radius &&
        !trenchContested(s, t, u.side, u.id, true) &&
        walkable(s, t.x, t.z, GROUND_UNITS[u.key].size * 0.42) &&
        !s.groundUnits.some(
          (v) =>
            v.id !== u.id &&
            v.side === u.side &&
            v.hp > 0 &&
            [v.guard, v.defenseTask?.home].some(
              (p) =>
                p &&
                Math.hypot(p.x - t.x, p.z - t.z) <
                  (GROUND_UNITS[u.key].size + GROUND_UNITS[v.key].size) * 0.5 + 7 - 1e-6,
            ),
        ),
    )
    .sort(
      (a, b) =>
        Number(!allied(s, a.side, u.side)) - Number(!allied(s, b.side, u.side)) ||
        Math.hypot(a.x - point.x, a.z - point.z) - Math.hypot(b.x - point.x, b.z - point.z) ||
        a.id - b.id,
    );
  return positions.length ? { x: positions[0].x, z: positions[0].z } : point;
}
