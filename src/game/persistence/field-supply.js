import { FIELD, GROUND_UNITS } from '../config.js';
import { validSide } from '../factions.js';
import { FIELD_SUPPLY as C } from '../city/field-ammo.js';
import { AMMUNITION } from '../units/ground/ammunition.js';
import { ammunitionProfile } from '../units/ground/ammunition.js';
export const SAVE_CRATE_MAX = 2000;
const point = (p) =>
  p &&
  typeof p === 'object' &&
  !Array.isArray(p) &&
  Number.isFinite(p.x) &&
  Number.isFinite(p.z) &&
  Math.abs(p.x) <= FIELD.x &&
  Math.abs(p.z) <= FIELD.z;
export function restoreFieldSupply(s, sourceVersion = s.version) {
  if (sourceVersion < 19) {
    s.ammoCrates = [];
    s.fieldSupplyAt = 0;
    s.fieldSupplyCursor = 0;
    for (const u of s.groundUnits) delete u.supplyTrip;
  }
  if (
    !Array.isArray(s.ammoCrates) ||
    s.ammoCrates.length > SAVE_CRATE_MAX ||
    !Number.isFinite(s.fieldSupplyAt) ||
    s.fieldSupplyAt < 0 ||
    s.fieldSupplyAt > s.time + C.cadence + 1e-8
  )
    throw Error('Повреждены полевые боеприпасы');
  if (
    !Number.isSafeInteger(s.fieldSupplyCursor) ||
    s.fieldSupplyCursor < 0 ||
    s.fieldSupplyCursor > 20000
  )
    throw Error('Повреждена очередь полевого снабжения');
  const ids = new Set(
    [
      ...s.buildings,
      ...s.groundUnits,
      ...s.units,
      ...s.roads,
      ...s.ammoVehicles,
      ...s.serviceVehicles,
      ...s.trenches,
      ...(s.ships || []),
    ].map((v) => v.id),
  );
  for (const c of s.ammoCrates) {
    if (
      !c ||
      !Number.isSafeInteger(c.id) ||
      c.id < 1 ||
      c.id >= s.nextId ||
      ids.has(c.id) ||
      !validSide(s, c.side) ||
      !point(c) ||
      c.key !== 'ammo-crate' ||
      !Number.isFinite(c.hp) ||
      c.hp < 0 ||
      c.hp > C.hp ||
      c.maxHp !== C.hp ||
      !c.stock ||
      Array.isArray(c.stock) ||
      Object.keys(c.stock).length !== 4 ||
      AMMUNITION.kinds.some(
        (key) =>
          !Number.isSafeInteger(c.stock[key]) || c.stock[key] < 0 || c.stock[key] > C.capacity[key],
      ) ||
      (c.hp === 0 && Object.values(c.stock).some((n) => n !== 0))
    )
      throw Error('Поврежден полевой ящик');
    ids.add(c.id);
  }
  for (const u of s.groundUnits) {
    const t = u.supplyTrip;
    if (t == null) continue;
    if (
      !t ||
      Array.isArray(t) ||
      !ammunitionProfile(u) ||
      GROUND_UNITS[u.key]?.support ||
      !GROUND_UNITS[u.key]?.speed ||
      !Number.isSafeInteger(t.crateId) ||
      t.crateId < 1 ||
      t.crateId >= s.nextId ||
      !['outbound', 'returning'].includes(t.phase) ||
      !point(t.home) ||
      u.order?.supplyId !== t.crateId ||
      !['resupply', 'resupplyReturn'].includes(u.order.mode) ||
      (!u.autoDefense &&
        u.defenseAttack?.phase !== 'active' &&
        !(
          point(u.guard) &&
          ['guard', 'guardReturn', 'guardIntercept', 'wait', 'resupply', 'resupplyReturn'].includes(
            u.order?.mode,
          )
        ) &&
        !u.routeQueue?.some((p) => p.mode === 'attackmove')) ||
      !s.ammoCrates.some((c) => c.id === t.crateId && c.side === u.side)
    )
      throw Error('Поврежден маршрут пополнения');
  }
}
