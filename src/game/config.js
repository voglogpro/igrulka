import { BUILDINGS } from './city/buildings.config.js';
import { WEAPONS } from './units/aviation/weapons.config.js';
import { GROUND_UNITS } from './units/ground/types.js';
import { veteranAccuracy } from './units/ground/veterancy.js';
export { BUILDINGS, WEAPONS, GROUND_UNITS };
export { TECH } from './research/tech-tree.config.js';
export { isInfantry } from './units/ground/types.js';
export { VERSION, MAP, riverX, riverDistance } from './map.js';
export { dayPhase } from './clock.js';
export function weaponStats(f, key) {
  const d = WEAPONS[key];
  return {
    ...d,
    speed: d.speed * (f.tech.includes('propulsion') ? 1.2 : 1),
    hp: d.hp * (f.tech.includes('airframes') ? 1.3 : 1),
    damage: d.damage * (f.tech.includes('payload') ? 1.2 : 1),
  };
}
export function defenseStats(f, b) {
  const d = BUILDINGS[b.key] || GROUND_UNITS[b.key],
    level = b.level || 0,
    shared = d.infantry || b.key === 'gun';
  return {
    ...d,
    range: d.range * (1 + level * 0.08),
    damage: d.damage * (1 + level * 0.15),
    accuracy:
      (f.tech.includes('targeting') ? 0.75 : 1) * Math.pow(0.82, level) * veteranAccuracy(b),
    magazine: Math.ceil(
      (shared ? (d.groundMagazine ?? d.magazine) : d.magazine) *
        (f.tech.includes('magazines') ? 1.5 : 1),
    ),
    reload:
      (shared ? (d.groundReload ?? d.reload) : d.reload) *
      (f.tech.includes('magazines') ? 0.75 : 1),
    cooling: d.cooling * (f.tech.includes('cooling') ? 1.5 : 1),
    heatPerShot: d.heatPerShot * (f.tech.includes('cooling') ? 0.85 : 1),
  };
}
export function canEngageAir(key, target, abm = false) {
  return key === 'sam'
    ? ['drone', 'heavy', 'cruise'].includes(target) || (target === 'ballistic' && abm)
    : [
        'gun',
        'mog',
        'infantry',
        'machinegunner',
        'assault',
        'engineer',
        'operator',
        'shilka',
        'gepard',
      ].includes(key) &&
        (target === 'drone' || target === 'heavy');
}
