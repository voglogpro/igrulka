import { hostile } from './factions.js';
import { groundVisible } from './units/infantry/cover.js';
// The map and ordinary targets are open. Infantry concealment remains independent.
import { radarSources, VISION } from './vision-grid.js';
export { VISION };
export const sensorSources = radarSources;
export const pointVisible = () => true;
export const unitVisible = (_s, _side, u) => u.delay <= 0 && (u.hp > 0 || u.status === 'falling');
export const eventVisible = () => true;
const roadTarget = (r) => ({
  ...r,
  key: 'road',
  x: (r.ax + r.bx) / 2,
  z: (r.az + r.bz) / 2,
  progress: 1,
});
export function observedTarget(s, side, id) {
  const crate = s.ammoCrates?.find((c) => c.id === Number(id) && c.hp > 0);
  if (crate) {
    const publicCrate = {
      id: crate.id,
      side: crate.side,
      key: crate.key,
      x: crate.x,
      z: crate.z,
      hp: crate.hp,
      maxHp: crate.maxHp,
      fieldCrate: true,
      ground: false,
      progress: 1,
    };
    return crate.side === side ? { ...publicCrate, stock: { ...crate.stock } } : publicCrate;
  }
  const u = (s.groundUnits || []).find((u) => u.id === Number(id) && u.hp > 0);
  if (u) return groundVisible(s, side, u) ? { ...u, ground: true } : null;
  const b = s.buildings.find((b) => b.id === Number(id));
  if (b) return b.demolished ? null : b;
  const r = s.roads.find((r) => r.id === Number(id) && !r.removed);
  return r ? roadTarget(r) : null;
}
export function knownTargets(s, side) {
  // These two collections are public city targets. Their type is already known:
  // do not search the entire army/crate/city arrays again for each catalogue row.
  const targets = [];
  for (const b of s.buildings)
    if (hostile(s, b.side, side) && !b.demolished && b.hp > 0) targets.push(b);
  for (const r of s.roads)
    if (hostile(s, r.side, side) && !r.removed && r.hp > 0) targets.push(roadTarget(r));
  return targets;
}
