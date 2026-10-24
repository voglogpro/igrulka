import { VERSION } from './config.js';
import { campRoads } from './city/roads.js';
import { log } from './shared/events.js';
import { createDistricts } from './territory/state.js';
import { DIFFICULTY, DEFAULT_DIFFICULTY } from './ai/difficulty.config.js';
import { createWeather } from './weather.js';
export const newSide = () => ({
  credits: 3200,
  materials: 200,
  science: 0,
  tech: [],
  research: null,
  inventory: { drone: 0, heavy: 0, cruise: 0, ballistic: 0 },
  spentAmmo: 0,
  rearAuto: true,
  kills: 0,
  losses: 0,
});

export function createGame(seed = Date.now() >>> 0, { difficulty = DEFAULT_DIFFICULTY } = {}) {
  const s = {
    version: VERSION,
    difficulty: DIFFICULTY[difficulty] ? difficulty : DEFAULT_DIFFICULTY,
    time: 0,
    seed,
    weather: createWeather(seed),
    rules: { rear: true },
    rng: seed || 1,
    nextId: 3,
    networkRevision: 0,
    sides: [newSide(), newSide()],
    buildings: [
      {
        id: 1,
        side: 0,
        key: 'hq',
        x: -615,
        z: 0,
        hp: 1100,
        maxHp: 1100,
        progress: 1,
        rotation: 0,
        cooldown: 0,
      },
      {
        id: 2,
        side: 1,
        key: 'hq',
        x: 615,
        z: 0,
        hp: 1100,
        maxHp: 1100,
        progress: 1,
        rotation: Math.PI,
        cooldown: 0,
      },
    ],
    roads: [],
    serviceVehicles: [],
    units: [],
    groundUnits: [],
    trenches: [],
    districts: createDistricts(),
    contacts: [[], []],
    groups: [{}, {}],
    formations: ['line', 'line'],
    projectiles: [],
    events: [],
    log: [],
    ai: { nextBuild: 7, nextAttack: 170, nextResearch: 65, roadPlan: 0 },
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
