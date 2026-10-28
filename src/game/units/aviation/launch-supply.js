import { WEAPONS } from '../../config.js';
import {
  weaponStoreStock,
  weaponStoreAllows,
  launchSiteAllows,
  launchStoreCapacity,
  launchStoreTotal,
  initLaunchStore,
  availableLaunchStock,
  acceptLaunchDelivery,
  migrateWeaponWarehouses,
} from './weapon-stores.js';
export {
  LAUNCH_CAPACITY,
  weaponStoreStock,
  weaponStoreAllows,
  launchSiteAllows,
  launchStoreCapacity,
  launchStoreTotal,
  initLaunchStore,
  availableLaunchStock,
  acceptLaunchDelivery,
  factoryWarehouseStatus,
} from './weapon-stores.js';
const weaponKeys = Object.keys(WEAPONS);
export function weaponStock(s, side, key) {
  return (
    (s.sides[side]?.inventory?.[key] || 0) +
    (s.ammoVehicles || []).reduce(
      (total, vehicle) =>
        total +
        (vehicle.side === side &&
        vehicle.hp > 0 &&
        vehicle.status !== 'destroyed' &&
        vehicle.cargo?.kind === 'weapon' &&
        vehicle.cargo.key === key
          ? vehicle.cargo.amount
          : 0),
      0,
    ) +
    s.buildings
      .filter((b) => b.side === side && b.hp > 0 && !b.demolished)
      .reduce((total, b) => total + weaponStoreStock(b, key), 0)
  );
}

// A factory can dispatch its own staged craft as physical cargo. Remote launch
// racks and cargo already in transit are not warehouse pickup sources.
export function movableWeaponStock(s, side, key) {
  return (
    (s.sides[side]?.inventory?.[key] || 0) +
    s.buildings.reduce(
      (total, site) =>
        total +
        (site.side === side &&
        site.key === 'factory' &&
        site.hp > 0 &&
        !site.demolished &&
        site.progress >= 1
          ? weaponStoreStock(site, key)
          : 0),
      0,
    )
  );
}

// Demand is read-only. The physical logistics fleet owns dispatch, in-transit
// deduplication and removal from the global warehouse at pickup.
export function launchSupplyRequests(s, side) {
  const requests = [];
  for (const site of s.buildings) {
    if (
      site.side !== side ||
      site.key === 'factory' ||
      site.hp <= 0 ||
      site.demolished ||
      site.progress < 1
    )
      continue;
    const free = launchStoreCapacity(site) - launchStoreTotal(site);
    if (free <= 0) continue;
    const allowed = weaponKeys.filter(
      (key) => launchSiteAllows(site, key) && movableWeaponStock(s, side, key) >= 1,
    );
    const requested = Object.entries(site.weaponDemand || {}).find(
      ([key, count]) => count > availableLaunchStock(site, key),
    );
    if (requested) {
      const [key] = requested;
      if (allowed.includes(key)) requests.push({ siteId: site.id, key, amount: 1 });
      continue;
    }
    // Balance stocked types instead of filling every slot with the first weapon.
    allowed.sort((a, b) => availableLaunchStock(site, a) - availableLaunchStock(site, b));
    if (allowed.length) requests.push({ siteId: site.id, key: allowed[0], amount: 1 });
  }
  return requests;
}

export function updateLaunchSupply(s) {
  if (s.result) return;
  for (const site of s.buildings) if (launchStoreCapacity(site)) initLaunchStore(site);
}

export function restoreLaunchSupply(s, sourceVersion = s.version) {
  migrateWeaponWarehouses(s, sourceVersion);
  for (const site of s.buildings) {
    const capacity = launchStoreCapacity(site);
    if (!capacity) {
      if (site.launchStore != null) throw Error('Недопустимый склад пусковой');
      continue;
    }
    if (
      site.launchStore != null &&
      (typeof site.launchStore !== 'object' || Array.isArray(site.launchStore))
    )
      throw Error('Повреждён склад пусковой');
    const store = initLaunchStore(site);
    if (
      typeof store !== 'object' ||
      Array.isArray(store) ||
      Object.entries(store).some(
        ([key, value]) =>
          !weaponKeys.includes(key) ||
          !Number.isSafeInteger(value) ||
          value < 0 ||
          (!weaponStoreAllows(site, key) && value !== 0),
      ) ||
      Object.values(store).reduce((a, b) => a + b, 0) > capacity ||
      (site.nextLaunchAt != null &&
        (!Number.isFinite(site.nextLaunchAt) || site.nextLaunchAt < 0)) ||
      (site.launchBurstLeft != null &&
        (!Number.isInteger(site.launchBurstLeft) ||
          site.launchBurstLeft < 0 ||
          site.launchBurstLeft > 2))
    )
      throw Error('Повреждён склад пусковой');
    for (const key of weaponKeys) store[key] ??= 0;
    // Old orders already removed their weapons from inventory and remain untouched.
    // Only move genuinely existing warehouse stock into new local racks.
    if (sourceVersion < 15 && site.hp > 0 && !site.demolished)
      for (const key of weaponKeys) {
        const amount = Math.min(
          Math.floor(s.sides[site.side].inventory[key] || 0),
          capacity - launchStoreTotal(site),
        );
        const accepted = acceptLaunchDelivery(site, key, amount);
        s.sides[site.side].inventory[key] -= accepted;
      }
  }
}
