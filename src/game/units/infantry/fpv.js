import { FIELD } from '../../map.js';
import { flightRoute } from '../aviation/routes.js';
import { event as emit } from '../../shared/events.js';
export function launchFPV(s, side, ids, aim) {
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
      y: 4,
      z: u.z,
      startX: u.x,
      startZ: u.z,
      tx: aim.x,
      tz: aim.z,
      hp: 9,
      maxHp: 9,
      speed: 50,
      damage: 65,
      blast: 10,
      altitude: 18,
      travelled: 0,
      total: Math.max(1, route.at(-1).d),
      route,
      delay: 0,
      phase: 0,
      vx: 0,
      vy: 0,
      vz: 0,
    };
  s.units.push(air);
  emit(s, 'launch', { side, key: 'drone', x: u.x, y: 4, z: u.z, sourceId: u.id });
  return true;
}
