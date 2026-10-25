import { allied, hqOf } from '../factions.js';
import { FIELD, SEA, riverDistance, seaDistance } from '../map.js';
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
      district &&
      s.districts?.some((d) => d.id === district.id && allied(s, d.owner, side) && d.hp > 0);
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
      points: [
        { x, z: sign * shore },
        { x, z: sign * edge },
      ],
      slots,
    };
  });
}

export function defensePostPoint(lines, reference, direction) {
  const line = lines.find((v) => v.id === reference?.corridorId);
  const slot = line?.slots[reference?.slot];
  if (!slot) return null;
  const row = reference.row;
  return {
    x: slot.x - direction * (row === 0 ? 0 : C.supportOffset + (row - 1) * C.rowSpacing),
    z: slot.z,
  };
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
