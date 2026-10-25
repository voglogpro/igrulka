export const SETTLEMENT_RULES = {
  roadReach: 34,
  radius: 54,
  income: 0,
  materials: 0,
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
const settlementIndices = new Map(SETTLEMENTS.map((site, index) => [site.id, index]));
// Ordinary building sizes and a central street leave a readable approach from
// the interior of the map. A village's layout never follows moving units.
export function settlementLayout(site) {
  const facing = -Math.sign(site.z);
  const components = [
    { slot: 0, key: 'housing', x: site.x - 42, z: site.z, size: 25, rotation: Math.PI / 2 },
    { slot: 1, key: 'industry', x: site.x + 42, z: site.z, size: 28, rotation: -Math.PI / 2 },
    ...(site.variant
      ? [
          {
            slot: 2,
            key: 'housing',
            x: site.x,
            z: site.z - 58 * facing,
            size: 25,
            rotation: facing > 0 ? 0 : Math.PI,
          },
        ]
      : []),
  ];
  return {
    components,
    entrance: { x: site.x, z: site.z + 78 * facing },
    roads: [
      { ax: site.x, az: site.z + 78 * facing, bx: site.x, bz: site.z - 35 * facing },
      { ax: site.x, az: site.z, bx: site.x - 26.5, bz: site.z, slot: 0 },
      { ax: site.x, az: site.z, bx: site.x + 25, bz: site.z, slot: 1 },
      ...(site.variant
        ? [
            {
              ax: site.x,
              az: site.z - 35 * facing,
              bx: site.x,
              bz: site.z - 42.5 * facing,
              slot: 2,
            },
          ]
        : []),
    ],
  };
}
export const SETTLEMENT_COMPONENTS = SETTLEMENTS.flatMap((site, siteIndex) =>
  settlementLayout(site).components.map((component) => ({
    ...component,
    settlementId: site.id,
    index: siteIndex * 3 + component.slot,
    r: component.size * 0.6,
  })),
);
export function settlementComponentEnabled(s, site, slot) {
  const index = settlementIndices.get(typeof site === 'string' ? site : site.id);
  return (
    index !== undefined &&
    Number.isInteger(slot) &&
    slot >= 0 &&
    slot < 3 &&
    ((s.settlementLayoutMask ?? 16777215) & (1 << (index * 3 + slot))) !== 0
  );
}
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
  const mask = s.settlementLayoutMask ?? 16777215;
  let entry = footprintCache.get(s);
  if (
    !entry ||
    entry.mask !== mask ||
    entry.revision !== s.networkRevision ||
    entry.settlements !== s.settlements
  ) {
    const claimed = new Set(
      (s.settlements || []).filter((value) => value.materialized).map((value) => value.id),
    );
    entry = {
      mask,
      revision: s.networkRevision,
      settlements: s.settlements,
      footprints: SETTLEMENT_COMPONENTS.filter(
        (component) => mask & (1 << component.index) && !claimed.has(component.settlementId),
      ),
    };
    footprintCache.set(s, entry);
  }
  return entry.footprints;
}
