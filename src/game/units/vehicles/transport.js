import { walkable } from '../ground/navigation.js';
import { GROUND_UNITS, isInfantry, groundHeight } from '../../config.js';
import { orderGround } from '../ground/orders.js';
import { clearAutoDefense } from '../../defense/volunteers.js';
export function freeSpot(s, center, radius = 2, start = 0) {
  for (let i = 0; i < 64; i++) {
    const a = (i + start) * 2.399,
      r = 12 + Math.floor(i / 10) * 8,
      x = center.x + Math.cos(a) * r,
      z = center.z + Math.sin(a) * r;
    if (
      walkable(s, x, z, radius) &&
      !s.groundUnits.some(
        (u) =>
          u.hp > 0 &&
          !u.carrierId &&
          Math.hypot(u.x - x, u.z - z) < radius + GROUND_UNITS[u.key].size * 0.5 + 1,
      )
    )
      return { x, z };
  }
  return null;
}

export function boardGround(s, side, ids, carrierId) {
  const vehicle = s.groundUnits.find((u) => u.id === carrierId && u.side === side && u.hp > 0),
    capacity = GROUND_UNITS[vehicle?.key]?.capacity;
  if (!capacity) return 'Выберите свой бронетранспортёр';
  if (vehicle.delivery) return 'БТР выполняет доставку. Сначала остановите его';
  let seats = s.groundUnits
      .filter(
        (u) =>
          u.hp > 0 && u.side === side && (u.carrierId === carrierId || u.boardingId === carrierId),
      )
      .reduce((n, u) => n + (GROUND_UNITS[u.key].members || 1), 0),
    count = 0;
  for (const u of s.groundUnits)
    if (
      u.side === side &&
      u.hp > 0 &&
      !u.carrierId &&
      !u.boardingId &&
      isInfantry(u.key) &&
      ids.includes(u.id)
    ) {
      const members = GROUND_UNITS[u.key].members || 1;
      if (seats + members > capacity) continue;
      const result = orderGround(s, side, [u.id], vehicle);
      if (typeof result === 'number') {
        u.boardingId = vehicle.id;
        u.order.mode = 'board';
        if (u.key === 'mog') u.setup = 0;
        seats += members;
        count++;
      }
    }
  if (count) clearAutoDefense(vehicle);
  return count || 'Не хватает мест или нет доступных бойцов';
}

export const UNLOAD_RADII = [10, 16, 22, 28];
export const UNLOAD_SLOTS_PER_RING = 12;

export function cancelTransportDelivery(vehicle) {
  if (!vehicle?.delivery) return false;
  vehicle.delivery = null;
  if (vehicle.order?.mode === 'deliver') {
    vehicle.order = null;
    vehicle.path = [];
    vehicle.moving = false;
  }
  return true;
}

// Short connected exits prevent unloading through a wall or across water.
export function planGroundUnload(s, vehicle, center = vehicle) {
  const passengers = s.groundUnits
    .filter((u) => u.carrierId === vehicle.id && u.hp > 0)
    .sort((a, b) => GROUND_UNITS[b.key].size - GROUND_UNITS[a.key].size || a.id - b.id);
  const capacity = GROUND_UNITS[vehicle.key]?.capacity || 0;
  const seats = passengers.reduce((n, u) => n + (GROUND_UNITS[u.key]?.members || 1), 0);
  const placements = [];
  if (
    !capacity ||
    seats > capacity ||
    passengers.some((u) => u.side !== vehicle.side || !isInfantry(u.key))
  )
    return { passengers, seats, placements, error: 'Некорректный состав пассажиров БТР' };
  const occupied = s.groundUnits.filter((u) => u.id !== vehicle.id && u.hp > 0 && !u.carrierId);
  for (const passenger of passengers) {
    const radius = GROUND_UNITS[passenger.key].size * 0.42;
    let chosen = null;
    for (const ring of UNLOAD_RADII) {
      for (let i = 0; i < UNLOAD_SLOTS_PER_RING; i++) {
        const angle = (i * Math.PI * 2) / UNLOAD_SLOTS_PER_RING;
        const p = { x: center.x + Math.cos(angle) * ring, z: center.z + Math.sin(angle) * ring };
        if (
          occupied.some(
            (u) => Math.hypot(u.x - p.x, u.z - p.z) < radius + GROUND_UNITS[u.key].size * 0.5 + 1,
          ) ||
          placements.some(
            (u) => Math.hypot(u.x - p.x, u.z - p.z) < radius + GROUND_UNITS[u.key].size * 0.5 + 1,
          )
        )
          continue;
        const samples = Math.ceil(ring / 2);
        let connected = true;
        for (let sample = 0; sample <= samples; sample++) {
          const t = sample / samples;
          if (
            !walkable(s, center.x + (p.x - center.x) * t, center.z + (p.z - center.z) * t, radius)
          ) {
            connected = false;
            break;
          }
        }
        if (connected) {
          chosen = { id: passenger.id, key: passenger.key, ...p };
          break;
        }
      }
      if (chosen) break;
    }
    if (chosen) placements.push(chosen);
  }
  return {
    passengers,
    seats,
    placements,
    error:
      placements.length < passengers.length
        ? 'Нет безопасного места для высадки всех бойцов'
        : null,
  };
}

export function unloadGround(
  s,
  side,
  carrierId,
  { requireAll = false, keepDelivery = false } = {},
) {
  const vehicle = s.groundUnits.find((u) => u.id === carrierId && u.side === side && u.hp > 0);
  if (!vehicle) return 0;
  if (!keepDelivery) cancelTransportDelivery(vehicle);
  const plan = planGroundUnload(s, vehicle);
  if (requireAll && plan.error) return 0;
  if (plan.error === 'Некорректный состав пассажиров БТР') return 0;
  for (const p of plan.placements) {
    const u = plan.passengers.find((u) => u.id === p.id);
    const y = 1 + groundHeight(p.x, p.z);
    Object.assign(u, {
      x: p.x,
      y,
      z: p.z,
      prevX: p.x,
      prevY: y,
      prevZ: p.z,
      carrierId: null,
      boardingId: null,
      guard: null,
      guardTargetId: null,
      digging: false,
      trenchId: null,
      path: [],
      order: null,
      moving: false,
    });
    if (u.key === 'mog') u.setup = 0;
  }
  return plan.placements.length;
}
