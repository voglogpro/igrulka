import { AMMUNITION } from '../units/ground/ammunition.js';
import { fogVisible } from '../vision-grid.js';
import { event } from '../shared/events.js';

// Civic fleet entities stay outside army targeting, but paid cargo can be lost
// to existing area damage. Keep the destroyed slot until its paid replacement.
export function damageAmmoVehicle(s, vehicle, amount) {
  if (vehicle.status === 'destroyed' || vehicle.hp <= 0 || !Number.isFinite(amount) || amount <= 0)
    return 0;
  const config = AMMUNITION.vehicle,
    before = vehicle.hp ?? config.hp;
  vehicle.maxHp ??= config.hp;
  vehicle.hp = Math.max(0, before - amount);
  if (vehicle.hp > 0) return before - vehicle.hp;
  const visibleTo = [0, 1].filter(
    (side) => side === vehicle.side || fogVisible(s, side, vehicle.x, vehicle.z),
  );
  vehicle.cargo = null;
  vehicle.path = [];
  vehicle.targetId = null;
  vehicle.targetKind = null;
  vehicle.goal = null;
  vehicle.status = 'destroyed';
  vehicle.replaceAt = s.time + config.replacementDelay;
  s.sides[vehicle.side].losses++;
  event(s, 'groundDestroyed', {
    x: vehicle.x,
    y: vehicle.y ?? 2,
    z: vehicle.z,
    key: 'supplytruck',
    side: vehicle.side,
    unitId: vehicle.id,
    yaw: vehicle.yaw || 0,
    visibleTo,
  });
  return before;
}
