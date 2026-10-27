import { GROUND_UNITS, isInfantry } from '../config.js';
import { allied, hostile, hqOf } from '../factions.js';
import { districtStatus, DISTRICTS } from '../territory/districts.js';
import { groundVisible } from '../units/infantry/cover.js';
import { hasOil, oilCost } from '../city/oil.js';
import { recruitmentFacility } from '../units/ground/recruitment.js';
import { purchaseQuote } from '../city/pricing.js';
import { ROAD_REQUIRED } from '../city/rules.js';
import { ROAD_REACH } from '../city/road-network.js';

export const AI_CAPTURE_INFANTRY_MIN = 3;

export function infrastructureReserve(s, side, key) {
  const quote = purchaseQuote(s, side, 'building', key);
  if (!quote) return 0;
  // Protect the small automatically attached driveway too. Actual placement
  // still computes and charges its own exact price through ordinary build().
  const driveway = ROAD_REQUIRED.has(key) ? Math.ceil(Math.max(0, ROAD_REACH - 3) * 0.8) : 0;
  return quote.cost + driveway;
}

// Derived only: the ordinary front coordinator owns destinations, capture and
// reserves. Both cooperative bots consider the depot in their own city lane.
export function depotObjectives(s, side) {
  const hq = hqOf(s, side);
  if (!hq) return [];
  return DISTRICTS.filter((d) => s.sides.length <= 2 || Math.sign(d.z) === Math.sign(hq.z))
    .map((d) => districtStatus(s, d.id))
    .filter(Boolean);
}

export const capturesDepot = (key) => isInfantry(key) && !GROUND_UNITS[key].support;

export function armyComposition(s, side) {
  const counts = new Map();
  const add = (key) => counts.set(key, (counts.get(key) || 0) + 1);
  for (const u of s.groundUnits)
    if (u.side === side && u.hp > 0 && !GROUND_UNITS[u.key]?.civil) add(u.key);
  for (const b of s.buildings)
    if (b.side === side && b.hp > 0 && !b.demolished) for (const q of b.armyQueue || []) add(q.key);
  return counts;
}

export function needsDepotInfantry(s, side = 1) {
  if (!depotObjectives(s, side).some((d) => !allied(s, d.owner, side))) return false;
  let infantry = s.groundUnits.filter(
    (u) =>
      u.side === side &&
      u.hp > 0 &&
      !u.downed &&
      !u.carrierId &&
      !u.boardingId &&
      capturesDepot(u.key) &&
      (u.autoDefense || (!u.guard && !u.order && !u.path?.length)),
  ).length;
  for (const b of s.buildings)
    if (b.side === side && b.hp > 0 && !b.demolished)
      infantry += (b.armyQueue || []).filter((q) => capturesDepot(q.key)).length;
  return infantry < AI_CAPTURE_INFANTRY_MIN;
}

export function observedArmor(s, side) {
  return s.groundUnits.some(
    (u) =>
      hostile(s, u.side, side) &&
      u.hp > 0 &&
      !u.carrierId &&
      GROUND_UNITS[u.key]?.groundArmor &&
      groundVisible(s, side, u),
  );
}

// Costs, oil, paid queues and training times are untouched. Fill a cheap mixed
// core before buying rare heavy vehicles; count queued units to avoid spam.
export function chooseArmyRecruit(
  s,
  side,
  facilities,
  { reserve = 250, ignoreMoney = false } = {},
) {
  const slots = new Map();
  for (const b of s.buildings)
    if (b.side === side && b.hp > 0 && b.progress >= 1 && !b.demolished)
      slots.set(b.key, (slots.get(b.key) || 0) + Math.max(0, 8 - (b.armyQueue?.length || 0)));
  const counts = armyComposition(s, side),
    count = (...keys) => keys.reduce((sum, key) => sum + (counts.get(key) || 0), 0),
    total = [...counts.values()].reduce((sum, value) => sum + value, 0),
    armor = observedArmor(s, side),
    f = s.sides[side],
    affordable = (key) => {
      const d = GROUND_UNITS[key];
      return (
        facilities.has(recruitmentFacility(key)) &&
        slots.get(recruitmentFacility(key)) > 0 &&
        (ignoreMoney || f.credits >= d.cost + reserve) &&
        f.materials >= d.metal &&
        hasOil(s, side, oilCost(key))
      );
    };
  if (facilities.has('barracks') && needsDepotInfantry(s, side))
    return affordable('infantry') ? 'infantry' : null;
  const goals = [
    {
      keys: ['infantry', 'assault'],
      target: Math.max(AI_CAPTURE_INFANTRY_MIN, Math.ceil(total / 3)),
      buy: 'infantry',
    },
    {
      keys: ['atrifle', 'atgm', 'operator', 'tankdestroyer'],
      target: Math.max(1, Math.ceil(total / (armor ? 6 : 12))),
      buy: facilities.has('barracks') ? (armor ? 'atgm' : 'atrifle') : 'tankdestroyer',
    },
    { keys: ['machinegunner'], target: Math.max(1, Math.floor(total / 10)), buy: 'machinegunner' },
    {
      keys: ['mog', 'shilka', 'gepard'],
      target: Math.max(1, Math.floor(total / 12)),
      buy: facilities.has('barracks') ? 'mog' : 'gepard',
    },
    {
      keys: ['sniper', 'armoredcar'],
      target: Math.max(1, Math.floor(total / 16)),
      buy: facilities.has('barracks') ? 'sniper' : 'armoredcar',
    },
    { keys: ['engineer'], target: Math.max(1, Math.floor(total / 15)), buy: 'engineer' },
    {
      keys: ['armoredcar', 'lighttank', 'ifv', 'leopard', 'heavytank'],
      target: Math.max(1, Math.floor(total / 8)),
      buy: count('armoredcar') ? (count('lighttank') ? 'leopard' : 'lighttank') : 'armoredcar',
    },
    { keys: ['medic'], target: total >= 8 ? Math.max(1, Math.floor(total / 18)) : 0, buy: 'medic' },
    {
      keys: ['supplytruck'],
      target: total >= 12 && facilities.has('ammofactory') ? 1 : 0,
      buy: 'supplytruck',
    },
    {
      keys: ['howitzer', 'mlrs'],
      target: total >= 24 ? Math.floor(total / 24) : 0,
      buy: 'howitzer',
    },
  ];
  return (
    goals.find((goal) => count(...goal.keys) < goal.target && affordable(goal.buy))?.buy ||
    (affordable('infantry') ? 'infantry' : affordable('armoredcar') ? 'armoredcar' : null)
  );
}

export function armyProductionReserve(s, side, facilities) {
  const key = chooseArmyRecruit(s, side, facilities, { ignoreMoney: true });
  return key ? Math.min(700, 250 + GROUND_UNITS[key].cost) : 0;
}
