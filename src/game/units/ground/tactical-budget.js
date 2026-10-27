import { GROUND_UNITS } from '../../config.js';
import { groundPath } from './navigation.js';

export const TACTICAL_PATH_LIMIT = 2;
export const TACTICAL_RECOVERY_STAY = 2.5;
export const TACTICAL_RECOVERED_SUPPRESSION = 0.18;
const CELL = 32,
  frames = new WeakMap();

function groupKey(u) {
  const group =
    u.squadId != null
      ? `squad:${u.squadId}`
      : u.defenseCapture
        ? `capture:${u.defenseCapture.districtId}`
        : u.defensePost
          ? `${u.defensePost.corridorId}:${Math.floor(u.defensePost.slot / 2)}`
          : `${Math.floor((u.guard?.x ?? u.x) / 160)},${Math.floor((u.guard?.z ?? u.z) / 160)}`;
  return `${u.side}:${group}`;
}

function frame(s) {
  let value = frames.get(s);
  if (value?.time === s.time) return value;
  value = {
    time: s.time,
    searches: 0,
    bySide: new Map(),
    groups: new Map(),
    cells: new Map(),
    transports: new Set(),
    returnSides: new Set(),
    activeSides: [],
  };
  const active = new Set();
  for (const u of s.groundUnits) {
    if (u.hp > 0) {
      if (u.carrierId != null) value.transports.add(u.carrierId);
      if (u.boardingId != null) value.transports.add(u.boardingId);
    }
    const d = GROUND_UNITS[u.key];
    if (u.hp <= 0 || u.carrierId || u.downed || !d) continue;
    const point = u.order?.mode === 'cover' ? u.order : u;
    const cell = `${u.side}:${Math.floor(point.x / CELL)},${Math.floor(point.z / CELL)}`;
    if (!value.cells.has(cell)) value.cells.set(cell, []);
    value.cells.get(cell).push({ id: u.id, point });
    if (u.autoDefense && u.guard && !d.support) {
      const key = groupKey(u);
      if (!value.groups.has(key)) value.groups.set(key, { members: 0, covering: 0 });
      const group = value.groups.get(key);
      group.members++;
      if (u.order?.mode === 'cover') group.covering++;
    }
    if (
      d.support ||
      u.civil ||
      u.boardingId ||
      u.delivery ||
      u.supplyTrip ||
      u.holdFire ||
      u.camouflaged ||
      (u.guard && !u.autoDefense)
    )
      continue;
    if (
      u.order?.mode === 'cover' ||
      s.time - (u.threatAt ?? -Infinity) < 4 ||
      (u.enemyId != null && (u.groundReload > 0 || u.groundAmmo === 0))
    )
      active.add(u.side);
    if (
      u.order?.mode === 'cover' &&
      !u.path?.length &&
      ((u.suppression || 0) < TACTICAL_RECOVERED_SUPPRESSION ||
        (u.groundAmmo === 0 && !u.ammoReserve))
    )
      value.returnSides.add(u.side);
  }
  value.activeSides = [...active].sort((a, b) => a - b);
  frames.set(s, value);
  return value;
}

export function canTacticalDisengage(s, u) {
  if (!u.autoDefense || !u.guard) return true;
  const group = frame(s).groups.get(groupKey(u));
  return !group || group.covering < Math.max(1, Math.floor(group.members / 3));
}

export function tacticalTransportBusy(s, u) {
  return !!GROUND_UNITS[u.key]?.capacity && frame(s).transports.has(u.id);
}

export function tacticalCrowd(s, u, p) {
  const f = frame(s),
    ids = new Set();
  for (let z = Math.floor((p.z - 8) / CELL); z <= Math.floor((p.z + 8) / CELL); z++)
    for (let x = Math.floor((p.x - 8) / CELL); x <= Math.floor((p.x + 8) / CELL); x++)
      for (const record of f.cells.get(`${u.side}:${x},${z}`) || [])
        if (record.id !== u.id && Math.hypot(record.point.x - p.x, record.point.z - p.z) < 6)
          ids.add(record.id);
  return ids.size;
}

export function noteTacticalDisengage(s, u, point, entering = true) {
  const f = frame(s);
  if (entering && u.autoDefense && u.guard) {
    const group = f.groups.get(groupKey(u));
    if (group) group.covering++;
  }
  const key = `${u.side}:${Math.floor(point.x / CELL)},${Math.floor(point.z / CELL)}`;
  if (!f.cells.has(key)) f.cells.set(key, []);
  f.cells.get(key).push({ id: u.id, point });
}

export function tacticalPathAvailable(s, u, returning = false) {
  const f = frame(s);
  if (f.searches >= TACTICAL_PATH_LIMIT) return false;
  const sides = f.activeSides;
  if (sides.length > 1) {
    const first = Math.round(s.time * 20) % sides.length;
    if (u.side !== sides[first] && u.side !== sides[(first + 1) % sides.length]) return false;
    if ((f.bySide.get(u.side) || 0) >= 1 || (!returning && f.returnSides.has(u.side))) return false;
  } else if (!returning && f.returnSides.size && f.searches >= TACTICAL_PATH_LIMIT - 1)
    return false;
  return true;
}

export function tacticalPath(s, u, point, returning = false) {
  if (!tacticalPathAvailable(s, u, returning)) return null;
  const f = frame(s);
  f.searches++;
  f.bySide.set(u.side, (f.bySide.get(u.side) || 0) + 1);
  return groundPath(s, u, point, GROUND_UNITS[u.key].size * 0.42);
}

export function tacticalBudgetMetrics(s) {
  const f = frames.get(s);
  return f?.time === s.time
    ? { searches: f.searches, limit: TACTICAL_PATH_LIMIT, bySide: Object.fromEntries(f.bySide) }
    : { searches: 0, limit: TACTICAL_PATH_LIMIT, bySide: {} };
}
