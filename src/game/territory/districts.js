import { isInfantry, GROUND_UNITS } from '../units/ground/types.js';
import { guardGround } from '../units/ground/guard.js';
import { event } from '../shared/events.js';
import { DISTRICT_BY_ID, DISTRICT_RULES as R } from './districts.config.js';
import { districtState } from './state.js';

export { DISTRICTS, DISTRICT_TYPES, DISTRICT_BY_ID, DISTRICT_RULES } from './districts.config.js';
export { createDistricts } from './state.js';
const direction = (side) => (side === 0 ? 1 : -1);
const definition = (id) =>
  typeof id === 'string' && Object.hasOwn(DISTRICT_BY_ID, id) ? DISTRICT_BY_ID[id] : null;

export function districtStatus(s, id) {
  const d = definition(id),
    value = s.districts?.find((site) => site.id === id);
  if (!d || !value) return null;
  const factor =
    value.owner != null && !value.blocked && value.hp > 0 ? 0.35 + (0.65 * value.hp) / d.hp : 0;
  return { ...d, ...districtState(value), maxHp: d.hp, factor };
}

export function districtIncome(s, side) {
  const income = { income: 0, materials: 0, science: 0, owned: 0, active: 0 };
  for (const value of s.districts || []) {
    if (value.owner !== side) continue;
    const d = districtStatus(s, value.id);
    if (!d) continue;
    income.owned++;
    if (d.factor > 0) income.active++;
    for (const key of ['income', 'materials', 'science']) income[key] += d[key] * d.factor;
  }
  return income;
}

export function captureDistrict(s, side, ids, id) {
  if (s.result) return 'Кампания завершена';
  const d = districtStatus(s, id);
  if (!d || ![0, 1].includes(side)) return 'Район не найден';
  const units = s.groundUnits.filter(
    (u) => u.side === side && u.hp > 0 && !u.carrierId && ids.includes(u.id),
  );
  if (!units.length) return 'Выберите доступные войска';
  if (d.owner !== side && !units.some((u) => isInfantry(u.key)))
    return 'Для захвата района нужна пехота вне транспорта';
  return guardGround(
    s,
    side,
    units.map((u) => u.id),
    d,
  );
}

export function setDistrictRepair(s, side, id, enabled) {
  if (s.result) return 'Кампания завершена';
  const value = s.districts?.find((site) => site.id === id),
    d = definition(id);
  if (!d || !value || value.owner !== side) return 'Сначала захватите район';
  if (typeof enabled !== 'boolean') return 'Некорректный приказ ремонта';
  if (enabled && value.hp >= d.hp) return 'Инфраструктура исправна';
  value.repairing = enabled;
  return true;
}

function repairDistrict(s, value, d, dt) {
  if (!value.repairing || value.owner == null || value.blocked || value.hp >= d.hp) return;
  const f = s.sides[value.owner];
  const amount = Math.max(
    0,
    Math.min(
      d.hp - value.hp,
      R.repairPerSecond * dt,
      f.credits / R.repairCreditsPerHp,
      f.materials / R.repairMaterialsPerHp,
    ),
  );
  f.credits = Math.max(0, f.credits - amount * R.repairCreditsPerHp);
  f.materials = Math.max(0, f.materials - amount * R.repairMaterialsPerHp);
  value.hp = Math.min(d.hp, value.hp + amount);
  if (d.hp - value.hp < 1e-6) {
    value.hp = d.hp;
    value.repairing = false;
  }
}

export function updateDistricts(s, dt) {
  if (s.result || !Number.isFinite(dt) || dt <= 0) return;
  for (const value of s.districts || []) {
    const d = definition(value.id);
    if (!d) continue;
    const present = [0, 0],
      foot = [0, 0];
    for (const u of s.groundUnits) {
      if (u.hp <= 0 || u.carrierId || u.progress < 1 || Math.hypot(u.x - d.x, u.z - d.z) > d.radius)
        continue;
      present[u.side]++;
      if (
        isInfantry(u.key) &&
        !u.downed &&
        !GROUND_UNITS[u.key].support &&
        (u.suppression || 0) < R.suppressionLimit &&
        u.order?.mode !== 'retreat'
      )
        foot[u.side]++;
    }
    value.contested = present[0] > 0 && present[1] > 0;
    value.blocked = value.owner != null && present[1 - value.owner] > 0;
    const side = !value.contested ? (foot[0] ? 0 : foot[1] ? 1 : null) : null;
    value.capturing = side != null && side !== value.owner ? side : null;
    if (side != null) {
      const sign = direction(side);
      const strength = 1 + (Math.min(R.maxCaptureStrength, foot[side]) - 1) * R.extraCaptureSpeed;
      const seconds =
        value.owner != null && value.owner !== side ? R.neutralizeSeconds : R.captureSeconds;
      const control = Math.max(-1, Math.min(1, value.control + (sign * dt * strength) / seconds));
      if (value.owner != null && value.owner !== side && control * direction(value.owner) <= 0) {
        const lost = value.owner;
        value.owner = null;
        value.control = 0;
        value.blocked = false;
        value.repairing = false;
        event(s, 'districtLost', { side: lost, districtId: d.id, x: d.x, z: d.z });
      } else {
        value.control = control;
        if (value.owner == null && control * sign >= 1 - 1e-8) {
          value.owner = side;
          value.control = sign;
          value.capturing = null;
          s.stats.districtsCaptured = (s.stats.districtsCaptured || 0) + 1;
          event(s, 'districtCaptured', { side, districtId: d.id, x: d.x, z: d.z });
        }
      }
    } else if (!present[0] && !present[1]) {
      const target = value.owner == null ? 0 : direction(value.owner);
      value.control +=
        Math.sign(target - value.control) *
        Math.min(Math.abs(target - value.control), dt * R.decayPerSecond);
    }
    repairDistrict(s, value, d, dt);
  }
}

export function damageDistricts(s, x, z, damage, radius) {
  if (![x, z, damage, radius].every(Number.isFinite) || damage <= 0 || radius <= 0) return;
  for (const value of s.districts || []) {
    if (value.hp <= 0) continue;
    const d = definition(value.id);
    const distance = d && Math.max(0, Math.hypot(x - d.x, z - d.z) - 8);
    if (!d || distance >= radius) continue;
    value.hp = Math.max(0, value.hp - damage * (1 - distance / radius));
    if (value.hp === 0) {
      value.repairing = false;
      s.stats.districtsDestroyed = (s.stats.districtsDestroyed || 0) + 1;
      event(s, 'districtDestroyed', { side: value.owner, districtId: d.id, x: d.x, z: d.z });
    }
  }
}
