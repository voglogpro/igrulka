import { oilCost, hasOil, spendOil } from '../../city/oil.js';
import { GROUND_UNITS, defenseStats } from '../../config.js';
import { clamp } from '../../shared/math.js';
import { GROUND_LIMIT, walkable } from './navigation.js';
import { validStance } from './stance.js';
export function makeGround(s, side, key, x, z) {
  const d = GROUND_UNITS[key];
  const u = {
    id: s.nextId++,
    side,
    key,
    x,
    z,
    y: 1,
    hp: d.hp,
    maxHp: d.hp,
    progress: 1,
    cooldown: 0,
    groundCooldown: 0,
    groundAmmo: d.groundMagazine || 30,
    groundReload: 0,
    heat: 0,
    level: 0,
    xp: 0,
    path: [],
    order: null,
    yaw: 0,
    suppression: 0,
    autoDefense: false,
    defenseTask: null,
    defenseReadyAt: 0,
    fpvAmmo: key === 'operator' ? 3 : 0,
    civil: !!d.civil,
    aiDefender:
      side === 1 &&
      ['mog', 'sniper', 'machinegunner'].includes(key) &&
      s.groundUnits.filter((u) => u.side === side && u.aiDefender).length < 3,
  };
  if (d.infantry && d.range) u.groundAmmo = defenseStats(s.sides[side], u).magazine;
  // Composite armour only reinforces machines built after the research.
  if (!d.infantry && s.sides[side]?.tech.includes('composite'))
    u.hp = u.maxHp = Math.round(d.hp * 1.25);
  return u;
}

export function recruit(s, side, key, siteId = null, count = 1, stance = null) {
  const f = s.sides[side],
    d = GROUND_UNITS[key];
  count = clamp(Math.floor(count) || 1, 1, 5);
  if (s.result) return 'Кампания завершена';
  if (!validStance(stance)) return 'Неизвестный режим';
  if (!d || d.civil || (d.tech && !f.tech.includes(d.tech))) return 'Нужно исследование';
  const sites = s.buildings.filter(
    (b) =>
      b.side === side &&
      b.key === 'barracks' &&
      b.hp > 0 &&
      b.progress >= 1 &&
      (siteId == null || b.id === Number(siteId)),
  );
  if (!sites.length) return 'Постройте казармы у дороги';
  const queued = s.buildings
    .filter((b) => b.side === side && b.hp > 0)
    .reduce((n, b) => n + (b.armyQueue?.length || 0), 0);
  if (
    (s.groundUnits || []).filter((u) => u.side === side && u.hp > 0).length + queued + count >
    GROUND_LIMIT
  )
    return 'Лимит армии: 120 единиц на сторону';
  if (sites.reduce((n, b) => n + 8 - (b.armyQueue?.length || 0), 0) < count)
    return 'Очередь казарм заполнена';
  if (f.credits < d.cost * count || f.materials < d.metal * count)
    return 'Не хватает денег или сплавов';
  if (!hasOil(s, side, oilCost(key) * count)) return 'Не хватает нефти: постройте нефтевышки';
  f.credits -= d.cost * count;
  f.materials -= d.metal * count;
  spendOil(s, side, oilCost(key) * count);
  for (let i = 0; i < count; i++) {
    sites.sort((a, b) => (a.armyQueue?.length || 0) - (b.armyQueue?.length || 0));
    (sites[0].armyQueue ||= []).push({
      key,
      progress: 0,
      ...(stance ? { stance: { mode: stance.mode, post: stance.post ?? 'auto' } } : {}),
    });
  }
  return true;
}

export function setRally(s, side, id, point) {
  const b = s.buildings.find(
    (b) => b.id === id && b.side === side && b.key === 'barracks' && b.hp > 0,
  );
  if (
    !b ||
    !point ||
    ![point.x, point.z].every(Number.isFinite) ||
    !walkable(s, point.x, point.z, 2)
  )
    return 'Точка сбора должна быть на доступной суше';
  b.rally = { x: point.x, z: point.z };
  return true;
}

export const RALLY_MODES = ['guard', 'wait', 'attackmove', 'attack', 'defend'];

export function defaultRallyMode(s, site) {
  return site.rallyMode || (s.mode !== 'multiplayer' && site.side === 1 ? 'wait' : 'guard');
}

export function setRallyMode(s, side, id, mode) {
  if (s.result) return 'Кампания завершена';
  const b = s.buildings.find(
    (site) =>
      site.id === Number(id) && site.side === side && site.key === 'barracks' && site.hp > 0,
  );
  if (!b) return 'Выберите свои действующие казармы';
  if (!RALLY_MODES.includes(mode)) return 'Неизвестный режим точки сбора';
  b.rallyMode = mode;
  return true;
}
