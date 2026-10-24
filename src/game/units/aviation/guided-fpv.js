import { groundHeight } from '../../map.js';
import { groundVisible } from '../infantry/cover.js';

// Guidance follows the last observed position. Losing contact does not reveal a hidden tank.
export function guidedFPVPosition(s, u, dt) {
  if (u.subtype !== 'fpv' || !u.fpvTargetId) return null;
  if (s.time >= (u.fpvSeekAt || 0) && u.travelled < 600) {
    u.fpvSeekAt = s.time + 0.15;
    const target = s.groundUnits.find((v) => v.id === u.fpvTargetId);
    if (target && !target.downed && groundVisible(s, u.side, target)) {
      u.tx = target.x;
      u.tz = target.z;
    }
  }
  const dx = u.tx - u.x,
    dz = u.tz - u.z;
  const distance = Math.hypot(dx, dz);
  const step = Math.min(distance, (u.speed || 50) * (u.hp / u.maxHp < 0.4 ? 0.85 : 1) * dt);
  const x = u.x + (dx / (distance || 1)) * step;
  const z = u.z + (dz / (distance || 1)) * step;
  u.travelled += step;
  u.total = u.travelled + Math.max(0, distance - step);
  return {
    x,
    z,
    y:
      groundHeight(x, z) +
      Math.min(u.altitude || 18, 4 + u.travelled * 0.48, 4 + (distance - step) * 0.48),
  };
}
