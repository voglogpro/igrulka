import { VERSION, HQ_X, WEAPONS } from './config.js';
import { HQ_Z } from './map.js';
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
  components: 0,
  componentProductionSpent: 0,
  science: 0,
  tech: [],
  research: null,
  researchQueue: [],
  purchases: { building: {} },
  roadRecovery: null,
  armyComposition: createArmyComposition(),
  ammoStock: createAmmoStock(),
  inventory: Object.fromEntries(Object.keys(WEAPONS).map((key) => [key, 0])),
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
  // 'coop': two allied player cities against two bots; 'siege': one player in the middle of the
  // western bank against two allied bots holding the north and south of the eastern bank.
  const count = mode === 'coop' ? 4 : mode === 'siege' ? 3 : 2;
  const plan = () => ({
    nextBuild: 7,
    nextAttack: 170,
    roadPlan: 0,
    aiDefenseAt: 0,
    aiGroundReserve: { amount: 0, nextAt: 0 },
  });
  const site = (side) =>
    count === 4
      ? { x: side % 2 ? HQ_X : -HQ_X, z: side < 2 ? -HQ_Z : HQ_Z }
      : count === 3
        ? side
          ? { x: HQ_X, z: side === 1 ? -HQ_Z : HQ_Z }
          : { x: -HQ_X, z: 0 }
        : { x: side ? HQ_X : -HQ_X, z: 0 };
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
      ...site(side),
      hp: 1100,
      maxHp: 1100,
      progress: 1,
      rotation: site(side).x > 0 ? Math.PI : 0,
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
    warships: [],
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
    ai: {
      nextBuild: 7,
      nextAttack: 170,
      roadPlan: 0,
      aiDefenseAt: 0,
      aiGroundReserve: { amount: 0, nextAt: 0 },
    },
    ...(count === 4 ? { aiBySide: { 3: plan() } } : count === 3 ? { aiBySide: { 2: plan() } } : {}),
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
