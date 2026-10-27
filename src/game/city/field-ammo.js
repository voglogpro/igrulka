import { GROUND_UNITS, BUILDINGS } from '../config.js';
import { validSide } from '../factions.js';
import { depotSupplyPoint } from '../defense/supply.js';
import { walkable } from '../units/ground/navigation.js';
import {
  AMMUNITION,
  ammunitionProfile,
  ammunitionStatus,
  createAmmoStock,
} from '../units/ground/ammunition.js';

export const FIELD_SUPPLY = {
  load: { small: 360, shell: 24, rocket: 24, sam: 8 },
  capacity: { small: 720, shell: 48, rocket: 48, sam: 16 },
  serviceRadius: 36,
  walkRadius: 160,
  clusterRadius: 120,
  hp: 100,
  cadence: 1,
};
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const jobsCache = new WeakMap();
const total = (crate) => Object.values(crate.stock).reduce((sum, n) => sum + n, 0);
export function fieldSupplyJobs(s, side) {
  let cache = jobsCache.get(s);
  if (!cache || cache.time !== s.time) {
    cache = { time: s.time, sides: new Map() };
    jobsCache.set(s, cache);
  }
  if (!cache.sides.has(side)) {
    const needs = [];
    for (const target of [...s.buildings, ...s.groundUnits]) {
      if (
        target.side !== side ||
        target.hp <= 0 ||
        target.demolished ||
        target.carrierId ||
        target.downed ||
        target.progress < 1
      )
        continue;
      const p = ammunitionProfile(target);
      if (!p) continue;
      const report = ammunitionStatus(s, target),
        need = p.capacity - report.reserve;
      if (need <= 0) continue;
      const staticTarget =
        !GROUND_UNITS[target.key] || target.key === 'mog' || !GROUND_UNITS[target.key].speed;
      needs.push({ target, kind: p.kind, need, empty: report.total === 0, staticTarget });
    }
    needs.sort(
      (a, b) =>
        Number(b.staticTarget) - Number(a.staticTarget) ||
        Number(b.empty) - Number(a.empty) ||
        a.target.id - b.target.id,
    );
    const groups = [],
      cells = new Map(),
      cell = (p) => [
        Math.floor(p.x / FIELD_SUPPLY.clusterRadius),
        Math.floor(p.z / FIELD_SUPPLY.clusterRadius),
      ];
    for (const need of needs) {
      const [cx, cz] = cell(need.target);
      let group = null;
      for (let dz = -1; dz <= 1 && !group; dz++)
        for (let dx = -1; dx <= 1 && !group; dx++)
          group = (cells.get(`${cx + dx},${cz + dz}`) || []).find(
            (g) =>
              distance(g, need.target) <=
              (need.staticTarget ? FIELD_SUPPLY.serviceRadius - 8 : FIELD_SUPPLY.clusterRadius),
          );
      if (!group) {
        const size = BUILDINGS[need.target.key]?.size || 0;
        let point = depotSupplyPoint(s, need.target, FIELD_SUPPLY.serviceRadius);
        for (const [dx, dz] of [
          [12, 12],
          [-12, 12],
          [12, -12],
          [-12, -12],
          [size * 0.6 + 8, 0],
          [-size * 0.6 - 8, 0],
          [0, size * 0.6 + 8],
          [0, -size * 0.6 - 8],
        ]) {
          if (point) break;
          const p = { x: need.target.x + dx, z: need.target.z + dz };
          if (
            walkable(s, p.x, p.z, 3) &&
            distance(p, need.target) <= FIELD_SUPPLY.serviceRadius - 4
          ) {
            point = p;
            break;
          }
        }
        if (!point) {
          need.target.ammoSupplyBlocked = true;
          continue;
        }
        group = { ...point, need: createAmmoStock(), empty: false, members: [] };
        groups.push(group);
        const [x, z] = cell(group),
          key = `${x},${z}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(group);
      }
      need.target.ammoSupplyBlocked = false;
      group.members.push(need.target);
      group.need[need.kind] += need.need;
      group.empty ||= need.empty;
    }
    cache.sides.set(side, groups);
  }
  const stock = s.sides[side].ammoStock;
  const result = [];
  for (const group of cache.sides.get(side))
    for (const key of AMMUNITION.kinds) {
      const nearby = (s.ammoCrates || []).filter(
        (c) => c.side === side && c.hp > 0 && distance(c, group) <= FIELD_SUPPLY.serviceRadius,
      );
      const stored = nearby.reduce((n, c) => n + c.stock[key], 0);
      const transit = (s.ammoVehicles || []).reduce(
        (n, v) =>
          n +
          (v.side === side &&
          v.hp > 0 &&
          v.targetKind === 'field' &&
          v.status !== 'returning' &&
          v.fieldPoint &&
          distance(v.fieldPoint, group) <= FIELD_SUPPLY.serviceRadius &&
          v.cargo?.kind === 'ammo' &&
          v.cargo.key === key
            ? v.cargo.amount
            : 0),
        0,
      );
      const room = nearby.length ? FIELD_SUPPLY.capacity[key] - stored : FIELD_SUPPLY.capacity[key];
      const amount = Math.min(
        FIELD_SUPPLY.load[key],
        stock[key],
        Math.max(0, group.need[key] - stored - transit),
        Math.max(0, room - transit),
      );
      if (amount > 0)
        result.push({
          target: { id: null, side, key: 'ammo-crate', x: group.x, z: group.z },
          targetKind: 'field',
          cargo: { kind: 'ammo', key, amount },
          urgency: group.empty ? 2 : 0,
          members: group.members,
        });
    }
  return result;
}
export function depositFieldAmmo(s, van) {
  if (
    !van.fieldPoint ||
    van.cargo?.kind !== 'ammo' ||
    distance(van, van.fieldPoint) > FIELD_SUPPLY.serviceRadius
  )
    return 0;
  s.ammoCrates ||= [];
  const { key, amount } = van.cargo;
  let crate = s.ammoCrates.find(
    (c) =>
      c.side === van.side &&
      c.hp > 0 &&
      distance(c, van.fieldPoint) <= FIELD_SUPPLY.serviceRadius &&
      c.stock[key] < FIELD_SUPPLY.capacity[key],
  );
  if (!crate) {
    // Empty unreserved boxes have no paid value; retire those slots before
    // placing the next paid delivery, never discard ammunition to make room.
    s.ammoCrates = s.ammoCrates.filter(
      (c) =>
        (c.hp > 0 && total(c) > 0) || s.groundUnits.some((u) => u.supplyTrip?.crateId === c.id),
    );
    crate = {
      id: s.nextId++,
      side: van.side,
      key: 'ammo-crate',
      ...van.fieldPoint,
      hp: FIELD_SUPPLY.hp,
      maxHp: FIELD_SUPPLY.hp,
      stock: createAmmoStock(),
    };
    s.ammoCrates.push(crate);
  }
  const accepted = Math.min(amount, FIELD_SUPPLY.capacity[key] - crate.stock[key]);
  crate.stock[key] += accepted;
  return accepted;
}
export function fieldCrateStatus(s, side, id) {
  const c = s.ammoCrates?.find((c) => c.id === id && c.side === side && c.hp > 0);
  if (!c || !validSide(s, side)) return null;
  return {
    ...c,
    stock: { ...c.stock },
    capacity: { ...FIELD_SUPPLY.capacity },
    incoming: (s.ammoVehicles || []).filter(
      (v) =>
        v.hp > 0 &&
        v.side === side &&
        v.targetKind === 'field' &&
        v.fieldPoint &&
        v.status !== 'returning' &&
        distance(v.fieldPoint, c) <= FIELD_SUPPLY.serviceRadius &&
        v.cargo?.kind === 'ammo',
    ).length,
    nearby: s.groundUnits.filter(
      (u) => u.side === side && u.hp > 0 && distance(u, c) <= FIELD_SUPPLY.serviceRadius,
    ).length,
  };
}
export function damageAmmoCrates(s, x, z, damage, radius, filter = () => true) {
  for (const c of s.ammoCrates || []) {
    const d = Math.hypot(c.x - x, c.z - z);
    if (c.hp <= 0 || d > radius || !filter(c)) continue;
    c.hp = Math.max(0, c.hp - damage * (1 - (0.8 * d) / Math.max(1, radius)));
    if (c.hp === 0) c.stock = createAmmoStock();
  }
}
