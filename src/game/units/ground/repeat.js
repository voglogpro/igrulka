import { oilCost, hasOil, spendOil } from '../../city/oil.js';
import { GROUND_UNITS } from '../../config.js';
import { GROUND_LIMIT } from './navigation.js';

const barracks = (s, side, siteId) =>
  s.buildings.find((b) => b.id === Number(siteId) && b.side === side && b.key === 'barracks');

export function recruitRepeatStatus(s, side, siteId) {
  const b = barracks(s, side, siteId);
  if (!b) return null;
  const plan = b.recruitRepeat;
  const key = plan?.key || null;
  const d = GROUND_UNITS[key];
  const queued = b.armyQueue?.length || 0;
  const alive = (s.groundUnits || []).filter((u) => u.side === side && u.hp > 0).length;
  const sideQueued = s.buildings
    .filter((site) => site.side === side && site.hp > 0)
    .reduce((n, site) => n + (site.armyQueue?.length || 0), 0);
  const f = s.sides[side];
  let status = 'off';
  if (plan?.enabled) {
    if (s.result) status = 'finished';
    else if (b.hp <= 0 || b.progress < 1) status = 'site-unavailable';
    else if (!d || (d.tech && !f.tech.includes(d.tech))) status = 'research';
    else if (queued) status = 'queued';
    else if (alive + sideQueued >= GROUND_LIMIT) status = 'unit-limit';
    else if (f.credits < d.cost || f.materials < d.metal) status = 'resources';
    else if (!hasOil(s, side, oilCost(key))) status = 'oil';
    else status = 'ready';
  }
  return {
    enabled: !!plan?.enabled,
    key,
    status,
    queued,
    limit: GROUND_LIMIT,
    affordable: !!d && f.credits >= d.cost && f.materials >= d.metal,
  };
}

export function setRecruitRepeat(s, side, siteId, key, enabled = true) {
  const b = barracks(s, side, siteId);
  if (!b || b.hp <= 0) return 'Выберите свои действующие казармы';
  if (s.result) return 'Кампания завершена';
  if (!enabled) {
    b.recruitRepeat = null;
    return true;
  }
  const d = GROUND_UNITS[key];
  if (!d || (d.tech && !s.sides[side].tech.includes(d.tech))) return 'Нужно исследование';
  b.recruitRepeat = { enabled: true, key };
  return true;
}

export function updateRecruitRepeat(s) {
  for (const b of s.buildings) {
    if (b.key !== 'barracks' || !b.recruitRepeat?.enabled) continue;
    if (recruitRepeatStatus(s, b.side, b.id)?.status !== 'ready') continue;
    const d = GROUND_UNITS[b.recruitRepeat.key];
    const f = s.sides[b.side];
    f.credits -= d.cost;
    f.materials -= d.metal;
    spendOil(s, b.side, oilCost(b.recruitRepeat.key));
    (b.armyQueue ||= []).push({ key: b.recruitRepeat.key, progress: 0 });
  }
}
