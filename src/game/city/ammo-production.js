import { BUILDINGS } from '../config.js';
import { buildingConnected } from './road-network.js';
import { economy } from './economy.js';
import { oilEnabled } from './oil.js';
import { equipmentModifiers } from '../combat/upgrade-tiers.js';
import {
  AMMUNITION as C,
  createAmmoStock,
  ammunitionProfile,
  ammunitionStatus,
} from '../units/ground/ammunition.js';

export const ammoDepotReady = (b) => b && b.hp > 0 && !b.demolished && b.progress >= 1;
export function setAmmoFactoryEnabled(s, side, id, enabled) {
  const b = s.buildings.find(
    (v) => v.id === id && v.side === side && v.key === 'ammofactory' && v.hp > 0 && !v.demolished,
  );
  if (s.result || !b || typeof enabled !== 'boolean') return 'Выберите свой боеприпасный завод';
  b.ammoEnabled = enabled;
  return true;
}
function demand(s, side) {
  const desired = createAmmoStock();
  for (const u of [...s.buildings, ...s.groundUnits]) {
    if (u.side !== side || u.hp <= 0 || u.demolished || u.carrierId) continue;
    const p = ammunitionProfile(u);
    if (p)
      desired[p.kind] += Math.max(
        C.batches[p.kind],
        ammunitionStatus(s, u).maxTotal - ammunitionStatus(s, u).total,
      );
  }
  for (const kind of C.kinds) desired[kind] = Math.min(C.stock[kind], desired[kind]);
  return desired;
}
function status(s, b, desired) {
  const f = s.sides[b.side],
    stock = f.ammoStock || createAmmoStock();
  const needed = C.kinds.filter((key) => stock[key] < desired[key]);
  const canBuy = (key) => {
    const [credits, metal, oil] = C.costs[key],
      fraction = Math.min(C.batches[key], desired[key] - stock[key]) / C.batches[key];
    if (f.credits - credits * fraction < C.reserveCredits) return 'credits';
    if (f.materials < metal * fraction) return 'materials';
    if (oilEnabled(s) && (f.oil || 0) < oil * fraction) return 'oil';
    return 'active';
  };
  if (!ammoDepotReady(b)) return b.hp <= 0 || b.demolished ? 'ruined' : 'building';
  if (b.ammoEnabled === false) return 'disabled';
  if (!buildingConnected(s, b, BUILDINGS.ammofactory.size)) return 'road';
  if (!needed.length) return 'stock';
  return needed.map(canBuy).find((v) => v === 'active') || canBuy(needed[0]);
}
const reasons = {
  ruined: 'Завод разрушен',
  building: 'Строится',
  disabled: 'Выключен',
  road: 'Нужна дорога к штабу',
  stock: 'Запас соответствует потребности',
  credits: 'Сохраняется резерв 250 денег',
  materials: 'Не хватает сплавов',
  oil: 'Не хватает нефти',
  active: 'Выпускает боеприпасы',
  finished: 'Матч завершён',
};
export function ammoFactoryStatus(s, side, id) {
  const b = s.buildings.find((v) => v.id === id && v.side === side && v.key === 'ammofactory');
  if (!b) return null;
  const state = s.result ? 'finished' : status(s, b, demand(s, side));
  const fleet = (s.ammoVehicles || []).filter((v) => v.hp > 0 && v.depotId === id);
  return {
    enabled: b.ammoEnabled !== false,
    level: b.level || 0,
    status: state,
    reason: reasons[state],
    stock: { ...(s.sides[side].ammoStock || createAmmoStock()) },
    capacity: { ...C.stock },
    production: equipmentModifiers(b).production,
    fleet: {
      busy: fleet.filter((v) => v.status !== 'idle').length,
      total: fleet.length,
      limit: equipmentModifiers(b).fleet,
    },
  };
}
export function updateAmmoProduction(s) {
  if (s.result) return;
  const desires = [null, null];
  const economies = [null, null];
  for (const b of s.buildings) {
    if (b.key !== 'ammofactory' || s.time < (b.ammoNextAt || 0)) continue;
    b.ammoNextAt = s.time + C.interval / equipmentModifiers(b).production;
    const desired = (desires[b.side] ||= demand(s, b.side));
    if (status(s, b, desired) !== 'active') continue;
    const e = (economies[b.side] ||= economy(s, b.side));
    const rate = equipmentModifiers(b).production * e.productivity * (0.5 + (0.5 * b.hp) / b.maxHp);
    b.ammoNextAt = s.time + C.interval / rate;
    const f = s.sides[b.side];
    f.ammoStock ||= createAmmoStock();
    for (let i = 0; i < C.kinds.length; i++) {
      const index = ((b.ammoCursor || 0) + i) % C.kinds.length,
        key = C.kinds[index];
      const amount = Math.min(C.batches[key], desired[key] - f.ammoStock[key]);
      if (amount <= 0) continue;
      const fraction = amount / C.batches[key],
        [credits, metal, oil] = C.costs[key];
      if (
        f.credits - credits * fraction < C.reserveCredits ||
        f.materials < metal * fraction ||
        (oilEnabled(s) && (f.oil || 0) < oil * fraction)
      )
        continue;
      f.credits -= credits * fraction;
      f.materials -= metal * fraction;
      if (oilEnabled(s)) f.oil -= oil * fraction;
      f.ammoStock[key] += amount;
      b.ammoCursor = (index + 1) % C.kinds.length;
      break;
    }
  }
}
