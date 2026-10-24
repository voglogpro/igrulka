import { BUILDINGS, TECH, GROUND_UNITS } from '../config.js';
import { RECRUIT_REPEAT } from '../units/ground/repeat.js';

const record = (value) => value && typeof value === 'object' && !Array.isArray(value);
const configured = (table, key) => typeof key === 'string' && Object.hasOwn(table, key);

// Called after legacy entity migrations and before assigning the current version.
export function restoreEconomy(s, sourceVersion = s.version) {
  for (let side = 0; side < s.sides.length; side++) {
    const f = s.sides[side];
    if (sourceVersion < 14) f.purchases = { building: {} };
    if (
      !record(f.purchases) ||
      Object.keys(f.purchases).some((kind) => kind !== 'building') ||
      !record(f.purchases.building)
    )
      throw Error('Повреждена история покупок');
    const ledger = f.purchases.building;
    if (
      Object.entries(ledger).some(
        ([key, count]) =>
          !configured(BUILDINGS, key) ||
          !Number.isSafeInteger(count) ||
          count < 0 ||
          count > 1_000_000_000,
      )
    )
      throw Error('Повреждена история покупок');
    for (const key of Object.keys(BUILDINGS)) {
      const existing = s.buildings.filter((b) => b.side === side && b.key === key).length;
      if (ledger[key] == null && existing > 0) ledger[key] = existing;
      else if (ledger[key] < existing) throw Error('Повреждена история покупок');
    }
    if (sourceVersion < 14) f.researchQueue = [];
    if (!Array.isArray(f.researchQueue) || f.researchQueue.length >= Object.keys(TECH).length)
      throw Error('Повреждены исследования');
    const projects = [...(f.research ? [f.research] : []), ...f.researchQueue];
    const seen = new Set();
    for (const project of projects) {
      if (
        !record(project) ||
        !configured(TECH, project.key) ||
        !Number.isFinite(project.progress) ||
        seen.has(project.key) ||
        f.tech.includes(project.key) ||
        (TECH[project.key].requires && !f.tech.includes(TECH[project.key].requires))
      )
        throw Error('Повреждены исследования');
      if (sourceVersion < 14) project.progress = Math.max(0, Math.min(1, project.progress));
      if (project.progress < 0 || project.progress > 1) throw Error('Повреждены исследования');
      seen.add(project.key);
    }
    f.research = projects[0] || null;
    f.researchQueue = projects.slice(1);
  }
  for (const b of s.buildings) {
    const plan = b.recruitRepeat;
    if (plan == null || plan.target == null) continue;
    if (
      b.key !== 'barracks' ||
      !record(plan) ||
      !configured(GROUND_UNITS, plan.key) ||
      GROUND_UNITS[plan.key].civil ||
      typeof plan.enabled !== 'boolean' ||
      !Number.isSafeInteger(plan.target) ||
      plan.target < 1 ||
      plan.target > 120 ||
      !record(plan.reserves) ||
      Object.entries(RECRUIT_REPEAT.reserves).some(
        ([key, value]) => plan.reserves[key] !== value,
      ) ||
      !Number.isFinite(plan.nextAt) ||
      plan.nextAt < 0 ||
      plan.nextAt > s.time + RECRUIT_REPEAT.interval
    )
      throw Error('Повреждён план гарнизона');
  }
}
