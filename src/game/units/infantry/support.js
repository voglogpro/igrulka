import { isInfantry } from '../../config.js';
import { updateFortification } from '../../defense/fortifications.js';
export function updateInfantrySupport(s, u, dt) {
  const foot = isInfantry(u.key);
  updateFortification(s, u, dt);
  if (foot && !u.moving) {
    const base = s.buildings.find(
      (b) =>
        b.side === u.side &&
        b.hp > 0 &&
        b.progress >= 1 &&
        ['barracks', 'hq'].includes(b.key) &&
        Math.hypot(b.x - u.x, b.z - u.z) < 48,
    );
    if (base && u.hp < u.maxHp && s.sides[u.side].credits > 0.5) {
      const amount = Math.min(u.maxHp - u.hp, dt * 3);
      u.hp += amount;
      s.sides[u.side].credits -= amount * 0.3;
    }
  }
  if (u.key === 'engineer' && !u.moving) {
    const v = s.groundUnits.find(
        (v) =>
          v.side === u.side &&
          !isInfantry(v.key) &&
          v.hp > 0 &&
          v.hp < v.maxHp &&
          Math.hypot(v.x - u.x, v.z - u.z) < 26,
      ),
      f = s.sides[u.side];
    if (v && f.credits > 1 && f.materials > 0.1) {
      const amount = Math.min(v.maxHp - v.hp, dt * 4);
      v.hp += amount;
      f.credits -= amount * 0.3;
      f.materials -= amount * 0.025;
    }
  }
}
