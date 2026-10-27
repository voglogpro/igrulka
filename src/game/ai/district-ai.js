import { aiSides } from '../factions.js';
import { GROUND_UNITS } from '../config.js';
import { setDistrictRepair } from '../territory/districts.js';
import { queueAutoDefense } from '../defense/volunteers.js';
import { depotObjectives } from './depot-doctrine.js';

// Compatibility export: minimum paid capture infantry, no longer a cap on guards.
export { AI_CAPTURE_INFANTRY_MIN as AI_DISTRICT_GARRISON_LIMIT } from './depot-doctrine.js';
export function updateDistrictAI(s, side = 1) {
  if (!aiSides(s).includes(side) || s.result) return;
  const sites = depotObjectives(s, side),
    occupied = new Set();
  for (const u of s.groundUnits) {
    if (u.carrierId != null) occupied.add(u.carrierId);
    if (u.boardingId != null) occupied.add(u.boardingId);
  }
  const available = [];
  for (const u of s.groundUnits) {
    if (u.side !== side) continue;
    // Old campaigns used a separate one-man depot guard. Give those posts to
    // the shared planner, but never steal a later explicit march or guard.
    if (u.aiDistrict) {
      const legacy = sites.find((d) => d.id === u.aiDistrict),
        atLegacy =
          legacy && u.guard && Math.hypot(u.guard.x - legacy.x, u.guard.z - legacy.z) < 120;
      u.aiDistrict = null;
      if (
        atLegacy &&
        u.hp > 0 &&
        !u.downed &&
        !u.carrierId &&
        !u.boardingId &&
        !occupied.has(u.id) &&
        !u.delivery &&
        !u.supplyTrip &&
        !u.defenseTask &&
        !GROUND_UNITS[u.key]?.support
      ) {
        available.push(u);
        continue;
      }
    }
    const d = GROUND_UNITS[u.key];
    if (
      d &&
      !d.civil &&
      !d.support &&
      u.hp / u.maxHp > 0.55 &&
      !u.downed &&
      !u.autoDefense &&
      !u.defenseTask &&
      !u.carrierId &&
      !u.boardingId &&
      !occupied.has(u.id) &&
      !u.guard &&
      !u.delivery &&
      !u.supplyTrip &&
      !u.routeState &&
      !u.order &&
      !u.path?.length
    )
      available.push(u);
  }
  if (available.length) queueAutoDefense(s, available);
  for (const d of sites) {
    if (
      d.owner === side &&
      !d.blocked &&
      d.hp < d.maxHp &&
      s.sides[side].credits > 500 &&
      s.sides[side].materials > 30
    )
      setDistrictRepair(s, side, d.id, true);
  }
}
