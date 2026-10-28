import { equipmentModifiers } from '../../combat/upgrade-tiers.js';
import { WEAPONS } from '../../config.js';

const keys = Object.keys(WEAPONS);
export const WEAPON_STORE_CAPACITY = { factory: 24, launcher: 6, silo: 4 };
export const LAUNCH_CAPACITY = { launcher: 6, silo: 4 };
export function weaponStoreAllows(site, key) {
  return (
    typeof key === 'string' &&
    Object.hasOwn(WEAPONS, key) &&
    (site?.key === 'factory' ||
      (site?.key === 'launcher' && ['drone', 'heavy'].includes(key)) ||
      (site?.key === 'silo' && ['cruise', 'ballistic'].includes(key)))
  );
}
export function launchSiteAllows(site, key) {
  return Object.hasOwn(LAUNCH_CAPACITY, site?.key) && weaponStoreAllows(site, key);
}
// Retain the existing persisted launchStore field for real warehouses and racks.
export function launchStoreCapacity(site, key = null) {
  if (key != null && !weaponStoreAllows(site, key)) return 0;
  const capacity = Object.hasOwn(WEAPON_STORE_CAPACITY, site?.key)
    ? WEAPON_STORE_CAPACITY[site.key]
    : 0;
  return site?.key === 'factory'
    ? Math.max(
        Math.floor(capacity * equipmentModifiers(site).production),
        site.warehouseCapacity || 0,
      )
    : capacity;
}
export function initLaunchStore(site) {
  if (!launchStoreCapacity(site)) return null;
  return (site.launchStore ||= Object.fromEntries(keys.map((key) => [key, 0])));
}
export function weaponStoreStock(site, key) {
  return weaponStoreAllows(site, key) && !site.demolished && (site.hp == null || site.hp > 0)
    ? Math.max(0, Math.floor(site.launchStore?.[key] || 0))
    : 0;
}
export function availableLaunchStock(site, key) {
  return launchSiteAllows(site, key) ? weaponStoreStock(site, key) : 0;
}
export function launchStoreTotal(site) {
  return keys.reduce((total, key) => total + weaponStoreStock(site, key), 0);
}
export function acceptLaunchDelivery(site, key, amount) {
  if (
    !weaponStoreAllows(site, key) ||
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
  if (accepted) initLaunchStore(site)[key] = weaponStoreStock(site, key) + accepted;
  return accepted;
}
export function factoryWarehouseStatus(s, site) {
  if (!site || site.key !== 'factory' || !s?.sides?.[site.side]) return null;
  const stock = Object.fromEntries(keys.map((key) => [key, weaponStoreStock(site, key)])),
    total = Object.values(stock).reduce((a, b) => a + b, 0),
    capacity = launchStoreCapacity(site),
    ruined = site.hp <= 0 || site.demolished,
    blocked = !ruined && total >= capacity;
  return {
    capacity,
    total,
    stock,
    queued: site.queue?.length || 0,
    blocked,
    reason: ruined
      ? 'Склад уничтожен'
      : site.progress < 1
        ? 'Строится'
        : blocked
          ? 'Склад заполнен'
          : 'Производство и хранение; пуск только с пусковых',
  };
}

export function migrateWeaponWarehouses(s, sourceVersion) {
  for (const site of s.buildings) {
    if (
      site.warehouseCapacity != null &&
      (site.key !== 'factory' ||
        !Number.isSafeInteger(site.warehouseCapacity) ||
        site.warehouseCapacity < 24 ||
        site.warehouseCapacity > Number.MAX_SAFE_INTEGER)
    )
      throw Error('Invalid warehouse capacity');
  }
  if (sourceVersion >= 21) return;
  for (let side = 0; side < s.sides.length; side++) {
    const factory = s.buildings.find(
      (b) => b.side === side && b.key === 'factory' && b.hp > 0 && !b.demolished && b.progress >= 1,
    );
    if (!factory) continue; // A legacy HQ warehouse survives until a factory exists.
    const store = initLaunchStore(factory),
      inventory = s.sides[side].inventory;
    if (
      !store ||
      typeof store !== 'object' ||
      Array.isArray(store) ||
      Object.entries(store).some(
        ([key, count]) => !keys.includes(key) || !Number.isSafeInteger(count) || count < 0,
      )
    )
      throw Error('Invalid legacy weapon warehouse');
    for (const key of keys) {
      const count = (store[key] ?? 0) + (inventory[key] || 0);
      if (!Number.isSafeInteger(count) || count < 0) throw Error('Invalid legacy weapon warehouse');
      store[key] = count;
      inventory[key] = 0;
    }
    const total = launchStoreTotal(factory);
    if (total > WEAPON_STORE_CAPACITY.factory) factory.warehouseCapacity = total;
  }
}
