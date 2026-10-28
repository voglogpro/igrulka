import { WEAPONS } from '../../config.js';
import { validSide } from '../../factions.js';
import { hasOil, oilCost } from '../../city/oil.js';
import { componentCost, hasComponents } from '../../city/electronics.js';
import { launchStoreCapacity, launchStoreTotal } from './launch-supply.js';
import { produce } from './production.js';

export const FACTORY_ORDER_LIMIT = 1000;
const GROUP_LIMIT = 64;
const configured = (key) => typeof key === 'string' && Object.hasOwn(WEAPONS, key);
const living = (b) => b.key === 'factory' && b.hp > 0 && !b.demolished;
const pending = (b) => (b.productionOrders || []).reduce((n, q) => n + q.remaining, 0);
const sites = (s, side, id = null) =>
  s.buildings.filter((b) => b.side === side && living(b) && (id == null || b.id === id));
const validId = (id) => id == null || (Number.isSafeInteger(id) && id > 0);

export function queueFactoryOrder(s, side, key, count = 1, factoryId = null) {
  if (s.result) return 'Кампания завершена';
  if (
    !validSide(s, side) ||
    !configured(key) ||
    !Number.isSafeInteger(count) ||
    count < 1 ||
    count > 100 ||
    !validId(factoryId)
  )
    return 'Некорректный заказ';
  const own = sites(s, side),
    factories = sites(s, side, factoryId).filter(
      (b) =>
        b.progress >= 1 &&
        ((b.productionOrders?.length || 0) < GROUP_LIMIT || b.productionOrders.at(-1)?.key === key),
    );
  if (!factories.length) return 'Нужна своя завершённая база дронов со свободным местом для заказа';
  if (own.reduce((n, b) => n + pending(b), 0) + count > FACTORY_ORDER_LIMIT)
    return 'Лимит ожидающих заказов — 1000';
  factories.sort(
    (a, b) =>
      pending(a) + (a.queue?.length || 0) - pending(b) - (b.queue?.length || 0) || a.id - b.id,
  );
  const b = factories[0],
    orders = (b.productionOrders ||= []),
    last = orders.at(-1);
  if (last?.key === key) last.remaining += count;
  else orders.push({ key, remaining: count });
  return true;
}

export function cancelFactoryOrders(s, side, key, factoryId = null) {
  if (s.result || !validSide(s, side) || !configured(key) || !validId(factoryId))
    return 'Некорректный заказ';
  if (factoryId != null && !sites(s, side, factoryId).length) return 'Завод вам не принадлежит';
  for (const b of sites(s, side, factoryId))
    if (b.productionOrders) b.productionOrders = b.productionOrders.filter((q) => q.key !== key);
  // Only unpaid intentions are removed. Paid production and resources are untouched.
  return true;
}

function waiting(s, b, key, sideQueued) {
  if (s.result) return ['finished', 'Кампания завершена'];
  if (!living(b)) return ['ruined', 'Завод разрушен'];
  if (b.progress < 1) return ['building', 'Завод строится'];
  if (b.queue?.length || sideQueued >= 24) return ['queue', 'Выполняется оплаченная очередь'];
  if (launchStoreTotal(b) >= launchStoreCapacity(b)) return ['warehouse', 'Склад завода заполнен'];
  const f = s.sides[b.side],
    d = WEAPONS[key];
  if (f.credits < d.cost) return ['credits', 'Ожидание денег'];
  if (f.materials < d.metal) return ['materials', 'Ожидание сплавов'];
  if (!hasOil(s, b.side, oilCost(key))) return ['oil', 'Ожидание нефти'];
  if (!hasComponents(s, b.side, componentCost(s, d))) return ['components', 'Ожидание электроники'];
  return ['ready', 'Готов к оплате следующей единицы'];
}

export function factoryOrderStatus(s, side, factoryId = null, key = null) {
  if (!validSide(s, side) || !validId(factoryId) || (key != null && !configured(key))) return null;
  const own = sites(s, side),
    selected = own.filter((b) => factoryId == null || b.id === factoryId);
  const sideQueued = own.reduce((n, b) => n + (b.queue?.length || 0), 0);
  const orders = [];
  let unpaid = 0,
    paid = 0;
  for (const b of selected) {
    paid += (b.queue || []).filter((q) => key == null || q.key === key).length;
    for (let i = 0; i < (b.productionOrders?.length || 0); i++) {
      const q = b.productionOrders[i];
      if (key != null && q.key !== key) continue;
      const [status, reason] = i
        ? ['fifo', 'Ожидание предыдущего заказа']
        : waiting(s, b, q.key, sideQueued);
      unpaid += q.remaining;
      orders.push({ factoryId: b.id, key: q.key, remaining: q.remaining, status, reason });
    }
  }
  return {
    unpaid,
    paid,
    canOrder: selected.some(
      (b) =>
        b.progress >= 1 &&
        ((b.productionOrders?.length || 0) < GROUP_LIMIT ||
          (key != null && b.productionOrders.at(-1)?.key === key)),
    ),
    sidePending: own.reduce((n, b) => n + pending(b), 0),
    limit: FACTORY_ORDER_LIMIT,
    orders,
  };
}

export function updateFactoryOrders(s) {
  let sideQueued = s.sides.map(() => 0);
  for (const b of s.buildings) if (living(b)) sideQueued[b.side] += b.queue?.length || 0;
  for (const b of s.buildings) {
    if (b.key !== 'factory') continue;
    if (!living(b)) {
      if (b.productionOrders) b.productionOrders = [];
      continue;
    }
    const q = b.productionOrders?.[0];
    if (!q || waiting(s, b, q.key, sideQueued[b.side])[0] !== 'ready') continue;
    if (produce(s, b.side, q.key, 1, b.id) === true) {
      sideQueued[b.side]++;
      if (--q.remaining === 0) b.productionOrders.shift();
    }
  }
}

export function restoreFactoryOrders(s) {
  const totals = s.sides.map(() => 0);
  for (const b of s.buildings) {
    if (b.productionOrders == null) continue;
    if (
      b.key !== 'factory' ||
      !Array.isArray(b.productionOrders) ||
      b.productionOrders.length > GROUP_LIMIT
    )
      throw Error('Повреждены ожидающие заказы завода');
    b.productionOrders = b.productionOrders.map((q) => {
      if (
        !q ||
        typeof q !== 'object' ||
        Array.isArray(q) ||
        !configured(q.key) ||
        !Number.isSafeInteger(q.remaining) ||
        q.remaining < 1 ||
        q.remaining > FACTORY_ORDER_LIMIT
      )
        throw Error('Повреждён ожидающий заказ завода');
      return { key: q.key, remaining: q.remaining };
    });
    if (!living(b)) b.productionOrders = [];
    totals[b.side] += pending(b);
    if (totals[b.side] > FACTORY_ORDER_LIMIT) throw Error('Превышен лимит ожидающих заказов');
  }
}
