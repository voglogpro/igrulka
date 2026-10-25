import { BUILDINGS, GROUND_UNITS, WEAPONS } from '../config.js';

const tables = { building: BUILDINGS, ground: GROUND_UNITS, weapon: WEAPONS };
export const purchaseFactor = (purchased) => Math.min(1.5, 0.5 + purchased * 0.25);

// Existing ruins and demolished plots still count when introducing lifetime pricing.
export function buildingPurchases(s, side, key) {
  return (
    s.sides[side]?.purchases?.building?.[key] ??
    s.buildings.filter((b) => b.side === side && b.key === key).length
  );
}

// Quotes are read-only; failed placement and previews never consume an ordinal.
export function purchaseQuote(s, side, kind, key, count = 1) {
  const table = typeof kind === 'string' && Object.hasOwn(tables, kind) ? tables[kind] : null;
  if (
    !validSide(s, side) ||
    !s.sides[side] ||
    !table ||
    typeof key !== 'string' ||
    !Object.hasOwn(table, key) ||
    !Number.isSafeInteger(count) ||
    count < 1 ||
    count > 1000
  )
    return null;
  const d = table[key];
  const baseCost = {
    cost: d.cost || 0,
    metal: d.metal || 0,
    oil: kind === 'building' || s.rules?.oil === false ? 0 : d.oil || 0,
  };
  const purchased = kind === 'building' ? buildingPurchases(s, side, key) : 0;
  const factorAt = (offset) => (kind === 'building' ? purchaseFactor(purchased + offset) : 1);
  const quote = {
    cost: 0,
    metal: 0,
    oil: 0,
    count,
    factor: factorAt(0),
    lastFactor: factorAt(count - 1),
    nextFactor: factorAt(count),
    baseCost,
  };
  for (let index = 0; index < count; index++)
    for (const resource of ['cost', 'metal', 'oil'])
      quote[resource] += Math.round(baseCost[resource] * factorAt(index));
  return quote;
}

export function recordBuildingPurchase(s, side, key) {
  const purchased = buildingPurchases(s, side, key);
  const ledger = (s.sides[side].purchases ||= {});
  (ledger.building ||= {})[key] = purchased + 1;
}
import { validSide } from '../factions.js';
