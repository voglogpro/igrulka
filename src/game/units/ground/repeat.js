import { oilCost, hasOil, oilEnabled } from '../../city/oil.js';
import { GROUND_UNITS } from '../../config.js';

const barracks = (s, side, siteId) =>
  s.buildings.find((b) => b.id === Number(siteId) && b.side === side && b.key === 'barracks');
export const RECRUIT_REPEAT = { interval: 4, reserves: { credits: 250, materials: 5, oil: 5 } };

export function recruitRepeatStatus(s, side, siteId) {
  const b = barracks(s, side, siteId);
  if (!b) return null;
  const plan = b.recruitRepeat;
  const key = plan?.key || null;
  const d = GROUND_UNITS[key];
  const queued = b.armyQueue?.length || 0;
  const f = s.sides[side];
  const target = plan?.target ?? null;
  const reserves = target == null ? { credits: 0, materials: 0, oil: 0 } : plan.reserves;
  const present = (s.groundUnits || []).filter(
    (u) => u.side === side && u.key === key && u.hp > 0 && !u.downed,
  ).length;
  const queuedType = s.buildings
    .filter((site) => site.side === side && site.hp > 0 && !site.demolished)
    .reduce((count, site) => count + (site.armyQueue || []).filter((q) => q.key === key).length, 0);
  const remaining = target == null ? null : Math.max(0, target - present - queuedType);
  let status = 'off';
  if (plan?.enabled) {
    if (s.result) status = 'finished';
    else if (b.hp <= 0 || b.progress < 1 || b.demolished) status = 'site-unavailable';
    else if (!d) status = 'research';
    else if (remaining === 0) status = 'target-met';
    else if (queued) status = 'queued';
    else if (f.credits < d.cost || f.materials < d.metal) status = 'resources';
    else if (!hasOil(s, side, oilCost(key))) status = 'oil';
    else if (
      f.credits - d.cost < reserves.credits ||
      f.materials - d.metal < reserves.materials ||
      (oilEnabled(s) && oilCost(key) > 0 && (f.oil ?? 0) - oilCost(key) < reserves.oil)
    )
      status = 'reserve';
    else status = 'ready';
  }
  return {
    enabled: !!plan?.enabled,
    key,
    status,
    queued,
    target,
    present,
    queuedType,
    remaining,
    reserves: { ...reserves },
    reason: status,
    limit: null,
    affordable: !!d && f.credits >= d.cost && f.materials >= d.metal,
  };
}

export function setRecruitRepeat(s, side, siteId, key, enabled = true) {
  const b = barracks(s, side, siteId);
  if (!b || b.hp <= 0 || b.demolished) return 'Выберите свои действующие казармы';
  if (s.result) return 'Кампания завершена';
  if (typeof enabled !== 'boolean') return 'Неизвестный режим автонабора';
  if (!enabled) {
    b.recruitRepeat = null;
    return true;
  }
  return 'Выберите постоянный состав армии';
}

// Retired: composition is the only automatic purchaser. Paid queues remain untouched.

export function updateRecruitRepeat() {}
