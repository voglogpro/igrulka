import { GROUND_UNITS, BUILDINGS } from './config.js';
export function targetById(s, id) {
  const u = (s.groundUnits || []).find((u) => u.id === Number(id) && u.hp > 0);
  if (u) return { ...u, ground: true };
  const b = s.buildings.find((b) => b.id === Number(id));
  if (b) return b.demolished ? null : b;
  const r = s.roads.find((r) => r.id === Number(id) && !r.removed);
  return r ? { ...r, key: 'road', x: (r.ax + r.bx) / 2, z: (r.az + r.bz) / 2, progress: 1 } : null;
}

export function targetName(t) {
  return t?.key === 'road'
    ? `Участок дороги #${t.id}`
    : GROUND_UNITS[t?.key]?.name || BUILDINGS[t?.key]?.name || 'Командный пункт';
}
