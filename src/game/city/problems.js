import { BUILDINGS, GROUND_UNITS } from '../config.js';
import { ROAD_REQUIRED } from './rules.js';
import { economy, supplyFactor } from './economy.js';
import { electronicsFactoryStatus } from './electronics.js';
import { ammoFactoryStatus } from './ammo-production.js';
import { factoryOrderStatus } from '../units/aviation/factory-orders.js';
import { ammunitionStatus, ammunitionProfile } from '../units/ground/ammunition.js';
import {
  launchStoreTotal,
  movableWeaponStock,
  launchSiteAllows,
} from '../units/aviation/launch-supply.js';
import { WEAPONS } from '../config.js';

// Problem markers in the manner of city builders: a read-only projection of the owner's own
// state, never of the enemy's. Each marker names one thing a building or a group of soldiers
// lacks, so a new player sees at a glance what to build or connect.
export const PROBLEMS = Object.freeze({
  road: 'Нет дороги к штабу',
  power: 'Не хватает электроэнергии',
  electronics: 'Не хватает электроники',
  oil: 'Не хватает нефти',
  materials: 'Не хватает сплавов',
  credits: 'Не хватает денег',
  weapons: 'Нет вооружения для пуска',
  ammo: 'Нет боеприпасов',
  repair: 'Сильно повреждено',
});
const GROUP_RADIUS = 70;
const fromReason = {
  components: 'electronics',
  oil: 'oil',
  materials: 'materials',
  credits: 'credits',
  road: 'road',
};

export function problemMarkers(s, side) {
  const markers = [];
  if (!s?.sides?.[side]) return markers;
  const e = economy(s, side),
    add = (kind, at, count = 1) =>
      markers.push({ kind, label: PROBLEMS[kind], x: at.x, z: at.z, count, id: at.id ?? null });
  for (const b of s.buildings) {
    if (b.side !== side || b.hp <= 0 || b.demolished || b.progress < 1 || !BUILDINGS[b.key])
      continue;
    if (b.settlementId) continue;
    const d = BUILDINGS[b.key];
    let kind = null;
    if (ROAD_REQUIRED.has(b.key) && supplyFactor(s, b) < 1) kind = 'road';
    else if (d.power > 0 && e.supply < 0.75) kind = 'power';
    else if (b.key === 'electronics')
      kind = fromReason[electronicsFactoryStatus(s, side, b.id)?.status];
    else if (b.key === 'ammofactory') kind = fromReason[ammoFactoryStatus(s, side, b.id)?.status];
    else if (b.key === 'factory')
      kind = fromReason[factoryOrderStatus(s, side, b.id)?.orders[0]?.status];
    else if (['launcher', 'silo', 'navalbase'].includes(b.key) && !launchStoreTotal(b)) {
      const any = Object.keys(WEAPONS).some(
        (key) => launchSiteAllows(b, key) && movableWeaponStock(s, side, key) > 0,
      );
      if (!any) kind = 'weapons';
    } else if (ammunitionProfile(b) && ammunitionStatus(s, b).total === 0) kind = 'ammo';
    if (!kind && b.hp < b.maxHp * 0.4) kind = 'repair';
    if (kind) add(kind, b);
  }
  // One marker per group of soldiers that ran dry, not one per soldier.
  const groups = [];
  for (const u of s.groundUnits) {
    if (u.side !== side || u.hp <= 0 || u.carrierId || u.civil || !GROUND_UNITS[u.key]) continue;
    if (!ammunitionProfile(u) || ammunitionStatus(s, u).total > 0) continue;
    let g = groups.find(
      (v) => Math.hypot(v.x / v.count - u.x, v.z / v.count - u.z) <= GROUP_RADIUS,
    );
    if (!g) groups.push((g = { x: 0, z: 0, count: 0 }));
    g.x += u.x;
    g.z += u.z;
    g.count++;
  }
  for (const g of groups) add('ammo', { x: g.x / g.count, z: g.z / g.count }, g.count);
  return markers;
}

// Short HUD summary: the most common problems first.
export function problemSummary(markers) {
  const counts = new Map();
  for (const m of markers)
    counts.set(m.kind, (counts.get(m.kind) || 0) + (m.id == null ? m.count : 1));
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([kind, count]) => ({ kind, label: PROBLEMS[kind], count }));
}
