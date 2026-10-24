import { WEAPONS, BUILDINGS } from '../../config.js';
import { buildingConnected } from '../../city/road-network.js';

const weaponKeys = Object.keys(WEAPONS);
const drones = ['drone', 'heavy'];
const missiles = ['cruise', 'ballistic'];
export const LAUNCH_CAPACITY = { factory: 2, launcher: 6, silo: 4 };
export function launchSiteAllows(site, key) {
  return (
    Object.hasOwn(LAUNCH_CAPACITY, site?.key) &&
    (site.key === 'silo' ? missiles : drones).includes(key)
  );
}
export function launchStoreCapacity(site, key = null) {
  return key != null && !launchSiteAllows(site, key) ? 0 : LAUNCH_CAPACITY[site?.key] || 0;
}
export function initLaunchStore(site) {
  if (!launchStoreCapacity(site)) return null;
  site.launchStore ||= Object.fromEntries(weaponKeys.map((key) => [key, 0]));
  return site.launchStore;
}
export function availableLaunchStock(site, key) {
  return launchSiteAllows(site, key) ? Math.max(0, Math.floor(site.launchStore?.[key] || 0)) : 0;
}
export function launchStoreTotal(site) {
  return weaponKeys.reduce((total, key) => total + availableLaunchStock(site, key), 0);
}
export function acceptLaunchDelivery(site, key, amount) {
  if (
    !launchSiteAllows(site, key) ||
    site.demolished ||
    (site.hp != null && site.hp <= 0) ||
    (site.progress != null && site.progress < 1) ||
    !Number.isSafeInteger(amount) ||
    amount <= 0
  )
    return 0;
  const accepted = Math.min(
    amount,
    Math.max(0, launchStoreCapacity(site) - launchStoreTotal(site)),
  );
  if (accepted) initLaunchStore(site)[key] = availableLaunchStock(site, key) + accepted;
  return accepted;
}
export function weaponStock(s, side, key) {
  return (
    (s.sides[side]?.inventory?.[key] || 0) +
    (s.ammoVehicles || []).reduce(
      (total, vehicle) =>
        total +
        (vehicle.side === side && vehicle.cargo?.kind === 'weapon' && vehicle.cargo.key === key
          ? vehicle.cargo.amount
          : 0),
      0,
    ) +
    s.buildings
      .filter((b) => b.side === side && b.hp > 0 && !b.demolished)
      .reduce((total, b) => total + availableLaunchStock(b, key), 0)
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
          ? availableLaunchStock(site, key)
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
    // Balance stocked types instead of filling every slot with the first weapon.
    allowed.sort((a, b) => availableLaunchStock(site, a) - availableLaunchStock(site, b));
    if (allowed.length) requests.push({ siteId: site.id, key: allowed[0], amount: 1 });
  }
  return requests;
}

export function updateLaunchSupply(s) {
  if (s.result) return;
  for (const site of s.buildings) {
    if (!launchStoreCapacity(site)) continue;
    initLaunchStore(site);
    if (
      site.key !== 'factory' ||
      site.hp <= 0 ||
      site.demolished ||
      site.progress < 1 ||
      !buildingConnected(s, site, BUILDINGS.factory.size)
    )
      continue;
    while (launchStoreTotal(site) < launchStoreCapacity(site)) {
      const choices = drones.filter((key) => s.sides[site.side].inventory[key] >= 1);
      choices.sort((a, b) => availableLaunchStock(site, a) - availableLaunchStock(site, b));
      if (!choices.length) break;
      const accepted = acceptLaunchDelivery(site, choices[0], 1);
      if (!accepted) break;
      s.sides[site.side].inventory[choices[0]] -= accepted;
    }
  }
}

export function restoreLaunchSupply(s, sourceVersion = s.version) {
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
          (!launchSiteAllows(site, key) && value !== 0),
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
