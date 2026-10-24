import { FIELD } from '../map.js';
import { BUILDINGS } from '../city/buildings.config.js';
const object = (v) => v && typeof v === 'object' && !Array.isArray(v);
const id = (v) => Number.isSafeInteger(v) && v > 0;
const point = (p) =>
  object(p) &&
  Number.isFinite(p.x) &&
  Number.isFinite(p.z) &&
  Math.abs(p.x) <= FIELD.x &&
  Math.abs(p.z) <= FIELD.z;

export function restoreServices(s) {
  for (const b of s.buildings)
    if (
      Object.hasOwn(b, 'serviceEnabled') &&
      (b.key !== 'service' || typeof b.serviceEnabled !== 'boolean')
    )
      throw Error('Повреждена ремонтная станция');
  if (s.version < 11 && s.serviceVehicles == null) s.serviceVehicles = [];
  const cfg = BUILDINGS.service.service;
  if (!Array.isArray(s.serviceVehicles) || s.serviceVehicles.length > cfg.sideLimit * 2)
    throw Error('Повреждены ремонтные бригады');
  const ids = new Set(),
    counts = new Map();
  s.serviceVehicles = s.serviceVehicles.map((v) => {
    const station = s.buildings.find(
      (b) => b.id === v?.stationId && b.key === 'service' && b.side === v.side,
    );
    if (
      !object(v) ||
      !id(v.id) ||
      ids.has(v.id) ||
      ![0, 1].includes(v.side) ||
      !id(v.stationId) ||
      !station ||
      !point(v) ||
      !Number.isFinite(v.yaw) ||
      !['idle', 'outbound', 'repairing', 'returning', 'blocked'].includes(v.state) ||
      !Number.isInteger(v.revision) ||
      v.revision < 0 ||
      v.revision > s.networkRevision ||
      !Number.isFinite(v.thinkAt) ||
      v.thinkAt < 0 ||
      (v.dispatchCursor != null &&
        (!Number.isSafeInteger(v.dispatchCursor) ||
          v.dispatchCursor < 0 ||
          v.dispatchCursor > 5000)) ||
      !Array.isArray(v.path) ||
      v.path.length > 12000 ||
      !v.path.every(point) ||
      !Array.isArray(v.roadIds) ||
      v.roadIds.length > 3000 ||
      !v.roadIds.every(id) ||
      (v.target !== null &&
        (!object(v.target) || !['building', 'road'].includes(v.target.kind) || !id(v.target.id)))
    )
      throw Error('Повреждена ремонтная бригада');
    if (
      s.buildings.some((b) => b.id === v.id) ||
      s.roads.some((r) => r.id === v.id) ||
      s.groundUnits.some((u) => u.id === v.id) ||
      s.units.some((u) => u.id === v.id)
    )
      throw Error('Повторный номер ремонтной бригады');
    if (v.target) {
      const list = v.target.kind === 'building' ? s.buildings : s.roads;
      const t = list.find((t) => t.id === v.target.id);
      // A target may have been demolished between this service tick and the save.
      if (t && t.side !== v.side) throw Error('Чужая ремонтная задача');
    }
    ids.add(v.id);
    const count = (counts.get(v.stationId) || 0) + 1;
    counts.set(v.stationId, count);
    if (count > cfg.vehicles) throw Error('Слишком много ремонтных бригад');
    return {
      id: v.id,
      side: v.side,
      stationId: v.stationId,
      x: v.x,
      z: v.z,
      yaw: v.yaw,
      state: v.state,
      target: v.target && { kind: v.target.kind, id: v.target.id },
      path: v.path.map(({ x, z }) => ({ x, z })),
      roadIds: [...v.roadIds],
      revision: v.revision,
      thinkAt: v.thinkAt,
      dispatchCursor: v.dispatchCursor ?? 0,
    };
  });
  if (
    [0, 1].some((side) => s.serviceVehicles.filter((v) => v.side === side).length > cfg.sideLimit)
  )
    throw Error('Лимит ремонтных бригад');
  if (
    s.serviceVehicles.length &&
    (!id(s.nextId) || s.serviceVehicles.some((v) => v.id >= s.nextId))
  )
    throw Error('Повреждён счётчик ремонтных бригад');
}
