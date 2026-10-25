import { SETTLEMENTS, settlementHomeSide, settlementStatus } from '../territory/settlements.js';
import { nearestRoad } from '../city/road-network.js';
import { buildRoad } from '../city/roads.js';
import { hqOf } from '../factions.js';

// Paid, bounded extension from the city's actual connected network. Villages need roads,
// not an AI infantry garrison; each four-city bot plans only its own two villages.
export function settlementRoadPlan(s, side) {
  const hq = hqOf(s, side);
  if (!hq || s.sides[side].credits < 800) return false;
  const choices = SETTLEMENTS.filter(
    (d) => settlementHomeSide(s, d) === side && !settlementStatus(s, d.id)?.active,
  ).sort((a, b) => Math.hypot(a.x - hq.x, a.z - hq.z) - Math.hypot(b.x - hq.x, b.z - hq.z));
  for (const site of choices) {
    const near = nearestRoad(s, side, site.x, site.z, { connected: true });
    if (!near) continue;
    const dx = site.x - near.x,
      dz = site.z - near.z,
      length = Math.hypot(dx, dz);
    if (length <= 30) continue;
    const span = Math.min(180, length - 20);
    for (const offset of [0, 45, -45, 90, -90]) {
      const x = near.x + (dx / length) * span - (dz / length) * offset;
      const z = near.z + (dz / length) * span + (dx / length) * offset;
      if (typeof buildRoad(s, side, near.x, near.z, x, z) !== 'string') return true;
    }
  }
  return false;
}
