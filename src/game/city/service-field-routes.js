import { BUILDINGS, GROUND_UNITS } from '../config.js';
import { groundPath, walkable } from '../units/ground/navigation.js';
import { projectPoint } from './road-network.js';

export const SERVICE_RADIUS = 3;
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// A load bumps networkRevision even when no obstacle changed. Keep an existing
// physical journey in that case instead of selecting a new point around its target.
export function servicePathClear(s, origin, path) {
  let previous = origin;
  if (!walkable(s, origin.x, origin.z, SERVICE_RADIUS)) return false;
  for (const point of path) {
    const steps = Math.max(1, Math.ceil(distance(previous, point) / SERVICE_RADIUS));
    for (let i = 1; i <= steps; i++)
      if (
        !walkable(
          s,
          previous.x + ((point.x - previous.x) * i) / steps,
          previous.z + ((point.z - previous.z) * i) / steps,
          SERVICE_RADIUS,
        )
      )
        return false;
    previous = point;
  }
  return true;
}

// Stop beside the wall, never inside the repaired building. Roads need no special access.
export function serviceWorkPoint(s, origin, target, kind, slot = 0, accepts = () => true) {
  const reach =
    kind === 'building' ? (BUILDINGS[target.key]?.size || 30) * 0.56 + SERVICE_RADIUS + 2 : 0;
  const center = kind === 'building' ? target : projectPoint(origin.x, origin.z, target);
  const candidates = [];
  if (kind === 'road') {
    candidates.push(center, { x: target.ax, z: target.az }, { x: target.bx, z: target.bz });
  } else {
    const initial = Math.atan2(origin.z - target.z, origin.x - target.x) + slot * 0.35;
    for (let i = 0; i < 16; i++) {
      const angle = initial + (i * Math.PI) / 8;
      candidates.push({
        x: target.x + Math.cos(angle) * reach,
        z: target.z + Math.sin(angle) * reach,
      });
    }
  }
  return (
    candidates
      .filter((p) => walkable(s, p.x, p.z, SERVICE_RADIUS) && accepts(p))
      .sort((a, b) => distance(a, origin) - distance(b, origin))[0] || null
  );
}

export function serviceFieldRoute(s, origin, target, kind, slot = 0) {
  const goal = serviceWorkPoint(s, origin, target, kind, slot);
  if (!goal) return null;
  if (distance(origin, goal) < 0.25) return { path: [], cost: 0 };
  const path = groundPath(s, origin, goal, SERVICE_RADIUS);
  if (!path.length || distance(path.at(-1), goal) > 0.5) return null;
  let cost = 0,
    previous = origin;
  for (const point of path) {
    cost += distance(previous, point);
    previous = point;
  }
  return { path, cost };
}

// A parked body or another returning van owns its physical bay. Ignore the van
// asking for a bay, including its own saved endpoint, so idle checks stay stable.
export function serviceParkingClear(s, point, self = null) {
  for (const u of s.groundUnits || []) {
    if (u === self || !(u.hp > 0) || u.carrierId || !GROUND_UNITS[u.key]) continue;
    if (distance(point, u) < SERVICE_RADIUS + (GROUND_UNITS[u.key].size || 3) * 0.42 + 0.7)
      return false;
  }
  for (const u of [...(s.serviceVehicles || []), ...(s.ammoVehicles || [])]) {
    if (u === self || (u.hp != null && u.hp <= 0)) continue;
    if (distance(point, u) < SERVICE_RADIUS * 2 + 0.7) return false;
    if (
      u.state === 'returning' &&
      u.path?.length &&
      distance(point, u.path.at(-1)) < SERVICE_RADIUS * 2 + 0.7
    )
      return false;
  }
  return true;
}

export function serviceParking(s, station, slot = 0, self = null) {
  const angle = (station.rotation || 0) + Math.PI * 0.25 + slot * Math.PI * 0.5;
  const origin = { x: station.x + Math.cos(angle) * 100, z: station.z + Math.sin(angle) * 100 };
  const reach = (BUILDINGS[station.key]?.size || 30) * 0.56 + SERVICE_RADIUS + 2;
  if (
    self &&
    self.state === 'idle' &&
    distance(self, station) <= reach + 1 &&
    walkable(s, self.x, self.z, SERVICE_RADIUS) &&
    serviceParkingClear(s, self, self)
  )
    return { x: self.x, z: self.z };
  return serviceWorkPoint(s, origin, station, 'building', slot, (p) =>
    serviceParkingClear(s, p, self),
  );
}
