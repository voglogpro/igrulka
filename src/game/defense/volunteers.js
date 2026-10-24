import { GROUND_UNITS } from '../config.js';
import { invalidateFrontline } from './cache.js';

export function clearAutoDefense(u) {
  u.autoDefense = false;
  u.defenseTask = null;
}

export function setAutoDefense(s, side, ids, enabled) {
  if (s.result || ![0, 1].includes(side) || !Array.isArray(ids) || typeof enabled !== 'boolean')
    return 'Неизвестная команда обороны';
  let changed = 0;
  for (const u of s.groundUnits)
    if (
      ids.includes(u.id) &&
      u.side === side &&
      u.hp > 0 &&
      !u.downed &&
      !u.carrierId &&
      !u.boardingId &&
      u.guard &&
      !GROUND_UNITS[u.key]?.support &&
      !u.delivery &&
      (!enabled || !s.groundUnits.some((p) => p.carrierId === u.id || p.boardingId === u.id))
    ) {
      u.autoDefense = enabled;
      if (!enabled && u.defenseTask) u.defenseTask.until = s.time;
      changed++;
    }
  if (changed) invalidateFrontline(s);
  return changed || 'Выберите защитников на постах';
}
