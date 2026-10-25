import { BUILDINGS } from '../config.js';
import { addRoad } from '../city/roads.js';
import { dirtyNetwork, network, projectPoint, segmentDistance } from '../city/road-network.js';
import {
  SETTLEMENT_BY_ID,
  settlementLayout,
  settlementComponentEnabled,
} from './settlements.config.js';
const approachCache = new WeakMap();

export function settlementRoadApproach(s, side, site) {
  let cache = approachCache.get(s);
  if (!cache || cache.revision !== s.networkRevision) {
    cache = { revision: s.networkRevision, values: new Map() };
    approachCache.set(s, cache);
  }
  const key = `${side}:${site.id}`;
  if (cache.values.has(key)) return cache.values.get(key);
  const spine = settlementLayout(site).roads[0];
  let best = null;
  for (const road of network(s, side).connected) {
    const pairs = [];
    for (const goal of [
      { x: spine.ax, z: spine.az },
      { x: spine.bx, z: spine.bz },
    ])
      pairs.push({ ...projectPoint(goal.x, goal.z, road), goal });
    for (const p of [
      { x: road.ax, z: road.az },
      { x: road.bx, z: road.bz },
    ]) {
      const goal = projectPoint(p.x, p.z, spine);
      pairs.push({ x: p.x, z: p.z, distance: goal.distance, goal: { x: goal.x, z: goal.z } });
    }
    const dx = road.bx - road.ax,
      dz = road.bz - road.az,
      ex = spine.bx - spine.ax,
      ez = spine.bz - spine.az;
    const den = dx * ez - dz * ex;
    if (Math.abs(den) > 1e-8) {
      const rx = spine.ax - road.ax,
        rz = spine.az - road.az,
        t = (rx * ez - rz * ex) / den,
        u = (rx * dz - rz * dx) / den;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
        const x = road.ax + t * dx,
          z = road.az + t * dz;
        pairs.push({ x, z, distance: 0, goal: { x, z } });
      }
    }
    for (const pair of pairs) if (!best || pair.distance < best.distance) best = pair;
  }
  cache.values.set(key, best);
  return best;
}

// Claiming changes ownership of the same ordinary entities. A demolished plot
// stays demolished, including after neutralization, recapture and save/load.
export function materializeSettlement(s, value, side) {
  if (value.materialized) {
    for (const id of value.componentIds) {
      const b = s.buildings.find((item) => item.id === id);
      if (b) b.side = side;
    }
    for (const id of value.roadIds) {
      const road = s.roads.find((item) => item.id === id);
      if (road) road.side = side;
    }
    dirtyNetwork(s);
    return;
  }
  const site = SETTLEMENT_BY_ID[value.id],
    layout = settlementLayout(site);
  const approach = settlementRoadApproach(s, side, site);
  const positions = [];
  for (const u of s.groundUnits || [])
    positions.push(u, u.guard, u.order, ...(u.path || []), ...(u.routeQueue || []));
  for (const v of [...(s.serviceVehicles || []), ...(s.ammoVehicles || [])])
    positions.push(v, v.home, v.goal, ...(v.path || []));
  positions.push(...(s.trenches || []));
  for (const b of s.buildings) {
    positions.push(b.rally);
    for (const q of b.armyQueue || []) positions.push(q.destination);
  }
  for (const component of layout.components) {
    const radius = component.size * 0.6;
    if (
      positions.some(
        (p) =>
          p &&
          Number.isFinite(p.x) &&
          Number.isFinite(p.z) &&
          Math.hypot(p.x - component.x, p.z - component.z) < radius + 5,
      ) ||
      s.buildings.some(
        (b) =>
          !b.demolished &&
          Math.hypot(b.x - component.x, b.z - component.z) <
            radius + (BUILDINGS[b.key]?.size || 30) * 0.6 + 3,
      ) ||
      s.roads.some(
        (r) =>
          !r.removed &&
          segmentDistance(component.x, component.z, r.ax, r.az, r.bx, r.bz) < radius + 6,
      )
    ) {
      const index = s.settlements.findIndex((item) => item.id === value.id) * 3 + component.slot;
      s.settlementLayoutMask &= ~(1 << index);
    }
  }
  value.materialized = true;
  value.componentIds = [];
  value.roadIds = [];
  for (const component of layout.components) {
    if (!settlementComponentEnabled(s, site, component.slot)) continue;
    const d = BUILDINGS[component.key];
    const b = {
      id: s.nextId++,
      side,
      key: component.key,
      x: component.x,
      z: component.z,
      rotation: component.rotation,
      hp: d.hp,
      maxHp: d.hp,
      progress: 1,
      cooldown: 0,
      queue: [],
      settlementId: site.id,
      settlementSlot: component.slot,
    };
    s.buildings.push(b);
    value.componentIds.push(b.id);
  }
  // Preserve an existing street or paid legacy building instead of laying a
  // new lane through it. The remaining components are ordinary isolated homes.
  for (const [slot, line] of layout.roads.entries()) {
    const building =
      line.slot == null
        ? null
        : s.buildings.find((b) => b.settlementId === site.id && b.settlementSlot === line.slot);
    if (line.slot != null && !building) continue;
    if (
      s.buildings.some(
        (b) =>
          !b.demolished &&
          b.id !== building?.id &&
          segmentDistance(b.x, b.z, line.ax, line.az, line.bx, line.bz) <
            (BUILDINGS[b.key]?.size || 30) * 0.5 + 3,
      )
    )
      continue;
    const road = addRoad(s, side, line.ax, line.az, line.bx, line.bz, {
      settlementId: site.id,
      settlementRoadSlot: slot,
      ...(building ? { connectorTo: building.id } : {}),
    });
    value.roadIds.push(road.id);
    if (building) building.roadLink = road.id;
  }
  const best = approach;
  if (
    best &&
    best.distance > 2 &&
    best.distance <= 34 &&
    !s.buildings.some(
      (b) =>
        !b.demolished &&
        segmentDistance(b.x, b.z, best.x, best.z, best.goal.x, best.goal.z) <
          (BUILDINGS[b.key]?.size || 30) * 0.5 + 3,
    )
  ) {
    const road = addRoad(s, side, best.x, best.z, best.goal.x, best.goal.z, {
      settlementId: site.id,
      settlementRoadSlot: -1,
    });
    value.roadIds.push(road.id);
  }
  dirtyNetwork(s);
}

export function validateSettlementCities(s) {
  const claimedIds = new Set();
  for (const value of s.settlements) {
    const layout = settlementLayout(SETTLEMENT_BY_ID[value.id]);
    if (
      typeof value.materialized !== 'boolean' ||
      !Array.isArray(value.componentIds) ||
      value.componentIds.length > 3 ||
      !Array.isArray(value.roadIds) ||
      value.roadIds.length > 5 ||
      (!value.materialized && (value.componentIds.length || value.roadIds.length))
    )
      throw Error('Повреждена застройка поселения');
    const slots = new Set();
    for (const id of value.componentIds) {
      const b = s.buildings.find((item) => item.id === id);
      const component = b && layout.components.find((item) => item.slot === b.settlementSlot);
      if (
        !Number.isSafeInteger(id) ||
        id <= 0 ||
        claimedIds.has(id) ||
        !b ||
        !component ||
        slots.has(component.slot) ||
        b.settlementId !== value.id ||
        b.key !== component.key ||
        b.x !== component.x ||
        b.z !== component.z ||
        !settlementComponentEnabled(s, value.id, component.slot) ||
        b.maxHp !== BUILDINGS[b.key].hp ||
        b.hp < 0 ||
        b.hp > b.maxHp ||
        b.progress !== 1 ||
        (value.owner !== null && b.side !== value.owner)
      )
        throw Error('Повреждено здание поселения');
      slots.add(component.slot);
      claimedIds.add(id);
    }
    if (
      value.materialized &&
      layout.components.some(
        (component) =>
          settlementComponentEnabled(s, value.id, component.slot) && !slots.has(component.slot),
      )
    )
      throw Error('Отсутствует здание поселения');
    const roadSlots = new Set();
    for (const id of value.roadIds) {
      const r = s.roads.find((item) => item.id === id);
      if (
        !Number.isSafeInteger(id) ||
        id <= 0 ||
        claimedIds.has(id) ||
        !r ||
        r.settlementId !== value.id ||
        !Number.isInteger(r.settlementRoadSlot) ||
        r.settlementRoadSlot < -1 ||
        r.settlementRoadSlot >= layout.roads.length ||
        roadSlots.has(r.settlementRoadSlot) ||
        (value.owner !== null && r.side !== value.owner)
      )
        throw Error('Повреждена улица поселения');
      roadSlots.add(r.settlementRoadSlot);
      claimedIds.add(id);
    }
  }
  for (const b of s.buildings) {
    if (b.settlementId == null && b.settlementSlot == null) continue;
    const site =
      typeof b.settlementId === 'string' && Object.hasOwn(SETTLEMENT_BY_ID, b.settlementId)
        ? SETTLEMENT_BY_ID[b.settlementId]
        : null;
    const town = site && s.settlements.find((value) => value.id === site.id);
    const configured =
      typeof b.key === 'string' && Object.hasOwn(BUILDINGS, b.key) && !BUILDINGS[b.key].retired;
    if (
      !site ||
      !town?.materialized ||
      !configured ||
      Math.hypot(b.x - site.x, b.z - site.z) > 130 ||
      (b.settlementSlot != null && !claimedIds.has(b.id))
    )
      throw Error('Повреждена принадлежность здания поселению');
  }
  for (const r of s.roads) {
    if ((r.settlementId != null || r.settlementRoadSlot != null) && !claimedIds.has(r.id))
      throw Error('Повреждена принадлежность улицы поселению');
  }
}
