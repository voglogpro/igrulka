import { BUILDINGS, GROUND_UNITS, isInfantry } from '../../config.js';
import { CORRIDORS } from '../../map.js';
import { hqOf, hostile, pairedEnemy, validSide } from '../../factions.js';
import { groundFormationDestinations, orderGround } from './orders.js';
import { walkable } from './navigation.js';

export const DEFENSE_ATTACK_PERCENT = 30;
const enemyHQ = (s, side) => {
  const paired = hqOf(s, pairedEnemy(s, side));
  return paired?.hp > 0
    ? paired
    : s.buildings.find((b) => b.key === 'hq' && b.hp > 0 && hostile(s, side, b.side));
};
function attackPlan(s, side) {
  if (!validSide(s, side)) return { total: 0, eligible: 0, count: 0, groups: [] };
  const fronts =
    s.sides.length > 2 ? [hqOf(s, side)?.z < 0 ? 'north' : 'south'] : ['north', 'south'];
  const buckets = fronts.map((id) => ({ id, units: [], take: 0 })),
    waiting = [];
  let total = 0;
  for (const u of s.groundUnits) {
    if (
      u.side !== side ||
      u.hp <= 0 ||
      !u.autoDefense ||
      !isInfantry(u.key) ||
      u.key === 'mog' ||
      u.civil ||
      GROUND_UNITS[u.key].support
    )
      continue;
    total++;
    if (
      u.downed ||
      u.carrierId ||
      u.boardingId ||
      u.delivery ||
      u.supplyTrip ||
      u.defenseTask ||
      u.defenseCapture ||
      u.routeState ||
      u.holdFire ||
      u.hp / u.maxHp < 0.45 ||
      (!u.guard && (u.order || u.path?.length || u.stance?.mode !== 'defend'))
    )
      continue;
    const front =
      u.defensePost?.corridorId || (u.guard ? (u.guard.z < 0 ? 'north' : 'south') : null);
    const bucket = buckets.find((b) => b.id === front);
    if (bucket) bucket.units.push(u);
    else waiting.push(u);
  }
  for (const u of waiting) {
    const bucket = buckets.reduce((best, b) => (b.units.length < best.units.length ? b : best));
    bucket.units.push(u);
  }
  const eligible = buckets.reduce((n, b) => n + b.units.length, 0);
  // Keep at least one available defender in every occupied direction.
  const capacity = buckets.reduce((n, b) => n + Math.max(0, b.units.length - 1), 0);
  const count = Math.min(capacity, Math.max(eligible ? 1 : 0, Math.floor(eligible * 0.3)));
  for (const b of buckets)
    b.take = Math.min(Math.max(0, b.units.length - 1), Math.floor(b.units.length * 0.3));
  let remaining = count - buckets.reduce((n, b) => n + b.take, 0);
  for (const b of [...buckets].sort(
    (a, b) =>
      b.units.length * 0.3 - b.take - (a.units.length * 0.3 - a.take) || a.id.localeCompare(b.id),
  )) {
    if (remaining > 0 && b.take < b.units.length - 1) {
      b.take++;
      remaining--;
    }
  }
  const groups = buckets.map((b) => ({
    id: b.id,
    units: b.units
      .sort(
        (a, b) =>
          Number(!!a.guardTargetId) - Number(!!b.guardTargetId) ||
          (b.defensePost?.row || 0) - (a.defensePost?.row || 0) ||
          a.id - b.id,
      )
      .slice(0, b.take),
  }));
  return { total, eligible, count, groups };
}

export function defenseAttackStatus(s, side) {
  const plan = attackPlan(s, side);
  const reason = s.result
    ? 'Кампания завершена'
    : !validSide(s, side)
      ? 'Неизвестная сторона'
      : !enemyHQ(s, side)
        ? 'Нет вражеского штаба'
        : !plan.count
          ? 'Нужны свободные бойцы обороны; на каждом направлении остаётся защитник'
          : '';
  return {
    total: plan.total,
    eligible: plan.eligible,
    count: reason ? 0 : plan.count,
    reason,
    ok: !reason,
  };
}

function approach(s, u, nominal, hq, direction) {
  const radius = GROUND_UNITS[u.key].size * 0.42;
  const reach = Math.max(
    (BUILDINGS.hq?.size || 30) * 0.56 + 8,
    GROUND_UNITS[u.key].groundRange - 8,
  );
  const dx = nominal.x - hq.x,
    dz = nominal.z - hq.z,
    length = Math.hypot(dx, dz) || 1;
  const point =
    length > reach ? { x: hq.x + (dx * reach) / length, z: hq.z + (dz * reach) / length } : nominal;
  if (walkable(s, point.x, point.z, radius)) return point;
  const distance = Math.min(reach, (BUILDINGS.hq?.size || 30) * 0.56 + 22);
  for (const turn of [0, 0.5, -0.5, 1, -1, 1.5, -1.5, Math.PI]) {
    const p = {
      x: hq.x - direction * Math.cos(turn) * distance,
      z: hq.z + Math.sin(turn) * distance,
    };
    if (walkable(s, p.x, p.z, radius)) return p;
  }
  return null;
}

export function launchDefenseAttack(s, side) {
  const status = defenseAttackStatus(s, side);
  if (!status.ok) return status.reason;
  const plan = attackPlan(s, side),
    hq = enemyHQ(s, side),
    direction = side % 2 ? -1 : 1;
  let accepted = 0;
  for (const group of plan.groups) {
    const wanted = new Set(group.units.map((u) => u.id));
    const units = s.groundUnits.filter((u) => wanted.has(u.id));
    if (!units.length) continue;
    const goals = groundFormationDestinations(s, side, units, {
      x: hq.x - direction * ((BUILDINGS.hq?.size || 30) * 0.56 + 22),
      z: hq.z,
    }).map((point, i) => approach(s, units[i], point, hq, direction));
    const goalsById = new Map(units.map((u, i) => [u.id, goals[i]]).filter(([, goal]) => goal));
    const previous = new Map(units.map((u) => [u.id, u.order]));
    // A real corridor leg forces both waves to use their own land crossing.
    // Batch admission is linear; the planner builds at most two paths per step.
    const result = orderGround(
      s,
      side,
      [...goalsById.keys()],
      {
        x: direction * 650,
        z: CORRIDORS[group.id === 'north' ? 0 : 1],
        mode: 'attackmove',
      },
      { defer: true },
    );
    if (typeof result !== 'number') continue;
    for (const u of units) {
      if (u.order === previous.get(u.id) || !goalsById.has(u.id)) continue;
      u.stance = { mode: 'attack' };
      u.routeQueue = [{ ...goalsById.get(u.id), mode: 'attackmove' }];
      accepted++;
    }
  }
  return accepted || 'Нет доступного подхода к вражескому городу';
}
