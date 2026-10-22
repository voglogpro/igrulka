import { GROUND_UNITS } from '../../config.js';
import { clamp } from '../../shared/math.js';
import { walkable } from '../ground/navigation.js';
import { orderGround } from '../ground/orders.js';
import { cancelTransportDelivery, planGroundUnload, unloadGround } from './transport.js';

export { cancelTransportDelivery } from './transport.js';
export const DELIVERY_ARRIVAL_RADIUS = 4;
export const DELIVERY_RETRY_SECONDS = 1;

const carrier = (s, side, id) =>
  s.groundUnits.find(
    (u) => u.id === id && u.side === side && u.hp > 0 && GROUND_UNITS[u.key]?.capacity,
  );
const pointValid = (p) =>
  p != null &&
  typeof p === 'object' &&
  !Array.isArray(p) &&
  Number.isFinite(p.x) &&
  Number.isFinite(p.z) &&
  Math.abs(p.x) <= 864 &&
  Math.abs(p.z) <= 576;

export function deliverGround(s, side, carrierId, point) {
  if (s.result) return 'Кампания завершена';
  const u = carrier(s, side, carrierId);
  if (!u) return 'Выберите свой действующий БТР';
  if (!pointValid(point)) return 'Выберите точку доставки в пределах карты';
  if (s.groundUnits.some((p) => p.hp > 0 && p.boardingId === u.id))
    return 'Дождитесь посадки бойцов в БТР';
  const destination = { x: clamp(point.x, -850, 850), z: clamp(point.z, -560, 560) };
  if (!walkable(s, destination.x, destination.z, GROUND_UNITS[u.key].size * 0.42))
    return 'Точка доставки должна быть на доступной для БТР суше';
  const plan = planGroundUnload(s, u, destination);
  if (plan.error) return plan.error;
  if (!plan.passengers.length) return 'Сначала посадите пехоту в БТР';
  const result = orderGround(s, side, [u.id], { ...destination, mode: 'deliver' });
  if (typeof result === 'string') return result;
  u.delivery = { ...destination, status: 'moving', retryAt: s.time };
  return plan.passengers.length;
}

export function transportDeliveryStatus(s, side, carrierId) {
  const u = carrier(s, side, carrierId);
  if (!u) return null;
  const passengers = s.groundUnits.filter((p) => p.hp > 0 && p.carrierId === u.id);
  return {
    status: u.delivery?.status || 'idle',
    passengers: passengers.length,
    seats: passengers.reduce((n, p) => n + (GROUND_UNITS[p.key]?.members || 1), 0),
    capacity: GROUND_UNITS[u.key].capacity,
    point: u.delivery ? { x: u.delivery.x, z: u.delivery.z } : null,
    error:
      u.delivery?.status === 'blocked'
        ? 'Доставка ожидает свободного проезда или места для высадки'
        : null,
  };
}

export function updateTransportDeliveries(s) {
  if (s.result) return;
  for (const u of s.groundUnits) {
    const delivery = u.delivery;
    if (!delivery) continue;
    if (u.hp <= 0 || u.order?.mode !== 'deliver') {
      cancelTransportDelivery(u);
      continue;
    }
    if (!s.groundUnits.some((p) => p.hp > 0 && p.carrierId === u.id)) {
      cancelTransportDelivery(u);
      continue;
    }
    if (u.path?.length) continue;
    if (s.time < delivery.retryAt) continue;
    const arrived = Math.hypot(u.x - delivery.x, u.z - delivery.z) <= DELIVERY_ARRIVAL_RADIUS;
    if (arrived) {
      if (unloadGround(s, u.side, u.id, { requireAll: true, keepDelivery: true }) > 0) {
        cancelTransportDelivery(u);
        continue;
      }
    } else if (walkable(s, delivery.x, delivery.z, GROUND_UNITS[u.key].size * 0.42)) {
      const result = orderGround(s, u.side, [u.id], {
        x: delivery.x,
        z: delivery.z,
        mode: 'deliver',
      });
      // A successful order may invoke the shared cancellation hook; restore this same mission.
      if (typeof result === 'number') {
        u.delivery = delivery;
        delivery.status = 'moving';
        delivery.retryAt = s.time + DELIVERY_RETRY_SECONDS;
        continue;
      }
    }
    delivery.status = 'blocked';
    delivery.retryAt = s.time + DELIVERY_RETRY_SECONDS;
  }
}
