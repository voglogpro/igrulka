import { FIELD, groundHeight } from '../../map.js';
import { flightRoute } from '../aviation/routes.js';
import { event as emit } from '../../shared/events.js';
import { groundVisible, recordFire } from './cover.js';
import { GROUND_UNITS } from '../../config.js';
import { groundArmorClass } from '../ground/engagement.js';
import { random } from '../../shared/random.js';
export function launchFPV(s, side, ids, aim, targetId = null) {
  if (
    !aim ||
    ![aim.x, aim.z].every(Number.isFinite) ||
    Math.abs(aim.x) > FIELD.x ||
    Math.abs(aim.z) > FIELD.z
  )
    return 'Выберите точку карты';
  const u = s.groundUnits.find(
    (u) =>
      ids.includes(u.id) &&
      u.side === side &&
      u.key === 'operator' &&
      u.hp > 0 &&
      !u.carrierId &&
      (u.fpvAmmo ?? 3) > 0 &&
      (u.fpvReady || 0) <= s.time &&
      Math.hypot(u.x - aim.x, u.z - aim.z) <= 320,
  );
  if (!u) return 'Нужен оператор с FPV: радиус 320, пауза 25 с';
  const target =
    targetId == null
      ? null
      : s.groundUnits.find(
          (v) =>
            v.id === targetId &&
            v.side !== side &&
            v.hp > 0 &&
            !v.downed &&
            !v.carrierId &&
            groundVisible(s, side, v),
        );
  if (targetId != null && (!target || Math.hypot(target.x - u.x, target.z - u.z) > 320))
    return 'Цель FPV должна быть видимой и находиться в радиусе';
  if (s.units.filter((v) => v.side === side && v.hp > 0).length >= 120)
    return 'Воздушный лимит достигнут';
  const f = s.sides[side];
  if (f.credits < 12 || f.materials < 1) return 'Для запуска нужно 12 денег и 1 сплав';
  f.credits -= 12;
  f.materials -= 1;
  u.fpvAmmo = (u.fpvAmmo ?? 3) - 1;
  u.fpvReady = s.time + 25;
  u.lastFire = s.time;
  const route = flightRoute(u, aim, 'drone'),
    air = {
      id: s.nextId++,
      side,
      key: 'drone',
      subtype: 'fpv',
      sourceId: u.id,
      status: 'flying',
      launched: true,
      x: u.x,
      y: groundHeight(u.x, u.z) + 4,
      z: u.z,
      startX: u.x,
      startZ: u.z,
      tx: aim.x,
      tz: aim.z,
      hp: 9,
      maxHp: 9,
      speed: 50,
      damage: 185,
      blast: 7,
      altitude: 18,
      travelled: 0,
      total: Math.max(1, route.at(-1).d),
      route,
      delay: 0,
      phase: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      ...(target ? { fpvTargetId: target.id, fpvSeekAt: s.time } : {}),
    };
  s.units.push(air);
  recordFire(s, u, random);
  emit(s, 'launch', { side, key: 'drone', x: u.x, y: 4, z: u.z, sourceId: u.id });
  return true;
}

// Autonomous operators use observed armoured contacts, not hidden target coordinates.
// Existing in-flight strikes reserve damage so a team does not spend every drone on one wreck.
export function updateAutomaticFPV(s) {
  for (const u of s.groundUnits) {
    if (
      u.key !== 'operator' ||
      u.hp <= 0 ||
      u.downed ||
      u.carrierId ||
      u.holdFire ||
      u.moving ||
      u.suppression > 0.8 ||
      (u.fpvAmmo ?? 3) <= 0 ||
      (u.fpvReady || 0) > s.time ||
      (u.fpvNextThink || 0) > s.time
    )
      continue;
    u.fpvNextThink = s.time + 0.65;
    let best = null,
      score = -Infinity;
    for (const target of s.groundUnits) {
      if (
        target.side === u.side ||
        target.hp <= 0 ||
        target.downed ||
        target.carrierId ||
        !GROUND_UNITS[target.key] ||
        GROUND_UNITS[target.key].infantry ||
        target.civil
      )
        continue;
      const distance = Math.hypot(target.x - u.x, target.z - u.z);
      if (distance > 320 || !groundVisible(s, u.side, target)) continue;
      const reserved = s.units.reduce(
        (sum, air) =>
          sum +
          (air.hp > 0 && air.side === u.side && air.fpvTargetId === target.id ? air.damage : 0),
        0,
      );
      if (reserved >= target.hp) continue;
      const value =
        (groundArmorClass(target) === 'heavy' ? 400 : 260) - distance * 0.25 - reserved * 0.3;
      if (value > score || (value === score && target.id < best.id)) {
        best = target;
        score = value;
      }
    }
    if (best) launchFPV(s, u.side, [u.id], { x: best.x, z: best.z }, best.id);
  }
}
