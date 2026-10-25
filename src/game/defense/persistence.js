import { allied } from '../factions.js';
import { FIELD } from '../map.js';
import { FRONTLINE as C, FRONT_SECTORS, FORTIFICATION } from './config.js';
import { createFrontlineMemory } from './frontline.js';
import { corridorGeometry } from './geometry.js';
import { DISTRICTS } from '../territory/districts.config.js';

const object = (v) => v && typeof v === 'object' && !Array.isArray(v);
const point = (v) =>
  object(v) &&
  [v.x, v.z].every(Number.isFinite) &&
  Math.abs(v.x) <= FIELD.x &&
  Math.abs(v.z) <= FIELD.z;
const finite = (v) => Number.isFinite(v) && v >= 0;
const id = (v) => Number.isSafeInteger(v) && v > 0;
export function restoreDefense(s) {
  if (s.version < 12) s.frontlineMemory = createFrontlineMemory(s.sides.length);
  if (!Array.isArray(s.frontlineMemory) || s.frontlineMemory.length !== s.sides.length)
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
        s.groundUnits.some((u) => u.id === v.id && allied(s, u.side, side))
      )
        throw Error('Повреждён контакт фронта');
      ids.add(v.id);
      return { id: v.id, x: v.x, z: v.z, strength: v.strength, time: v.time };
    });
    if (
      memory.nextReinforce != null &&
      (!finite(memory.nextReinforce) ||
        memory.nextReinforce > s.time + C.reinforcementCadence + 1e-6)
    )
      throw Error('Повреждён такт усиления обороны');
    return { nextThink: memory.nextThink, nextReinforce: memory.nextReinforce ?? 0, seen };
  });
  for (const u of s.groundUnits) {
    if (s.version < 15) {
      // Keep the physical guard location; the new planner assigns new posts through real paths.
      u.defensePost = null;
      u.defenseCapture = null;
      u.defenseTask = null;
    }
    if (u.autoDefense != null && typeof u.autoDefense !== 'boolean')
      throw Error('Повреждён резерв обороны');
    if (u.defenseReadyAt != null && !finite(u.defenseReadyAt))
      throw Error('Повреждено ожидание резерва');
    if (u.defensePost != null) {
      const post = u.defensePost;
      const line = corridorGeometry(s, u.side).find((v) => v.id === post.corridorId);
      if (
        !object(post) ||
        !line ||
        !Number.isInteger(post.slot) ||
        !line.slots[post.slot] ||
        !Number.isInteger(post.row) ||
        post.row < 0 ||
        post.row >= C.maxRows ||
        !u.guard ||
        !u.autoDefense
      )
        throw Error('Повреждён оборонный пост');
      u.defensePost = { corridorId: post.corridorId, slot: post.slot, row: post.row };
    }
    if (u.defenseCapture != null) {
      const capture = u.defenseCapture;
      if (
        !object(capture) ||
        !DISTRICTS.some((v) => v.id === capture.districtId) ||
        !finite(capture.assignedAt) ||
        capture.assignedAt > s.time ||
        !u.defensePost ||
        !u.autoDefense
      )
        throw Error('Повреждён приказ захвата');
      u.defenseCapture = { districtId: capture.districtId, assignedAt: capture.assignedAt };
    }
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
