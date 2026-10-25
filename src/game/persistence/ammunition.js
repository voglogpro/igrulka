import { FIELD } from '../config.js';
import {
  AMMUNITION as C,
  createAmmoStock,
  ammunitionProfile,
  initializeAmmunition,
} from '../units/ground/ammunition.js';
import { launchStoreCapacity } from '../units/aviation/launch-supply.js';

const record = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const whole = (v, max) => Number.isSafeInteger(v) && v >= 0 && v <= max;
const point = (p) =>
  record(p) &&
  Number.isFinite(p.x) &&
  Number.isFinite(p.z) &&
  Math.abs(p.x) <= FIELD.x &&
  Math.abs(p.z) <= FIELD.z;
const stock = (v, capacities) =>
  record(v) &&
  Object.keys(v).length === C.kinds.length &&
  Object.entries(v).every(
    ([key, value]) => Object.hasOwn(capacities, key) && whole(value, capacities[key]),
  );
export function restoreAmmunition(s, sourceVersion = s.version) {
  if (sourceVersion < 15) {
    for (const f of s.sides) f.ammoStock = createAmmoStock();
    s.ammoVehicles = [];
    s.ammoLogisticsAt = 0;
  }
  for (const f of s.sides) {
    if (!stock(f.ammoStock, C.stock)) throw Error('Повреждён склад боеприпасов');
    f.ammoProductionSpent ??= 0;
    if (!Number.isFinite(f.ammoProductionSpent) || f.ammoProductionSpent < 0)
      throw Error('Повреждена статистика производства боеприпасов');
  }
  for (const u of [...s.buildings, ...s.groundUnits]) {
    const profile = ammunitionProfile(u);
    if (sourceVersion < 15 && profile) {
      delete u.ammoReserve;
      initializeAmmunition(u);
    }
    if (profile ? !whole(u.ammoReserve, profile.capacity) : u.ammoReserve != null)
      throw Error('Повреждён местный боезапас');
    if (u.ammoCargo != null && (u.key !== 'supplytruck' || !stock(u.ammoCargo, C.cargo)))
      throw Error('Повреждён груз снабжения');
    if (u.key === 'supplytruck') u.ammoCargo ||= createAmmoStock();
    if (
      u.supportManual != null &&
      (!['supplytruck', 'medic'].includes(u.key) || typeof u.supportManual !== 'boolean')
    )
      throw Error('Повреждён приказ поддержки');
    if (['supplytruck', 'medic'].includes(u.key)) u.supportManual ??= false;
    if (
      u.ammoSupplyBlocked != null &&
      ((!profile && !launchStoreCapacity(u) && u.key !== 'operator') ||
        typeof u.ammoSupplyBlocked !== 'boolean')
    )
      throw Error('Повреждена доставка');
    if (
      u.weaponDemand != null &&
      (!launchStoreCapacity(u) ||
        !record(u.weaponDemand) ||
        Object.entries(u.weaponDemand).some(
          ([key, amount]) => !launchStoreCapacity(u, key) || !whole(amount, launchStoreCapacity(u)),
        ))
    )
      throw Error('Повреждён заказ доставки');
    if (sourceVersion < 16 && u.weaponDemand) {
      for (const [key, count] of Object.entries(u.weaponDemand)) {
        const inbound = (s.ammoVehicles || []).reduce(
          (n, van) =>
            n +
            (van.targetId === u.id &&
            van.cargo?.kind === 'weapon' &&
            van.cargo.key === key &&
            van.hp > 0 &&
            van.status !== 'returning'
              ? van.cargo.amount
              : 0),
          0,
        );
        u.weaponDemand[key] = Math.min(
          launchStoreCapacity(u),
          count + (u.launchStore?.[key] || 0) + inbound,
        );
      }
      // Older commands appended types. The last outstanding selection becomes
      // the single active preference; all physical racks and cargo stay intact.
      const last = Object.entries(u.weaponDemand)
        .filter(([, count]) => count > 0)
        .at(-1);
      u.weaponDemand = last ? Object.fromEntries([last]) : {};
    }
    if (Object.keys(u.weaponDemand || {}).length > 1)
      throw Error('Несколько активных типов доставки');
    if (u.ammoEnabled != null && (u.key !== 'ammofactory' || typeof u.ammoEnabled !== 'boolean'))
      throw Error('Повреждён завод боеприпасов');
    if (
      u.ammoNextAt != null &&
      (u.key !== 'ammofactory' ||
        !Number.isFinite(u.ammoNextAt) ||
        u.ammoNextAt < 0 ||
        u.ammoNextAt > s.time + 8)
    )
      throw Error('Повреждён выпуск боеприпасов');
    if (
      u.ammoCursor != null &&
      (u.key !== 'ammofactory' || !whole(u.ammoCursor, C.kinds.length - 1))
    )
      throw Error('Повреждён выпуск боеприпасов');
  }
  s.ammoVehicles ||= [];
  s.ammoLogisticsAt ??= 0;
  if (
    !Array.isArray(s.ammoVehicles) ||
    s.ammoVehicles.length > C.fleetLimit * s.sides.length ||
    !Number.isFinite(s.ammoLogisticsAt) ||
    s.ammoLogisticsAt < 0 ||
    s.ammoLogisticsAt > s.time + 1
  )
    throw Error('Повреждён автопарк снабжения');
  const ids = new Set(
    [
      ...s.buildings,
      ...s.groundUnits,
      ...s.units,
      ...s.roads,
      ...(s.serviceVehicles || []),
      ...(s.ships || []),
      ...(s.trenches || []),
    ].map((v) => v.id),
  );
  const slots = new Set();
  for (const v of s.ammoVehicles) {
    const depot = s.buildings.find(
      (b) =>
        b.id === v.depotId &&
        b.side === v.side &&
        ['factory', 'ammofactory'].includes(b.key) &&
        b.progress >= 1,
    );
    const identity = `${v.depotId}:${v.slot}`;
    if (
      !depot ||
      !validSide(s, v.side) ||
      !Number.isSafeInteger(v.id) ||
      v.id < 1 ||
      v.id >= s.nextId ||
      ids.has(v.id) ||
      slots.has(identity) ||
      !whole(v.slot, 3) ||
      !point(v) ||
      !point(v.home) ||
      (v.goal != null && !point(v.goal)) ||
      !Number.isFinite(v.y) ||
      !Number.isFinite(v.yaw) ||
      !Array.isArray(v.path) ||
      v.path.length > 1200 ||
      v.path.some((p) => !point(p)) ||
      !['idle', 'outbound', 'unloading', 'returning', 'blocked', 'destroyed'].includes(v.status) ||
      !Number.isFinite(v.hp) ||
      v.hp < 0 ||
      v.hp > C.vehicle.hp ||
      v.maxHp !== C.vehicle.hp ||
      (v.status === 'destroyed'
        ? v.hp !== 0 ||
          v.cargo != null ||
          v.pickup != null ||
          v.path.length !== 0 ||
          v.targetId != null ||
          v.targetKind != null ||
          v.goal != null ||
          !Number.isFinite(v.replaceAt) ||
          v.replaceAt < 0 ||
          v.replaceAt > s.time + C.vehicle.replacementDelay
        : v.hp <= 0 || v.replaceAt != null) ||
      !Number.isFinite(v.retryAt) ||
      v.retryAt < 0 ||
      v.retryAt > s.time + 2 ||
      (v.unloadAt != null &&
        (!Number.isFinite(v.unloadAt) || v.unloadAt < 0 || v.unloadAt > s.time + 0.4 + 1e-8)) ||
      !Number.isSafeInteger(v.revision) ||
      v.revision < 0 ||
      v.revision > s.networkRevision ||
      (v.targetId == null
        ? v.targetKind != null
        : !Number.isSafeInteger(v.targetId) ||
          v.targetId < 1 ||
          !['ground', 'building'].includes(v.targetKind)) ||
      (v.cargo != null &&
        (!record(v.cargo) ||
          !['ammo', 'weapon'].includes(v.cargo.kind) ||
          !Number.isSafeInteger(v.cargo.amount) ||
          v.cargo.amount < 1 ||
          (v.cargo.kind === 'ammo'
            ? depot.key !== 'ammofactory' ||
              !Object.hasOwn(C.cargo, v.cargo.key) ||
              v.cargo.amount > C.cargo[v.cargo.key]
            : depot.key !== 'factory' ||
              !['drone', 'heavy', 'cruise', 'ballistic'].includes(v.cargo.key) ||
              v.cargo.amount > 1))) ||
      (v.pickup != null &&
        (!record(v.pickup) ||
          depot.key !== 'factory' ||
          v.cargo != null ||
          v.targetKind !== 'building' ||
          v.targetId == null ||
          !['outbound', 'unloading', 'blocked'].includes(v.status) ||
          !['drone', 'heavy', 'cruise', 'ballistic'].includes(v.pickup.key) ||
          v.pickup.amount !== 1))
    )
      throw Error('Повреждена машина снабжения');
    if (s.ammoVehicles.filter((car) => car.side === v.side).length > C.fleetLimit)
      throw Error('Превышен автопарк снабжения');
    const target = (v.targetKind === 'ground' ? s.groundUnits : s.buildings).find(
      (u) => u.id === v.targetId,
    );
    if (target && target.side !== v.side) throw Error('Чужой получатель снабжения');
    if (target && v.pickup && !launchStoreCapacity(target, v.pickup.key))
      throw Error('Несовместимый возврат вооружения');
    if (
      target &&
      v.cargo &&
      (v.cargo.kind === 'ammo'
        ? ammunitionProfile(target)?.kind !== v.cargo.key
        : !(v.targetKind === 'ground' && target.key === 'operator' && v.cargo.key === 'drone') &&
          !(v.targetKind === 'building' && launchStoreCapacity(target, v.cargo.key)))
    )
      throw Error('Несовместимый получатель снабжения');
    ids.add(v.id);
    slots.add(identity);
  }
}
import { validSide } from '../factions.js';
