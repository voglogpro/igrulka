import {
  availableLaunchStock,
  launchStoreCapacity,
  launchStoreTotal,
  movableWeaponStock,
} from '../units/aviation/launch-supply.js';

const active = (v) => v.hp > 0 && !['returning', 'destroyed'].includes(v.status);
const transit = (s, site, key = null) =>
  (s.ammoVehicles || []).reduce(
    (n, v) =>
      n +
      (active(v) &&
      v.targetId === site.id &&
      v.cargo?.kind === 'weapon' &&
      (key == null || v.cargo.key === key)
        ? v.cargo.amount
        : 0),
    0,
  );

export function requestWeaponDelivery(s, side, siteId, key, amount = 1) {
  const site = s.buildings.find((b) => b.id === siteId && b.side === side);
  if (
    s.result ||
    ![0, 1].includes(side) ||
    !site ||
    site.hp <= 0 ||
    site.demolished ||
    site.progress < 1 ||
    !launchStoreCapacity(site, key) ||
    !Number.isSafeInteger(amount) ||
    amount < 1 ||
    amount > 6
  )
    return 'Недоступная доставка вооружения';
  // A local stock target survives dispatch. Changing weapons replaces the old
  // preference; it never deletes, swaps or teleports paid craft out of a rack.
  site.weaponDemand = { [key]: Math.min(amount, launchStoreCapacity(site)) };
  return true;
}

export function collectionRequest(s, site) {
  const target = Object.entries(site.weaponDemand || {}).find(
    ([key, count]) =>
      launchStoreCapacity(site, key) &&
      count > availableLaunchStock(site, key) + transit(s, site, key),
  );
  if (!target) return null;
  const [wanted, count] = target;
  // Keep the existing weapons usable while the selected type is still being
  // manufactured. The preference survives and becomes actionable on arrival.
  if (movableWeaponStock(s, site.side, wanted) + transit(s, site, wanted) < 1) return null;
  const collecting = (s.ammoVehicles || []).filter(
    (v) => active(v) && v.targetId === site.id && v.pickup,
  );
  const free = launchStoreCapacity(site) - launchStoreTotal(site) - transit(s, site);
  if (
    count - availableLaunchStock(site, wanted) - transit(s, site, wanted) <=
    free + collecting.reduce((n, v) => n + v.pickup.amount, 0)
  )
    return null;
  for (const key of Object.keys(site.launchStore || {})) {
    if (key === wanted) continue;
    const reserved = collecting
      .filter((v) => v.pickup.key === key)
      .reduce((n, v) => n + v.pickup.amount, 0);
    if (availableLaunchStock(site, key) > reserved) return { key, amount: 1 };
  }
  return null;
}

export function collectWeapon(s, van, site) {
  const pickup = van.pickup;
  if (!pickup) return;
  // A changed preference or a fulfilled request can make the trip unnecessary.
  const free = launchStoreCapacity(site) - launchStoreTotal(site) - transit(s, site);
  const stillNeeded = Object.entries(site.weaponDemand || {}).some(
    ([key, count]) =>
      key !== pickup.key &&
      movableWeaponStock(s, site.side, key) + transit(s, site, key) > 0 &&
      count - availableLaunchStock(site, key) - transit(s, site, key) > free,
  );
  const amount = stillNeeded ? Math.min(pickup.amount, availableLaunchStock(site, pickup.key)) : 0;
  if (amount > 0) {
    site.launchStore[pickup.key] -= amount;
    van.cargo = { kind: 'weapon', key: pickup.key, amount };
  }
  van.pickup = null;
}

export function deliverySpace(s, site, key) {
  const free = Math.max(0, launchStoreCapacity(site) - launchStoreTotal(site));
  const reserved = Object.entries(site.weaponDemand || {}).reduce(
    (n, [wanted, count]) =>
      n + (wanted !== key ? Math.max(0, count - availableLaunchStock(site, wanted)) : 0),
    0,
  );
  return Math.max(0, free - reserved);
}
