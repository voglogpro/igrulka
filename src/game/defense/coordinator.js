import { GROUND_UNITS, isInfantry } from '../config.js';
import { event } from '../shared/events.js';
import { assignGuardPost } from '../units/ground/guard.js';
import { FRONTLINE as C, sectorAt } from './config.js';
import {
  createFrontlineMemory,
  observedFrontline,
  calculateFrontline,
  cacheFrontline,
  military,
} from './frontline.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
function post(s, u, point, snap) {
  const stance = u.stance ?? null;
  if (!assignGuardPost(s, u, point, snap, { preserveDefense: true })) return false;
  u.stance = stance;
  return true;
}
function returnToPost(s, u) {
  const task = u.defenseTask;
  if (post(s, u, task.home, false) || post(s, u, task.home, true)) {
    task.home = { ...u.guard };
    task.returning = true;
  }
}
function eligibleReserve(s, u) {
  return (
    u.autoDefense &&
    !u.defenseTask &&
    military(u) &&
    u.guard &&
    !u.boardingId &&
    !u.delivery &&
    !u.routeState &&
    (u.defenseReadyAt || 0) <= s.time &&
    u.hp / u.maxHp >= 0.45 &&
    (u.suppression || 0) < 0.45 &&
    !u.guardTargetId &&
    !s.groundUnits.some((p) => p.carrierId === u.id || p.boardingId === u.id)
  );
}

export function updateDefense(s) {
  if (s.result) return;
  s.frontlineMemory ||= createFrontlineMemory();
  for (const side of [0, 1]) {
    const memory = s.frontlineMemory[side];
    if (memory.nextThink > s.time) continue;
    memory.nextThink = s.time + C.cadence;
    const observed = observedFrontline(s, side, memory.seen);
    memory.seen = observed.seen;
    let report = calculateFrontline(s, side, memory.seen, observed.visible);
    const own = s.groundUnits.filter((u) => u.side === side && military(u));
    for (const u of own) {
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
      const sector = report.sectors.find((v) => v.id === task.sectorId);
      if (
        !u.autoDefense ||
        task.until <= s.time ||
        (s.time - task.assignedAt >= C.minDuty && sector.pressure < 0.7)
      )
        returnToPost(s, u);
    }
    const volunteers = own.filter((u) => u.autoDefense && u.guard);
    let active = own.filter((u) => u.defenseTask).length;
    const limit = Math.min(C.maxReinforcing, Math.floor(volunteers.length * C.reserveShare));
    const donors = new Map(
      report.sectors.map((v) => [
        v.id,
        {
          count: own.filter((u) => u.guard && !u.defenseTask && sectorAt(u.guard.z).id === v.id)
            .length,
          sent: 0,
        },
      ]),
    );
    let issued = 0;
    const threatened = report.sectors
      .filter((v) => v.pressure >= C.pressureThreshold && (v.enemy > 0 || v.contacts > 0))
      .sort((a, b) => b.pressure - a.pressure || a.z - b.z);
    for (const sector of threatened) {
      if (active >= limit || issued >= C.maxNewAssignments) break;
      const candidates = own
        .filter((u) => {
          if (!eligibleReserve(s, u)) return false;
          const donorId = sectorAt(u.guard.z).id,
            donor = donors.get(donorId);
          const donorThreat = report.sectors.find((v) => v.id === donorId).pressure;
          return (
            donorId !== sector.id &&
            donorThreat < Math.min(0.8, sector.pressure * 0.5) &&
            donor.count - donor.sent >
              Math.max(C.donorMinimum, Math.ceil(donor.count * C.donorShare)) &&
            distance(u, { x: sector.x, z: sector.z }) <= C.maxTransferDistance
          );
        })
        .sort((a, b) => distance(a, sector) - distance(b, sector) || a.id - b.id);
      for (const u of candidates) {
        if (active >= limit || issued >= C.maxNewAssignments) break;
        const donor = donors.get(sectorAt(u.guard.z).id);
        if (
          donor.count - donor.sent <=
          Math.max(C.donorMinimum, Math.ceil(donor.count * C.donorShare))
        )
          continue;
        const direction = side === 0 ? 1 : -1;
        const point = { x: sector.x - direction * (isInfantry(u.key) ? 45 : 85), z: sector.z };
        const home = { ...u.guard };
        if (!post(s, u, point, true)) continue;
        let travel = 0,
          previous = u;
        for (const p of u.path) {
          travel += distance(previous, p);
          previous = p;
        }
        u.defenseTask = {
          sectorId: sector.id,
          home,
          assignedAt: s.time,
          until: s.time + C.maxDuty + travel / Math.max(1, GROUND_UNITS[u.key].speed * 0.8),
          returning: false,
        };
        donor.sent++;
        active++;
        issued++;
        event(s, 'defenseRedeployed', { x: u.x, z: u.z, side, unitId: u.id, sectorId: sector.id });
      }
    }
    report = calculateFrontline(s, side, memory.seen, observed.visible);
    cacheFrontline(s, side, report);
  }
}
