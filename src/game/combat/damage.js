import { passable, dirtyNetwork, projectPoint, removeDriveways } from '../city/road-network.js';
import { event } from '../shared/events.js';
import { clamp } from '../shared/math.js';
import { BUILDINGS, GROUND_UNITS } from '../config.js';
import { damageGround } from '../units/ground/index.js';
import { damageDistricts } from '../territory/districts.js';
import { damageAmmoVehicle } from '../city/ammo-vehicle-damage.js';
import { AMMUNITION } from '../units/ground/ammunition.js';
export function damageRoad(s, r, amount) {
  const before = passable(r);
  r.hp = Math.max(0, r.hp - amount);
  if (r.hp <= r.maxHp * 0.3) r.blocked = true;
  if (before !== passable(r)) {
    dirtyNetwork(s);
    if (!passable(r)) {
      s.stats.roadsCut++;
      event(s, 'roadCut', {
        x: (r.ax + r.bx) / 2,
        z: (r.az + r.bz) / 2,
        side: r.side,
        key: 'road',
      });
    }
  }
}

export function damageBuilding(s, b, amount) {
  if (b.hp <= 0 || b.demolished) return;
  b.hp = Math.max(0, b.hp - amount);
  if (b.hp === 0) {
    removeDriveways(s, b.id);
    dirtyNetwork(s);
    event(s, 'destroy', { x: b.x, z: b.z, side: b.side, key: b.key, buildingId: b.id });
    s.sides[b.side].losses++;
  }
}

export function applyBlast(s, x, z, damage, radius) {
  damageDistricts(s, x, z, damage, radius);
  const at = (distance) =>
    distance > radius
      ? 0
      : damage * (1 - 0.8 * clamp((distance - radius * 0.2) / (radius * 0.8), 0, 1));
  for (const b of s.buildings)
    if (b.hp > 0 && !b.demolished) {
      const amount = at(
        Math.max(0, Math.hypot(b.x - x, b.z - z) - (BUILDINGS[b.key]?.size || 30) * 0.45),
      );
      if (amount) damageBuilding(s, b, amount);
    }
  for (const u of (s.groundUnits || []).filter((u) => u.hp > 0 && !u.carrierId)) {
    const amount = at(Math.max(0, Math.hypot(u.x - x, u.z - z) - GROUND_UNITS[u.key].size));
    if (amount) damageGround(s, u, amount, event, 'blast');
  }
  // Driveways are not damaged on their own; they share the fate of their building.
  for (const vehicle of (s.ammoVehicles || []).slice(0, AMMUNITION.fleetLimit * s.sides.length)) {
    const amount = at(
      Math.max(0, Math.hypot(vehicle.x - x, vehicle.z - z) - AMMUNITION.vehicle.radius),
    );
    if (amount) damageAmmoVehicle(s, vehicle, amount);
  }
  for (const r of s.roads)
    if (!r.removed && r.hp > 0 && !r.connectorTo) {
      const amount = at(Math.max(0, projectPoint(x, z, r).distance - 5));
      if (amount) damageRoad(s, r, amount);
    }
}
