import { GROUND_UNITS, isInfantry } from '../config.js';

export function defenseRole(key) {
  const d = GROUND_UNITS[key];
  if (['mog', 'gun', 'shilka', 'gepard'].includes(key)) return 'air';
  if (d?.indirect) return 'artillery';
  if (['atgm', 'atrifle', 'operator', 'atcarrier'].includes(key)) return 'antiarmor';
  if (key === 'sniper') return 'marksman';
  return isInfantry(key) ? 'line' : 'armor';
}

// These are priorities, not a second order owner. Post references and all
// movement still belong to the common bounded formation coordinator.
export function layerRanks(u, line, volunteers) {
  const role = defenseRole(u.key),
    foot = isInfantry(u.key),
    local = volunteers.filter((v) => v.defensePost?.corridorId === line.id),
    fronts = local.filter((v) => v.defensePost.row === 0 && !v.defenseCapture).length,
    cores = local.filter((v) => v.defensePost.row === 2).length,
    reserve = local.filter((v) => v.defensePost.row >= 4 && !v.defenseTask).length;
  let first;
  if (role === 'artillery') first = [7, 9, 5, 11, 3, 1];
  else if (role === 'air') first = foot ? [2, 4, 0, 6] : [3, 1, 5, 7];
  else if (role === 'armor') first = [1, 3, 5, 7];
  else if (role === 'marksman' || role === 'antiarmor') first = foot ? [2, 0, 4, 6] : [1, 3, 5, 7];
  else if (fronts < Math.min(4, line.slots.length)) first = [0, 2, 4, 6];
  else if (line.secured && cores < 2) first = [2, 0, 4, 6];
  else if (fronts < line.slots.length) first = [0, 4, 2, 6];
  else if (reserve < 2) first = [4, 2, 0, 6];
  else first = [2, 4, 6, 8, 0];
  const rows = [...first];
  for (let row = foot ? 0 : 1; row < 20; row += 2) if (!rows.includes(row)) rows.push(row);
  return new Map(rows.map((row, index) => [row, index]));
}

export function depotLayerName(u) {
  if (u.defenseMission)
    return u.defenseMission.phase === 'return'
      ? 'Возврат рейдовой группы'
      : u.defenseMission.phase === 'watch'
        ? 'Наблюдение в тылу'
        : 'Обходная группа';
  if (u.defenseCapture) return 'Захват склада';
  if (u.defenseTask) return u.defenseTask.returning ? 'Возврат к рубежу' : 'Перехват прорыва';
  const row = u.defensePost?.row;
  if (row == null) return 'Ожидает позиции';
  if (row === 0) return 'Внешний рубеж';
  if (row <= 3) return 'Охрана склада';
  return defenseRole(u.key) === 'artillery' ? 'Огневая поддержка' : 'Тыловой резерв';
}
