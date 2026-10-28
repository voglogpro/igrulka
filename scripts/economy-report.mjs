import { BUILDINGS, GROUND_UNITS, WEAPONS } from '../src/game/config.js';
import { ELECTRONICS } from '../src/game/city/electronics.js';
import { OIL } from '../src/game/city/oil.js';
import { purchaseFactor } from '../src/game/city/pricing.js';
import { AMMUNITION } from '../src/game/units/ground/ammunition.js';

// Read-only dimensional analysis of the shipped recipes, not a combat simulation
// or a promise of achievable throughput. Assumes full power, roads and health,
// no difficulty/territory modifiers, and a working electronics supply chain.
const rounded = (n) => Math.round(n * 10000) / 10000;
const recipe = (d, count = 1) => {
  const chips = d.components || 0;
  return {
    credits: rounded(((d.cost || 0) + chips * ELECTRONICS.credits) * count),
    alloys: rounded(((d.metal || 0) + chips * ELECTRONICS.metal) * count),
    oil: rounded(((d.oil || 0) + chips * ELECTRONICS.oil) * count),
    chips: chips * count,
  };
};
const flow = (orders) => {
  const totals = { credits: 0, alloys: 0, oil: 0, chips: 0, factorySeconds: 0 };
  for (const [key, perMinute] of Object.entries(orders)) {
    const d = WEAPONS[key];
    for (const [resource, amount] of Object.entries(recipe(d, perMinute)))
      totals[resource] += amount;
    totals.factorySeconds += d.time * perMinute;
  }
  return {
    ordersPerMinute: orders,
    consumptionPerMinute: Object.fromEntries(
      Object.entries(totals).map(([key, value]) => [key, rounded(value)]),
    ),
    idealMinimumFacilities: {
      industry: rounded(totals.alloys / (BUILDINGS.industry.materials * 60)),
      oilwell: rounded(totals.oil / (BUILDINGS.oilwell.oil * 60)),
      electronics: rounded(totals.chips / (60 / ELECTRONICS.seconds)),
      factory: rounded(totals.factorySeconds / 60),
    },
    excluded: ['facility construction/upkeep', 'army', 'ammunition', 'repairs', 'delivery fuel'],
  };
};
const ammo = Object.fromEntries(
  AMMUNITION.kinds.map((key) => {
    const [cost, metal, oil] = AMMUNITION.costs[key];
    const count = AMMUNITION.batches[key];
    return [
      key,
      {
        batchSize: count,
        fullBatch: recipe({ cost, metal, oil, components: AMMUNITION.components[key] }),
        perRoundAtFullBatch: recipe(
          { cost, metal, oil, components: AMMUNITION.components[key] },
          1 / count,
        ),
        partialBatchWarning: 'A partial electronics batch rounds component cost upward.',
      },
    ];
  }),
);
const report = {
  kind: 'static recipe/throughput audit; not gameplay balancing acceptance',
  units: 'all flow values per real-time game minute; raw configuration uses seconds',
  buildingPriceFactors: Array.from({ length: 6 }, (_, n) => purchaseFactor(n)),
  economy: {
    headquartersCreditsPerMinute: 1.8 * 60,
    industryAlloysPerMinute: BUILDINGS.industry.materials * 60,
    oilwellOilPerMinute: BUILDINGS.oilwell.oil * 60,
    housingBaseNetPerMinute: rounded((BUILDINGS.housing.income - BUILDINGS.housing.upkeep) * 60),
    electronicsPerMinute: 60 / ELECTRONICS.seconds,
    electronicsConsumptionPerMinute: recipe(
      {
        cost: ELECTRONICS.credits,
        metal: ELECTRONICS.metal,
        oil: ELECTRONICS.oil,
      },
      60 / ELECTRONICS.seconds,
    ),
    electronicsFullStockCost: recipe(
      {
        cost: ELECTRONICS.credits,
        metal: ELECTRONICS.metal,
        oil: ELECTRONICS.oil,
      },
      ELECTRONICS.capacity,
    ),
  },
  weapons: Object.fromEntries(Object.entries(WEAPONS).map(([key, d]) => [key, recipe(d)])),
  ammo,
  army: Object.fromEntries(
    [
      'infantry',
      'machinegunner',
      'atrifle',
      'atgm',
      'medic',
      'operator',
      'supplytruck',
      'leopard',
      'mlrs',
    ].map((key) => {
      const d = GROUND_UNITS[key];
      return [
        key,
        {
          purchase: recipe(d),
          upkeepPerMinute: rounded(d.upkeep * 60),
          movingOilPerMinute: rounded((d.fuel || 0) * OIL.engineMultiplier * 60),
        },
      ];
    }),
  ),
  productionExamples: [
    flow({ drone: 3 }),
    flow({ drone: 6, heavy: 2, cruise: 0.5, ballistic: 0.25 }),
    flow({ ballistic: 1 }),
  ],
};
console.log(JSON.stringify(report, null, 2));
