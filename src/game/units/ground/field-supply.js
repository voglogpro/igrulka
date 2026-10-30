import { GROUND_UNITS } from '../../config.js';
import { FIELD_SUPPLY as C, updateCrateCapture } from '../../city/field-ammo.js';
import { ammunitionProfile, ammunitionStatus, receiveAmmunition } from './ammunition.js';
import { groundPath, walkable } from './navigation.js';
import { clearGroundRoute } from './route-queue.js';
import { clearAutoDefense } from '../../defense/volunteers.js';
import {
  assaultAmmunition,
  rejectAssaultCrate,
  unavailableAssaultCrate,
} from './assault-supply.js';
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
function finishTrip(s, u, blocked = false) {
  u.path = [];
  const resume = u.routeQueue?.shift();
  if (resume) {
    if (resume.mode === 'move') delete u.defenseAttack;
    u.guard = null;
    u.guardTargetId = null;
    clearAutoDefense(u);
  } else if (blocked && u.guard) {
    // A new solid obstacle can invalidate the old post during the supply leg.
    // Keep the soldier at its actual safe position rather than retry forever.
    u.guard = { x: u.x, z: u.z };
  }
  u.order = resume || null;
  u.routeState = resume ? { status: 'moving', retryAt: s.time } : null;
  u.moving = false;
  delete u.supplyTrip;
}
export function updateFieldSupply(s) {
  if (s.result || s.paused || s.time < (s.fieldSupplyAt || 0)) return;
  s.fieldSupplyAt = s.time + C.cadence;
  updateCrateCapture(s);
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
        (!u.autoDefense &&
          u.defenseAttack?.phase !== 'active' &&
          !u.guard &&
          !u.routeQueue?.some((p) => p.mode === 'attackmove'))
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
      if (
        trip.phase === 'outbound' &&
        (!crate ||
          !crate.stock[profile.kind] ||
          (u.defenseAttack?.phase === 'active'
            ? u.ammoReserve >= profile.capacity
            : u.ammoReserve > 0))
      )
        trip.phase = 'returning';
      if (trip.phase === 'returning') {
        if (distance(u, trip.home) <= 4) {
          finishTrip(s, u);
          continue;
        }
        if ((u.order?.mode !== 'resupplyReturn' || !u.path?.length) && searches < 4) {
          searches++;
          if (!setPath(s, u, trip.home, 'resupplyReturn')) finishTrip(s, u, true);
        }
      } else if (!u.path?.length && searches < 4) {
        searches++;
        if (!setPath(s, u, crate, 'resupply')) {
          rejectAssaultCrate(s, u, crate);
          trip.phase = 'returning';
        }
      }
      continue;
    }
    const d = GROUND_UNITS[u.key];
    const cityMission = u.defenseAttack?.phase === 'active';
    const combatOrder = ['attack', 'attackmove'].includes(u.order?.mode);
    const automaticPickup = cityMission || combatOrder || !!u.guard;
    const ammo = ammunitionStatus(s, u);
    // Guards retain their AA role: either empty domain needs a reserve. A
    // marching ground attack cannot count an unrelated loaded air magazine.
    const needsAmmo =
      cityMission || combatOrder
        ? assaultAmmunition(s, u).low
        : profile.dual
          ? ammo.reserve === 0 && (ammo.loaded === 0 || ammo.groundLoaded === 0)
          : ammo.total === 0;
    const guardMode = ['guard', 'guardReturn', 'guardIntercept', 'wait'].includes(u.order?.mode);
    if (
      !d ||
      d.support ||
      !d.speed ||
      (!u.autoDefense && !automaticPickup) ||
      u.delivery ||
      (u.routeState && !automaticPickup) ||
      u.digging ||
      (u.path?.length && !guardMode && !automaticPickup) ||
      (u.order && !guardMode && !combatOrder && !(cityMission && u.order.mode === 'move')) ||
      !needsAmmo ||
      searches >= 4
    )
      continue;
    const candidates = crates
      .filter(
        (c) =>
          c.side === u.side &&
          c.stock[profile.kind] > 0 &&
          !unavailableAssaultCrate(s, u, c) &&
          // A post walks only to a nearby box; a vehicle brings a new one closer otherwise.
          // Attack groups may fall back further, but never across the map around the sea.
          distance(u, c) <= (cityMission || combatOrder ? C.assaultWalkRadius : C.walkRadius),
      )
      .sort((a, b) => distance(u, a) - distance(u, b) || a.id - b.id);
    for (const crate of candidates) {
      if (searches >= 4) break;
      const angle = ((u.id % 8) * Math.PI) / 4,
        goal = { x: crate.x + Math.cos(angle) * 10, z: crate.z + Math.sin(angle) * 10 };
      if (!walkable(s, goal.x, goal.z, d.size * 0.42)) {
        rejectAssaultCrate(s, u, crate);
        continue;
      }
      const home = u.guard ? { x: u.guard.x, z: u.guard.z } : { x: u.x, z: u.z };
      const resume = automaticPickup
        ? [
            ...(u.order && ['attack', 'attackmove'].includes(u.order.mode)
              ? [{ ...u.order, mode: 'attackmove' }]
              : []),
            ...(u.routeQueue || []),
          ].slice(0, 12)
        : [];
      u.supplyTrip = { crateId: crate.id, phase: 'outbound', home };
      searches++;
      if (!setPath(s, u, goal, 'resupply')) {
        delete u.supplyTrip;
        rejectAssaultCrate(s, u, crate);
      } else {
        if (automaticPickup) {
          clearGroundRoute(u);
          u.routeQueue = resume;
        }
        break;
      }
    }
  }
  s.fieldSupplyCursor = (cursor + Math.max(1, searches)) % Math.max(1, army.length);
}
