import { VERSION, HQ_X } from './config.js';
import { campRoads } from './city/roads.js';
import { log } from './shared/events.js';
import { createDistricts } from './territory/state.js';
import { DIFFICULTY, DEFAULT_DIFFICULTY } from './ai/difficulty.config.js';
import { createWeather } from './weather.js';
import { createFrontlineMemory } from './defense/frontline.js';
import { createArmyComposition } from './units/ground/composition.js';
import { createAmmoStock } from './units/ground/ammunition.js';
import { createSettlements } from './territory/settlements.js';
export const newSide = () => ({
  credits: 3200,
  materials: 200,
  science: 0,
  tech: [],
  research: null,
  researchQueue: [],
  purchases: { building: {} },
  armyComposition: createArmyComposition(),
  ammoStock: createAmmoStock(),
  inventory: { drone: 0, heavy: 0, cruise: 0, ballistic: 0 },
  spentAmmo: 0,
  ammoProductionSpent: 0,
  rearAuto: true,
  // Barrels of oil in storage (see city/oil.js, OIL.start).
  oil: 150,
  kills: 0,
  losses: 0,
});

export function createGame(
  seed = Date.now() >>> 0,
  { difficulty = DEFAULT_DIFFICULTY, mode } = {},
) {
  const count = mode === 'coop' ? 4 : 2;
  const s = {
    version: VERSION,
    ...(mode ? { mode } : {}),
    difficulty: DIFFICULTY[difficulty] ? difficulty : DEFAULT_DIFFICULTY,
    time: 0,
    seed,
    weather: createWeather(seed),
    rules: { rear: true, oil: true },
    rng: seed || 1,
    nextId: count + 1,
    networkRevision: 0,
    sides: Array.from({ length: count }, newSide),
    buildings: Array.from({ length: count }, (_, side) => ({
      id: side + 1,
      side,
      key: 'hq',
      x: side % 2 ? HQ_X : -HQ_X,
      z: count === 4 ? (side < 2 ? -HQ_X : HQ_X) : 0,
      hp: 1100,
      maxHp: 1100,
      progress: 1,
      rotation: side % 2 ? Math.PI : 0,
      cooldown: 0,
    })),
    roads: [],
    serviceVehicles: [],
    ammoVehicles: [],
    ammoCrates: [],
    fieldSupplyAt: 0,
    fieldSupplyCursor: 0,
    ammoLogisticsAt: 0,
    ships: [],
    frontlineMemory: createFrontlineMemory(count),
    units: [],
    groundUnits: [],
    trenches: [],
    groundScars: [],
    districts: createDistricts(),
    settlements: createSettlements(),
    settlementHouseMask: 65535,
    settlementLayoutMask: 16777215,
    settlementClock: { next: 0, elapsed: 0 },
    contacts: Array.from({ length: count }, () => []),
    groups: Array.from({ length: count }, () => ({})),
    formations: Array(count).fill('line'),
    projectiles: [],
    events: [],
    log: [],
    ai: { nextBuild: 7, nextAttack: 170, roadPlan: 0 },
    ...(count === 4 ? { aiBySide: { 3: { nextBuild: 7, nextAttack: 170, roadPlan: 0 } } } : {}),
    result: null,
    stats: {
      shots: 0,
      hits: 0,
      misses: 0,
      interceptions: 0,
      impacts: 0,
      roadsCut: 0,
      crashes: 0,
      airbursts: 0,
      districtsCaptured: 0,
      districtsDestroyed: 0,
      trades: 0,
    },
  };
  campRoads(s);
  log(s, 'Развёртывание. Стройте экономику вдоль подъездной улицы штаба.');
  return s;
}
