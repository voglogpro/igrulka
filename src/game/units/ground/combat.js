import { event as emit } from '../../shared/events.js';
import { isInfantry, GROUND_UNITS } from '../../config.js';
import { coverInfo, lineOfSight } from '../infantry/cover.js';
import { freeSpot } from '../vehicles/transport.js';
import { clamp } from '../../shared/math.js';
export function damageGround(s, u, amount, event = emit, kind = 'bullet') {
  if (u.hp <= 0 || u.carrierId) return;
  const c = isInfantry(u.key) ? coverInfo(s, u) : { cover: 0 };
  u.hp = Math.max(0, u.hp - amount * (1 - c.cover * (kind === 'blast' ? 0.4 : 1)));
  if (!u.hp) {
    s.sides[u.side].losses++;
    event(s, 'groundDestroyed', { x: u.x, y: 2, z: u.z, key: u.key, side: u.side, unitId: u.id });
    for (const passenger of s.groundUnits)
      if (passenger.carrierId === u.id) {
        const p = freeSpot(s, u, GROUND_UNITS[passenger.key].size * 0.42);
        passenger.carrierId = null;
        passenger.boardingId = null;
        passenger.path = [];
        if (p) {
          Object.assign(passenger, p);
          passenger.hp *= 0.4;
          passenger.suppression = 1;
        } else passenger.hp = 0;
      }
  }
}

export function impactGround(s, p, event = emit) {
  const radius = p.kind === 'shell' ? 14 : 4.5;
  for (const u of s.groundUnits)
    if (u.hp > 0 && !u.carrierId && u.side !== p.side) {
      const dist = Math.hypot(u.x - p.tx, u.z - p.tz);
      if (dist < radius + 7 && isInfantry(u.key))
        u.suppression = clamp(
          (u.suppression || 0) + (p.suppression || 0.05) * (1 - coverInfo(s, u).cover * 0.6),
          0,
          1.5,
        );
      if (dist < radius && lineOfSight(s, { x: p.px, z: p.pz, id: p.source }, u)) {
        const armour = !isInfantry(u.key) && p.kind !== 'shell' ? 0.15 : 1;
        damageGround(s, u, p.damage * armour * (1 - dist / (radius * 1.5)), event);
      }
    }
  for (const b of s.buildings)
    if (b.id === p.targetId && b.side !== p.side && b.hp > 0) {
      const amount =
        p.damage * (p.kind === 'shell' ? 1 : GROUND_UNITS[p.shooterKey]?.infantry ? 1.2 : 1);
      b.hp = Math.max(0, b.hp - amount);
      if (!b.hp) {
        s.networkRevision++;
        s.sides[b.side].losses++;
        event(s, 'destroy', { x: b.x, z: b.z, side: b.side, key: b.key, buildingId: b.id });
      }
    }
  event(s, p.kind === 'shell' ? 'impact' : 'hit', {
    x: p.tx,
    y: 2,
    z: p.tz,
    key: p.kind === 'shell' ? 'tank' : 'infantry',
    radius: radius,
    side: p.side,
  });
}
