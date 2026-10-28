import { GROUND_UNITS } from '../../config.js';
import { FIELD_SUPPLY as C } from '../../city/field-ammo.js';
import { ammunitionProfile, ammunitionStatus, receiveAmmunition } from './ammunition.js';
import { groundPath, walkable } from './navigation.js';
import { clearGroundRoute } from './route-queue.js';
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const ownedOrder = (u) =>
  u.supplyTrip &&
  u.order?.supplyId === u.supplyTrip.crateId &&
  ['resupply', 'resupplyReturn'].includes(u.order.mode);
function setPath(s, u, point, mode) {
  const path = groundPath(s, u, point, GROUND_UNITS[u.key].size * 0.42);
  if (!path.length || distance(path.at(-1), point) > 4) return false;
  u.path = path;
  u.order = { ...point, mode, supplyId: u.supplyTrip.crateId };
  u.navRevision = s.networkRevision;
  return true;
}
export function updateFieldSupply(s) {
  if (s.result || s.paused || s.time < (s.fieldSupplyAt || 0)) return;
  s.fieldSupplyAt = s.time + C.cadence;
  let searches = 0;
  const crates = (s.ammoCrates || []).filter((c) => c.hp > 0);
  const cursor = s.fieldSupplyCursor || 0,
    army = s.groundUnits;
  for (const u of [...s.buildings, ...army.slice(cursor), ...army.slice(0, cursor)]) {
    if (u.hp <= 0 || u.demolished || u.carrierId || u.boardingId || u.downed) {
      if (ownedOrder(u)) {
        u.path = [];
        u.order = null;
      }
      delete u.supplyTrip;
      continue;
    }
    const profile = ammunitionProfile(u);
    if (!profile) continue;
    for (const crate of crates) {
      if (
        crate.side !== u.side ||
        crate.stock[profile.kind] <= 0 ||
        distance(u, crate) > C.serviceRadius
      )
        continue;
      crate.stock[profile.kind] -= receiveAmmunition(u, profile.kind, crate.stock[profile.kind]);
    }
    if (u.supplyTrip) {
      if (
        !ownedOrder(u) ||
        u.routeState ||
        u.delivery ||
        (!u.autoDefense && u.defenseAttack?.phase !== 'active')
      ) {
        if (ownedOrder(u)) {
          u.path = [];
          u.order = null;
        }
        delete u.supplyTrip;
        continue;
      }
      const trip = u.supplyTrip,
        crate = crates.find((c) => c.id === trip.crateId && c.side === u.side);
      if (trip.phase === 'outbound' && (!crate || !crate.stock[profile.kind] || u.ammoReserve > 0))
        trip.phase = 'returning';
      if (trip.phase === 'returning') {
        if (distance(u, trip.home) <= 4) {
          u.path = [];
          u.order = null;
          u.moving = false;
          delete u.supplyTrip;
          continue;
        }
        if ((u.order?.mode !== 'resupplyReturn' || !u.path?.length) && searches < 4) {
          searches++;
          setPath(s, u, trip.home, 'resupplyReturn');
        }
      } else if (!u.path?.length && searches < 4) {
        searches++;
        if (!setPath(s, u, crate, 'resupply')) trip.phase = 'returning';
      }
      continue;
    }
    const d = GROUND_UNITS[u.key];
    const cityMission = u.defenseAttack?.phase === 'active';
    const guardMode = ['guard', 'guardReturn', 'guardIntercept', 'wait'].includes(u.order?.mode);
    if (
      !d ||
      d.support ||
      u.key === 'mog' ||
      !d.speed ||
      (!u.autoDefense && !cityMission) ||
      u.delivery ||
      (u.routeState && !cityMission) ||
      u.digging ||
      (u.path?.length && !guardMode && !(cityMission && !u.moving)) ||
      (u.order &&
        !guardMode &&
        !(cityMission && ['attack', 'attackmove'].includes(u.order.mode))) ||
      ammunitionStatus(s, u).total > 0 ||
      searches >= 4
    )
      continue;
    const crate = crates
      .filter(
        (c) => c.side === u.side && c.stock[profile.kind] > 0 && distance(u, c) <= C.walkRadius,
      )
      .sort((a, b) => distance(u, a) - distance(u, b) || a.id - b.id)[0];
    if (!crate) continue;
    const angle = ((u.id % 8) * Math.PI) / 4,
      goal = { x: crate.x + Math.cos(angle) * 10, z: crate.z + Math.sin(angle) * 10 };
    if (!walkable(s, goal.x, goal.z, d.size * 0.42)) continue;
    const home = u.guard ? { x: u.guard.x, z: u.guard.z } : { x: u.x, z: u.z };
    if (cityMission) clearGroundRoute(u);
    u.supplyTrip = { crateId: crate.id, phase: 'outbound', home };
    searches++;
    if (!setPath(s, u, goal, 'resupply')) delete u.supplyTrip;
  }
  s.fieldSupplyCursor = (cursor + Math.max(1, searches)) % Math.max(1, army.length);
}
