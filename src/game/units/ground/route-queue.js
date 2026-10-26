import { FIELD, GROUND_UNITS } from '../../config.js';
import { walkable } from './navigation.js';
import { groundFormationDestinations, orderGround } from './orders.js';
import { groundVisible, lineOfSight } from '../infantry/cover.js';

export const GROUND_ROUTE_LIMIT = 12;
export const GROUND_ROUTE_RETRY_SECONDS = 1;
export const GROUND_ROUTE_ARRIVAL_RADIUS = 4;
export const GROUND_ROUTE_PATHS_PER_STEP = 2;
const modes = ['move', 'attackmove'];
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export function clearGroundRoute(u) {
  const hadRoute = !!u.routeState || !!u.routeQueue?.length;
  u.routeQueue = [];
  u.routeState = null;
  return hadRoute;
}

export function appendGroundOrder(s, side, ids, point) {
  if (s.result) return 'Кампания завершена';
  if (
    !point ||
    Array.isArray(point) ||
    ![point.x, point.z].every(Number.isFinite) ||
    Math.abs(point.x) > FIELD.x ||
    Math.abs(point.z) > FIELD.z ||
    (point.mode != null && !modes.includes(point.mode))
  )
    return 'Выберите допустимую точку маршрута на карте';
  const units = s.groundUnits.filter((u) => u.side === side && u.hp > 0 && ids.includes(u.id));
  if (!units.length) return 'Выберите свои наземные отряды';
  if (units.some((u) => u.carrierId || u.boardingId || u.delivery))
    return 'Сначала завершите посадку или доставку и высадите пассажиров';
  if (units.some((u) => (u.routeQueue?.length || 0) >= GROUND_ROUTE_LIMIT))
    return 'В маршруте уже 12 ожидающих точек';
  const points = groundFormationDestinations(s, side, units, point);
  let count = 0;
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    const next = { ...points[i], mode: point.mode || 'move' };
    const radius = GROUND_UNITS[u.key].size * 0.42;
    if (!walkable(s, next.x, next.z, radius)) continue;
    if (u.routeState || (!u.guard && u.path?.length && u.order)) {
      u.routeQueue ||= [];
      u.routeQueue.push(next);
      u.routeState ||= { status: 'moving', retryAt: s.time };
      count++;
    } else if (typeof orderGround(s, side, [u.id], next) === 'number') {
      u.routeQueue = [];
      u.routeState = { status: 'moving', retryAt: s.time };
      count++;
    }
  }
  return count || 'Нет доступного прохода к точке маршрута';
}

export function groundRouteStatus(s, side, id) {
  const u = s.groundUnits.find((u) => u.side === side && u.id === id && u.hp > 0);
  if (!u) return null;
  return {
    status: u.routeState?.status || 'idle',
    pending: u.routeQueue?.length || 0,
    limit: GROUND_ROUTE_LIMIT,
    points: u.routeState
      ? [
          ...(u.order
            ? [
                {
                  x: u.order.x,
                  z: u.order.z,
                  mode: u.order.mode === 'attackmove' ? 'attackmove' : 'move',
                },
              ]
            : []),
          ...(u.routeQueue || []).map((p) => ({ ...p })),
        ]
      : [],
  };
}

function fighting(s, u, targets) {
  if (u.enemyId == null || u.holdFire || !['attack', 'attackmove'].includes(u.order?.mode))
    return false;
  const target = targets().get(u.enemyId);
  if (
    !target ||
    target.hp <= 0 ||
    (GROUND_UNITS[target.key] && (target.carrierId || !groundVisible(s, u.side, target)))
  )
    return false;
  return (
    !!target && distance(u, target) < GROUND_UNITS[u.key].groundRange && lineOfSight(s, u, target)
  );
}

export function updateGroundRoutes(s) {
  if (s.result) return;
  const pending = [];
  let targetIndex;
  const targets = () =>
    (targetIndex ||= new Map([...s.groundUnits, ...s.buildings].map((v) => [v.id, v])));
  for (const u of s.groundUnits) {
    const route = u.routeState;
    if (!route) continue;
    if (u.hp <= 0 || u.carrierId || u.boardingId || u.delivery || u.guard || !u.order) {
      clearGroundRoute(u);
      continue;
    }
    if (
      u.path?.length ||
      fighting(s, u, targets) ||
      (route.status === 'blocked' && s.time < route.retryAt)
    )
      continue;
    const arrived = distance(u, u.order) <= GROUND_ROUTE_ARRIVAL_RADIUS;
    if (arrived && !u.routeQueue?.length) {
      clearGroundRoute(u);
      continue;
    }
    pending.push({ u, route, arrived, next: arrived ? u.routeQueue[0] : u.order });
  }
  // Oldest unattempted work wins over retries: unreachable early IDs cannot
  // starve later soldiers, and a large order cannot monopolize a simulation tick.
  pending.sort((a, b) => a.route.retryAt - b.route.retryAt || a.u.id - b.u.id);
  const queues = new Map();
  for (const item of pending) {
    if (!queues.has(item.u.side)) queues.set(item.u.side, []);
    queues.get(item.u.side).push(item);
  }
  const selected = [],
    positions = new Map();
  const start = Math.round(s.time * 20) % s.sides.length;
  while (selected.length < GROUND_ROUTE_PATHS_PER_STEP) {
    let progress = false;
    for (let i = 0; i < s.sides.length && selected.length < GROUND_ROUTE_PATHS_PER_STEP; i++) {
      const side = (start + i) % s.sides.length,
        position = positions.get(side) || 0;
      const item = queues.get(side)?.[position];
      if (!item) continue;
      selected.push(item);
      positions.set(side, position + 1);
      progress = true;
    }
    if (!progress) break;
  }
  for (const { u, route, arrived, next } of selected) {
    if (
      walkable(s, next.x, next.z, GROUND_UNITS[u.key].size * 0.42) &&
      typeof orderGround(s, u.side, [u.id], next, { preserveRoute: true }) === 'number'
    ) {
      if (arrived) u.routeQueue.shift();
      route.status = 'moving';
    } else route.status = 'blocked';
    route.retryAt = s.time + GROUND_ROUTE_RETRY_SECONDS;
  }
}
