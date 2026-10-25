import { sideIds } from '../../factions.js';
import { BUILDINGS } from '../../config.js';
import { supplyFactor } from '../../city/economy.js';

// Training grounds: recruits arrive already trained, and soldiers resting near the range drill
// to the next rank. Combat experience still goes further (see veterancy.js).
const cfg = () => BUILDINGS.training.training;
const ranges = (s, side) =>
  s.buildings.filter(
    (b) =>
      b.side === side &&
      b.key === 'training' &&
      b.hp > 0 &&
      b.progress >= 1 &&
      !b.demolished &&
      supplyFactor(s, b) === 1,
  );

export function trainRecruit(s, u) {
  if (ranges(s, u.side).length) u.xp = Math.max(u.xp || 0, cfg().recruitXp);
}

export function updateTraining(s, dt) {
  const c = cfg();
  for (const side of sideIds(s)) {
    const list = ranges(s, side);
    if (!list.length) continue;
    for (const u of s.groundUnits)
      if (
        u.side === side &&
        u.hp > 0 &&
        !u.carrierId &&
        !u.moving &&
        u.enemyId == null &&
        (u.xp || 0) < c.maxXp &&
        list.some((b) => (b.x - u.x) ** 2 + (b.z - u.z) ** 2 < c.radius * c.radius)
      )
        u.xp = Math.min(c.maxXp, (u.xp || 0) + c.drillXp * dt);
  }
}
