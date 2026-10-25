export const SETTLEMENT_RULES = {
  roadReach: 34,
  radius: 54,
  income: 0.6,
  materials: 0.05,
  neutralizeSeconds: 12,
  captureSeconds: 22,
  decayPerSecond: 0.035,
  cadence: 1,
};
export const SETTLEMENTS = [-1415, 1415].flatMap((z, row) =>
  [-1515, -515, 515, 1515].map((x, column) => ({
    id: `${row ? 'south' : 'north'}-village-${column + 1}`,
    name: `${row ? 'Южное' : 'Северное'} поселение ${column + 1}`,
    x,
    z,
    radius: SETTLEMENT_RULES.radius,
    variant: column < 2 ? column : 3 - column,
    seed: (row * 2 + Math.min(column, 3 - column) + 1) * 137,
  })),
);
export const SETTLEMENT_BY_ID = Object.fromEntries(SETTLEMENTS.map((site) => [site.id, site]));
export const settlementHouseOffsets = (site) =>
  [-20, 20].map((x, index) => ({
    x,
    z: (index ? -1 : 1) * (8 + (site.seed % 3)),
  }));
export const SETTLEMENT_FOOTPRINTS = SETTLEMENTS.flatMap((site) =>
  settlementHouseOffsets(site).map((house) => ({ x: site.x + house.x, z: site.z + house.z, r: 8 })),
);
const footprintCache = new WeakMap();
export function settlementHouseEnabled(s, index) {
  return (
    Number.isInteger(index) &&
    index >= 0 &&
    index < 16 &&
    ((s.settlementHouseMask ?? 65535) & (1 << index)) !== 0
  );
}
export function activeSettlementFootprints(s) {
  const mask = s.settlementHouseMask ?? 65535;
  let entry = footprintCache.get(s);
  if (!entry || entry.mask !== mask) {
    entry = {
      mask,
      footprints: SETTLEMENT_FOOTPRINTS.filter((_, index) => settlementHouseEnabled(s, index)),
    };
    footprintCache.set(s, entry);
  }
  return entry.footprints;
}
