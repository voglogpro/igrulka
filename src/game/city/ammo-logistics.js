import { BUILDINGS, groundHeight } from '../config.js';
import { equipmentModifiers } from '../combat/upgrade-tiers.js';
import { groundPath } from '../units/ground/navigation.js';
import { moveCivicVehicle } from '../units/ground/movement.js';
import { freeSpot } from '../units/vehicles/transport.js';
import {
  AMMUNITION as C,
  createAmmoStock,
  ammunitionProfile,
  receiveAmmunition,
} from '../units/ground/ammunition.js';
import { ammoDepotReady } from './ammo-production.js';
import {
  launchSupplyRequests,
  launchStoreCapacity,
  launchStoreTotal,
  acceptLaunchDelivery,
  availableLaunchStock,
} from '../units/aviation/launch-supply.js';
import { collectionRequest, collectWeapon, deliverySpace } from './weapon-transfer.js';
import { fieldSupplyJobs, depositFieldAmmo } from './field-ammo.js';
export { requestWeaponDelivery } from './weapon-transfer.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const PARKING_GAP = 6.35;
function parkingSpace(s, van = null, parkedOnly = false) {
  const fleet = [...(s.ammoVehicles || []), ...(s.serviceVehicles || [])].filter(
    (other) => other !== van && (other.hp == null || other.hp > 0),
  );
  return (point) =>
    !fleet.some((other) => {
      const occupied = (!parkedOnly || !other.path?.length) && distance(other, point) < PARKING_GAP;
      const goal = other.goal || other.path?.at(-1);
      return (
        occupied ||
        (goal && distance(goal, point) < PARKING_GAP) ||
        (other.home && distance(other.home, point) < PARKING_GAP)
      );
    });
}
const parking = (s, target, start = 0, van = null) =>
  freeSpot(s, target, 3, start, parkingSpace(s, van));
const depotActive = (s, b) => ammoDepotReady(b) && b.ammoEnabled !== false;
const targetOf = (s, v) =>
  v.targetKind === 'field' && v.fieldPoint
    ? { id: null, side: v.side, key: 'ammo-crate', ...v.fieldPoint }
    : (v.targetKind === 'ground' ? s.groundUnits : s.buildings).find(
        (t) =>
          t.id === v.targetId && t.side === v.side && t.hp > 0 && !t.demolished && !t.carrierId,
      );
const incoming = (s, id, kind, key) =>
  (s.ammoVehicles || []).reduce(
    (n, v) =>
      n +
      (v.hp > 0 &&
      v.targetId === id &&
      v.status !== 'returning' &&
      v.cargo?.kind === kind &&
      v.cargo.key === key
        ? v.cargo.amount
        : 0),
    0,
  );

function reconcile(s) {
  s.ammoVehicles ||= [];
  const depots = s.buildings
    .filter((b) => ['factory', 'ammofactory'].includes(b.key) && ammoDepotReady(b))
    .sort((a, b) => a.id - b.id);
  const quotas = new Map();
  for (const side of sideIds(s)) {
    let count = 0;
    for (let slot = 0; slot < 4; slot++)
      for (const b of depots)
        if (b.side === side && slot < equipmentModifiers(b).fleet && count < C.fleetLimit) {
          quotas.set(b.id, (quotas.get(b.id) || 0) + 1);
          count++;
        }
  }
  s.ammoVehicles = s.ammoVehicles.filter((v) => {
    const b = depots.find((t) => t.id === v.depotId && t.side === v.side);
    return (
      (v.hp > 0 && v.cargo) ||
      (b && (v.slot < (quotas.get(b.id) || 0) || (v.hp > 0 && v.status !== 'idle')))
    );
  });
  for (const b of depots)
    for (let slot = 0; slot < (quotas.get(b.id) || 0); slot++) {
      const previous = s.ammoVehicles.find((v) => v.depotId === b.id && v.slot === slot);
      if (previous?.hp > 0) continue;
      const f = s.sides[b.side];
      if (
        previous &&
        (b.ammoEnabled === false ||
          s.time < previous.replaceAt ||
          f.credits - C.vehicle.replacementCost < 250 ||
          f.materials - C.vehicle.replacementMetal < 5)
      )
        continue;
      if (
        s.ammoVehicles.filter((v) => v.side === b.side).length - (previous ? 1 : 0) >=
        C.fleetLimit
      )
        continue;
      const home = parking(s, b, slot * 7);
      if (!home) continue;
      if (previous) {
        f.credits -= C.vehicle.replacementCost;
        f.materials -= C.vehicle.replacementMetal;
        s.ammoVehicles.splice(s.ammoVehicles.indexOf(previous), 1);
      }
      s.ammoVehicles.push({
        id: s.nextId++,
        side: b.side,
        depotId: b.id,
        slot,
        ...home,
        home: { ...home },
        hp: C.vehicle.hp,
        maxHp: C.vehicle.hp,
        y: groundHeight(home.x, home.z) + 1,
        yaw: 0,
        path: [],
        status: 'idle',
        targetId: null,
        targetKind: null,
        cargo: null,
        pickup: null,
        retryAt: 0,
        revision: s.networkRevision,
      });
    }
}

function destination(s, v, target) {
  return parking(s, target, v.slot * 7, v);
}
function route(s, v, point, status) {
  const path = groundPath(s, v, point, 3),
    end = path.at(-1);
  if (!end || distance(end, point) > 3) return false;
  v.path = path;
  v.goal = { ...point };
  v.status = status;
  v.revision = s.networkRevision;
  return true;
}
function returnHome(s, v) {
  v.pickup = null;
  v.targetId = null;
  v.targetKind = null;
  v.fieldPoint = null;
  const original = s.buildings.find(
    (b) => b.id === v.depotId && b.side === v.side && ammoDepotReady(b),
  );
  if (!original && v.cargo) {
    const replacement = s.buildings.find(
      (b) =>
        b.side === v.side &&
        ammoDepotReady(b) &&
        b.key === (v.cargo.kind === 'ammo' ? 'ammofactory' : 'factory'),
    );
    if (replacement) {
      const point = parking(s, replacement, v.slot * 7, v);
      if (point) v.home = point;
    } else {
      v.path = [];
      v.status = 'blocked';
      v.retryAt = s.time + 2;
      v.goal = null;
      return;
    }
  }
  if (original && !parkingSpace(s, v, true)(v.home)) {
    const point = parking(s, original, v.slot * 7, v);
    if (point) v.home = point;
  }
  if (!route(s, v, v.home, 'returning')) {
    v.path = [];
    v.status = 'blocked';
    v.retryAt = s.time + 2;
  }
}

function jobs(s, v, depot) {
  const f = s.sides[v.side],
    result = [];
  const weaponAvailable = (key) => (f.inventory[key] || 0) + availableLaunchStock(depot, key);
  if (depot.key === 'factory') {
    for (const site of s.buildings) {
      if (site.side !== v.side || !ammoDepotReady(site)) continue;
      const pickup = collectionRequest(s, site);
      if (pickup)
        result.push({ target: site, targetKind: 'building', cargo: null, pickup, urgency: 6 });
    }
    for (const t of s.groundUnits)
      if (
        t.side === v.side &&
        t.hp > 0 &&
        t.key === 'operator' &&
        !t.carrierId &&
        (t.fpvAmmo || 0) + incoming(s, t.id, 'weapon', 'drone') < 3 &&
        weaponAvailable('drone') > 0
      )
        result.push({
          target: t,
          targetKind: 'ground',
          cargo: { kind: 'weapon', key: 'drone', amount: 1 },
          urgency: 1,
        });
    const requests = launchSupplyRequests(s, v.side);
    for (const b of s.buildings)
      if (b.side === v.side && ammoDepotReady(b))
        for (const [key, amount] of Object.entries(b.weaponDemand || {}))
          if (amount > availableLaunchStock(b, key) + incoming(s, b.id, 'weapon', key))
            requests.unshift({ siteId: b.id, key, amount, manual: true });
    const seen = new Set();
    for (const request of requests) {
      const id = request.siteId,
        key = request.key,
        signature = `${id}:${key}`;
      if (seen.has(signature)) continue;
      seen.add(signature);
      const t = s.buildings.find((b) => b.id === id && b.side === v.side && ammoDepotReady(b));
      if (!t || t.id === depot.id || !launchStoreCapacity(t, key)) continue;
      const allIncoming = (s.ammoVehicles || []).reduce(
        (n, car) =>
          n +
          (car.hp > 0 &&
          car.targetId === t.id &&
          car.cargo?.kind === 'weapon' &&
          car.status !== 'returning'
            ? car.cargo.amount
            : 0),
        0,
      );
      const amount = Math.min(
        1,
        weaponAvailable(key),
        launchStoreCapacity(t) - launchStoreTotal(t) - allIncoming,
        request.manual
          ? request.amount - availableLaunchStock(t, key) - incoming(s, t.id, 'weapon', key)
          : Infinity,
      );
      if (amount > 0)
        result.push({
          target: t,
          targetKind: 'building',
          cargo: { kind: 'weapon', key, amount },
          urgency: (request.manual ? 4 : 0) + (launchStoreTotal(t) + allIncoming === 0 ? 2 : 0),
        });
    }
  } else {
    result.push(...fieldSupplyJobs(s, v.side));
  }
  return result.sort(
    (a, b) =>
      b.urgency - a.urgency ||
      distance(v, a.target) - distance(v, b.target) ||
      a.target.id - b.target.id,
  );
}

function unload(s, v) {
  if (v.targetKind === 'field') {
    const accepted = depositFieldAmmo(s, v);
    if (!accepted) return false;
    v.cargo.amount -= accepted;
    if (!v.cargo.amount) v.cargo = null;
    returnHome(s, v);
    return true;
  }
  const target = targetOf(s, v);
  if (!target || distance(v, target) > C.reach + (BUILDINGS[target.key]?.size || 0) * 0.5)
    return false;
  if (v.pickup) {
    collectWeapon(s, v, target);
    returnHome(s, v);
    return true;
  }
  if (!v.cargo) {
    returnHome(s, v);
    return true;
  }
  const accepted =
    v.cargo.kind === 'ammo'
      ? receiveAmmunition(target, v.cargo.key, v.cargo.amount)
      : target.key === 'operator' && v.cargo.key === 'drone'
        ? Math.min(v.cargo.amount, 3 - (target.fpvAmmo || 0))
        : acceptLaunchDelivery(
            target,
            v.cargo.key,
            Math.min(v.cargo.amount, deliverySpace(s, target, v.cargo.key)),
          );
  if (v.cargo.kind === 'weapon' && target.key === 'operator' && v.cargo.key === 'drone')
    target.fpvAmmo = (target.fpvAmmo || 0) + accepted;
  v.cargo.amount -= accepted;
  if (!v.cargo.amount) v.cargo = null;
  returnHome(s, v);
  return true;
}
function storeAtHome(s, v) {
  if (v.cargo) {
    const f = s.sides[v.side],
      c = v.cargo;
    if (c.kind === 'weapon') {
      f.inventory[c.key] += c.amount;
      v.cargo = null;
    } else {
      f.ammoStock ||= createAmmoStock();
      const stored = Math.min(c.amount, C.stock[c.key] - f.ammoStock[c.key]);
      f.ammoStock[c.key] += stored;
      c.amount -= stored;
      if (!c.amount) v.cargo = null;
    }
  }
  if (!v.cargo) {
    v.status = 'idle';
    v.goal = null;
  }
}
export function updateAmmoLogistics(s, dt) {
  if (s.result) return;
  const thinking = s.time >= (s.ammoLogisticsAt || 0);
  if (thinking) {
    s.ammoLogisticsAt = s.time + 1;
    reconcile(s);
  }
  let searches = 0;
  for (const v of s.ammoVehicles || []) {
    if (v.hp <= 0) continue;
    const depot = s.buildings.find(
      (b) => b.id === v.depotId && b.side === v.side && ammoDepotReady(b),
    );
    if (!depot && !v.cargo) continue;
    const target = targetOf(s, v);
    if (
      thinking &&
      v.status !== 'idle' &&
      (v.targetId != null || v.targetKind === 'field') &&
      (!target || (depot && !depotActive(s, depot)))
    ) {
      if (searches++ < 4) returnHome(s, v);
    }
    if (thinking && searches < 4 && v.status === 'idle' && !v.cargo && depotActive(s, depot)) {
      for (const job of jobs(s, v, depot).slice(0, 3)) {
        if (searches++ >= 4) break;
        const goal = destination(s, v, job.target);
        if (!goal || !route(s, v, goal, 'outbound')) {
          job.target.ammoSupplyBlocked = true;
          for (const member of job.members || []) member.ammoSupplyBlocked = true;
          continue;
        }
        job.target.ammoSupplyBlocked = false;
        for (const member of job.members || []) member.ammoSupplyBlocked = false;
        v.targetId = job.target.id;
        v.targetKind = job.targetKind;
        v.fieldPoint = job.targetKind === 'field' ? { x: job.target.x, z: job.target.z } : null;
        v.cargo = job.cargo;
        v.pickup = job.pickup || null;
        const f = s.sides[v.side];
        if (!v.cargo) break;
        if (v.cargo.kind === 'ammo') f.ammoStock[v.cargo.key] -= v.cargo.amount;
        else {
          if (f.inventory[v.cargo.key] > 0) f.inventory[v.cargo.key] -= v.cargo.amount;
          else depot.launchStore[v.cargo.key] -= v.cargo.amount;
        }
        break;
      }
    }
    if (thinking && searches < 4 && v.status === 'blocked' && s.time >= v.retryAt) {
      searches++;
      if (target) {
        const point = destination(s, v, target);
        if (point) route(s, v, point, 'outbound');
      } else returnHome(s, v);
      v.retryAt = s.time + 2;
    }
    // Old saves or a newly parked vehicle can claim an in-flight bay. Reserve
    // another real destination; never unload through the obstructing vehicle.
    if (
      thinking &&
      searches < 4 &&
      v.goal &&
      v.path.length &&
      ['outbound', 'returning'].includes(v.status) &&
      !parkingSpace(s, v, true)(v.goal)
    ) {
      searches++;
      if (v.status === 'returning') returnHome(s, v);
      else if (target) {
        const point = destination(s, v, target);
        if (point) route(s, v, point, 'outbound');
      }
    }
    if (
      thinking &&
      searches < 4 &&
      v.status === 'outbound' &&
      target &&
      v.goal &&
      distance(v.goal, target) > C.reach + (BUILDINGS[target.key]?.size || 0) * 0.5
    ) {
      searches++;
      const point = destination(s, v, target);
      if (point && !route(s, v, point, 'outbound')) {
        v.status = 'blocked';
        v.path = [];
        v.retryAt = s.time + 2;
      }
    }
    moveCivicVehicle(s, v, dt, C.speed);
    v.y = groundHeight(v.x, v.z) + 1;
    if (v.path.length || v.status === 'blocked') continue;
    if (v.status === 'outbound') {
      v.status = 'unloading';
      v.unloadAt = s.time + 0.4;
    }
    if (v.status === 'unloading' && s.time >= v.unloadAt && searches < 4) {
      searches++;
      if (!unload(s, v)) {
        v.status = 'blocked';
        v.retryAt = s.time + 2;
      }
    }
    if (v.status === 'returning' && !v.path.length && distance(v, v.home) <= 3) storeAtHome(s, v);
  }
}
export function ammoLogisticsStatus(s, side, targetId) {
  const target = [...s.buildings, ...s.groundUnits].find(
    (t) => t.id === targetId && t.side === side,
  );
  if (!target) return null;
  const fleet = (s.ammoVehicles || []).filter(
    (v) =>
      v.hp > 0 &&
      v.side === side &&
      (v.targetId === targetId ||
        (v.targetKind === 'field' && v.fieldPoint && distance(v.fieldPoint, target) <= 120)),
  );
  const pending = Object.entries(target.weaponDemand || {}).reduce(
    (n, [key, count]) => n + Math.max(0, count - availableLaunchStock(target, key)),
    0,
  );
  const inTransit = fleet.reduce((n, v) => n + (v.cargo?.amount || 0), 0);
  const collecting = fleet.some((v) => v.pickup);
  const blocked = target.ammoSupplyBlocked || fleet.some((v) => v.status === 'blocked');
  const status = blocked
    ? 'blocked'
    : inTransit || collecting
      ? 'moving'
      : pending
        ? 'waiting'
        : 'idle';
  return {
    pending,
    inTransit,
    status,
    reason: blocked
      ? 'Нет сухого пути к получателю'
      : collecting
        ? 'Машина освобождает место для выбранного вооружения'
        : inTransit
          ? 'Машина в пути'
          : pending
            ? 'Ожидает свободную машину и груз'
            : 'Нет доставки',
  };
}

export function loadSupplyTruck(s, u, kinds = C.kinds) {
  u.ammoCargo ||= createAmmoStock();
  const stock = s.sides[u.side].ammoStock || createAmmoStock();
  const wanted = C.kinds.filter(
    (kind) => kinds.includes(kind) && stock[kind] > 0 && u.ammoCargo[kind] < C.cargo[kind],
  );
  // Do not keep sending a partly loaded truck to an empty warehouse.
  if (!wanted.length) return null;
  const depot = s.buildings
    .filter((b) => b.side === u.side && b.key === 'ammofactory' && depotActive(s, b))
    .sort((a, b) => distance(u, a) - distance(u, b) || a.id - b.id)[0];
  if (!depot) return null;
  if (distance(u, depot) > C.reach + BUILDINGS.ammofactory.size * 0.5) return depot;
  for (const kind of wanted) {
    const amount = Math.min(C.cargo[kind] - u.ammoCargo[kind], stock[kind]);
    u.ammoCargo[kind] += amount;
    stock[kind] -= amount;
  }
  return null;
}
export function supplyNearbyAmmo(s, u) {
  if (!u.ammoCargo) return;
  for (const t of [...s.groundUnits, ...s.buildings]) {
    if (t.side !== u.side || t.hp <= 0 || t.carrierId || t.demolished || distance(u, t) > C.reach)
      continue;
    const p = ammunitionProfile(t);
    if (!p || !u.ammoCargo[p.kind]) continue;
    u.ammoCargo[p.kind] -= receiveAmmunition(t, p.kind, u.ammoCargo[p.kind]);
  }
}
import { sideIds } from '../factions.js';
