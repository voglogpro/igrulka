import { BUILDINGS, GROUND_UNITS, WEAPONS, TECH, defenseStats } from '../config.js';
import { purchaseFactor } from '../city/pricing.js';
import { demolish } from '../city/construction.js';
import { upgradeable } from '../combat/upgrades.js';

// Runs after legacy resource/project validation and restoreEconomy. The source-version
// boundary makes compensation idempotent across subsequent save/load cycles.
export function restoreRetiredResearch(s, sourceVersion = s.version) {
  const entities = [...s.buildings, ...(s.groundUnits || [])];
  const byId = new Map(entities.map((u) => [u.id, u]));
  if (
    entities.some(
      (u) =>
        u.level != null &&
        (!Number.isSafeInteger(u.level) ||
          u.level < 0 ||
          u.level > 2 ||
          (u.level > 0 && !upgradeable(u))),
    )
  )
    throw Error('Повреждён уровень установки');
  for (const side of sideIds(s)) {
    const f = s.sides[side];
    if (sourceVersion < 15) {
      const paid = new Set();
      for (const project of [f.research, ...(f.researchQueue || [])])
        if (project && Object.hasOwn(TECH, project.key) && !paid.has(project.key)) {
          f.credits += TECH[project.key].cost;
          paid.add(project.key);
        }
      const labs = s.buildings
        .filter((b) => b.side === side && b.key === 'lab')
        .sort((a, b) => a.id - b.id);
      // The ledger may include earlier buildings removed from old exported saves.
      const earlier = Math.max(0, (f.purchases?.building?.lab ?? labs.length) - labs.length);
      for (let i = 0; i < labs.length; i++) {
        const b = labs[i];
        if (b.hp <= 0 || b.demolished) continue;
        const factor = sourceVersion < 14 ? 1 : purchaseFactor(earlier + i);
        f.credits += Math.round(BUILDINGS.lab.cost * factor);
        f.materials += Math.round(BUILDINGS.lab.metal * factor);
        // Only this building and its dedicated driveway are removed. Main roads survive.
        demolish(s, b.id, side);
      }
      for (const u of s.groundUnits || []) {
        const d = GROUND_UNITS[u.key];
        if (
          u.side !== side ||
          !d ||
          d.infantry ||
          !f.tech.includes('composite') ||
          u.maxHp !== Math.round(d.hp * 1.25)
        )
          continue;
        u.hp = Math.max(0, (d.hp * u.hp) / u.maxHp);
        u.maxHp = d.hp;
      }
      for (const u of s.units || []) {
        const d = WEAPONS[u.key];
        if (u.side !== side || !d || u.subtype === 'fpv') continue;
        if (f.tech.includes('airframes') && Math.abs(u.maxHp - d.hp * 1.3) < 1e-6) {
          u.hp = Math.max(0, (d.hp * u.hp) / u.maxHp);
          u.maxHp = d.hp;
        }
        if (f.tech.includes('propulsion') && Math.abs(u.speed - d.speed * 1.2) < 1e-6)
          u.speed = d.speed;
        if (f.tech.includes('payload') && Math.abs(u.damage - d.damage * 1.2) < 1e-6)
          u.damage = d.damage;
      }
      if (f.tech.includes('magazines'))
        for (const u of entities) {
          const d = BUILDINGS[u.key] || GROUND_UNITS[u.key];
          if (u.side !== side || !d?.range) continue;
          const stats = defenseStats(f, u);
          if (Number.isFinite(u.ammo)) u.ammo = Math.min(u.ammo, stats.magazine);
          if (u.reloadLeft > 0) u.reloadLeft /= 0.75;
          if (d.infantry || u.key === 'gun') {
            if (Number.isFinite(u.groundAmmo))
              u.groundAmmo = Math.min(u.groundAmmo, stats.magazine);
            if (u.groundReload > 0) u.groundReload /= 0.75;
          }
        }
      for (const p of s.projectiles || []) {
        if (p.side !== side || p.domain === 'ground') continue;
        const source = byId.get(p.sourceId ?? p.source);
        if (!source || !(BUILDINGS[source.key] || GROUND_UNITS[source.key])?.range) continue;
        const damage = defenseStats(f, source).damage;
        const oldDamage =
          damage * (1 + (source.level || 0) * 0.15) * (p.abm && f.tech.includes('abm') ? 1.15 : 1);
        if (Math.abs(p.damage - oldDamage) < 1e-6) p.damage = damage;
      }
      f.tech = [];
      f.science = 0;
      f.research = null;
      f.researchQueue = [];
    } else if (
      f.tech.length ||
      f.research != null ||
      f.researchQueue.length ||
      s.buildings.some((b) => b.side === side && b.key === 'lab' && b.hp > 0 && !b.demolished)
    )
      throw Error('Исследования упразднены');
  }
}
import { sideIds } from '../factions.js';
