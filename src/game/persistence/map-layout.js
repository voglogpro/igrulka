import { FIELD, expandLegacyZ } from '../map.js';
import { GROUND_UNITS } from '../config.js';
import { walkable, groundPath } from '../units/ground/navigation.js';
import { basePosition } from '../units/aviation/flight.js';

const zFields = new Set([
  'z',
  'az',
  'bz',
  'tz',
  'startZ',
  'prevZ',
  'originZ',
  'targetZ',
  'fromZ',
  'threatZ',
]);
function stretch(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (zFields.has(key) && Number.isFinite(child)) value[key] = expandLegacyZ(child);
    else if (child && typeof child === 'object') stretch(child);
  }
}

function dryPoint(s, point, radius, side) {
  if (walkable(s, point.x, point.z, radius)) return point;
  for (let distance = 12; distance <= 720; distance += 12)
    for (let i = 0; i < 16; i++) {
      const angle = (i * Math.PI) / 8 + (side === 0 ? Math.PI : 0);
      const x = point.x + Math.cos(angle) * distance;
      const z = point.z + Math.sin(angle) * distance;
      if (
        Math.abs(x) <= FIELD.x - radius &&
        Math.abs(z) <= FIELD.z - radius &&
        walkable(s, x, z, radius)
      )
        return { ...point, x, z };
    }
  return point;
}

// One-time spatial migration. Town centres, identities, inventories and paid work survive;
// corridor positions follow the enlarged coast, including oil fields and queued orders.
export function migrateMapLayout(s, sourceVersion) {
  if (sourceVersion >= 14) return;
  // Stretching is not uniform: a global progress fraction would jump aircraft backwards.
  // Keep their actual position as a waypoint so the next tick continues from that position.
  const airAnchors = new Map();
  for (const u of s.units || []) {
    if (!u.route?.length)
      u.route = [
        { x: u.startX, z: u.startZ, d: 0 },
        { x: u.tx, z: u.tz, d: u.total },
      ];
    const anchor = { x: u.x, z: u.z, d: u.travelled };
    let index = u.route.findIndex((p) => p.d > u.travelled);
    if (index < 0) index = u.route.length;
    u.route.splice(index, 0, anchor);
    if (u.route.length > 100) u.route.splice(index > 1 ? index - 1 : index + 1, 1);
    airAnchors.set(u, anchor);
  }
  for (const collection of [
    'buildings',
    'roads',
    'groundUnits',
    'units',
    'trenches',
    'serviceVehicles',
    'ships',
    'projectiles',
    'contacts',
    'frontlineMemory',
  ])
    stretch(s[collection]);
  for (const road of s.roads)
    if (road.length != null) road.length = Math.hypot(road.bx - road.ax, road.bz - road.az);
  for (const trench of s.trenches || []) Object.assign(trench, dryPoint(s, trench, 2, trench.side));
  for (const u of s.groundUnits || []) {
    if (u.carrierId) continue;
    const radius = (GROUND_UNITS[u.key]?.size || 3) * 0.42;
    Object.assign(u, dryPoint(s, u, radius, u.side));
    if (u.guard) u.guard = dryPoint(s, u.guard, radius, u.side);
    if (u.order && ['move', 'attackmove', 'guard', 'retreat'].includes(u.order.mode)) {
      const target = dryPoint(s, u.order, radius, u.side);
      u.order = target;
      u.path = groundPath(s, u, target, radius);
    } else if (u.path?.length) {
      const target = dryPoint(s, u.path.at(-1), radius, u.side);
      u.path = groundPath(s, u, target, radius);
    }
  }
  for (const u of s.units || []) {
    if (!u.route?.length) continue;
    let distance = 0;
    for (let i = 0; i < u.route.length; i++) {
      if (i)
        distance += Math.hypot(u.route[i].x - u.route[i - 1].x, u.route[i].z - u.route[i - 1].z);
      u.route[i].d = distance;
    }
    u.total = Math.max(1, distance);
    u.travelled = airAnchors.get(u).d;
    // The stretched route also changes the ballistic height parameter. Blend its small
    // residual smoothly instead of changing altitude and vertical velocity on the first tick.
    if (u.hp > 0 && u.status !== 'falling')
      u.flightHeightOffset = u.y - basePosition(u, u.travelled).y;
  }
  // Old contact and path caches cannot describe the new terrain.
  s.networkRevision = (s.networkRevision || 0) + 1;
}
