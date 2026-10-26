import { BUILDINGS } from './city/buildings.config.js';
import { WEAPONS } from './units/aviation/weapons.config.js';
import { GROUND_UNITS } from './units/ground/types.js';
import { veteranAccuracy } from './units/ground/veterancy.js';
import { equipmentModifiers } from './combat/upgrade-tiers.js';
export { BUILDINGS, WEAPONS, GROUND_UNITS };
export { TECH } from './research/tech-tree.config.js';
export { isInfantry } from './units/ground/types.js';
export {
  VERSION,
  MAP,
  FIELD,
  inField,
  SEA,
  CORRIDORS,
  HQ_X,
  ISLAND,
  OIL_FIELDS,
  HILLS,
  riverX,
  riverDistance,
  seaDistance,
  isWater,
  groundHeight,
  terrainClear,
} from './map.js';
export { dayPhase } from './clock.js';
export function weaponStats(f, key) {
  return { ...WEAPONS[key] };
}
export function defenseStats(f, b) {
  const d = BUILDINGS[b.key] || GROUND_UNITS[b.key],
    shared = d.infantry || b.key === 'gun',
    modifiers = equipmentModifiers(b);
  return {
    ...d,
    range: d.range * modifiers.range,
    damage: d.damage,
    accuracy: veteranAccuracy(b) * modifiers.spread,
    cooldown: d.cooldown / modifiers.rate,
    magazine: Math.ceil(shared ? (d.groundMagazine ?? d.magazine) : d.magazine),
    reload: shared ? (d.groundReload ?? d.reload) : d.reload,
    cooling: d.cooling * (modifiers.cooling || 1),
    heatPerShot: d.heatPerShot * (modifiers.heat || 1),
  };
}
export function canEngageAir(key, target) {
  return key === 'sam'
    ? ['drone', 'heavy', 'cruise', 'ballistic'].includes(target)
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
