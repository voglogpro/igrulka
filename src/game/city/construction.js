import { BUILDINGS, MAP, riverDistance } from '../config.js';
import {
  projectPoint,
  nearestRoad,
  ROAD_REACH,
  segmentDistance,
  dirtyNetwork,
} from './road-network.js';
import { ROAD_REQUIRED } from './rules.js';
import { addRoad } from './roads.js';
import { event } from '../shared/events.js';
export function physicalPlacement(s, key, x, z) {
  const d = BUILDINGS[key];
  if (!d || ![x, z].every(Number.isFinite)) return 'Некорректная постройка';
  if (Math.abs(x) > MAP.width / 2 - d.size || Math.abs(z) > MAP.depth / 2 - d.size)
    return 'За границей карты';
  if (riverDistance(x, z) < MAP.riverWidth + d.size * 0.65 + 26) return 'Нужна сухая ровная земля';
  for (const b of s.buildings)
    if (
      !b.demolished &&
      Math.hypot(b.x - x, b.z - z) < (d.size + (BUILDINGS[b.key]?.size || 30)) * 0.6 + 5
    )
      return b.hp <= 0 ? 'Сначала разберите руины' : 'Место занято другой постройкой';
  for (const r of s.roads)
    if (!r.removed && projectPoint(x, z, r).distance < d.size * 0.5 + (r.connectorTo ? 3 : 6))
      return 'Отодвиньте здание от проезжей части';
  return null;
}

export function placementPlan(s, owner, key, x, z) {
  const error = physicalPlacement(s, key, x, z);
  if (error) return { error };
  if (!ROAD_REQUIRED.has(key)) return { x, z };
  const near = nearestRoad(s, owner, x, z, { connected: true });
  if (!near || near.distance > BUILDINGS[key].size * 0.5 + ROAD_REACH)
    return { error: 'Поставьте рядом со своей улицей, связанной со штабом' };
  const d = BUILDINGS[key],
    dx = x - near.x,
    dz = z - near.z,
    length = Math.hypot(dx, dz),
    end = { x: x - (dx / length) * (d.size * 0.5 + 3), z: z - (dz / length) * (d.size * 0.5 + 3) };
  for (const b of s.buildings)
    if (
      b.hp > 0 &&
      segmentDistance(b.x, b.z, near.x, near.z, end.x, end.z) <
        (BUILDINGS[b.key]?.size || 30) * 0.48 + 2
    )
      return { error: 'Подъезд перекрыт постройкой' };
  return {
    x,
    z,
    near,
    end,
    rotation: Math.atan2(near.x - x, near.z - z),
    driveCost: Math.ceil(Math.max(0, length - d.size * 0.5 - 3) * 0.8),
  };
}

export function canPlace(s, key, x, z, owner = 0) {
  return placementPlan(s, owner, key, x, z).error || null;
}

export function build(s, owner, key, x, z, rotation = null) {
  if (s.result) return 'Кампания завершена';
  const d = BUILDINGS[key],
    f = s.sides[owner];
  if (!d || !f) return 'Неизвестная постройка';
  if (d.tech && !f.tech.includes(d.tech)) return 'Сначала проведите исследование';
  const p = placementPlan(s, owner, key, x, z);
  if (p.error) return p.error;
  const cost = d.cost + (p.driveCost || 0);
  if (f.credits < cost || f.materials < d.metal) return 'Не хватает денег или сплавов';
  f.credits -= cost;
  f.materials -= d.metal;
  const b = {
    id: s.nextId++,
    side: owner,
    key,
    x,
    z,
    rotation: p.near ? p.rotation + (rotation || 0) : rotation || 0,
    hp: d.hp * 0.3,
    maxHp: d.hp,
    progress: 0,
    cooldown: 0,
    queue: [],
  };
  s.buildings.push(b);
  if (p.near) {
    if (Math.hypot(p.near.x - p.end.x, p.near.z - p.end.z) > 2) {
      const r = addRoad(s, owner, p.near.x, p.near.z, p.end.x, p.end.z, { connectorTo: b.id });
      b.roadLink = r.id;
    } else b.roadLink = p.near.road.id;
  }
  event(s, 'build', { x, z, side: owner });
  return b;
}

export function demolish(s, id, owner = 0) {
  const b = s.buildings.find((b) => b.id === Number(id)),
    r = s.roads.find((r) => r.id === Number(id)),
    t = b || r;
  if (!t || t.side !== owner || t.demolished || t.removed || (b?.key === 'hq' && b.hp > 0))
    return false;
  if (r) {
    r.removed = true;
    r.hp = 0;
  } else {
    b.hp = 0;
    b.demolished = true;
    for (const drive of s.roads)
      if (drive.connectorTo === b.id) {
        drive.removed = true;
        drive.hp = 0;
      }
  }
  dirtyNetwork(s);
  event(s, 'cleared', {
    x: b?.x ?? (r.ax + r.bx) / 2,
    z: b?.z ?? (r.az + r.bz) / 2,
    side: owner,
    key: r ? 'road' : b.key,
  });
  return true;
}

export function repair(s, id, owner = 0) {
  if (s.result) return 'Кампания завершена';
  const t = s.buildings.find((b) => b.id === id) || s.roads.find((r) => r.id === id && !r.removed);
  if (!t || t.side !== owner || t.hp >= t.maxHp || t.repairing || t.progress < 1)
    return 'Ремонт не требуется';
  if (t.key && t.hp <= 0) return 'Здание уничтожено';
  const cost = Math.ceil((t.maxHp - t.hp) * 0.55);
  if (s.sides[owner].credits < cost) return 'Недостаточно денег';
  s.sides[owner].credits -= cost;
  t.repairing = true;
  return true;
}
