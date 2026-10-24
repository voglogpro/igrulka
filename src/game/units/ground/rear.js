import { GROUND_UNITS, BUILDINGS, isInfantry } from '../../config.js';
import { event as emit } from '../../shared/events.js';
import { random } from '../../shared/random.js';
import { groundPath } from './navigation.js';
import { loadSupplyTruck, supplyNearbyAmmo } from '../../city/ammo-logistics.js';
import { createAmmoStock, ammunitionProfile, ammunitionStatus } from './ammunition.js';

// Everything in this file happens without orders: soldiers who would die are sometimes only
// wounded, medics find and revive them, supply trucks mend machines and refill magazines, and each
// side trains the rear service it needs. The player only decides who fights and where.
export const DOWNED = {
  chance: 0.5,
  blastChance: 0.3,
  bleedOut: 45,
  hpShare: 0.12,
  reviveHp: 0.35,
};
const MEDIC_RANGE = 10;
const REVIVE_TIME = 4;
const MEDIC_HEAL = 5;
const TRUCK_RANGE = 30;
const TRUCK_REPAIR = 6;
const THINK = 0.9;

export const isSupport = (u) => !!GROUND_UNITS[u.key]?.support;
// Scenarios that test one mechanic in isolation can switch the rear service off with rules.rear.
export const rearEnabled = (s) => s.rules?.rear !== false;

// Called from damageGround when a soldier's health reaches zero. Returns true when the soldier
// goes down instead of dying.
export function tryDown(s, u, kind) {
  if (!rearEnabled(s) || !isInfantry(u.key) || u.downed || isSupport(u) || u.carrierId)
    return false;
  const chance = kind === 'blast' ? DOWNED.blastChance : DOWNED.chance;
  // A side with a medic nearby gives soldiers better odds; without any the chance is halved.
  const medic = s.groundUnits.some(
    (v) =>
      v.side === u.side &&
      v.hp > 0 &&
      v.key === 'medic' &&
      (v.x - u.x) ** 2 + (v.z - u.z) ** 2 < 260 * 260,
  );
  if (random(s) > chance * (medic ? 1 : 0.5)) return false;
  u.hp = Math.max(1, Math.ceil(u.maxHp * DOWNED.hpShare));
  u.downed = { t: 0, revive: 0 };
  u.path = [];
  u.moving = false;
  u.digging = false;
  u.suppression = 0;
  emit(s, 'groundDowned', {
    x: u.x,
    z: u.z,
    key: u.key,
    side: u.side,
    unitId: u.id,
    yaw: u.yaw || 0,
  });
  return true;
}

// A downed soldier does nothing but bleed; no medic arriving means death.
export function tickDowned(s, u, dt) {
  u.moving = false;
  u.downed.t += dt;
  return u.downed.t >= DOWNED.bleedOut;
}

const wounded = new WeakMap();
function woundedBySide(s) {
  let cache = wounded.get(s);
  if (!cache || cache.time !== s.time) {
    cache = { time: s.time, sides: [[], []] };
    for (const v of s.groundUnits)
      if (
        v.hp > 0 &&
        !v.carrierId &&
        isInfantry(v.key) &&
        !isSupport(v) &&
        (v.downed || v.hp < v.maxHp * 0.7)
      )
        cache.sides[v.side].push(v);
    wounded.set(s, cache);
  }
  return cache.sides;
}

function centroid(units) {
  if (!units.length) return null;
  let x = 0,
    z = 0;
  for (const u of units) {
    x += u.x;
    z += u.z;
  }
  return { x: x / units.length, z: z / units.length };
}

function walkTo(s, u, point, stopAt = 3) {
  const d = GROUND_UNITS[u.key];
  if (Math.hypot(u.x - point.x, u.z - point.z) <= stopAt) {
    u.path = [];
    return true;
  }
  const last = u.path?.at(-1);
  if (last && Math.hypot(last.x - point.x, last.z - point.z) < 12) return false;
  const path = groundPath(s, u, point, d.size * 0.42);
  if (path.length) {
    u.path = path;
    u.order = { x: point.x, z: point.z, mode: 'support' };
  }
  return false;
}

function medicTick(s, u, dt) {
  if (u.supportManual && u.path?.length) return;
  const list = woundedBySide(s)[u.side];
  let patient = list.find(
    (v) =>
      v.id === u.patientId && (!u.supportManual || Math.hypot(v.x - u.x, v.z - u.z) <= MEDIC_RANGE),
  );
  if (patient && (patient.hp <= 0 || (!patient.downed && patient.hp >= patient.maxHp * 0.95)))
    patient = null;
  if ((u.supportAt || 0) <= s.time) {
    u.supportAt = s.time + THINK + (u.id % 5) * 0.05;
    if (!patient) {
      let best = Infinity;
      for (const v of list) {
        const score = Math.hypot(v.x - u.x, v.z - u.z) * (v.downed ? 0.55 : 1);
        // Another medic already on the way makes a patient less attractive.
        const taken = s.groundUnits.some(
          (m) => m !== u && m.patientId === v.id && m.hp > 0 && m.key === 'medic',
        );
        if (
          score < best &&
          score < (u.supportManual ? MEDIC_RANGE : 320) &&
          !(taken && !v.downed)
        ) {
          best = score;
          patient = v;
        }
      }
    }
    u.patientId = patient?.id ?? null;
    if (patient && !u.supportManual) walkTo(s, u, patient, MEDIC_RANGE - 3);
    else if (!patient && !u.supportManual && !u.path?.length) {
      const army = centroid(
        s.groundUnits.filter(
          (v) =>
            v.side === u.side && v.hp > 0 && !v.carrierId && isInfantry(v.key) && !isSupport(v),
        ),
      );
      if (army)
        walkTo(s, u, { x: army.x - (u.side === 0 ? 24 : -24), z: army.z + (u.id % 7) * 3 }, 30);
    }
  }
  if (!patient) return;
  if (Math.hypot(patient.x - u.x, patient.z - u.z) > MEDIC_RANGE) return;
  u.path = [];
  u.moving = false;
  u.yaw = Math.atan2(patient.x - u.x, patient.z - u.z);
  u.lastFire = s.time;
  if (patient.downed) {
    patient.downed.revive += dt;
    if (patient.downed.revive >= REVIVE_TIME) {
      patient.downed = null;
      patient.hp = Math.max(patient.hp, patient.maxHp * DOWNED.reviveHp);
      patient.suppression = 0.3;
      emit(s, 'revived', { x: patient.x, z: patient.z, key: patient.key, side: patient.side });
    }
  } else patient.hp = Math.min(patient.maxHp, patient.hp + MEDIC_HEAL * dt);
}

function truckTick(s, u, dt) {
  const f = s.sides[u.side];
  u.ammoCargo ||= createAmmoStock();
  supplyNearbyAmmo(s, u);
  // Mend everything friendly around the truck.
  for (const v of s.groundUnits) {
    if (v.side !== u.side || v.hp <= 0 || v.carrierId || v === u) continue;
    if ((v.x - u.x) ** 2 + (v.z - u.z) ** 2 > TRUCK_RANGE * TRUCK_RANGE) continue;
    if (v.groundReload > 0) v.groundReload = Math.max(1e-6, v.groundReload - dt * 1.5);
    if (v.reloadLeft > 0) v.reloadLeft = Math.max(1e-6, v.reloadLeft - dt * 1.5);
    if (!isInfantry(v.key) && v.hp < v.maxHp && f.credits > 1 && f.materials > 0.1) {
      const amount = Math.min(v.maxHp - v.hp, TRUCK_REPAIR * dt);
      v.hp += amount;
      f.credits -= amount * 0.25;
      f.materials -= amount * 0.02;
    }
  }
  for (const b of s.buildings) {
    if (b.side !== u.side || b.hp <= 0 || b.hp >= b.maxHp || b.progress < 1 || b.demolished)
      continue;
    if (Math.hypot(b.x - u.x, b.z - u.z) > TRUCK_RANGE + (BUILDINGS[b.key]?.size || 20) * 0.5)
      continue;
    if (f.credits > 1 && f.materials > 0.1) {
      const amount = Math.min(b.maxHp - b.hp, 5 * dt);
      b.hp += amount;
      f.credits -= amount * 0.3;
      f.materials -= amount * 0.025;
    }
  }
  if ((u.supportAt || 0) > s.time) return;
  u.supportAt = s.time + THINK * 1.5 + (u.id % 5) * 0.05;
  if (u.supportManual) return;
  if (!Object.values(u.ammoCargo).some((n) => n > 0)) {
    const depot = loadSupplyTruck(s, u);
    if (depot) {
      const point = { x: depot.x, z: depot.z + BUILDINGS.ammofactory.size * 0.7 + 8 };
      walkTo(s, u, point, 10);
      return;
    }
  }
  let goal = null,
    best = Infinity;
  for (const v of s.groundUnits)
    if (
      v.side === u.side &&
      v.hp > 0 &&
      !v.carrierId &&
      !isSupport(v) &&
      ((!isInfantry(v.key) && v.hp < v.maxHp * 0.8) ||
        (ammunitionProfile(v) &&
          ammunitionStatus(s, v).reserve < ammunitionStatus(s, v).capacity &&
          u.ammoCargo[ammunitionProfile(v).kind] > 0))
    ) {
      const d = Math.hypot(v.x - u.x, v.z - u.z);
      if (d < best && d < 380) {
        best = d;
        goal = v;
      }
    }
  for (const b of s.buildings)
    if (
      b.side === u.side &&
      b.hp > 0 &&
      b.progress >= 1 &&
      !b.demolished &&
      (b.hp < b.maxHp * 0.7 ||
        (ammunitionProfile(b) &&
          ammunitionStatus(s, b).reserve < ammunitionStatus(s, b).capacity &&
          u.ammoCargo[ammunitionProfile(b).kind] > 0))
    ) {
      const d = Math.hypot(b.x - u.x, b.z - u.z) + 60;
      if (d < best && d < 380) {
        best = d;
        goal = b;
      }
    }
  if (goal) {
    walkTo(s, u, { x: goal.x, z: goal.z + 14 }, 18);
    return;
  }
  if (u.path?.length) return;
  const army = centroid(
    s.groundUnits.filter(
      (v) => v.side === u.side && v.hp > 0 && !v.carrierId && !isSupport(v) && !v.guard,
    ),
  );
  const base = s.buildings.find((b) => b.side === u.side && b.key === 'hq' && b.hp > 0);
  const rest = army || (base ? { x: base.x, z: base.z + 40 } : null);
  if (rest) walkTo(s, u, { x: rest.x - (u.side === 0 ? 34 : -34), z: rest.z + 22 }, 40);
}

export function updateRear(s, dt) {
  for (const u of s.groundUnits) {
    if (u.hp <= 0 || u.carrierId || u.downed) continue;
    const kind = GROUND_UNITS[u.key]?.support;
    if (kind === 'medic') medicTick(s, u, dt);
    else if (kind === 'supply') truckTick(s, u, dt);
  }
}

// Purchases belong exclusively to the desired composition, including support roles.
export function autoRear() {}

export function setSupportAutomatic(s, side, ids, enabled = true) {
  if (s.result || typeof enabled !== 'boolean') return 'Недоступный режим поддержки';
  let changed = 0;
  for (const u of s.groundUnits)
    if (
      u.side === side &&
      u.hp > 0 &&
      ['medic', 'supplytruck'].includes(u.key) &&
      ids.includes(u.id)
    ) {
      u.supportManual = !enabled;
      u.supportAt = 0;
      if (enabled) {
        u.path = [];
        u.order = null;
        u.guard = null;
      }
      changed++;
    }
  return changed || 'Выберите медика или машину снабжения';
}
