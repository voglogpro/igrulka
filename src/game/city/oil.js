import { BUILDINGS, GROUND_UNITS, WEAPONS } from '../config.js';
import { event } from '../shared/events.js';
import { supplyFactor } from './economy.js';
import { removeDriveways } from './road-network.js';

// Oil is the blood of the war machine: wells pump it, tanks store it, vehicles, drones and
// missiles are assembled with it and engines burn it on the move. Without oil the armour stops.
export const OIL = {
  start: 150,
  // The headquarters keeps a small reserve without any tank farm.
  baseStorage: 200,
  // A destroyed tank burns this long and sets its neighbours on fire.
  fire: 120,
  fireReach: 46,
  fireDamage: 5,
  // Vehicles on empty tanks crawl at this share of their speed.
  dryCrawl: 0.35,
};

const live = (b) => b.hp > 0 && b.progress >= 1 && !b.demolished;

export function oilStorage(s, side) {
  let storage = OIL.baseStorage;
  for (const b of s.buildings)
    if (b.side === side && live(b) && BUILDINGS[b.key]?.storage)
      storage += BUILDINGS[b.key].storage * (0.5 + (0.5 * b.hp) / b.maxHp);
  return storage;
}

// Oil a unit or a weapon needs to be built; infantry needs none.
export const oilCost = (key) => GROUND_UNITS[key]?.oil || WEAPONS[key]?.oil || 0;
// Scenarios that test one mechanic in isolation can switch oil off with rules.oil = false.
export const oilEnabled = (s) => s.rules?.oil !== false;
export const hasOil = (s, side, amount) =>
  !oilEnabled(s) || (s.sides[side].oil ?? 0) >= amount - 1e-9;
export function spendOil(s, side, amount) {
  if (oilEnabled(s)) s.sides[side].oil = Math.max(0, (s.sides[side].oil ?? 0) - amount);
}

// Barrels pumped per second by each side's wells right now.
export function oilProduction(s, side, productivity = 1) {
  let total = 0;
  for (const b of s.buildings) {
    const d = BUILDINGS[b.key];
    if (b.side !== side || !live(b) || !d?.oil) continue;
    total += d.oil * productivity * (0.5 + (0.5 * b.hp) / b.maxHp) * supplyFactor(s, b);
  }
  return total;
}

// Fuel burnt per second by moving machines.
export function oilBurn(s, side) {
  let total = 0;
  for (const u of s.groundUnits || [])
    if (u.side === side && u.hp > 0 && u.moving && !u.carrierId)
      total += GROUND_UNITS[u.key]?.fuel || 0;
  return total;
}

export function updateOil(s, rates, dt) {
  for (let side = 0; side < 2; side++) {
    const f = s.sides[side];
    f.oil ??= OIL.start;
    const produced =
        oilProduction(s, side, rates[side]?.productivity ?? 1) * (rates[side]?.bonus ?? 1),
      burnt = oilBurn(s, side),
      storage = oilStorage(s, side);
    f.oil = Math.max(0, Math.min(storage, f.oil + (produced - burnt) * dt));
    f.oilRate = produced - burnt;
  }
  // Destroyed tanks catch fire once; burning tanks scorch their neighbours.
  for (const b of s.buildings) {
    if (!BUILDINGS[b.key]?.storage) continue;
    if (b.hp <= 0 && b.progress >= 1 && b.fire == null && !b.demolished) {
      b.fire = OIL.fire;
      event(s, 'oilfire', { x: b.x, z: b.z, side: b.side, buildingId: b.id });
    }
    if (!(b.fire > 0)) continue;
    b.fire = Math.max(0, b.fire - dt);
    for (const o of s.buildings) {
      if (o === b || o.hp <= 0 || o.demolished) continue;
      const reach = OIL.fireReach + (BUILDINGS[o.key]?.size || 20) * 0.5;
      if ((o.x - b.x) ** 2 + (o.z - b.z) ** 2 > reach * reach) continue;
      // Other tanks catch the fire far more easily than ordinary buildings.
      o.hp = Math.max(0, o.hp - OIL.fireDamage * (BUILDINGS[o.key]?.storage ? 2.4 : 1) * dt);
      if (o.hp === 0) {
        removeDriveways(s, o.id);
        s.networkRevision++;
        s.sides[o.side].losses++;
        event(s, 'destroy', { x: o.x, z: o.z, side: o.side, key: o.key, buildingId: o.id });
      }
    }
  }
}

// Ground speed factor when a side has run dry.
export const fuelFactor = (s, u) =>
  oilEnabled(s) && GROUND_UNITS[u.key]?.fuel && (s.sides[u.side].oil ?? 1) <= 0 ? OIL.dryCrawl : 1;
