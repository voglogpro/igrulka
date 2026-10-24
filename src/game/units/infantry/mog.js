import { GROUND_LIMIT } from '../ground/navigation.js';
import { makeGround } from '../ground/recruitment.js';
import { ammunitionProfile, initializeAmmunition } from '../ground/ammunition.js';
export function redeployMOG(s, side, id) {
  const b = s.buildings.find(
    (b) => b.id === id && b.key === 'gun' && b.side === side && b.hp > 0 && b.progress >= 1,
  );
  if (!b) return 'Выберите готовую МОГ';
  if (s.groundUnits.filter((u) => u.side === side).length >= GROUND_LIMIT) return 'Армия заполнена';
  const u = makeGround(s, side, 'mog', b.x, b.z);
  u.hp = (u.maxHp * b.hp) / b.maxHp;
  u.level = b.level || 0;
  u.heat = b.heat || 0;
  initializeAmmunition(b);
  const capacity = ammunitionProfile(u).capacity;
  u.groundAmmo = Math.min(capacity, b.groundAmmo);
  u.ammoReserve = Math.min(capacity, b.ammoReserve + Math.max(0, b.groundAmmo - capacity));
  u.ammo = u.groundAmmo;
  u.groundReload = b.groundReload || 0;
  u.groundCooldown = b.groundCooldown || 0;
  u.cooldown = b.cooldown || 0;
  u.setup = 0;
  s.groundUnits.push(u);
  b.hp = 0;
  b.demolished = true;
  s.networkRevision = (s.networkRevision || 0) + 1;
  return u.id;
}
