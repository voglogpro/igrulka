// Visual signature of each weapon class. Only rendering reads this; damage lives in game configs.
// flash: fireball radius, jet: forward cone length, petals: side flashes of a muzzle brake,
// casing: spent case size (0 — none), smoke: muzzle smoke size, every: smoke on every Nth round,
// light: pooled light power (0 — none), lightEvery: light on every Nth round,
// reach: distance from a ground unit's centre to its muzzle.
export const WEAPON_FX = {
  rifle: { flash: 0.8, jet: 1.6, petals: 0, casing: 0, smoke: 0.35, every: 2, light: 0 },
  mg: { flash: 1.15, jet: 2.4, petals: 2, casing: 0.32, smoke: 0.45, every: 2, light: 0 },
  hmg: {
    flash: 1.8,
    jet: 3.6,
    petals: 2,
    casing: 0.5,
    smoke: 0.7,
    every: 2,
    light: 9,
    lightEvery: 4,
  },
  shilka: {
    flash: 2.1,
    jet: 4.6,
    petals: 3,
    casing: 0.62,
    smoke: 0.9,
    every: 2,
    light: 14,
    lightEvery: 3,
  },
  autocannon: {
    flash: 3.1,
    jet: 6.5,
    petals: 3,
    casing: 0.95,
    smoke: 1.3,
    every: 1,
    light: 22,
    lightEvery: 2,
    brake: true,
  },
  tank: {
    flash: 5,
    jet: 10,
    petals: 4,
    casing: 0,
    smoke: 2.2,
    every: 1,
    light: 40,
    lightEvery: 1,
    brake: true,
    blast: true,
    reach: 8.5,
  },
  artillery: {
    flash: 6.5,
    jet: 13,
    petals: 2,
    casing: 0,
    smoke: 3,
    every: 1,
    light: 55,
    lightEvery: 1,
    brake: true,
    blast: true,
    reach: 14,
  },
  atgm: {
    flash: 2.4,
    jet: 3,
    petals: 0,
    casing: 0,
    smoke: 1.6,
    every: 1,
    light: 18,
    lightEvery: 1,
    backblast: true,
    reach: 1.6,
  },
  sam: {
    flash: 3.4,
    jet: 5,
    petals: 0,
    casing: 0,
    smoke: 2.4,
    every: 1,
    light: 30,
    lightEvery: 1,
    backblast: true,
  },
};

const AIR_GUNS = { gepard: 'autocannon', shilka: 'shilka', mog: 'hmg', gun: 'hmg' };
const GROUND_GUNS = {
  howitzer: 'artillery',
  leopard: 'tank',
  tankdestroyer: 'tank',
  atgm: 'atgm',
  machinegunner: 'mg',
  apc: 'mg',
  mog: 'hmg',
  gun: 'hmg',
};

export function weaponClass(event, shooterKey) {
  if (event.key === 'sam') return 'sam';
  if (event.ground) return GROUND_GUNS[shooterKey] || (event.key === 'cannon' ? 'tank' : 'rifle');
  return AIR_GUNS[shooterKey] || (event.key === 'cannon' ? 'autocannon' : 'rifle');
}
