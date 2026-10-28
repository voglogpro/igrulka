import { ROAD_HP, dirtyNetwork, overlappingRoad, segmentDistance } from './road-network.js';
import { riverDistance, BUILDINGS, FIELD, groundHeight } from '../config.js';
import { event } from '../shared/events.js';
import { sideIds, validSide } from '../factions.js';
import { activeSettlementFootprints } from '../territory/settlements.config.js';
export function addRoad(s, side, ax, az, bx, bz, extra = {}) {
  const r = { id: s.nextId++, side, ax, az, bx, bz, hp: ROAD_HP, maxHp: ROAD_HP, ...extra };
  s.roads.push(r);
  dirtyNetwork(s);
  return r;
}

export function campRoads(s) {
  for (const side of sideIds(s)) {
    const hq = s.buildings.find((b) => b.key === 'hq' && b.side === side);
    for (let i = 0; i < 3; i++)
      addRoad(s, side, hq.x - 90 + i * 60, hq.z - 45, hq.x - 30 + i * 60, hq.z - 45, {
        camp: true,
      });
  }
}

export function roadPreview(
  s,
  owner,
  ax,
  az,
  bx,
  bz,
  { ignoreCredits = false, ignoreRoadId = null } = {},
) {
  if (!validSide(s, owner)) return { error: 'Неизвестный город' };
  if (![ax, az, bx, bz].every(Number.isFinite)) return { error: 'Некорректная дорога' };
  const length = Math.hypot(bx - ax, bz - az),
    cost = Math.ceil(length * 0.8);
  if (length < 8 || length > 650) return { error: 'Длина участка: 8–650', length, cost };
  for (let i = 0; i <= Math.ceil(length / 5); i++) {
    const t = i / Math.ceil(length / 5),
      x = ax + (bx - ax) * t,
      z = az + (bz - az) * t;
    if (Math.abs(x) > FIELD.x || Math.abs(z) > FIELD.z)
      return { error: 'За границей карты', length, cost };
    if (riverDistance(x, z) < 75) return { error: 'Улица должна проходить по суше', length, cost };
    if (groundHeight(x, z) > 1.2)
      return { error: 'Улица не поднимается на холм: ведите её по равнине', length, cost };
  }
  if (overlappingRoad(s, ax, az, bx, bz, ignoreRoadId))
    return {
      error: 'Здесь уже есть дорога. Продолжите её от края или постройте перекрёсток',
      length,
      cost,
    };
  if (
    activeSettlementFootprints(s).some(
      (house) => segmentDistance(house.x, house.z, ax, az, bx, bz) < house.r + 6,
    )
  )
    return { error: 'На пути дом поселения: проведите дорогу рядом', length, cost };
  if (
    s.buildings.some(
      (b) =>
        !b.demolished &&
        segmentDistance(b.x, b.z, ax, az, bx, bz) < (BUILDINGS[b.key]?.size || 30) * 0.5 + 6,
    )
  )
    return { error: 'На пути здание', length, cost };
  if (!ignoreCredits && s.sides[owner].credits < cost)
    return { error: 'Недостаточно денег', length, cost };
  return { length, cost };
}

export function buildRoad(s, owner, ax, az, bx, bz) {
  if (s.result) return 'Кампания завершена';
  const check = roadPreview(s, owner, ax, az, bx, bz);
  if (check.error) return check.error;
  s.sides[owner].credits -= check.cost;
  const count = Math.ceil(check.length / 90),
    segments = [];
  for (let i = 0; i < count; i++) {
    const a = i / count,
      b = (i + 1) / count;
    segments.push(
      addRoad(
        s,
        owner,
        ax + (bx - ax) * a,
        az + (bz - az) * a,
        ax + (bx - ax) * b,
        az + (bz - az) * b,
      ),
    );
  }
  event(s, 'build', { x: bx, z: bz, side: owner });
  return { ...segments[0], segments, end: { x: bx, z: bz } };
}
