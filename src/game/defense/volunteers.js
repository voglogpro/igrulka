import { validSide } from '../factions.js';
import { GROUND_UNITS } from '../config.js';
import { invalidateFrontline } from './cache.js';
import { clearGroundRoute } from '../units/ground/route-queue.js';
import { cancelTransportDelivery } from '../units/vehicles/transport.js';

export function clearAutoDefense(u) {
  u.autoDefense = false;
  u.defenseTask = null;
  u.defensePost = null;
  u.defenseCapture = null;
  u.defenseMission = null;
}

// Accept the standing order now; the coordinator assigns its actual front
// position through the bounded planning pulse. Do not first march a whole
// batch to the same temporary rally and calculate one A* for every recruit.
export function queueAutoDefense(s, units) {
  const occupied = new Set();
  for (const u of s.groundUnits) {
    if (u.carrierId != null) occupied.add(u.carrierId);
    if (u.boardingId != null) occupied.add(u.boardingId);
  }
  let queued = 0;
  for (const u of units) {
    if (GROUND_UNITS[u.key]?.support || occupied.has(u.id)) continue;
    clearAutoDefense(u);
    clearGroundRoute(u);
    cancelTransportDelivery(u);
    delete u.supplyTrip;
    u.boardingId = null;
    u.guard = null;
    u.guardTargetId = null;
    u.path = [];
    u.order = null;
    u.digging = false;
    u.trenchId = null;
    u.defenseReadyAt = 0;
    u.autoDefense = true;
    u.stance = { mode: 'defend', post: 'auto' };
    queued++;
  }
  if (queued) invalidateFrontline(s);
  return queued;
}

export function setAutoDefense(s, side, ids, enabled) {
  if (s.result || !validSide(s, side) || !Array.isArray(ids) || typeof enabled !== 'boolean')
    return 'Неизвестная команда обороны';
  let changed = 0;
  for (const u of s.groundUnits)
    if (
      ids.includes(u.id) &&
      u.side === side &&
      u.hp > 0 &&
      !u.downed &&
      !u.carrierId &&
      !u.boardingId &&
      u.guard &&
      !GROUND_UNITS[u.key]?.support &&
      !u.delivery &&
      (!enabled || !s.groundUnits.some((p) => p.carrierId === u.id || p.boardingId === u.id))
    ) {
      u.autoDefense = enabled;
      if (!enabled && u.supplyTrip) {
        if (u.order?.supplyId === u.supplyTrip.crateId) {
          u.path = [];
          u.order = null;
        }
        delete u.supplyTrip;
      }
      if (!enabled) {
        u.defensePost = null;
        u.defenseCapture = null;
        u.defenseMission = null;
      }
      if (!enabled && u.defenseTask) u.defenseTask.until = s.time;
      changed++;
    }
  if (changed) invalidateFrontline(s);
  return changed || 'Выберите защитников на постах';
}
