import { clamp } from '../../shared/math.js';
import { FIELD, GROUND_UNITS, isInfantry } from '../../config.js';

const squadId = (id) => Number.isSafeInteger(id) && id > 0;

export function squadArrivalPoint(value) {
  const goal = Object.hasOwn(value, 'destination') ? value.destination : value.squadGoal;
  const d = GROUND_UNITS[value.key];
  if (!goal || !d) return null;
  const slot = value.squadSlot ?? 0;
  const offsets = [
    [0, 0],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [1, 1],
  ];
  if (!Number.isInteger(slot) || !offsets[slot]) return null;
  const spacing = isInfantry(value.key) ? Math.max(8, d.size + 4) : Math.max(18, d.size + 7);
  return {
    x: goal.x + offsets[slot][0] * spacing,
    z: goal.z + offsets[slot][1] * spacing,
    mode: goal.mode || 'attackmove',
  };
}

export function squadDestination(point) {
  if (point === null) return null;
  if (
    !point ||
    typeof point !== 'object' ||
    Array.isArray(point) ||
    ![point.x, point.z].every(Number.isFinite) ||
    Math.abs(point.x) > FIELD.x ||
    Math.abs(point.z) > FIELD.z ||
    (point.mode != null && !['move', 'attackmove'].includes(point.mode))
  )
    return undefined;
  return {
    x: clamp(point.x, -(FIELD.x - 14), FIELD.x - 14),
    z: clamp(point.z, -(FIELD.z - 14), FIELD.z - 14),
    mode: point.mode || 'attackmove',
  };
}

export function squadRoster(s, side) {
  if (![0, 1].includes(side)) return [];
  const roster = new Map();
  const get = (value, goal) => {
    if (!roster.has(value.squadId))
      roster.set(value.squadId, {
        id: value.squadId,
        key: value.key,
        ids: [],
        queued: 0,
        goal: goal ? { ...goal } : null,
      });
    return roster.get(value.squadId);
  };
  for (const u of s.groundUnits)
    if (u.side === side && u.hp > 0 && squadId(u.squadId)) get(u, u.squadGoal).ids.push(u.id);
  for (const b of s.buildings)
    if (b.side === side && b.key === 'barracks' && b.hp > 0 && !b.demolished)
      for (const q of b.armyQueue || []) if (squadId(q.squadId)) get(q, q.destination).queued++;
  return [...roster.values()]
    .sort((a, b) => a.id - b.id)
    .map((value) => ({ ...value, ids: value.ids.sort((a, b) => a - b) }));
}

// Only a complete selected field group can redirect its paid reinforcements.
// Existing field orders are issued by the caller, not by this metadata operation.
export function retargetSquadReserves(s, side, ids, point) {
  if (s.result || ![0, 1].includes(side) || !Array.isArray(ids)) return 0;
  const destination = squadDestination(point);
  if (destination === undefined) return 0;
  const selected = new Set(ids);
  const own = s.groundUnits.filter((u) => u.side === side && u.hp > 0 && squadId(u.squadId));
  const groups = new Set(
    own.filter((u) => !u.carrierId && selected.has(u.id)).map((u) => u.squadId),
  );
  let count = 0;
  for (const id of groups) {
    const members = own.filter((u) => u.squadId === id);
    if (members.some((u) => !u.carrierId && !selected.has(u.id))) continue;
    for (const u of members) u.squadGoal = destination ? { ...destination } : null;
    for (const b of s.buildings)
      if (b.side === side && b.key === 'barracks' && b.hp > 0 && !b.demolished)
        for (const q of b.armyQueue || [])
          if (q.squadId === id) q.destination = destination ? { ...destination } : null;
    count++;
  }
  return count;
}
