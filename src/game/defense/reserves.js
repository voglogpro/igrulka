import { GROUND_UNITS } from '../config.js';
import { groundWeaponProfile } from '../units/ground/engagement.js';
import { event } from '../shared/events.js';
import { FRONTLINE as C } from './config.js';
import { defenseAvailable, assignDefensePost, occupiedDefenseCarriers } from './formation.js';
import { corridorGeometry, defensePostPoint } from './geometry.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
function interceptPoint(u, target, rank = 0) {
  const d = GROUND_UNITS[u.key],
    dx = u.x - target.x,
    dz = u.z - target.z,
    length = Math.hypot(dx, dz),
    nx = length > 1e-6 ? dx / length : u.side % 2 === 0 ? -1 : 1,
    nz = length > 1e-6 ? dz / length : 0,
    stand =
      u.key === 'operator'
        ? 185
        : Math.max((d.groundMinRange || 0) + 25, Math.min(90, (d.groundRange || 80) * 0.45)),
    along = stand + Math.floor(rank / 2) * 20,
    across = rank % 2 ? 12 : -12;
  return { x: target.x + nx * along - nz * across, z: target.z + nz * along + nx * across };
}
function freeIntercept(own, u, target) {
  return Array.from({ length: C.maxReinforcing }, (_, rank) =>
    interceptPoint(u, target, rank),
  ).find((point) =>
    own.every((v) => {
      if (v.id === u.id) return true;
      const clearance = (GROUND_UNITS[u.key].size + GROUND_UNITS[v.key].size) * 0.5 + 7;
      return [v.guard, v.defenseTask?.home, v.defenseMission?.home]
        .filter(Boolean)
        .every((post) => distance(point, post) >= clearance - 1e-6);
    }),
  );
}
export function updateDefenseReserves(s, side, own, report, memory) {
  let following = 0;
  const direction = side % 2 === 0 ? 1 : -1,
    lines = corridorGeometry(s, side);
  for (const u of own) {
    if (u.supplyTrip || u.order?.mode === 'cover') continue;
    const task = u.defenseTask;
    if (!task) continue;
    if (!u.guard || u.boardingId || u.delivery || u.routeState) {
      u.defenseTask = null;
      u.autoDefense = false;
      continue;
    }
    if (task.returning) {
      if (!u.path?.length && distance(u, task.home) <= 4) {
        u.defenseTask = null;
        u.defenseReadyAt = s.time + C.cooldown;
        event(s, 'defenseReturned', {
          x: u.x,
          z: u.z,
          side,
          unitId: u.id,
          sectorId: task.sectorId,
        });
      }
      continue;
    }
    const local = report.posts
      .filter((p) => p.corridorId === task.sectorId)
      .sort(
        (a, b) =>
          (b.breakthrough || 0) - (a.breakthrough || 0) ||
          distance(a, u.guard) - distance(b, u.guard),
      )[0];
    const currentThreat = local?.threatPoint;
    const fresh =
      currentThreat && memory.seen.some((v) => v.id === currentThreat.id && s.time - v.time < 8);
    if (fresh && local.breakthrough > 0) {
      task.until = Math.max(task.until, s.time + C.minDuty);
      // A breach is a moving target. Follow its last observed position instead
      // of waiting forever at the first interception marker behind the line.
      const toward = freeIntercept(own, u, currentThreat);
      if (
        toward &&
        following < 2 &&
        distance(u.guard, toward) > 65 &&
        assignDefensePost(s, u, toward)
      )
        following++;
    }
    if (
      !u.autoDefense ||
      task.until <= s.time ||
      (s.time - task.assignedAt >= C.minDuty &&
        (local?.pressure || 0) < 0.7 &&
        !(local?.breakthrough > 0))
    ) {
      const home = u.defensePost
        ? defensePostPoint(lines, u.defensePost, direction) || task.home
        : task.home;
      if (assignDefensePost(s, u, home) || assignDefensePost(s, u, home, true)) {
        task.home = { ...u.guard };
        task.returning = true;
      }
    }
  }
  if ((memory.nextReinforce || 0) > s.time) return;
  const occupiedCarriers = occupiedDefenseCarriers(s);
  const volunteers = own.filter((u) => defenseAvailable(s, u, occupiedCarriers));
  const volunteerIds = new Set(volunteers.map((u) => u.id));
  const donorCounts = new Map(),
    lineCounts = new Map(),
    sectorById = new Map(report.sectors.map((v) => [v.id, v]));
  for (const u of own) {
    if (!u.autoDefense || !u.defensePost) continue;
    const id = u.defensePost.corridorId;
    if (!lineCounts.has(id)) lineCounts.set(id, { total: 0, ready: 0 });
    const count = lineCounts.get(id);
    count.total++;
    if (!u.defenseTask && !u.defenseCapture && volunteerIds.has(u.id)) count.ready++;
  }
  for (const u of own) {
    if (!u.autoDefense || !(u.defensePost?.row > 0) || u.defenseCapture) continue;
    const id = u.defensePost.corridorId;
    if (!donorCounts.has(id)) donorCounts.set(id, { total: 0, idle: 0 });
    const counts = donorCounts.get(id);
    counts.total++;
    if (!u.defenseTask && volunteerIds.has(u.id)) counts.idle++;
  }
  const active = own.filter((u) => u.defenseTask).length;
  const limit = Math.min(C.maxReinforcing, Math.floor(volunteers.length * C.reserveShare));
  if (active >= limit) return;
  const threatened = report.posts
    .filter(
      (p) =>
        (p.pressure >= C.pressureThreshold || p.breakthrough > 0 || !p.reserved) &&
        (p.enemy > 0 || p.knowledge === 'estimated'),
    )
    .sort(
      (a, b) =>
        (b.breakthrough || 0) - (a.breakthrough || 0) ||
        b.pressure - a.pressure ||
        b.armor - a.armor ||
        a.z - b.z,
    );
  let attempts = 0;
  for (const target of threatened) {
    const intercept = target.threatPoint || target;
    const unposted = (u) => !u.defensePost && u.stance?.mode === 'defend';
    const crossAvailable = (u) => {
      if (unposted(u)) return true;
      if (u.defensePost.corridorId === target.corridorId) return true;
      const donor = sectorById.get(u.defensePost.corridorId);
      if (!donor || donor.enemy > 0 || donor.contacts > 0 || donor.pressure >= 0.7) return false;
      const rear = donorCounts.get(donor.id);
      return (
        rear && rear.idle > Math.max(C.donorMinimum, Math.ceil(rear.total * (1 - C.donorShare)))
      );
    };
    const candidates = volunteers
      .filter(
        (u) =>
          !u.defenseTask &&
          !u.defenseCapture &&
          (GROUND_UNITS[u.key].groundRange > 0 || (u.key === 'operator' && u.fpvAmmo > 0)) &&
          (u.defensePost?.row >= 4 ||
            unposted(u) ||
            (target.breakthrough > 0 &&
              u.defensePost &&
              lineCounts.get(u.defensePost.corridorId)?.ready >
                Math.max(2, Math.ceil(lineCounts.get(u.defensePost.corridorId).total * 0.5)))) &&
          (u.defenseReadyAt || 0) <= s.time &&
          u.hp / u.maxHp >= 0.45 &&
          (u.suppression || 0) < 0.45 &&
          !u.guardTargetId &&
          !u.enemyId &&
          crossAvailable(u) &&
          distance(u, intercept) <=
            (unposted(u)
              ? C.rearTransferDistance
              : u.defensePost.corridorId !== target.corridorId
                ? C.crossTransferDistance
                : target.breakthrough > 0
                  ? C.rearTransferDistance
                  : C.maxTransferDistance),
      )
      .sort((a, b) => {
        const role = (u) => {
          if (!(target.armor > 0)) return GROUND_UNITS[u.key].indirect ? 2 : 1;
          const weapon = groundWeaponProfile(u.key).id;
          if (weapon === 'antiArmor' || (u.key === 'operator' && u.fpvAmmo > 0)) return 0;
          if (weapon === 'cannon' || weapon === 'antiTankRifle') return 1;
          return GROUND_UNITS[u.key].indirect ? 2 : 4;
        };
        return (
          distance(a, intercept) / Math.max(1, GROUND_UNITS[a.key].speed) +
            role(a) * 20 -
            distance(b, intercept) / Math.max(1, GROUND_UNITS[b.key].speed) -
            role(b) * 20 ||
          Number(unposted(a)) - Number(unposted(b)) ||
          Number(a.defensePost?.corridorId !== target.corridorId) -
            Number(b.defensePost?.corridorId !== target.corridorId) ||
          distance(a, intercept) - distance(b, intercept) ||
          a.id - b.id
        );
      });
    for (const u of candidates) {
      if (attempts++ >= C.maxPathAttempts) return;
      // Returning details leave holes in their old ranks. Counting active units would
      // reuse an occupied high rank; explicitly reserve the first free physical slot.
      const point = freeIntercept(own, u, intercept);
      if (!point) continue;
      const home = u.guard ? { ...u.guard } : { x: u.x, z: u.z };
      if (!assignDefensePost(s, u, point)) continue;
      let travel = 0,
        previous = u;
      for (const p of u.path) {
        travel += distance(previous, p);
        previous = p;
      }
      u.defenseTask = {
        sectorId: target.corridorId,
        home,
        assignedAt: s.time,
        until: s.time + C.maxDuty + travel / Math.max(1, GROUND_UNITS[u.key].speed * 0.8),
        returning: false,
      };
      memory.nextReinforce = s.time + C.reinforcementCadence;
      event(s, 'defenseRedeployed', {
        x: u.x,
        z: u.z,
        side,
        unitId: u.id,
        sectorId: target.corridorId,
      });
      return;
    }
  }
}
