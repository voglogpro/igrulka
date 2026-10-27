import { allied } from '../factions.js';
import { DISTRICTS } from '../territory/districts.config.js';
import { walkable } from '../units/ground/navigation.js';

// A rendezvous, never a source of free ammunition. The normal paid vehicle
// and finite field-crate systems perform every withdrawal and delivery.
export function depotSupplyPoint(s, u, serviceRadius = 36) {
  if (!u.autoDefense || !u.defensePost || u.defenseMission) return null;
  const d = DISTRICTS.find((v) => v.id === `${u.defensePost.corridorId}-depot`),
    site = d && s.districts.find((v) => v.id === d.id);
  if (
    !d ||
    !site ||
    !allied(s, site.owner, u.side) ||
    site.contested ||
    site.blocked ||
    Math.hypot(u.x - d.x, u.z - d.z) > 150
  )
    return null;
  const point = { x: d.x, z: d.z };
  if (u.key === 'mog' && Math.hypot(u.x - point.x, u.z - point.z) > serviceRadius - 4) return null;
  const known = s.frontlineMemory?.[u.side]?.seen || [];
  if (known.some((v) => s.time - v.time < 6 && Math.hypot(v.x - point.x, v.z - point.z) < 75))
    return null;
  return walkable(s, point.x, point.z, 3) ? point : null;
}
