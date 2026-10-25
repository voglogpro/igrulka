import { hostile } from '../../factions.js';
import { MAP, WEAPONS, weaponStats } from '../../config.js';
import { targetById } from '../../targets.js';
import { COMBAT } from '../../combat/config.js';
import { clamp } from '../../shared/math.js';
import { flightRoute } from './routes.js';
import { random } from '../../shared/random.js';
import { event, log } from '../../shared/events.js';
import { availableLaunchStock, launchSiteAllows } from './launch-supply.js';

export function launchTempo(site) {
  const level = Math.max(0, Math.min(2, site.level || 0));
  return site.key === 'factory'
    ? { count: 1, interval: [20, 15, 10][level] }
    : { count: level === 2 ? 2 : 1, interval: level === 1 ? 5 : 10 };
}
export function resolveAim(s, owner, aim) {
  if (aim && typeof aim === 'object')
    return Number.isFinite(aim.x) &&
      Number.isFinite(aim.z) &&
      Math.abs(aim.x) <= MAP.width / 2 &&
      Math.abs(aim.z) <= MAP.depth / 2 &&
      (!aim.waypoints ||
        (Array.isArray(aim.waypoints) &&
          aim.waypoints.length <= 10 &&
          aim.waypoints.every(
            (p) =>
              Number.isFinite(p.x) &&
              Number.isFinite(p.z) &&
              Math.abs(p.x) <= MAP.width / 2 &&
              Math.abs(p.z) <= MAP.depth / 2,
          )))
      ? {
          x: aim.x,
          z: aim.z,
          key: 'point',
          waypoints: (aim.waypoints || []).map((p) => ({ x: p.x, z: p.z })),
        }
      : null;
  const target = targetById(s, aim);
  return target && hostile(s, target.side, owner) && target.hp > 0 ? target : null;
}

export function launchSites(s, owner, key = null) {
  return s.buildings.filter(
    (b) =>
      b.side === owner &&
      ['factory', 'launcher', 'silo'].includes(b.key) &&
      (key == null || launchSiteAllows(b, key)) &&
      !b.demolished &&
      b.hp > 0 &&
      b.progress >= 1,
  );
}

export function queuedLaunches(s, site) {
  return s.units.filter((u) => u.sourceId === site.id && u.hp > 0 && !u.launched).length;
}

export function selectedLaunchSite(s, owner, siteId = null, key = null) {
  const sites = launchSites(s, owner, key);
  if (siteId != null) return sites.find((b) => b.id === Number(siteId));
  return (
    sites
      .filter((b) => queuedLaunches(s, b) < COMBAT.queueLimit)
      .sort(
        (a, b) =>
          (key == null
            ? 0
            : Number(availableLaunchStock(b, key) > 0) -
              Number(availableLaunchStock(a, key) > 0)) ||
          (a.nextLaunchAt || 0) - (b.nextLaunchAt || 0),
      )[0] || sites[0]
  );
}

export function launchStatus(s, owner, key, aim, siteId = null) {
  if (s.result) return 'Кампания завершена';
  if (!resolveAim(s, owner, aim)) return 'Укажите точку в пределах карты';
  if (s.units.filter((u) => u.side === owner && u.hp > 0).length >= COMBAT.airLimit)
    return 'Лимит: 120 аппаратов в воздухе и очередях на сторону';
  const f = s.sides[owner];
  if (!f || !Object.hasOwn(WEAPONS, key)) return 'Неизвестное вооружение';
  if (!launchSites(s, owner, key).length)
    return ['cruise', 'ballistic'].includes(key)
      ? 'Постройте ракетную пусковую на суше'
      : 'Постройте площадку или базу дронов';
  const origin = selectedLaunchSite(s, owner, siteId, key);
  if (!origin) return 'Выбранная пусковая недоступна';
  if (!availableLaunchStock(origin, key))
    return 'На пусковой нет готового аппарата: ждём физическую доставку со склада';
  if (queuedLaunches(s, origin) >= COMBAT.queueLimit)
    return 'Очередь пусковой заполнена — выберите другую или дождитесь запуска';
  return null;
}

export function launch(s, owner, key, aim, count = 1, siteId = null) {
  const invalid = launchStatus(s, owner, key, aim, siteId);
  if (invalid) return invalid;
  const f = s.sides[owner],
    target = resolveAim(s, owner, aim),
    origin = selectedLaunchSite(s, owner, siteId, key),
    n = Math.min(
      availableLaunchStock(origin, key),
      clamp(Math.floor(count) || 1, 1, 6),
      COMBAT.queueLimit - queuedLaunches(s, origin),
      COMBAT.airLimit - s.units.filter((u) => u.side === owner && u.hp > 0).length,
    ),
    tempo = launchTempo(origin);
  let next = origin.nextLaunchAt ?? s.time;
  let left = Math.min(tempo.count, origin.launchBurstLeft ?? tempo.count);
  // An unused second slot belongs to the same ten-second window, including
  // separate clicks on subsequent simulation ticks. Idle windows do not accumulate.
  if (next < s.time && (left === tempo.count || s.time >= next + tempo.interval)) {
    next = s.time;
    left = tempo.count;
  }
  for (let i = 0; i < n; i++) {
    if (!left) {
      next += tempo.interval;
      left = tempo.count;
    }
    const d = weaponStats(f, key),
      delay = Math.max(0, next - s.time),
      route = flightRoute(origin, target, key);
    s.units.push({
      id: s.nextId++,
      side: owner,
      key,
      sourceId: origin.id,
      localLaunch: true,
      status: 'flying',
      route,
      speed: d.speed,
      damage: d.damage,
      x: origin.x,
      z: origin.z,
      y: 5,
      prevX: origin.x,
      prevY: 5,
      prevZ: origin.z,
      vx: 0,
      vy: 0,
      vz: 0,
      startX: origin.x,
      startZ: origin.z,
      targetId: target.id ?? null,
      targetKind: target.key === 'point' ? 'point' : target.key === 'road' ? 'road' : 'building',
      tx: target.x,
      tz: target.z,
      hp: d.hp,
      maxHp: d.hp,
      travelled: 0,
      total: Math.max(1, route.at(-1).d),
      delay,
      phase: random(s) * 6.28,
    });
    left--;
  }
  origin.launchStore[key] -= n;
  if (!left) {
    next += tempo.interval;
    left = tempo.count;
  }
  origin.nextLaunchAt = next;
  origin.launchBurstLeft = left;
  origin.launchCooldown = 0;
  event(s, 'salvo', { side: owner, key, count: n, x: origin.x, z: origin.z });
  if (owner === 0)
    log(
      s,
      `${WEAPONS[key].name} ×${n} · площадка #${origin.id} → ${Math.round(target.x)}, ${Math.round(target.z)}`,
    );
  return n;
}
