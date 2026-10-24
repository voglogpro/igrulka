import { FIELD } from '../map.js';
import { FRONTLINE as C, FRONT_SECTORS, FORTIFICATION } from './config.js';
import { createFrontlineMemory } from './frontline.js';

const object = (v) => v && typeof v === 'object' && !Array.isArray(v);
const point = (v) =>
  object(v) &&
  [v.x, v.z].every(Number.isFinite) &&
  Math.abs(v.x) <= FIELD.x &&
  Math.abs(v.z) <= FIELD.z;
const finite = (v) => Number.isFinite(v) && v >= 0;
const id = (v) => Number.isSafeInteger(v) && v > 0;
export function restoreDefense(s) {
  if (s.version < 12) s.frontlineMemory = createFrontlineMemory();
  if (!Array.isArray(s.frontlineMemory) || s.frontlineMemory.length !== 2)
    throw Error('Повреждена память фронта');
  s.frontlineMemory = s.frontlineMemory.map((memory, side) => {
    if (
      !object(memory) ||
      !finite(memory.nextThink) ||
      memory.nextThink > s.time + C.cadence + 1e-6 ||
      !Array.isArray(memory.seen) ||
      memory.seen.length > C.maxSeen
    )
      throw Error('Повреждена разведка фронта');
    const ids = new Set();
    const seen = memory.seen.map((v) => {
      if (
        !point(v) ||
        !id(v.id) ||
        ids.has(v.id) ||
        !finite(v.time) ||
        v.time > s.time ||
        !Number.isFinite(v.strength) ||
        v.strength <= 0 ||
        v.strength > 4 ||
        s.groundUnits.some((u) => u.id === v.id && u.side === side)
      )
        throw Error('Повреждён контакт фронта');
      ids.add(v.id);
      return { id: v.id, x: v.x, z: v.z, strength: v.strength, time: v.time };
    });
    return { nextThink: memory.nextThink, seen };
  });
  for (const u of s.groundUnits) {
    if (u.autoDefense != null && typeof u.autoDefense !== 'boolean')
      throw Error('Повреждён резерв обороны');
    if (u.defenseReadyAt != null && !finite(u.defenseReadyAt))
      throw Error('Повреждено ожидание резерва');
    if (u.defenseTask != null) {
      const task = u.defenseTask;
      if (
        !object(task) ||
        !FRONT_SECTORS.some((v) => v.id === task.sectorId) ||
        !point(task.home) ||
        !finite(task.assignedAt) ||
        task.assignedAt > s.time ||
        !finite(task.until) ||
        typeof task.returning !== 'boolean' ||
        !u.guard
      )
        throw Error('Повреждена задача обороны');
      u.defenseTask = {
        sectorId: task.sectorId,
        home: { x: task.home.x, z: task.home.z },
        assignedAt: task.assignedAt,
        until: task.until,
        returning: task.returning,
      };
    }
    if (s.version < 12) {
      u.autoDefense = false;
      u.defenseTask = null;
    }
  }
  for (const t of s.trenches) {
    if (
      t.fortificationWork != null &&
      (!finite(t.fortificationWork) ||
        t.fortificationWork > FORTIFICATION.maxWork ||
        (t.progress < 1 && t.fortificationWork > 0))
    )
      throw Error('Повреждено укрепление позиции');
  }
}
