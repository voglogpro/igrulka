import { validSide } from '../factions.js';
import { BUILDINGS, GROUND_UNITS } from '../config.js';
import { equipmentModifiers } from './upgrade-tiers.js';
import { event } from '../shared/events.js';

export function upgradeable(entity) {
  const d = entity && (BUILDINGS[entity.key] || GROUND_UNITS[entity.key]);
  return !!(
    d &&
    !d.retired &&
    !d.civil &&
    (d.range > 0 ||
      d.groundRange > 0 ||
      ['launcher', 'silo', 'factory', 'ammofactory'].includes(entity.key))
  );
}

export function upgradeStatus(s, side, id) {
  const entity = [...s.buildings, ...s.groundUnits].find((u) => u.id === id && u.side === side);
  const d = entity && (BUILDINGS[entity.key] || GROUND_UNITS[entity.key]);
  const level = entity?.level || 0;
  const cost = Math.max(40, Math.round((d?.cost || 0) * (level === 0 ? 0.4 : 0.65)));
  let reason = '';
  if (!validSide(s, side) || !entity || !upgradeable(entity))
    reason = 'Этот объект нельзя улучшить';
  else if (s.result) reason = 'Кампания завершена';
  else if (entity.hp <= 0 || entity.demolished || entity.progress < 1 || entity.downed)
    reason = 'Объект не готов';
  else if (level >= 2) reason = 'Максимальный уровень';
  else if (s.sides[side].credits < cost) reason = 'Не хватает денег';
  return {
    ok: !reason,
    reason,
    level,
    nextLevel: Math.min(2, level + 1),
    cost,
    modifiers: equipmentModifiers(entity),
    nextModifiers: equipmentModifiers({ level: Math.min(2, level + 1) }),
  };
}

export function upgradeDefense(s, side, id) {
  const status = upgradeStatus(s, side, id);
  if (!status.ok) return status.reason;
  const entity = [...s.buildings, ...s.groundUnits].find((u) => u.id === id && u.side === side);
  s.sides[side].credits -= status.cost;
  entity.level = status.nextLevel;
  event(s, 'upgrade', { side, id, level: entity.level, x: entity.x, z: entity.z });
  return true;
}
