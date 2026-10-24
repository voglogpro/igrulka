import { BUILDINGS, GROUND_UNITS } from '../../config.js';
import { groundWeaponProfile } from './engagement.js';

export const AMMUNITION = {
  kinds: ['small', 'shell', 'rocket', 'sam'],
  stock: { small: 1200, shell: 120, rocket: 120, sam: 40 },
  cargo: { small: 120, shell: 12, rocket: 12, sam: 4 },
  batches: { small: 60, shell: 6, rocket: 6, sam: 2 },
  costs: { small: [12, 1, 0], shell: [24, 3, 0], rocket: [36, 4, 1], sam: [32, 4, 1] },
  interval: 1,
  reserveCredits: 250,
  fleetLimit: 8,
  speed: 32,
  vehicle: { hp: 140, radius: 5, replacementCost: 100, replacementMetal: 8, replacementDelay: 20 },
  reach: 30,
};
export const createAmmoStock = () => Object.fromEntries(AMMUNITION.kinds.map((key) => [key, 0]));
export function ammunitionProfile(entity) {
  const d = GROUND_UNITS[entity?.key] || BUILDINGS[entity?.key];
  if (!d || (!d.range && !d.groundRange)) return null;
  const shared = !!d.infantry || entity.key === 'gun';
  const field = shared || !d.range ? 'groundAmmo' : 'ammo';
  const capacity = field === 'groundAmmo' ? (d.groundMagazine ?? d.magazine ?? 30) : d.magazine;
  const groundCapacity = d.groundRange
    ? (d.groundMagazine ?? (shared ? d.magazine : null) ?? 30)
    : 0;
  const dual = !shared && d.range > 0 && groundCapacity > 0;
  const weapon = groundWeaponProfile(entity.key).id;
  const kind =
    entity.key === 'sam'
      ? 'sam'
      : ['antiArmor', 'rocket'].includes(weapon)
        ? 'rocket'
        : ['antiTankRifle', 'cannon', 'artillery'].includes(weapon)
          ? 'shell'
          : 'small';
  return { kind, capacity, groundCapacity, dual, field, shared };
}
export function initializeAmmunition(entity) {
  const p = ammunitionProfile(entity);
  if (!p) return;
  entity[p.field] ??= p.capacity;
  if (p.dual) entity.groundAmmo ??= p.groundCapacity;
  entity.ammoReserve ??= Math.max(0, p.capacity - (p.dual ? p.groundCapacity : 0));
}
export function reloadFromReserve(entity, domain = 'primary') {
  initializeAmmunition(entity);
  const p = ammunitionProfile(entity);
  if (!p) return 0;
  const capacity = domain === 'ground' ? p.groundCapacity : p.capacity;
  const amount = Math.min(capacity, entity.ammoReserve);
  entity.ammoReserve -= amount;
  return amount;
}
export function receiveAmmunition(entity, kind, amount) {
  const p = ammunitionProfile(entity);
  if (!p || p.kind !== kind || !Number.isSafeInteger(amount) || amount <= 0) return 0;
  initializeAmmunition(entity);
  const accepted = Math.min(amount, p.capacity - entity.ammoReserve);
  entity.ammoReserve += accepted;
  return accepted;
}
export function ammunitionStatus(s, entity) {
  const p = ammunitionProfile(entity);
  if (!p)
    return {
      kind: null,
      loaded: 0,
      reserve: 0,
      capacity: 0,
      total: 0,
      maxTotal: 0,
      status: 'none',
      reason: 'Без оружия',
      cargo: entity?.ammoCargo ? { ...entity.ammoCargo } : null,
    };
  const loaded = entity[p.field] ?? p.capacity,
    reserve = entity.ammoReserve ?? Math.max(0, p.capacity - (p.dual ? p.groundCapacity : 0));
  const groundLoaded = p.dual ? (entity.groundAmmo ?? p.groundCapacity) : 0;
  const reloading = (p.field === 'groundAmmo' ? entity.groundReload : entity.reloadLeft) > 0;
  const status = reloading ? 'reloading' : loaded > 0 ? 'ready' : 'empty';
  return {
    kind: p.kind,
    loaded,
    reserve,
    capacity: p.capacity,
    groundLoaded,
    groundCapacity: p.groundCapacity,
    total: loaded + groundLoaded + reserve,
    maxTotal: p.capacity * 2 + (p.dual ? p.groundCapacity : 0),
    status,
    ...(entity.key === 'operator' ? { fpvAmmo: entity.fpvAmmo ?? 3, fpvCapacity: 3 } : {}),
    reason:
      status === 'empty'
        ? 'Нужен подвоз боеприпасов'
        : status === 'reloading'
          ? 'Перезарядка'
          : 'Готов к огню',
  };
}
