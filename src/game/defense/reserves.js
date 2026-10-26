import { GROUND_UNITS, isInfantry } from '../config.js';
import { event } from '../shared/events.js';
import { FRONTLINE as C } from './config.js';
import { defenseAvailable, assignDefensePost, occupiedDefenseCarriers } from './formation.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export function updateDefenseReserves(s, side, own, report, memory) {
  for (const u of own) {
    if (u.supplyTrip) continue;
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
      .sort((a, b) => distance(a, u.guard) - distance(b, u.guard))[0];
    if (
      !u.autoDefense ||
      task.until <= s.time ||
      (s.time - task.assignedAt >= C.minDuty && (local?.pressure || 0) < 0.7)
    ) {
      if (assignDefensePost(s, u, task.home) || assignDefensePost(s, u, task.home, true)) {
        task.home = { ...u.guard };
        task.returning = true;
      }
    }
  }
  if ((memory.nextReinforce || 0) > s.time) return;
  const occupiedCarriers = occupiedDefenseCarriers(s);
  const volunteers = own.filter((u) => defenseAvailable(s, u, occupiedCarriers));
  const active = own.filter((u) => u.defenseTask).length;
  const limit = Math.min(C.maxReinforcing, Math.floor(volunteers.length * C.reserveShare));
  if (active >= limit) return;
  const threatened = report.posts
    .filter(
      (p) => p.pressure >= C.pressureThreshold && (p.enemy > 0 || p.knowledge === 'estimated'),
    )
    .sort((a, b) => b.pressure - a.pressure || b.armor - a.armor || a.z - b.z);
  let attempts = 0;
  for (const target of threatened) {
    const candidates = volunteers
      .filter(
        (u) =>
          !u.defenseTask &&
          !u.defenseCapture &&
          GROUND_UNITS[u.key].groundRange > 0 &&
          u.defensePost?.row > 0 &&
          (u.defenseReadyAt || 0) <= s.time &&
          u.hp / u.maxHp >= 0.45 &&
          (u.suppression || 0) < 0.45 &&
          !u.guardTargetId &&
          u.defensePost.corridorId === target.corridorId &&
          distance(u, target) <= C.maxTransferDistance,
      )
      .sort((a, b) => {
        const role = (u) =>
          target.armor > 0 &&
          (['antiArmor', 'antiTankRifle'].includes(GROUND_UNITS[u.key].groundWeapon) ||
            !isInfantry(u.key))
            ? 0
            : 1;
        return role(a) - role(b) || distance(a, target) - distance(b, target) || a.id - b.id;
      });
    for (const u of candidates) {
      if (attempts++ >= C.maxPathAttempts) return;
      // Returning details leave holes in their old ranks. Counting active units would
      // reuse an occupied high rank; explicitly reserve the first free physical slot.
      const point = Array.from({ length: C.maxReinforcing }, (_, rank) => ({
        x:
          target.x -
          (side % 2 === 0 ? 1 : -1) *
            (18 + Math.floor(rank / 2) * 20 + (isInfantry(u.key) ? 0 : 40)),
        z: target.z + (rank % 2 ? 12 : -12),
      })).find((candidate) =>
        own.every((v) => {
          if (v.id === u.id) return true;
          const clearance = (GROUND_UNITS[u.key].size + GROUND_UNITS[v.key].size) * 0.5 + 7;
          return [v.guard, v.defenseTask?.home]
            .filter(Boolean)
            .every((post) => distance(candidate, post) >= clearance - 1e-6);
        }),
      );
      if (!point) continue;
      const home = { ...u.guard };
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
