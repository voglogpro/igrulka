import {
  FIELD,
  OIL_FIELDS,
  LEGACY_OIL_FIELDS,
  V22_OIL_FIELDS,
  seaDistance,
  expandLegacyZ,
  expandLegacyX,
  expandV23X,
} from '../map.js';
import { GROUND_UNITS } from '../config.js';
import { walkable, groundPath } from '../units/ground/navigation.js';
import { basePosition } from '../units/aviation/flight.js';
import { berthOf } from '../city/ports.js';
import { invalidateStaticGeometry } from '../shared/static-spatial.js';

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
const xFields = new Set(
  [...zFields].map((field) => field.replace(/z$/i, (suffix) => (suffix === 'Z' ? 'X' : 'x'))),
);
function stretch(value, fields, transform) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (fields.has(key) && Number.isFinite(child)) value[key] = transform(child);
    else if (child && typeof child === 'object') stretch(child, fields, transform);
  }
}
// Keep the island's quays fixed while expanding the open-water leg of merchant routes.
function stretchShipX(x) {
  const value = Math.abs(x);
  if (value <= 100) return expandV23X(x);
  if (value >= 240) return expandV23X(expandLegacyX(x));
  return expandV23X(Math.sign(x) * (100 + ((value - 100) * 540) / 140));
}
// Pre-15 positions cross both map changes; the island quays (|x| <= 100) never move.
const legacyX = (x) => expandV23X(expandLegacyX(x));

function portShore(point) {
  const original = seaDistance(point.x, point.z);
  if (original >= 8 && original <= 34) return point;
  let { x, z } = point;
  // Project only invalid old ports to the nearby 20 m contour. A finite-difference
  // normal also handles the rounded north/south shore, without snapping city land.
  for (let i = 0; i < 32; i++) {
    const distance = seaDistance(x, z),
      error = 20 - distance;
    if (Math.abs(error) < 1e-5) break;
    const dx = (seaDistance(x + 1, z) - seaDistance(x - 1, z)) / 2;
    const dz = (seaDistance(x, z + 1) - seaDistance(x, z - 1)) / 2;
    const length = Math.hypot(dx, dz);
    if (length < 1e-6) break;
    const step = Math.max(-128, Math.min(128, error / length));
    x = Math.max(-FIELD.x, Math.min(FIELD.x, x + (dx / length) * step));
    z = Math.max(-FIELD.z, Math.min(FIELD.z, z + (dz / length) * step));
  }
  return { x, z };
}

function spatialBuildingAnchors(s, sourceVersion) {
  const anchors = [];
  for (const building of s.buildings) {
    let target = null;
    if (building.key === 'oilwell') {
      for (const old of sourceVersion < 15 ? LEGACY_OIL_FIELDS : V22_OIL_FIELDS) {
        const z = sourceVersion < 14 || sourceVersion >= 15 ? old.z : expandLegacyZ(old.z);
        const dx = building.x - old.x,
          dz = building.z - z;
        if (Math.hypot(dx, dz) > old.r * 0.7 + 1e-6) continue;
        const field = OIL_FIELDS.find((f) => f.id === old.id);
        target = { x: field.x + dx, z: field.z + dz };
        break;
      }
    }
    if (building.key !== 'port' && !target) continue;
    // A driveway's road junction follows the map transform. Its building-facing
    // endpoint keeps its original metre offset, since buildings are not scaled.
    const connectors = s.roads
      .filter((road) => road.connectorTo === building.id)
      .map((road) => {
        const a = Math.hypot(road.ax - building.x, road.az - building.z);
        const b = Math.hypot(road.bx - building.x, road.bz - building.z);
        const end = a < b ? 'a' : 'b';
        return { road, end, dx: road[`${end}x`] - building.x, dz: road[`${end}z`] - building.z };
      });
    anchors.push({ building, target, connectors });
  }
  return anchors;
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
  if (sourceVersion >= 15) return;
  migrateLayout(s, sourceVersion);
  repairLegacyPositions(s);
}

// Collections that hold map positions. Velocities (vx/vz) are recomputed, never stretched.
const SPATIAL = [
  'buildings',
  'roads',
  'groundUnits',
  'units',
  'trenches',
  'serviceVehicles',
  'ammoVehicles',
  'ammoCrates',
  'groundScars',
  'ships',
  'projectiles',
  'contacts',
  'frontlineMemory',
];

// State 23 moves both banks 200 m apart and deepens the corridors. The transform is monotone,
// keeps towns, villages and the coast rigid and only stretches open water and empty corridor
// ground, so every dry position stays dry and every street keeps its buildings.
// It runs before settlements and oil are validated against their new sites.
export function migrateV23Layout(s, sourceVersion) {
  if (sourceVersion < 15 || sourceVersion >= 23) return;
  migrateLayout(s, sourceVersion);
}

function migrateLayout(s, sourceVersion) {
  const legacy = sourceVersion < 15;
  const transform = legacy ? legacyX : expandV23X;
  const buildingAnchors = spatialBuildingAnchors(s, sourceVersion);
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
  for (const collection of legacy
    ? [
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
      ]
    : SPATIAL) {
    if (sourceVersion < 14) stretch(s[collection], zFields, expandLegacyZ);
    stretch(s[collection], xFields, legacy && collection === 'ships' ? stretchShipX : transform);
  }
  for (const { building, target, connectors } of buildingAnchors) {
    Object.assign(building, target || (legacy ? portShore(building) : {}));
    for (const { road, end, dx, dz } of connectors) {
      road[`${end}x`] = building.x + dx;
      road[`${end}z`] = building.z + dz;
    }
  }
  // Recompute velocity from the remaining segment; position and hit time stay continuous.
  for (const p of s.projectiles || []) {
    if (p.domain !== 'ground' || !(p.flight > p.life)) continue;
    const remaining = p.flight - p.life;
    p.vx = (p.tx - p.x) / remaining;
    p.vz = (p.tz - p.z) / remaining;
  }
  for (const road of s.roads)
    if (road.length != null) road.length = Math.hypot(road.bx - road.ax, road.bz - road.az);
  for (const ship of s.ships || []) {
    const port = s.buildings.find((b) => b.id === ship.portId);
    if (!port) continue;
    const berth = berthOf(port);
    if (ship.state === 'docked') Object.assign(ship, berth);
    else if (ship.state === 'returning' && ship.path?.length)
      ship.path[ship.path.length - 1] = berth;
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
  invalidateStaticGeometry(s, 'trenches');
}

function repairLegacyPositions(s) {
  for (const trench of s.trenches || []) Object.assign(trench, dryPoint(s, trench, 2, trench.side));
  invalidateStaticGeometry(s, 'trenches');
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
}
