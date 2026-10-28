import {
  launchSiteAllows,
  availableLaunchStock,
  launchStoreCapacity,
  movableWeaponStock,
} from '../units/aviation/launch-supply.js';
import { AMMUNITION } from '../units/ground/ammunition.js';

// A projection of physical state only: inspecting a rack never dispatches a van.
export function weaponDeliveryStatus(s, site, key) {
  const capacity = launchSiteAllows(site, key) ? launchStoreCapacity(site) : 0;
  const stock = capacity ? availableLaunchStock(site, key) : 0;
  const desired = capacity ? Math.min(capacity, site.weaponDemand?.[key] || 1) : 0;
  const missing = Math.max(0, desired - stock);
  const fleet = (s.ammoVehicles || []).filter((v) => v.side === site?.side && v.hp > 0);
  const incoming = fleet.filter(
    (v) =>
      v.targetId === site?.id &&
      !v.pickup &&
      !['returning', 'destroyed'].includes(v.status) &&
      v.cargo?.kind === 'weapon' &&
      v.cargo.key === key,
  );
  const inTransit = incoming.reduce((n, v) => n + v.cargo.amount, 0);
  const exchanging = fleet
    .filter(
      (v) => v.targetId === site?.id && v.pickup && !['returning', 'destroyed'].includes(v.status),
    )
    .reduce((n, v) => n + v.pickup.amount, 0);
  const queued = s.buildings
    .filter((b) => b.side === site?.side && b.key === 'factory' && b.hp > 0 && !b.demolished)
    .reduce((n, b) => n + (b.queue || []).filter((q) => q.key === key).length, 0);
  const estimates = incoming.flatMap((v) => {
    if (v.status === 'blocked') return [];
    if (v.status === 'unloading') return [Math.max(0, (v.unloadAt || s.time) - s.time)];
    if (!v.path?.length) return [];
    let length = 0,
      previous = v;
    for (const p of v.path) {
      length += Math.hypot(p.x - previous.x, p.z - previous.z);
      previous = p;
    }
    return [length / AMMUNITION.speed + 0.4];
  });
  const ready = stock > 0;
  const valid = capacity && site.hp > 0 && !site.demolished && site.progress >= 1;
  const activeFactories = s.buildings.some(
    (b) =>
      b.side === site?.side &&
      b.key === 'factory' &&
      b.hp > 0 &&
      !b.demolished &&
      b.progress >= 1 &&
      b.ammoEnabled !== false,
  );
  const stage = !valid
    ? 'unavailable'
    : ready
      ? 'ready'
      : inTransit
        ? 'incoming'
        : exchanging
          ? 'exchange'
          : !activeFactories
            ? 'disabled'
            : movableWeaponStock(s, site.side, key)
              ? 'queued'
              : queued
                ? 'production'
                : 'unavailable';
  const blocked = incoming.some((v) => v.status === 'blocked') || site?.ammoSupplyBlocked;
  const reason = !valid
    ? 'Пусковая недоступна'
    : ready
      ? 'Готово к пуску'
      : blocked
        ? 'Нет сухого пути к пусковой'
        : stage === 'incoming'
          ? 'Груз в пути'
          : stage === 'exchange'
            ? 'Освобождаем место'
            : stage === 'disabled'
              ? 'Нет работающего склада'
              : stage === 'queued'
                ? 'Ждём свободную машину'
                : stage === 'production'
                  ? 'Ждём готовое изделие'
                  : 'Нет готового изделия';
  return {
    key,
    stock,
    capacity,
    desired,
    missing,
    inTransit,
    queued,
    exchanging,
    eta: estimates.length && !blocked ? Math.min(...estimates) : null,
    ready,
    stage,
    reason,
  };
}
