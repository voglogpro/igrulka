import { validSide } from '../../factions.js';
import { oilCost, hasOil } from '../../city/oil.js';
import { GROUND_UNITS, FIELD } from '../../config.js';
import { groundPath, walkable } from './navigation.js';
import { freeSpot } from '../vehicles/transport.js';
import { recruit, recruitmentFacility } from './recruitment.js';
import { squadDestination, squadArrivalPoint } from './squads.js';

export function deploymentPlan(s, side, key, point, count = 1, siteId = null) {
  const normalized = squadDestination(point);
  const destination = normalized ? { ...normalized, mode: 'attackmove' } : normalized;
  const d = typeof key === 'string' && Object.hasOwn(GROUND_UNITS, key) ? GROUND_UNITS[key] : null;
  const result = {
    ok: false,
    reason: '',
    siteId: null,
    origin: null,
    path: [],
    point: destination || null,
    cost: {
      credits: d && Number.isInteger(count) ? d.cost * count : 0,
      materials: d && Number.isInteger(count) ? d.metal * count : 0,
    },
  };
  const fail = (reason) => ({ ...result, reason });
  if (s.result) return fail('Кампания завершена');
  if (!validSide(s, side)) return fail('Неизвестная сторона');
  const facility = recruitmentFacility(key);
  if (!d || !facility) return fail('Неизвестный тип отряда');
  if (!Number.isInteger(count) || count < 1 || count > 5)
    return fail('Отправляйте от 1 до 5 единиц за один приказ');
  if (!destination) return fail('Выберите точку отправки в пределах карты');
  if (siteId != null && (!Number.isSafeInteger(siteId) || siteId <= 0))
    return fail('Выберите свои казармы');
  const sites = s.buildings.filter(
    (b) =>
      b.side === side &&
      b.key === facility &&
      b.hp > 0 &&
      !b.demolished &&
      b.progress >= 1 &&
      (siteId == null || b.id === siteId),
  );
  if (!sites.length)
    return fail(
      facility === 'barracks'
        ? 'Сначала постройте свои казармы'
        : 'Сначала постройте свой бронезавод',
    );
  const available = sites.filter((b) => (b.armyQueue?.length || 0) + count <= 8);
  if (!available.length) return fail('Очередь казарм заполнена');
  const f = s.sides[side];
  if (f.credits < result.cost.credits || f.materials < result.cost.materials)
    return fail('Не хватает денег или сплавов');
  if (!hasOil(s, side, oilCost(key) * count)) return fail('Не хватает нефти: постройте нефтевышки');
  if (!walkable(s, destination.x, destination.z, d.size * 0.42))
    return fail('Точка отправки должна быть на доступной суше');
  const arrivals = Array.from({ length: count }, (_, squadSlot) =>
    squadArrivalPoint({ key, squadSlot, destination }),
  );
  if (
    arrivals.some(
      (p) =>
        Math.abs(p.x) > FIELD.x - 14 ||
        Math.abs(p.z) > FIELD.z - 14 ||
        !walkable(s, p.x, p.z, d.size * 0.42),
    )
  )
    return fail('Для всего отряда нет места. Отодвиньте точку от препятствий и края карты');
  const weight = (b) =>
    Math.hypot(b.x - destination.x, b.z - destination.z) +
    (b.armyQueue?.length || 0) * d.time * d.speed;
  available.sort((a, b) => weight(a) - weight(b) || a.id - b.id);
  for (const b of available) {
    const start = freeSpot(s, b, d.size * 0.5);
    if (!start) continue;
    const path = groundPath(s, start, destination, d.size * 0.42);
    const end = path.at(-1);
    if (!end || Math.hypot(end.x - destination.x, end.z - destination.z) > 3) continue;
    const connected = arrivals.every((p) => {
      const distance = Math.hypot(p.x - destination.x, p.z - destination.z);
      const steps = Math.max(1, Math.ceil(distance / 4));
      let clear = true;
      for (let i = 0; i <= steps; i++)
        if (
          !walkable(
            s,
            destination.x + ((p.x - destination.x) * i) / steps,
            destination.z + ((p.z - destination.z) * i) / steps,
            d.size * 0.42,
          )
        ) {
          clear = false;
          break;
        }
      if (clear) return true;
      const route = groundPath(s, start, p, d.size * 0.42);
      return route.length && Math.hypot(route.at(-1).x - p.x, route.at(-1).z - p.z) <= 3;
    });
    if (connected)
      return {
        ...result,
        ok: true,
        siteId: b.id,
        origin: { x: start.x, z: start.z },
        path,
        reason: '',
      };
  }
  return fail('Нет свободного выхода из казарм или прохода к точке отправки');
}

export function deployGround(s, side, key, point, count = 1, siteId = null) {
  const plan = deploymentPlan(s, side, key, point, count, siteId);
  if (!plan.ok) return false;
  const site = s.buildings.find((b) => b.id === plan.siteId);
  const offset = site.armyQueue?.length || 0;
  if (recruit(s, side, key, plan.siteId, count) !== true) return false;
  const id = s.nextId++;
  for (let slot = 0; slot < count; slot++)
    Object.assign(site.armyQueue[offset + slot], {
      destination: { ...plan.point, mode: 'attackmove' },
      squadId: id,
      squadSlot: slot,
    });
  return { siteId: plan.siteId, squadId: id, count };
}
