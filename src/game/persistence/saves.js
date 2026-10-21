import { VERSION, MAP, BUILDINGS, GROUND_UNITS, TECH, WEAPONS } from '../config.js';
import { ROAD_HP, normalizeRoadOverlaps } from '../city/road-network.js';
import { campRoads } from '../city/roads.js';
import { log } from '../shared/events.js';
const configured = (table, key) => typeof key === 'string' && Object.hasOwn(table, key);
export function save(s) {
  const copy = structuredClone(s);
  copy.events = [];
  return JSON.stringify(copy);
}

export function load(raw) {
  const s = JSON.parse(raw);
  if (
    ![3, 4, 5, 6, 7, VERSION].includes(s.version) ||
    !Array.isArray(s.buildings) ||
    !Array.isArray(s.roads) ||
    !Array.isArray(s.sides) ||
    s.sides.length !== 2 ||
    !Number.isFinite(s.time) ||
    s.time < 0
  )
    throw Error('Некорректное сохранение');
  if (
    s.buildings.length > 2000 ||
    s.roads.length > 3000 ||
    !Array.isArray(s.units) ||
    s.units.length > 600 ||
    !s.ai
  )
    throw Error('Повреждённая кампания');
  if (s.version < 6) {
    for (let side = 0; side < 2; side++) {
      const f = s.sides[side];
      let retired = Number.isFinite(f.inventory?.scout) ? Math.max(0, f.inventory.scout) : 0;
      retired += s.units.filter((u) => u.side === side && u.key === 'scout' && u.hp > 0).length;
      for (const b of s.buildings)
        if (b.side === side && b.queue) {
          retired += b.queue.filter((q) => q.key === 'scout').length;
          b.queue = b.queue.filter((q) => q.key !== 'scout');
        }
      if (f.inventory) delete f.inventory.scout;
      f.credits += retired * 65;
      f.materials += retired * 5;
    }
    s.units = s.units.filter((u) => u.key !== 'scout');
  }

  if (s.version < 8) {
    for (const b of s.buildings) {
      if (b.key === 'cannon') {
        const health = b.hp / b.maxHp;
        b.key = 'gun';
        b.maxHp = BUILDINGS.gun.hp;
        b.hp = Math.max(0, b.maxHp * health);
        s.sides[b.side].credits += 300;
        s.sides[b.side].materials += 18;
      }
      if (b.key === 'gun') {
        b.groundAmmo = b.ammo ?? BUILDINGS.gun.magazine;
        b.groundReload = b.reloadLeft || 0;
      }
      if (b.armyQueue)
        b.armyQueue = b.armyQueue.flatMap((q) =>
          q.key === 'infantry'
            ? Array.from({ length: 5 }, (_, i) => ({ ...q, progress: i === 0 ? q.progress : 0 }))
            : q,
        );
    }
    const converted = [];
    for (const u of s.groundUnits || []) {
      if (u.key !== 'infantry') {
        converted.push(u);
        continue;
      }
      for (let i = 0; i < 5; i++) {
        const soldier = structuredClone(u);
        soldier.id = i === 0 ? u.id : s.nextId++;
        soldier.x += ((i % 3) - 1) * 3;
        soldier.z += Math.floor(i / 3) * 3;
        soldier.maxHp = GROUND_UNITS.infantry.hp;
        soldier.hp = soldier.maxHp * Math.max(0, u.hp / u.maxHp);
        converted.push(soldier);
      }
    }
    s.groundUnits = converted;
  }
  delete s.intel;
  delete s.intelTime;
  delete s.ai.nextScout;
  for (const f of s.sides) {
    if (
      !['credits', 'materials', 'science'].every((k) => Number.isFinite(f[k]) && f[k] >= 0) ||
      !Array.isArray(f.tech) ||
      f.tech.some((k) => !configured(TECH, k)) ||
      !f.inventory ||
      typeof f.inventory !== 'object' ||
      Array.isArray(f.inventory) ||
      Object.keys(f.inventory).some((k) => !configured(WEAPONS, k)) ||
      Object.keys(WEAPONS).some((k) => !Number.isFinite(f.inventory[k]) || f.inventory[k] < 0)
    )
      throw Error('Повреждены ресурсы');
    if (f.research && (!configured(TECH, f.research.key) || !Number.isFinite(f.research.progress)))
      throw Error('Повреждены исследования');
  }
  for (const b of s.buildings)
    if (
      !['id', 'x', 'z', 'hp', 'maxHp', 'progress'].every((k) => Number.isFinite(b[k])) ||
      (b.key !== 'hq' && !configured(BUILDINGS, b.key)) ||
      ![0, 1].includes(b.side) ||
      b.queue?.some((q) => !configured(WEAPONS, q.key) || !Number.isFinite(q.progress))
    )
      throw Error('Повреждены постройки');
  if (s.version === 3) {
    for (const r of s.roads) Object.assign(r, { hp: ROAD_HP, maxHp: ROAD_HP });
    s.networkRevision = 0;
    campRoads(s);
    s.units = [];
    s.projectiles = [];
    for (const b of s.buildings) {
      b.queue ||= [];
      delete b.roadLink;
    }
    s.ai.roadPlan = 0;
    log(s, 'Обновлено снабжение: подведите улицы к предприятиям и постройте пусковую площадку.');
  }
  for (const r of s.roads)
    if (
      !['id', 'ax', 'az', 'bx', 'bz', 'hp', 'maxHp'].every((k) => Number.isFinite(r[k])) ||
      ![0, 1].includes(r.side)
    )
      throw Error('Повреждена дорога');
  if (s.version < 6) {
    normalizeRoadOverlaps(s);
    s.ai.roadPlan = 0;
  }
  for (const u of s.units)
    if (
      !configured(WEAPONS, u.key) ||
      !['x', 'y', 'z', 'hp', 'startX', 'startZ', 'tx', 'tz', 'total', 'travelled', 'delay'].every(
        (k) => Number.isFinite(u[k]),
      )
    )
      throw Error('Повреждены цели');
  for (const u of s.units)
    if (
      u.status === 'falling' &&
      (!['fallAge', 'spin', 'vx', 'vy', 'vz'].every((k) => Number.isFinite(u[k])) ||
        ![-1, 1].includes(u.missingWing))
    )
      throw Error('Повреждено падение дрона');
  for (const p of s.projectiles || [])
    if (
      !['x', 'y', 'z', 'vx', 'vy', 'vz', 'speed', 'life', 'maxLife'].every((k) =>
        Number.isFinite(p[k]),
      )
    )
      throw Error('Повреждены снаряды');
  s.groundUnits ||= [];
  if (!Array.isArray(s.groundUnits) || s.groundUnits.length > 600) throw Error('Повреждена армия');
  for (const u of s.groundUnits)
    if (
      !configured(GROUND_UNITS, u.key) ||
      ![0, 1].includes(u.side) ||
      !['id', 'x', 'z', 'hp', 'maxHp'].every((k) => Number.isFinite(u[k])) ||
      u.path?.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.z))
    )
      throw Error('Повреждён отряд');
  for (const u of s.groundUnits) {
    if (u.xp != null && (!Number.isFinite(u.xp) || u.xp < 0 || u.xp > 450))
      throw Error('Повреждён опыт бойца');
    if (
      u.guard != null &&
      (!Number.isFinite(u.guard.x) ||
        !Number.isFinite(u.guard.z) ||
        Math.abs(u.guard.x) > 864 ||
        Math.abs(u.guard.z) > 576)
    )
      throw Error('Повреждён оборонительный пост');
    for (const key of ['guardNextThink', 'guardRepathAt'])
      if (u[key] != null && (!Number.isFinite(u[key]) || u[key] < 0))
        throw Error('Повреждена реакция гарнизона');
    if (u.guardTargetId != null && (!Number.isSafeInteger(u.guardTargetId) || u.guardTargetId <= 0))
      throw Error('Повреждена цель гарнизона');
  }
  for (const b of s.buildings) {
    if (
      b.rally != null &&
      (typeof b.rally !== 'object' ||
        Array.isArray(b.rally) ||
        !Number.isFinite(b.rally.x) ||
        !Number.isFinite(b.rally.z) ||
        Math.abs(b.rally.x) > MAP.width / 2 - 16 ||
        Math.abs(b.rally.z) > MAP.depth / 2 - 16)
    )
      throw Error('Повреждена точка сбора');
    if (b.rallyMode != null && !['guard', 'wait', 'attackmove'].includes(b.rallyMode))
      throw Error('Повреждены приказы новобранцам');
    if (b.armyQueue?.some((q) => !configured(GROUND_UNITS, q.key) || !Number.isFinite(q.progress)))
      throw Error('Повреждена очередь казарм');
    if (
      b.recruitRepeat != null &&
      (b.key !== 'barracks' ||
        !configured(GROUND_UNITS, b.recruitRepeat.key) ||
        typeof b.recruitRepeat.enabled !== 'boolean')
    )
      throw Error('Повреждён автоматический набор');
    if (b.level != null && (!Number.isInteger(b.level) || b.level < 0 || b.level > 2))
      throw Error('Повреждена модернизация');
  }
  for (const u of s.units)
    if (
      u.route &&
      (!Array.isArray(u.route) ||
        u.route.length > 100 ||
        u.route.some((p) => !['x', 'z', 'd'].every((k) => Number.isFinite(p[k]))))
    )
      throw Error('Повреждён маршрут');
  s.trenches ||= [];
  s.contacts ||= [[], []];
  s.groups ||= [{}, {}];
  s.formations ||= ['line', 'line'];
  if (
    !Array.isArray(s.trenches) ||
    s.trenches.length > 240 ||
    s.trenches.some(
      (t) =>
        !['id', 'x', 'z', 'progress'].every((k) => Number.isFinite(t[k])) ||
        t.progress < 0 ||
        t.progress > 1,
    )
  )
    throw Error('Повреждены окопы');
  if (
    !Array.isArray(s.contacts) ||
    s.contacts.length !== 2 ||
    s.contacts.some(
      (list) =>
        !Array.isArray(list) ||
        list.length > 600 ||
        list.some((c) => !['x', 'z', 'expires'].every((k) => Number.isFinite(c[k]))),
    )
  )
    throw Error('Повреждены контакты');
  if (
    !Array.isArray(s.groups) ||
    s.groups.length !== 2 ||
    s.groups.some(
      (g) =>
        !g ||
        typeof g !== 'object' ||
        Object.values(g).some(
          (ids) =>
            !Array.isArray(ids) || ids.length > 600 || ids.some((id) => !Number.isFinite(id)),
        ),
    )
  )
    throw Error('Повреждены группы');
  if (
    !Array.isArray(s.formations) ||
    s.formations.length !== 2 ||
    s.formations.some((v) => !['line', 'column', 'spread'].includes(v))
  )
    throw Error('Повреждено построение');
  for (const u of s.groundUnits) {
    if (
      u.carrierId &&
      !s.groundUnits.some(
        (v) => v.id === u.carrierId && v.side === u.side && GROUND_UNITS[v.key].capacity,
      )
    )
      throw Error('Повреждены пассажиры');
    for (const k of ['groundAmmo', 'groundReload', 'suppression', 'fpvAmmo', 'fpvReady', 'setup'])
      if (u[k] != null && (!Number.isFinite(u[k]) || u[k] < 0))
        throw Error('Повреждено состояние бойца');
  }
  s.version = VERSION;
  s.events = [];
  s.stats = {
    shots: 0,
    hits: 0,
    misses: 0,
    interceptions: 0,
    impacts: 0,
    roadsCut: 0,
    crashes: 0,
    airbursts: 0,
    ...s.stats,
  };
  s.networkRevision = (s.networkRevision || 0) + 1;
  s.ai.roadPlan ||= 0;
  return s;
}
