import { BUILDINGS, GROUND_UNITS, isInfantry } from '../../config.js';
import { CORRIDORS } from '../../map.js';
import { hqOf, hostile, pairedEnemy, validSide } from '../../factions.js';
import { groundFormationDestinations, orderGround } from './orders.js';
import { groundVisible } from '../infantry/cover.js';
import { clearGroundRoute } from './route-queue.js';
import { walkable } from './navigation.js';

export const DEFENSE_ATTACK_PERCENT = 30;
const enemyHQ = (s, side) => {
  const paired = hqOf(s, pairedEnemy(s, side));
  return paired?.hp > 0
    ? paired
    : s.buildings.find((b) => b.key === 'hq' && b.hp > 0 && hostile(s, side, b.side));
};
function attackPlan(s, side) {
  if (!validSide(s, side))
    return { total: 0, eligible: 0, count: 0, groups: [], active: 0, returning: 0, initial: 0 };
  const fronts =
    s.sides.length > 2 ? [hqOf(s, side)?.z < 0 ? 'north' : 'south'] : ['north', 'south'];
  const buckets = fronts.map((id) => ({ id, units: [], take: 0 })),
    waiting = [];
  const waves = new Map();
  let total = 0,
    active = 0,
    returning = 0;
  for (const u of s.groundUnits) {
    if (u.side !== side || u.hp <= 0) continue;
    if (u.defenseAttack) {
      if (u.defenseAttack.phase === 'active') active++;
      else if (u.defenseAttack.phase === 'returning') returning++;
      waves.set(
        u.defenseAttack.wave,
        Math.max(waves.get(u.defenseAttack.wave) || 0, u.defenseAttack.initial || 0),
      );
    }
    if (
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
  const initial = [...waves.values()].reduce((sum, n) => sum + n, 0);
  return { total, eligible, count, groups, active, returning, initial };
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
    active: plan.active,
    returning: plan.returning,
    initial: plan.initial,
    reason,
    ok: !reason,
  };
}

function approach(s, u, nominal, hq, direction) {
  const radius = GROUND_UNITS[u.key].size * 0.42;
  const reach = Math.max(
    (BUILDINGS[hq.key]?.size || 30) * 0.56 + 8,
    GROUND_UNITS[u.key].groundRange - 8,
  );
  const dx = nominal.x - hq.x,
    dz = nominal.z - hq.z,
    length = Math.hypot(dx, dz) || 1;
  const point =
    length > reach ? { x: hq.x + (dx * reach) / length, z: hq.z + (dz * reach) / length } : nominal;
  if (walkable(s, point.x, point.z, radius)) return point;
  const distance = Math.min(reach, (BUILDINGS[hq.key]?.size || 30) * 0.56 + 22);
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
  const wave = s.nextId++;
  const homes = new Map(
    plan.groups.flatMap((g) =>
      g.units.map((u) => [u.id, { x: u.guard?.x ?? u.x, z: u.guard?.z ?? u.z }]),
    ),
  );
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
      u.defenseAttack = {
        phase: 'active',
        home: homes.get(u.id),
        initial: plan.count,
        wave,
        nextAt: s.time + 3,
      };
      u.stance = { mode: 'attack' };
      u.routeQueue = [{ ...goalsById.get(u.id), mode: 'attackmove' }];
      accepted++;
    }
  }
  return accepted || 'Нет доступного подхода к вражескому городу';
}

// Recruit rally attacks share the same continuing mission, while precise
// player point/target orders keep their existing manual cancellation rules.
export function enrollCityAssault(s, u) {
  if (!GROUND_UNITS[u.key] || GROUND_UNITS[u.key].support || u.civil || u.hp <= 0 || u.downed)
    return false;
  const hq = hqOf(s, u.side);
  if (!hq || u.stance?.mode !== 'attack') return false;
  u.defenseAttack = {
    phase: 'active',
    home: {
      x: u.side % 2 ? 300 : -300,
      z:
        s.sides.length > 2
          ? hq.z < 0
            ? CORRIDORS[0]
            : CORRIDORS[1]
          : u.z < 0
            ? CORRIDORS[0]
            : CORRIDORS[1],
    },
    initial: 1,
    wave: s.nextId++,
    nextAt: s.time + 3,
  };
  return true;
}

// Operation routes use the shared two-path planner; commands never run A*.
export function recallDefenseAttack(s, side) {
  if (s.result || !validSide(s, side)) return 'Недоступный отзыв';
  let count = 0;
  for (const u of s.groundUnits) {
    if (u.side !== side || u.hp <= 0 || !u.defenseAttack) continue;
    const op = u.defenseAttack;
    op.phase = 'returning';
    op.nextAt = s.time;
    delete u.supplyTrip;
    clearGroundRoute(u);
    u.path = [];
    u.order = { ...op.home, mode: 'retreat' };
    u.routeState = { status: 'moving', retryAt: s.time };
    u.stance = null;
    count++;
  }
  return count || 'Нет бойцов для отзыва';
}

export function updateDefenseAttacks(s) {
  if (s.result) return;
  // Buildings are public map objects; concealed infantry must pass observation.
  const targets = s.buildings.filter((b) => b.hp > 0 && !b.demolished);
  let retargetBudget = 2;
  for (const u of s.groundUnits) {
    const op = u.defenseAttack;
    if (!op || u.hp <= 0 || u.downed || u.carrierId || u.supplyTrip || op.nextAt > s.time) continue;
    op.nextAt = s.time + 3 + (u.id % 7) * 0.1;
    if (op.phase === 'returning') {
      if (Math.hypot(u.x - op.home.x, u.z - op.home.z) < 12) {
        clearGroundRoute(u);
        u.order = null;
        u.path = [];
        u.guard = { ...op.home };
        u.autoDefense = true;
        u.stance = { mode: 'defend' };
        delete u.defenseAttack;
      }
      continue;
    }
    if (
      u.path?.length ||
      u.routeQueue?.length ||
      (u.routeState && u.routeState.status !== 'blocked')
    )
      continue;
    if (retargetBudget-- <= 0) {
      op.nextAt = s.time;
      continue;
    }
    let target = null,
      best = Infinity;
    for (const b of targets) {
      if (!hostile(s, u.side, b.side) || !groundVisible(s, u.side, b)) continue;
      if (u.routeState?.status === 'blocked' && u.order?.targetId === b.id) continue;
      const score = Math.hypot(u.x - b.x, u.z - b.z);
      if (score < best) {
        target = b;
        best = score;
      }
    }
    if (!target) continue;
    const direction = u.x < target.x ? 1 : -1;
    const goal = approach(s, u, u, target, direction);
    if (!goal) continue;
    const saved = u.defenseAttack;
    if (
      typeof orderGround(
        s,
        u.side,
        [u.id],
        { ...goal, mode: 'attackmove', targetId: target.id },
        { defer: true },
      ) === 'number'
    ) {
      u.defenseAttack = saved;
      u.stance = { mode: 'attack' };
    }
  }
}
