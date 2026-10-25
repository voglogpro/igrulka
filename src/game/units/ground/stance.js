import { hqOf, pairedEnemy, hostile } from '../../factions.js';
import { GROUND_UNITS, isInfantry } from '../../config.js';
import { BRIDGES, walkable } from './navigation.js';
import { orderGround } from './orders.js';
import { guardGround } from './guard.js';
import { prepareDefensivePosition } from '../../defense/fortifications.js';
import { updateDefenseFormation } from '../../defense/formation.js';

// A stance is a standing order that outlives a single click: new units take it when they leave
// the barracks. "attack" advances on the enemy headquarters with combat stops, "defend" holds
// the home end of a land corridor around the sea and digs in.
export const STANCE_MODES = ['attack', 'defend'];
export const DEFEND_POSTS = ['auto', 'north', 'south'];
export const POST_NAMES = { north: 'Северный коридор', south: 'Южный коридор' };
const BRIDGE_Z = { north: BRIDGES[0], south: BRIDGES[1] };
// Posts stand in the corridor on the home side of the line between the cities.
const POST_OFFSET = 300;

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
  const x = side % 2 === 0 ? -POST_OFFSET : POST_OFFSET;
  return { x, z };
}

function defenders(s, side, post) {
  return s.groundUnits.filter(
    (u) => u.side === side && u.hp > 0 && u.stance?.mode === 'defend' && u.stance.post === post,
  ).length;
}

// "auto" sends the group to the bridge that currently has fewer defenders.
export function chooseBridge(s, side) {
  if (s.sides.length > 2) return hqOf(s, side).z < 0 ? 'north' : 'south';
  const north = defenders(s, side, 'north'),
    south = defenders(s, side, 'south');
  return north <= south ? 'north' : 'south';
}

export function stanceLabel(stance) {
  if (!stance) return 'Приказ вручную';
  return stance.mode === 'attack'
    ? 'Атака'
    : `Оборона · ${POST_NAMES[stance.post] || 'Распределённый рубеж'}`;
}

export function applyStance(s, side, ids, stance) {
  if (s.result) return 'Кампания завершена';
  if (!validStance(stance) || !stance) return 'Неизвестный режим';
  const units = (s.groundUnits || []).filter(
    (u) => u.side === side && u.hp > 0 && !u.carrierId && !u.downed && ids.includes(u.id),
  );
  if (!units.length) return 'Выберите доступные наземные отряды';
  if (stance.mode === 'attack') {
    const pairedHQ = hqOf(s, pairedEnemy(s, side));
    const hq =
      pairedHQ?.hp > 0
        ? pairedHQ
        : s.buildings.find((b) => b.key === 'hq' && b.hp > 0 && hostile(s, b.side, side));
    if (!hq) return 'Нет цели для атаки';
    const previous = new Map(units.map((u) => [u.id, u.order]));
    const result = orderGround(s, side, ids, {
      x: hq.x,
      z: hq.z,
      targetId: hq.id,
      mode: 'attackmove',
    });
    if (typeof result !== 'number') return result;
    for (const u of units)
      if (u.order && u.order !== previous.get(u.id)) u.stance = { mode: 'attack' };
    return result;
  }
  const post = stance.post && stance.post !== 'auto' ? stance.post : chooseBridge(s, side);
  const point = bridgePoint(side, post);
  const previous = new Map(units.map((u) => [u.id, u.guard]));
  const result = guardGround(s, side, ids, point);
  if (typeof result === 'string') return result;
  let assigned = 0;
  for (const u of units)
    if (u.guard && u.guard !== previous.get(u.id)) {
      u.stance = { mode: 'defend', post: stance.post === 'auto' || !stance.post ? 'auto' : post };
      u.autoDefense = !stance.post || stance.post === 'auto';
      u.entrenched = false;
      assigned++;
    }
  if (assigned && (!stance.post || stance.post === 'auto'))
    updateDefenseFormation(
      s,
      side,
      s.groundUnits.filter((u) => u.side === side && u.hp > 0),
    );
  return assigned || 'Нет свободного доступного места для поста';
}

export function clearStance(u) {
  u.stance = null;
}

// Defenders dig in once they stand at their post and nobody is shooting at them.
export function updateStance(s, u) {
  return prepareDefensivePosition(s, u);
}

export const stanceMobile = (u) => !!GROUND_UNITS[u.key] && !isInfantry(u.key);
export const postWalkable = (s, side, post) => {
  const p = bridgePoint(side, post);
  return walkable(s, p.x, p.z, 3);
};
