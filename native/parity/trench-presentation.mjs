import { isInfantry } from '../../src/game/config.js';
import {
  presentationTrenchLayout,
  drawingIdsAt,
  drawingRecord,
  drawingRecordsAlongRay,
} from './trench-link-layout.mjs';

let activeWorld;
const rounds = new WeakMap();
const unitIndices = new WeakMap();
function presentationUnit(world, id) {
  const state = world.state,
    units = state.groundUnits || [];
  let cache = unitIndices.get(world);
  if (
    !cache ||
    cache.state !== state ||
    cache.units !== units ||
    cache.time !== state.time ||
    cache.count !== units.length
  ) {
    cache = {
      state,
      units,
      time: state.time,
      count: units.length,
      index: new Map(units.map((unit) => [unit.id, unit])),
    };
    unitIndices.set(world, cache);
  }
  return cache.index.get(Number(id));
}
const smooth = (a, b, v) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export function bindPresentationWorld(world) {
  activeWorld = world;
  presentationTrenchLayout(world, true);
}
export function presentationEnabled() {
  return globalThis.__SKYFRONT_NATIVE__?.enhancedGraphics === true;
}
// Same capsule, 1.55m excavation and end ramps as the native trench geometry.
// This is a drawing floor, never written into authoritative unit coordinates.
export function trenchDepth(record, x, z) {
  if (!record) return 0;
  const c = Math.cos(record.yaw || 0),
    s = Math.sin(record.yaw || 0);
  const dx = x - record.x,
    dz = z - record.z;
  const along = (dx * c - dz * s) / ((record.stretch || 1) * Math.cos(record.roll || 0));
  const across = (dx * s + dz * c) / (record.widthScale || 1);
  if (record.connector) {
    if (Math.abs(along) > 9) return 0;
    return (
      1.55 *
      smooth(0, 0.75, record.progress || 0) *
      smooth(0, 0.65, 2.2 - Math.abs(across)) *
      (record.rampStart ? smooth(0, 8.4, along + 9) : 1) *
      (record.rampEnd ? smooth(0, 8.4, 9 - along) : 1)
    );
  }
  const distance = Math.hypot(Math.max(0, Math.abs(along) - 6.8), across);
  return (
    1.55 *
    smooth(0, 0.75, record.progress || 0) *
    smooth(0, 2.8, 9 - Math.abs(along)) *
    smooth(0, 0.65, 2.2 - distance)
  );
}
export function trenchSurfaceY(record, x, z) {
  if (!record) return 0;
  const c = Math.cos(record.yaw || 0),
    s = Math.sin(record.yaw || 0);
  return (record.y || 0) + ((x - record.x) * c - (z - record.z) * s) * Math.tan(record.roll || 0);
}
export function presentationFloor(world, x, z, selected = null) {
  const layout = presentationTrenchLayout(world);
  let floor = -Infinity,
    found = null;
  for (const id of drawingIdsAt(layout, x, z)) {
    const record = world.fortifications?.models.get(id) || drawingRecord(layout, id);
    const depth = trenchDepth(record, x, z);
    if (!(depth > 0)) continue;
    const y = trenchSurfaceY(record, x, z) - depth * Math.cos(record.roll || 0);
    // Where visible source channels touch, choose the topmost actual floor,
    // matching the depth-tested overlapping earth surfaces.
    if (y > floor) {
      floor = y;
      found = id;
    }
  }
  if (selected) selected.id = found;
  return found !== null ? floor : Math.max(0, world.height(x, z));
}
export function presentationOffset(world, unit, x = unit.x, z = unit.z) {
  if (!presentationEnabled() || !isInfantry(unit.key) || unit.carrierId) return 0;
  const floor = presentationFloor(world, x, z);
  const base = unit.y || 1;
  // Source art roots float about one metre above terrain. The enhanced drawing
  // contract puts feet on the actual floor both outside and inside the ramp.
  return floor + 0.05 - base;
}
export const presentationUnitY = (world, unit, x = unit.x, z = unit.z) =>
  (unit.y || 1) + presentationOffset(world, unit, x, z);
export const presentationModelY = (unit) =>
  activeWorld ? presentationUnitY(activeWorld, unit) : unit.y || 1;
export function presentationCorpseY(world, unit, y, x = unit.x, z = unit.z) {
  if (!presentationEnabled()) return y;
  return y + presentationFloor(world, x, z);
}
export function presentationCorpseTrench(world, event) {
  if (!presentationEnabled()) return null;
  const selected = { id: null };
  presentationFloor(world, event.x, event.z, selected);
  return selected.id;
}
export function presentationShadowY(unit, original) {
  if (!presentationEnabled() || !activeWorld || !isInfantry(unit.key)) return original;
  return 0.035 + presentationFloor(activeWorld, unit.x, unit.z);
}
export function presentationGroundPoint(world, ray, original) {
  if (!original || !presentationEnabled() || Math.abs(ray.direction.y) < 1e-5) return original;
  const layout = presentationTrenchLayout(world);
  let closest = Infinity,
    hit = original;
  for (const record of drawingRecordsAlongRay(layout, ray)) {
    const point = original.clone();
    const directionAlong =
      ray.direction.x * Math.cos(record.yaw || 0) - ray.direction.z * Math.sin(record.yaw || 0);
    const denominator = ray.direction.y - directionAlong * Math.tan(record.roll || 0);
    if (Math.abs(denominator) < 1e-5) continue;
    const initial =
      (trenchSurfaceY(record, ray.origin.x, ray.origin.z) - ray.origin.y) / denominator;
    if (initial <= 0) continue;
    ray.at(initial, point);
    if (!trenchDepth(record, point.x, point.z)) continue;
    for (let i = 0; i < 5; i++) {
      const depth = trenchDepth(record, point.x, point.z);
      const floor = trenchSurfaceY(record, point.x, point.z) - depth * Math.cos(record.roll || 0);
      const distance = (floor - ray.origin.y) / ray.direction.y;
      if (distance < 0) break;
      ray.at(distance, point);
    }
    if (trenchDepth(record, point.x, point.z) > 0.02) {
      const distance = point.distanceTo(ray.origin);
      if (distance < closest) {
        closest = distance;
        hit = point;
      }
    }
  }
  return hit;
}
export function presentationMuzzleEvent(world, event) {
  // The source barrel-tip resolver has already sampled the moved CPU model.
  if (event.barrelTip) return event;
  const unit = presentationUnit(world, event.buildingId);
  if (!unit || !isInfantry(unit.key)) return event;
  const offset = presentationOffset(world, unit);
  return offset ? { ...event, my: event.my + offset } : event;
}
export function presentationProjectilePoint(p, ahead, point) {
  if (!presentationEnabled() || !activeWorld) return point;
  let offsets = rounds.get(p);
  if (!offsets) {
    const source = presentationUnit(activeWorld, p.sourceId ?? p.source);
    const target = presentationUnit(activeWorld, p.targetId);
    offsets = {
      from: source ? presentationOffset(activeWorld, source) : 0,
      to: target ? presentationOffset(activeWorld, target) : 0,
    };
    rounds.set(p, offsets);
  }
  const k = Math.max(0, Math.min(1, (p.life + ahead) / (p.flight || 0.35)));
  point.y += offsets.from * (1 - k) + offsets.to * k;
  return point;
}
