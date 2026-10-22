import { GROUND_UNITS } from '../../config.js';
import { walkable } from './navigation.js';
import { groundFormationDestinations, orderGround } from './orders.js';
import { groundVisible, lineOfSight } from '../infantry/cover.js';

export const GROUND_ROUTE_LIMIT = 12;
export const GROUND_ROUTE_RETRY_SECONDS = 1;
export const GROUND_ROUTE_ARRIVAL_RADIUS = 4;
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
    Math.abs(point.x) > 864 ||
    Math.abs(point.z) > 576 ||
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

function fighting(s, u) {
  if (u.holdFire || !['attack', 'attackmove'].includes(u.order?.mode)) return false;
  const target =
    s.groundUnits.find(
      (v) => v.id === u.enemyId && v.hp > 0 && !v.carrierId && groundVisible(s, u.side, v),
    ) || s.buildings.find((b) => b.id === u.enemyId && b.hp > 0);
  return (
    !!target && distance(u, target) < GROUND_UNITS[u.key].groundRange && lineOfSight(s, u, target)
  );
}

export function updateGroundRoutes(s) {
  if (s.result) return;
  for (const u of s.groundUnits) {
    const route = u.routeState;
    if (!route) continue;
    if (u.hp <= 0 || u.carrierId || u.boardingId || u.delivery || u.guard || !u.order) {
      clearGroundRoute(u);
      continue;
    }
    if (u.path?.length || fighting(s, u) || (route.status === 'blocked' && s.time < route.retryAt))
      continue;
    const arrived = distance(u, u.order) <= GROUND_ROUTE_ARRIVAL_RADIUS;
    if (arrived && !u.routeQueue?.length) {
      clearGroundRoute(u);
      continue;
    }
    const next = arrived ? u.routeQueue[0] : u.order;
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
