import { ammunitionProfile, ammunitionStatus } from './ammunition.js';
import { orderGround } from './orders.js';

const failures = new WeakMap();
export function unavailableAssaultCrate(s, u, crate) {
  const failure = failures.get(u)?.get(crate.id);
  return failure?.revision === s.networkRevision && failure.until > s.time;
}
export function rejectAssaultCrate(s, u, crate) {
  let rejected = failures.get(u);
  if (!rejected) failures.set(u, (rejected = new Map()));
  for (const [id, failure] of rejected)
    if (failure.until <= s.time || failure.revision !== s.networkRevision) rejected.delete(id);
  rejected.delete(crate.id);
  if (rejected.size >= 64) rejected.delete(rejected.keys().next().value);
  rejected.set(crate.id, { revision: s.networkRevision, until: s.time + 30 });
}

// Air magazines cannot make an exhausted ground weapon ready for a city assault.
export function assaultAmmunition(s, u) {
  const p = ammunitionProfile(u);
  if (!p) return { low: false, ready: true };
  const a = ammunitionStatus(s, u);
  const capacity = p.dual ? p.groundCapacity : p.capacity;
  const loaded = p.dual ? a.groundLoaded : a.loaded;
  const total = loaded + a.reserve;
  return { low: total < capacity, ready: total >= capacity, capacity, total };
}

// Keep the existing operation and its home; manual orders still cancel both.
// With no physical box yet, the home is a stable paid-delivery rendezvous.
export function holdAssaultForSupply(s, u) {
  if (!assaultAmmunition(s, u).low) return false;
  if (u.supplyTrip) return true;
  const p = ammunitionProfile(u);
  if (
    (s.ammoCrates || []).some(
      (c) =>
        c.side === u.side && c.hp > 0 && c.stock[p.kind] > 0 && !unavailableAssaultCrate(s, u, c),
    )
  )
    return true;
  const op = u.defenseAttack;
  const behindHome = u.side % 2 ? u.x >= op.home.x : u.x <= op.home.x;
  if (behindHome || Math.hypot(u.x - op.home.x, u.z - op.home.z) <= 12) {
    u.path = [];
    u.routeQueue = [];
    u.routeState = null;
    u.order = { x: u.x, z: u.z, mode: 'wait' };
  } else if (u.order?.mode !== 'move' || !u.routeState) {
    if (
      typeof orderGround(s, u.side, [u.id], { ...op.home, mode: 'move' }, { defer: true }) ===
      'number'
    )
      u.defenseAttack = op;
  }
  return true;
}
