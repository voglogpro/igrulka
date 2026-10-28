import { BUILDINGS } from '../config.js';
import { buildingConnected } from './road-network.js';
import { oilEnabled } from './oil.js';
import { validSide } from '../factions.js';

export const ELECTRONICS = Object.freeze({
  capacity: 120,
  seconds: 6,
  credits: 2,
  metal: 4,
  oil: 0.3,
  reserveCredits: 250,
});
// Preserve the existing oil-off isolated-scenario convention; a components
// test can explicitly opt in even with fuel disabled.
export const componentsEnabled = (s) =>
  s.rules?.components === true || (s.rules?.components !== false && s.rules?.oil !== false);
export const componentCost = (s, descriptor, count = 1) =>
  componentsEnabled(s) ? (descriptor?.components || 0) * count : 0;
export const hasComponents = (s, side, amount) =>
  !componentsEnabled(s) || (s.sides[side]?.components || 0) >= amount;
export function spendComponents(s, side, amount) {
  if (componentsEnabled(s))
    s.sides[side].components = Math.max(0, (s.sides[side].components || 0) - amount);
}
const working = (b) => b?.hp > 0 && !b.demolished && b.progress >= 1;
function factoryState(s, b) {
  const f = s.sides[b.side];
  if (!working(b)) return b.hp <= 0 || b.demolished ? 'ruined' : 'building';
  if (b.componentsEnabled === false) return 'disabled';
  if (!buildingConnected(s, b, BUILDINGS.electronics.size)) return 'road';
  if ((f.components || 0) >= ELECTRONICS.capacity) return 'stock';
  if (f.credits < ELECTRONICS.reserveCredits + ELECTRONICS.credits) return 'credits';
  if (f.materials < ELECTRONICS.metal) return 'materials';
  if (oilEnabled(s) && (f.oil || 0) < ELECTRONICS.oil) return 'oil';
  return 'active';
}
const reasons = {
  ruined: 'Цех разрушен',
  building: 'Строится',
  disabled: 'Выключен',
  road: 'Нужна дорога к штабу',
  stock: 'Запас электроники заполнен',
  credits: 'Сохраняется резерв 250 денег',
  materials: 'Не хватает сплавов',
  oil: 'Не хватает нефти',
  active: 'Собирает электронику',
  finished: 'Матч завершён',
};
export function electronicsFactoryStatus(s, side, id) {
  const b = s.buildings.find((v) => v.id === id && v.side === side && v.key === 'electronics');
  if (!b) return null;
  const state = s.result ? 'finished' : factoryState(s, b);
  return {
    status: state,
    reason: reasons[state],
    enabled: b.componentsEnabled !== false,
    progress: b.componentProgress || 0,
    stock: s.sides[side].components || 0,
    capacity: ELECTRONICS.capacity,
    recipe: {
      cost: ELECTRONICS.credits,
      metal: ELECTRONICS.metal,
      oil: ELECTRONICS.oil,
      components: 1,
    },
    seconds: ELECTRONICS.seconds,
  };
}
export function updateElectronics(s, rates, dt) {
  if (s.result || !componentsEnabled(s)) return;
  for (const b of s.buildings) {
    if (b.key !== 'electronics' || factoryState(s, b) !== 'active') continue;
    const f = s.sides[b.side],
      rate = (rates[b.side]?.productivity ?? 1) * (0.5 + (0.5 * b.hp) / b.maxHp);
    b.componentProgress = (b.componentProgress || 0) + (dt * rate) / ELECTRONICS.seconds;
    while (b.componentProgress >= 1 && factoryState(s, b) === 'active') {
      f.credits -= ELECTRONICS.credits;
      f.materials -= ELECTRONICS.metal;
      if (oilEnabled(s)) f.oil -= ELECTRONICS.oil;
      f.components = (f.components || 0) + 1;
      f.componentProductionSpent = (f.componentProductionSpent || 0) + ELECTRONICS.credits;
      b.componentProgress -= 1;
    }
    b.componentProgress = Math.min(1, b.componentProgress);
  }
}
export function restoreElectronics(s, sourceVersion) {
  for (let side = 0; side < s.sides.length; side++) {
    if (!validSide(s, side)) throw Error('Неизвестная сторона электроники');
    const f = s.sides[side];
    if (sourceVersion < 21) {
      f.components ??= 0;
      f.componentProductionSpent ??= 0;
    }
    for (const key of ['components', 'componentProductionSpent']) {
      if (!Number.isSafeInteger(f[key]) || f[key] < 0 || f[key] > 1e9)
        throw Error('Повреждена электроника');
    }
  }
  for (const b of s.buildings) {
    if (b.key !== 'electronics') continue;
    if (
      b.componentProgress != null &&
      (!Number.isFinite(b.componentProgress) || b.componentProgress < 0 || b.componentProgress > 1)
    )
      throw Error('Повреждён выпуск электроники');
    if (b.componentsEnabled != null && typeof b.componentsEnabled !== 'boolean')
      throw Error('Повреждён режим цеха');
  }
}
