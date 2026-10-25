import { FIELD, isInfantry, GROUND_UNITS } from '../../config.js';
import { clamp } from '../../shared/math.js';
import { groundPath } from './navigation.js';
import { unloadGround, cancelTransportDelivery } from '../vehicles/transport.js';
import { clearGroundRoute } from './route-queue.js';
import { clearAutoDefense } from '../../defense/volunteers.js';
import { invalidateFrontline } from '../../defense/cache.js';
import { hostile } from '../../factions.js';
export function orderGround(s, side, ids, aim, { preserveRoute = false } = {}) {
  if (s.result) return 'Кампания завершена';
  if (aim?.targetId != null) {
    const target = [...s.groundUnits, ...s.buildings].find((v) => v.id === aim.targetId);
    if (target && !hostile(s, side, target.side)) return 'Нельзя атаковать союзника';
  }
  if (
    !aim ||
    ![aim.x, aim.z].every(Number.isFinite) ||
    Math.abs(aim.x) > FIELD.x ||
    Math.abs(aim.z) > FIELD.z
  )
    return 'Выберите точку в пределах карты';
  const units = (s.groundUnits || []).filter(
    (u) => u.side === side && u.hp > 0 && !u.carrierId && !u.downed && ids.includes(u.id),
  );
  const destinations = groundFormationDestinations(s, side, units, aim);
  let count = 0;
  for (let index = 0; index < units.length; index++) {
    const u = units[index],
      destination = destinations[index],
      path = groundPath(s, u, destination, GROUND_UNITS[u.key].size * 0.42);
    if (!path.length) continue;
    delete u.supplyTrip;
    if (['medic', 'supply'].includes(GROUND_UNITS[u.key].support)) u.supportManual = true;
    if (!preserveRoute) clearGroundRoute(u);
    if (!preserveRoute) clearAutoDefense(u);
    cancelTransportDelivery(u);
    u.guard = null;
    u.guardTargetId = null;
    if (!aim.keepStance) u.stance = null;
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
  if (count) invalidateFrontline(s);
  return count || 'Нет прохода. Пассажиров сначала высадите из машины';
}

export const sqrtCols = (n) => Math.max(1, Math.ceil(Math.sqrt(n * 1.8)));

export function groundFormationDestinations(s, side, units, aim) {
  const spacing = units.some((u) => !isInfantry(u.key)) ? 18 : 7;
  const cols = sqrtCols(units.length);
  const formation = s.formations?.[side] || 'line';
  return units.map((u, index) => {
    const dx =
      formation === 'column'
        ? ((index % 2) - 0.5) * spacing
        : ((index % cols) - (Math.min(cols, units.length) - 1) / 2) * spacing;
    const dz =
      formation === 'column'
        ? Math.floor(index / 2) * spacing
        : Math.floor(index / cols) * spacing * (formation === 'spread' ? 1.8 : 1);
    return {
      x: clamp(aim.x + (units.length > 1 ? dx : 0), -(FIELD.x - 14), FIELD.x - 14),
      z: clamp(aim.z + (units.length > 1 ? dz : 0), -(FIELD.z - 14), FIELD.z - 14),
    };
  });
}

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
  const units = s.groundUnits.filter(
      (u) => u.side === side && u.hp > 0 && !u.downed && ids.includes(u.id),
    ),
    fireState = !units.every((u) => u.holdFire),
    camoState = !units.filter((u) => isInfantry(u.key) && !u.carrierId).every((u) => u.camouflaged);
  let changed = 0;
  for (const u of units) {
    if (command === 'stop') {
      delete u.supplyTrip;
      if (['medic', 'supply'].includes(GROUND_UNITS[u.key].support)) u.supportManual = true;
      clearAutoDefense(u);
      u.stance = null;
      clearGroundRoute(u);
      cancelTransportDelivery(u);
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
      delete u.supplyTrip;
      clearAutoDefense(u);
      clearGroundRoute(u);
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
  if (changed) invalidateFrontline(s);
  return changed || 'Команда недоступна выбранным единицам';
}
