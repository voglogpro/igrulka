import { FIELD, isInfantry, GROUND_UNITS, BUILDINGS } from '../../config.js';
import { clamp } from '../../shared/math.js';
import { groundPath, walkable } from './navigation.js';
import { unloadGround, cancelTransportDelivery } from '../vehicles/transport.js';
import { clearGroundRoute } from './route-queue.js';
import { clearAutoDefense } from '../../defense/volunteers.js';
import { invalidateFrontline } from '../../defense/cache.js';
import { hostile } from '../../factions.js';
import { trenchContested } from '../../defense/positions.js';
import { invalidateTrenchLinks } from '../../defense/trench-links.js';
import { invalidateStaticGeometry } from '../../shared/static-spatial.js';
export function orderGround(s, side, ids, aim, { preserveRoute = false, defer = false } = {}) {
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
  const selected = new Set(ids);
  const units = (s.groundUnits || []).filter(
    (u) => u.side === side && u.hp > 0 && !u.carrierId && !u.downed && selected.has(u.id),
  );
  // Large commands acknowledge their destinations without synchronously running
  // hundreds of A* searches inside the click handler. Existing route fields
  // persist pending work and allow immediate manual cancellation/replacement.
  const queued = !preserveRoute && (defer || units.length >= 16);
  const destinations = groundFormationDestinations(s, side, units, aim);
  const attackedBuilding =
    queued && aim.targetId != null
      ? s.buildings.find((b) => b.id === aim.targetId && hostile(s, side, b.side))
      : null;
  let count = 0;
  for (let index = 0; index < units.length; index++) {
    const u = units[index];
    let destination = destinations[index];
    if (
      attackedBuilding &&
      !walkable(s, destination.x, destination.z, GROUND_UNITS[u.key].size * 0.42)
    ) {
      const b = attackedBuilding,
        dx = u.x - b.x,
        dz = u.z - b.z;
      const length = Math.max(Math.abs(dx), Math.abs(dz), 1);
      const half = (BUILDINGS[b.key]?.size || 30) * 0.56 + GROUND_UNITS[u.key].size * 0.42 + 4;
      destination = {
        x: b.x + ((dx || (side % 2 ? 1 : -1)) * half) / length,
        z: b.z + (dz * half) / length,
      };
    }
    const radius = GROUND_UNITS[u.key].size * 0.42,
      path = queued ? [] : groundPath(s, u, destination, radius);
    // A retreat names the centre of its friendly base. Like the synchronous
    // pathfinder, queued planning must allow that solid endpoint and approach
    // its nearest reachable cell instead of rejecting the entire retreat.
    if (
      queued
        ? aim.mode !== 'retreat' && !walkable(s, destination.x, destination.z, radius)
        : !path.length
    )
      continue;
    delete u.supplyTrip;
    if (!preserveRoute && ['medic', 'supply'].includes(GROUND_UNITS[u.key].support))
      u.supportManual = true;
    if (!preserveRoute) {
      clearGroundRoute(u);
      delete u.defenseAttack;
    }
    if (!preserveRoute) clearAutoDefense(u);
    cancelTransportDelivery(u);
    u.guard = null;
    u.guardTargetId = null;
    if (!aim.keepStance && !preserveRoute) u.stance = null;
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
    if (queued) u.routeState = { status: 'moving', retryAt: s.time };
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
  const own = new Set(s.groundUnits.filter((u) => u.side === side && u.hp > 0).map((u) => u.id));
  const valid = [...new Set(ids)].filter((id) => own.has(id));
  s.groups[side][index] = valid;
  return valid;
}

export const getGroup = (s, side, index) => {
  const own = new Set(s.groundUnits.filter((u) => u.side === side && u.hp > 0).map((u) => u.id));
  return (s.groups?.[side]?.[index] || []).filter((id) => own.has(id));
};

export function commandUnits(s, side, ids, command) {
  const selected = new Set(ids);
  const units = s.groundUnits.filter(
      (u) => u.side === side && u.hp > 0 && !u.downed && selected.has(u.id),
    ),
    fireState = !units.every((u) => u.holdFire),
    camoState = !units.filter((u) => isInfantry(u.key) && !u.carrierId).every((u) => u.camouflaged),
    retreatBases =
      command === 'retreat'
        ? s.buildings.filter(
            (b) =>
              b.side === side &&
              b.hp > 0 &&
              (b.key === 'hq' || (b.key === 'barracks' && b.progress >= 1)),
          )
        : [],
    deferRetreat = command === 'retreat' && units.filter((u) => !u.carrierId).length >= 16;
  let changed = 0;
  for (const u of units) {
    if (['stop', 'dig', 'retreat'].includes(command)) delete u.defenseAttack;
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
      let t = (s.trenches ||= []).find((t) => Math.hypot(t.x - u.x, t.z - u.z) < 4);
      if (t && trenchContested(s, t, side, u.id)) continue;
      delete u.supplyTrip;
      clearAutoDefense(u);
      clearGroundRoute(u);
      u.guard = null;
      u.guardTargetId = null;
      u.path = [];
      u.order = null;
      u.moving = false;
      u.digging = true;
      if (!t && s.trenches.length < 240) {
        t = { id: s.nextId++, side, x: u.x, z: u.z, progress: 0, yaw: u.yaw || 0 };
        s.trenches.push(t);
        invalidateStaticGeometry(s, 'trenches');
      }
      if (t) {
        if (t.side !== side && hostile(s, t.side, side)) {
          t.side = side;
          invalidateTrenchLinks(s);
        }
        u.trenchId = t.id;
        changed++;
      }
    }
    if (command === 'retreat' && !u.carrierId) {
      let base = null,
        nearest = Infinity;
      for (const candidate of retreatBases) {
        const distance = Math.hypot(candidate.x - u.x, candidate.z - u.z);
        if (!base || distance < nearest) {
          base = candidate;
          nearest = distance;
        }
      }
      if (
        base &&
        typeof orderGround(
          s,
          side,
          [u.id],
          { x: base.x, z: base.z, mode: 'retreat' },
          { defer: deferRetreat },
        ) === 'number'
      )
        changed++;
    }
    if (command === 'unload' && GROUND_UNITS[u.key].capacity)
      changed += unloadGround(s, side, u.id);
  }
  if (changed) invalidateFrontline(s);
  return changed || 'Команда недоступна выбранным единицам';
}
