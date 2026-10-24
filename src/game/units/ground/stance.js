import { GROUND_UNITS, isInfantry, riverX } from '../../config.js';
import { BRIDGES, walkable } from './navigation.js';
import { orderGround } from './orders.js';
import { guardGround } from './guard.js';

// A stance is a standing order that outlives a single click: new units take it when they leave
// the barracks. "attack" advances on the enemy headquarters with combat stops, "defend" holds
// the home end of a bridge and digs in.
export const STANCE_MODES = ['attack', 'defend'];
export const DEFEND_POSTS = ['auto', 'north', 'south'];
export const POST_NAMES = { north: 'Северный мост', south: 'Южный мост' };
const BRIDGE_Z = { north: BRIDGES[0], south: BRIDGES[1] };
const POST_OFFSET = 92;

export function validStance(stance) {
  return (
    stance === null ||
    (!!stance &&
      typeof stance === 'object' &&
      !Array.isArray(stance) &&
      STANCE_MODES.includes(stance.mode) &&
      (stance.mode === 'attack' || DEFEND_POSTS.includes(stance.post ?? 'auto')))
  );
}

export function bridgePoint(side, post) {
  const z = BRIDGE_Z[post];
  const x = riverX(z) + (side === 0 ? -POST_OFFSET : POST_OFFSET);
  return { x, z };
}

function defenders(s, side, post) {
  return s.groundUnits.filter(
    (u) => u.side === side && u.hp > 0 && u.stance?.mode === 'defend' && u.stance.post === post,
  ).length;
}

// "auto" sends the group to the bridge that currently has fewer defenders.
export function chooseBridge(s, side) {
  const north = defenders(s, side, 'north'),
    south = defenders(s, side, 'south');
  return north <= south ? 'north' : 'south';
}

export function stanceLabel(stance) {
  if (!stance) return 'Приказ вручную';
  return stance.mode === 'attack'
    ? 'Атака'
    : `Оборона · ${POST_NAMES[stance.post] || 'мост по загрузке'}`;
}

export function applyStance(s, side, ids, stance) {
  if (s.result) return 'Кампания завершена';
  if (!validStance(stance) || !stance) return 'Неизвестный режим';
  const units = (s.groundUnits || []).filter(
    (u) => u.side === side && u.hp > 0 && !u.carrierId && !u.downed && ids.includes(u.id),
  );
  if (!units.length) return 'Выберите доступные наземные отряды';
  if (stance.mode === 'attack') {
    const hq = s.buildings.find((b) => b.side !== side && b.key === 'hq' && b.hp > 0);
    if (!hq) return 'Нет цели для атаки';
    const result = orderGround(s, side, ids, {
      x: hq.x,
      z: hq.z,
      targetId: hq.id,
      mode: 'attackmove',
    });
    if (typeof result !== 'number') return result;
    for (const u of units) if (u.order) u.stance = { mode: 'attack' };
    return result;
  }
  const post = stance.post && stance.post !== 'auto' ? stance.post : chooseBridge(s, side);
  const point = bridgePoint(side, post);
  const result = guardGround(s, side, ids, point);
  if (typeof result === 'string') return result;
  let assigned = 0;
  for (const u of units)
    if (u.guard) {
      u.stance = { mode: 'defend', post };
      u.entrenched = false;
      assigned++;
    }
  return assigned || 'Нет свободного доступного места для поста';
}

export function clearStance(u) {
  u.stance = null;
}

// Defenders dig in once they stand at their post and nobody is shooting at them.
export function updateStance(s, u) {
  if (u.stance?.mode !== 'defend' || !u.guard || !isInfantry(u.key) || u.digging) return;
  if (u.path?.length || u.moving || u.enemyId != null || (u.suppression || 0) > 0.3) return;
  if (Math.hypot(u.x - u.guard.x, u.z - u.guard.z) > 4) return;
  let t = s.trenches.find((t) => Math.hypot(t.x - u.x, t.z - u.z) < 4 && t.side === u.side);
  if (t?.progress >= 1) return;
  if (!t && s.trenches.length < 240) {
    t = { id: s.nextId++, side: u.side, x: u.x, z: u.z, progress: 0, yaw: u.yaw || 0 };
    s.trenches.push(t);
  }
  if (!t) return;
  u.trenchId = t.id;
  u.digging = true;
}

export const stanceMobile = (u) => !!GROUND_UNITS[u.key] && !isInfantry(u.key);
export const postWalkable = (s, side, post) => {
  const p = bridgePoint(side, post);
  return walkable(s, p.x, p.z, 3);
};
