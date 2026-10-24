import { event as emit } from '../../shared/events.js';
import { isInfantry, GROUND_UNITS, BUILDINGS } from '../../config.js';
import { coverInfo, groundVisible, lineOfSight } from '../infantry/cover.js';
import { freeSpot } from '../vehicles/transport.js';
import { clamp } from '../../shared/math.js';
import { removeDriveways } from '../../city/road-network.js';
import { gainGroundExperience } from './veterancy.js';
import { damageDistricts } from '../../territory/districts.js';
import { cancelTransportDelivery } from '../vehicles/transport.js';
import { clearGroundRoute } from './route-queue.js';
import { groundDamageMultiplier, groundWeaponProfile } from './engagement.js';
import { recordThreat } from './tactics.js';
import { tryDown } from './rear.js';
export function damageGround(s, u, amount, event = emit, kind = 'bullet', from = null) {
  if (u.hp <= 0 || u.carrierId || !Number.isFinite(amount) || amount <= 0) return;
  const c = isInfantry(u.key) ? coverInfo(s, u, from) : { cover: 0 };
  const cover = kind === 'blast' && c.kind === 'Стена' ? 0 : c.cover;
  // Body armour stops part of small-arms fire, not blast or shell fragments.
  const vest =
    kind === 'bullet' && isInfantry(u.key) && s.sides[u.side]?.tech.includes('bodyArmor')
      ? 0.85
      : 1;
  const hp = Math.max(0, u.hp - amount * vest * (1 - cover * (kind === 'blast' ? 0.4 : 1)));
  // Visibility must be captured while the victim is alive; corpses are removed before snapshots.
  const visibleTo =
    hp === 0 && s.mode === 'multiplayer'
      ? [0, 1].filter((side) => groundVisible(s, side, u))
      : undefined;
  // Soldiers who would die are sometimes only wounded and can be revived by a medic.
  if (hp === 0 && kind !== 'bleed' && tryDown(s, u, kind)) {
    if (from) recordThreat(s, u, from);
    return;
  }
  u.hp = hp;
  if (from) recordThreat(s, u, from);
  if (!u.hp) {
    cancelTransportDelivery(u);
    clearGroundRoute(u);
    s.sides[u.side].losses++;
    event(s, 'groundDestroyed', {
      x: u.x,
      y: 2,
      z: u.z,
      key: u.key,
      side: u.side,
      unitId: u.id,
      yaw: u.yaw || 0,
      crouched: !!(u.digging || u.trenchId || u.camouflaged),
      ...(visibleTo ? { visibleTo } : {}),
    });
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
  const profile =
    GROUND_UNITS[p.shooterKey] || p.shooterKey === 'gun'
      ? groundWeaponProfile(p.shooterKey).id
      : p.kind === 'shell'
        ? 'cannon'
        : 'rifle';
  const artillery = profile === 'artillery' || profile === 'rocket';
  const splash = profile === 'cannon' || artillery;
  const radius =
    profile === 'artillery'
      ? 18
      : profile === 'rocket'
        ? 11
        : splash
          ? 14
          : profile === 'antiArmor'
            ? 3
            : 4.5;
  const from = {
    x: p.originX ?? p.px ?? p.x ?? p.tx,
    z: p.originZ ?? p.pz ?? p.z ?? p.tz,
    id: p.source,
  };
  if (splash) damageDistricts(s, p.tx, p.tz, p.damage, radius);
  let direct = null,
    directDistance = Infinity;
  for (const u of s.groundUnits)
    if (u.hp > 0 && !u.carrierId && u.side !== p.side) {
      const dist = Math.hypot(u.x - p.tx, u.z - p.tz);
      const hitRadius = GROUND_UNITS[u.key].size * 0.55 + 0.8;
      if (dist >= Math.max(radius + 7, hitRadius)) continue;
      // Shells falling from above are blocked only by walls between the burst and the soldier.
      if (!lineOfSight(s, artillery ? { x: p.tx, z: p.tz, id: p.source } : from, u)) continue;
      if (dist < radius + 7 && isInfantry(u.key)) recordThreat(s, u, from);
      if (dist < radius + 7 && isInfantry(u.key))
        u.suppression = clamp(
          (u.suppression || 0) + (p.suppression || 0.05) * (1 - coverInfo(s, u, from).cover * 0.6),
          0,
          1.5,
        );
      if (!splash && dist < hitRadius && dist < directDistance) {
        direct = u;
        directDistance = dist;
      }
      if (splash && dist < radius) {
        const before = u.hp;
        damageGround(
          s,
          u,
          p.damage *
            groundDamageMultiplier(p.shooterKey, u, p.kind) *
            (1 - dist / (radius * (artillery ? 1.15 : 1.5))),
          event,
          'blast',
          from,
        );
        if (before > u.hp) gainGroundExperience(s, p.source, before - u.hp, u.hp <= 0);
      }
    }
  if (direct) {
    const before = direct.hp;
    damageGround(
      s,
      direct,
      p.damage * groundDamageMultiplier(p.shooterKey, direct, p.kind),
      event,
      'bullet',
      from,
    );
    if (before > direct.hp) gainGroundExperience(s, p.source, before - direct.hp, direct.hp <= 0);
  }
  for (const b of s.buildings)
    if (b.id === p.targetId && b.side !== p.side && b.hp > 0) {
      const half = (BUILDINGS[b.key]?.size || 30) * 0.55;
      const distance = Math.hypot(
        Math.max(0, Math.abs(p.tx - b.x) - half),
        Math.max(0, Math.abs(p.tz - b.z) - half),
      );
      if (distance > radius || (!artillery && !lineOfSight(s, from, b))) continue;
      const amount =
        p.damage *
        groundDamageMultiplier(p.shooterKey, b, p.kind) *
        (1 - distance / (radius * 1.5));
      const before = b.hp;
      b.hp = Math.max(0, b.hp - amount);
      if (before > b.hp) gainGroundExperience(s, p.source, (before - b.hp) * 0.25, b.hp <= 0);
      if (!b.hp) {
        removeDriveways(s, b.id);
        s.networkRevision++;
        s.sides[b.side].losses++;
        event(s, 'destroy', { x: b.x, z: b.z, side: b.side, key: b.key, buildingId: b.id });
      }
    }
  event(s, p.kind === 'shell' ? 'impact' : 'hit', {
    x: p.tx,
    y: 2,
    z: p.tz,
    key:
      profile === 'rocket'
        ? 'rocket'
        : artillery
          ? 'artillery'
          : p.kind === 'shell'
            ? 'tank'
            : 'infantry',
    radius: radius,
    side: p.side,
  });
}
