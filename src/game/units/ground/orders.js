import { isInfantry, GROUND_UNITS } from '../../config.js';
import { clamp } from '../../shared/math.js';
import { groundPath } from './navigation.js';
import { unloadGround } from '../vehicles/transport.js';
export function orderGround(s, side, ids, aim) {
  if (s.result) return 'Кампания завершена';
  if (
    !aim ||
    ![aim.x, aim.z].every(Number.isFinite) ||
    Math.abs(aim.x) > 864 ||
    Math.abs(aim.z) > 576
  )
    return 'Выберите точку в пределах карты';
  const units = (s.groundUnits || []).filter(
    (u) => u.side === side && u.hp > 0 && !u.carrierId && ids.includes(u.id),
  );
  let count = 0;
  for (let index = 0; index < units.length; index++) {
    const u = units[index],
      spacing = units.some((v) => !isInfantry(v.key)) ? 18 : 7,
      cols = sqrtCols(units.length),
      formation = s.formations?.[side] || 'line',
      dx =
        formation === 'column'
          ? ((index % 2) - 0.5) * spacing
          : ((index % cols) - (Math.min(cols, units.length) - 1) / 2) * spacing,
      dz =
        formation === 'column'
          ? Math.floor(index / 2) * spacing
          : Math.floor(index / cols) * spacing * (formation === 'spread' ? 1.8 : 1);
    const destination = {
        x: clamp(aim.x + (units.length > 1 ? dx : 0), -850, 850),
        z: clamp(aim.z + (units.length > 1 ? dz : 0), -560, 560),
      },
      path = groundPath(s, u, destination, GROUND_UNITS[u.key].size * 0.42);
    if (!path.length) continue;
    u.guard = null;
    u.guardTargetId = null;
    u.path = path;
    u.order = {
      ...destination,
      targetId: aim.targetId ?? null,
      mode: aim.mode || (aim.targetId ? 'attack' : 'move'),
    };
    u.targetId = null;
    u.digging = false;
    u.trenchId = null;
    u.boardingId = null;
    u.navRevision = s.networkRevision;
    count++;
  }
  return count || 'Нет прохода. Пассажиров сначала высадите из машины';
}

export const sqrtCols = (n) => Math.max(1, Math.ceil(Math.sqrt(n * 1.8)));

export function saveGroup(s, side, index, ids) {
  s.groups ||= [{}, {}];
  const valid = [...new Set(ids)].filter((id) =>
    s.groundUnits.some((u) => u.id === id && u.side === side && u.hp > 0),
  );
  s.groups[side][index] = valid;
  return valid;
}

export const getGroup = (s, side, index) =>
  (s.groups?.[side]?.[index] || []).filter((id) =>
    s.groundUnits.some((u) => u.id === id && u.side === side && u.hp > 0),
  );

export function commandUnits(s, side, ids, command) {
  const units = s.groundUnits.filter((u) => u.side === side && u.hp > 0 && ids.includes(u.id)),
    fireState = !units.every((u) => u.holdFire),
    camoState = !units.filter((u) => isInfantry(u.key) && !u.carrierId).every((u) => u.camouflaged);
  let changed = 0;
  for (const u of units) {
    if (command === 'stop') {
      u.guard = null;
      u.guardTargetId = null;
      u.path = [];
      u.order = null;
      u.boardingId = null;
      u.digging = false;
      u.moving = false;
      changed++;
    }
    if (command === 'camo' && isInfantry(u.key) && !u.carrierId) {
      u.camouflaged = camoState;
      changed++;
    }
    if (command === 'fire') {
      u.holdFire = fireState;
      changed++;
    }
    if (command === 'dig' && isInfantry(u.key) && !u.carrierId) {
      u.guard = null;
      u.guardTargetId = null;
      u.path = [];
      u.order = null;
      u.moving = false;
      u.digging = true;
      let t = (s.trenches ||= []).find((t) => Math.hypot(t.x - u.x, t.z - u.z) < 4);
      if (!t && s.trenches.length < 240) {
        t = { id: s.nextId++, side, x: u.x, z: u.z, progress: 0, yaw: u.yaw || 0 };
        s.trenches.push(t);
      }
      if (t) {
        u.trenchId = t.id;
        changed++;
      }
    }
    if (command === 'retreat' && !u.carrierId) {
      const bases = s.buildings
        .filter(
          (b) =>
            b.side === side &&
            b.hp > 0 &&
            (b.key === 'hq' || (b.key === 'barracks' && b.progress >= 1)),
        )
        .sort((a, b) => Math.hypot(a.x - u.x, a.z - u.z) - Math.hypot(b.x - u.x, b.z - u.z));
      if (
        bases[0] &&
        typeof orderGround(s, side, [u.id], { x: bases[0].x, z: bases[0].z, mode: 'retreat' }) ===
          'number'
      )
        changed++;
    }
    if (command === 'unload' && GROUND_UNITS[u.key].capacity)
      changed += unloadGround(s, side, u.id);
  }
  return changed || 'Команда недоступна выбранным единицам';
}
