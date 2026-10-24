import { BUILDINGS, GROUND_UNITS } from '../../config.js';
import { buildingConnected } from '../../city/road-network.js';
import { oilCost, oilEnabled } from '../../city/oil.js';
import { recruit, recruitmentFacility } from './recruitment.js';
import { GROUND_LIMIT } from './navigation.js';

export const ARMY_COMPOSITION = {
  interval: 4,
  limit: GROUND_LIMIT,
  reserves: { credits: 250, materials: 5, oil: 5 },
};
const keys = Object.keys(GROUND_UNITS).filter((key) => !GROUND_UNITS[key].civil);
const record = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
export const createArmyComposition = () => ({ targets: {}, nextAt: 0, cursor: 0 });

export function setArmyTarget(s, side, key, count) {
  if (![0, 1].includes(side) || !s.sides[side]) return 'Неизвестная сторона';
  if (s.result) return 'Кампания завершена';
  if (!recruitmentFacility(key)) return 'Неизвестный тип войск';
  if (!Number.isSafeInteger(count) || count < 0 || count > GROUND_LIMIT)
    return 'Численность типа: от 0 до 120';
  const plan = s.sides[side].armyComposition || createArmyComposition();
  const total = Object.entries(plan.targets).reduce(
    (n, [type, target]) => n + (type === key ? 0 : target),
    count,
  );
  if (total > GROUND_LIMIT) return 'Общий состав: не более 120 единиц';
  s.sides[side].armyComposition = plan;
  if (count === 0) delete plan.targets[key];
  else plan.targets[key] = count;
  return true;
}

function counts(s, side) {
  const alive = {},
    queued = {};
  let liveTotal = 0,
    queueTotal = 0;
  for (const u of s.groundUnits)
    if (u.side === side && u.hp > 0) {
      // Wounded and carried soldiers still occupy their places; neither is a loss.
      if (!GROUND_UNITS[u.key]?.civil) alive[u.key] = (alive[u.key] || 0) + 1;
      liveTotal++;
    }
  for (const b of s.buildings)
    if (b.side === side && b.hp > 0 && !b.demolished)
      for (const q of b.armyQueue || []) {
        queued[q.key] = (queued[q.key] || 0) + 1;
        queueTotal++;
      }
  return { alive, queued, liveTotal, queueTotal };
}

const reasons = {
  disabled: 'Число не задано',
  met: 'Состав укомплектован',
  queued: 'Производство занято',
  finished: 'Кампания завершена',
  limit: 'Достигнут предел армии',
  facility: 'Нужна готовая база со связанной дорогой',
  credits: 'Не хватает денег',
  materials: 'Не хватает сплавов',
  oil: 'Не хватает нефти',
  reserve: 'Сохраняется резерв ресурсов',
  active: 'Ожидает очередного пополнения',
};

export function armyCompositionStatus(s, side) {
  if (![0, 1].includes(side) || !s.sides[side]) return null;
  const f = s.sides[side],
    plan = f.armyComposition || createArmyComposition();
  const c = counts(s, side),
    reserves = ARMY_COMPOSITION.reserves;
  const sites = s.buildings
    .filter(
      (b) =>
        b.side === side &&
        ['barracks', 'vehiclebase'].includes(b.key) &&
        b.hp > 0 &&
        !b.demolished &&
        b.progress >= 1 &&
        buildingConnected(s, b, BUILDINGS[b.key].size),
    )
    .sort((a, b) => a.id - b.id);
  const types = keys.map((key) => {
    const d = GROUND_UNITS[key],
      target = plan.targets[key] || 0;
    const alive = c.alive[key] || 0,
      queued = c.queued[key] || 0;
    const remaining = Math.max(0, target - alive - queued),
      facility = recruitmentFacility(key);
    const matching = sites.filter((b) => b.key === facility);
    const site = matching.find((b) => !b.armyQueue?.length);
    const oil = oilEnabled(s) ? oilCost(key) : 0;
    let status = 'active';
    if (!target) status = 'disabled';
    else if (s.result) status = 'finished';
    else if (!remaining) status = 'met';
    else if (c.liveTotal + c.queueTotal >= GROUND_LIMIT) status = 'limit';
    else if (!matching.length) status = 'facility';
    else if (!site) status = 'queued';
    else if (f.credits < d.cost) status = 'credits';
    else if (f.materials < d.metal) status = 'materials';
    else if (oilEnabled(s) && (f.oil || 0) < oil) status = 'oil';
    else if (
      f.credits - d.cost < reserves.credits ||
      f.materials - d.metal < reserves.materials ||
      (oil > 0 && (f.oil || 0) - oil < reserves.oil)
    )
      status = 'reserve';
    return {
      key,
      target,
      alive,
      queued,
      remaining,
      status,
      reason: reasons[status],
      facility,
      siteId: site?.id ?? null,
    };
  });
  return {
    types,
    targets: { ...plan.targets },
    reserves: { ...reserves },
    totals: {
      desired: Object.values(plan.targets).reduce((a, b) => a + b, 0),
      alive: c.liveTotal,
      queued: c.queueTotal,
      limit: GROUND_LIMIT,
    },
  };
}

export function updateArmyComposition(s) {
  if (s.result) return;
  for (const side of [0, 1]) {
    const plan = s.sides[side].armyComposition;
    if (!plan || s.time < plan.nextAt || !Object.keys(plan.targets).length) continue;
    plan.nextAt = s.time + ARMY_COMPOSITION.interval;
    const report = armyCompositionStatus(s, side);
    for (let offset = 0; offset < keys.length; offset++) {
      const index = (plan.cursor + offset) % keys.length,
        row = report.types[index];
      if (row.status !== 'active') continue;
      // Use the ordinary paid command; no separate resource or spawn implementation.
      if (recruit(s, side, row.key, row.siteId, 1, { mode: 'defend', post: 'auto' }) === true) {
        const site = s.buildings.find((b) => b.id === row.siteId);
        site.armyQueue.at(-1).autoDefense = true;
        plan.cursor = (index + 1) % keys.length;
        break;
      }
    }
  }
}

export function restoreArmyComposition(s, sourceVersion = s.version) {
  for (const side of [0, 1]) {
    const f = s.sides[side];
    if (sourceVersion < 15) {
      f.armyComposition = createArmyComposition();
      let available = GROUND_LIMIT;
      for (const key of keys) {
        const targets = s.buildings
          .filter(
            (b) =>
              b.side === side &&
              b.recruitRepeat?.enabled &&
              b.recruitRepeat.key === key &&
              Number.isSafeInteger(b.recruitRepeat.target),
          )
          .map((b) => b.recruitRepeat.target);
        const target = Math.min(available, Math.max(0, ...targets));
        if (target > 0) {
          f.armyComposition.targets[key] = target;
          available -= target;
        }
      }
    }
    const p = f.armyComposition;
    if (
      !record(p) ||
      !record(p.targets) ||
      Object.entries(p.targets).some(
        ([key, value]) =>
          !recruitmentFacility(key) ||
          !Number.isSafeInteger(value) ||
          value < 1 ||
          value > GROUND_LIMIT,
      ) ||
      Object.values(p.targets).reduce((a, b) => a + b, 0) > GROUND_LIMIT ||
      !Number.isFinite(p.nextAt) ||
      p.nextAt < 0 ||
      p.nextAt > s.time + ARMY_COMPOSITION.interval ||
      !Number.isSafeInteger(p.cursor) ||
      p.cursor < 0 ||
      p.cursor >= keys.length
    )
      throw Error('Повреждён состав армии');
    f.armyComposition = { targets: { ...p.targets }, nextAt: p.nextAt, cursor: p.cursor };
  }
  // Per-facility infinite recruitment is retired, not a second source of paid reinforcements.
  for (const b of s.buildings) if (b.recruitRepeat != null) b.recruitRepeat = null;
}
