import { walkable } from '../ground/navigation.js';
import { GROUND_UNITS, isInfantry } from '../../config.js';
import { orderGround } from '../ground/orders.js';
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
  let seats = s.groundUnits
      .filter((u) => u.carrierId === carrierId || u.boardingId === carrierId)
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
        seats += members;
        count++;
      }
    }
  return count || 'Не хватает мест или нет доступных бойцов';
}

export function unloadGround(s, side, carrierId) {
  const vehicle = s.groundUnits.find((u) => u.id === carrierId && u.side === side && u.hp > 0);
  if (!vehicle) return 0;
  let count = 0;
  for (const u of s.groundUnits)
    if (u.carrierId === carrierId) {
      const p = freeSpot(s, vehicle, GROUND_UNITS[u.key].size * 0.42, count * 5);
      if (!p) continue;
      Object.assign(u, p, {
        carrierId: null,
        boardingId: null,
        path: [],
        order: null,
        moving: false,
      });
      count++;
    }
  return count;
}
