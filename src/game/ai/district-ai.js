import { allied, hqOf } from '../factions.js';
import { isInfantry, GROUND_UNITS } from '../config.js';
import {
  DISTRICTS,
  captureDistrict,
  setDistrictRepair,
  districtStatus,
} from '../territory/districts.js';
import { commandUnits } from '../units/ground/orders.js';

// A small garrison budget leaves most of the army available for its original city attack.
export const AI_DISTRICT_GARRISON_LIMIT = 3;
export function updateDistrictAI(s, side = 1) {
  if (s.mode === 'multiplayer' || s.result) return;
  for (const u of s.groundUnits) {
    if (u.side !== side || !u.aiDistrict) continue;
    if (!u.guard || u.hp <= 0) {
      u.aiDistrict = null;
      continue;
    }
    if (u.hp / u.maxHp < 0.3) {
      commandUnits(s, side, [u.id], 'retreat');
      u.aiDistrict = null;
    }
  }
  const assigned = s.groundUnits.filter(
    (u) => u.side === side && u.hp > 0 && u.aiDistrict && u.guard,
  );
  const candidates = s.groundUnits.filter(
    (u) =>
      u.side === side &&
      u.hp / u.maxHp > 0.55 &&
      isInfantry(u.key) &&
      !GROUND_UNITS[u.key].support &&
      !u.downed &&
      u.key !== 'atgm' &&
      !u.aiDefender &&
      !u.carrierId &&
      !u.boardingId &&
      !u.guard &&
      !u.delivery &&
      !u.routeState &&
      u.order?.mode !== 'retreat',
  );
  let remaining = AI_DISTRICT_GARRISON_LIMIT - assigned.length;
  const reserved = new Set(assigned.map((u) => u.aiDistrict));
  for (const u of candidates) {
    if (remaining <= 0) break;
    const choices = DISTRICTS.filter(
      (d) =>
        !reserved.has(d.id) &&
        !allied(s, s.districts?.find((site) => site.id === d.id)?.owner, side) &&
        (s.sides.length <= 2 || Math.sign(d.z) === Math.sign(hqOf(s, side).z)),
    ).sort((a, b) => Math.hypot(a.x - u.x, a.z - u.z) - Math.hypot(b.x - u.x, b.z - u.z));
    for (const target of choices) {
      if (typeof captureDistrict(s, side, [u.id], target.id) !== 'number') continue;
      u.aiDistrict = target.id;
      reserved.add(target.id);
      remaining--;
      break;
    }
  }
  for (const raw of s.districts || []) {
    const d = districtStatus(s, raw.id);
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
