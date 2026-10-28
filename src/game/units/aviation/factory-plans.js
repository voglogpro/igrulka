import { hasComponents, componentCost } from '../../city/electronics.js';
import { sideIds } from '../../factions.js';
import { oilCost, hasOil } from '../../city/oil.js';
import { WEAPONS } from '../../config.js';
import { produce } from './production.js';
import { launchStoreCapacity, launchStoreTotal, weaponStock } from './launch-supply.js';

const fields = ['key', 'target', 'reserveCredits', 'reserveMaterials', 'enabled'];
const configured = (key) => typeof key === 'string' && Object.hasOwn(WEAPONS, key);
const factory = (s, side, id) =>
  s.buildings.find((b) => b.id === id && b.side === side && b.key === 'factory');

export function isFactoryPlan(value) {
  return (
    value != null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    fields.every((key) => Object.hasOwn(value, key)) &&
    configured(value.key) &&
    Number.isInteger(value.target) &&
    value.target >= 1 &&
    value.target <= 30 &&
    Number.isFinite(value.reserveCredits) &&
    value.reserveCredits >= 0 &&
    value.reserveCredits <= 10000 &&
    Number.isFinite(value.reserveMaterials) &&
    value.reserveMaterials >= 0 &&
    value.reserveMaterials <= 1000 &&
    typeof value.enabled === 'boolean'
  );
}

export function setFactoryPlan(s, side, id, plan) {
  if (s.result) return 'Кампания завершена';
  const b = factory(s, side, id);
  if (!b || b.hp <= 0 || b.demolished || b.progress < 1)
    return 'Выберите свою завершённую базу дронов';
  if (!isFactoryPlan(plan)) return 'Некорректный план пополнения';
  b.productionPlan = Object.fromEntries(fields.map((key) => [key, plan[key]]));
  return true;
}

function counts(s) {
  const sides = sideIds(s).map(() => ({
    total: 0,
    weapons: Object.fromEntries(Object.keys(WEAPONS).map((key) => [key, 0])),
  }));
  for (const b of s.buildings) {
    if (b.key !== 'factory' || b.hp <= 0 || b.demolished) continue;
    for (const q of b.queue || []) {
      sides[b.side].total++;
      if (configured(q.key)) sides[b.side].weapons[q.key]++;
    }
  }
  return sides;
}

function status(s, b, counted) {
  const plan = isFactoryPlan(b.productionPlan) ? b.productionPlan : null;
  const f = s.sides[b.side];
  const d = plan ? WEAPONS[plan.key] : null;
  const inventory = plan ? weaponStock(s, b.side, plan.key) : 0;
  const queued = plan ? counted.weapons[plan.key] : 0;
  const stock = inventory + queued;
  const factoryQueued = b.queue?.length || 0;
  let value;
  if (s.result) value = 'finished';
  else if (b.hp <= 0 || b.demolished) value = 'ruined';
  else if (b.progress < 1) value = 'building';
  else if (!plan?.enabled) value = 'disabled';
  else if (stock >= plan.target) value = 'stock';
  else if (launchStoreTotal(b) >= launchStoreCapacity(b)) value = 'warehouse';
  else if (factoryQueued || counted.total >= 24) value = 'queue';
  else if (f.credits - d.cost < plan.reserveCredits) value = 'credits';
  else if (f.materials - d.metal < plan.reserveMaterials) value = 'materials';
  else if (!hasOil(s, b.side, oilCost(plan.key))) value = 'oil';
  else if (!hasComponents(s, b.side, componentCost(s, d))) value = 'components';
  else value = 'active';
  return {
    enabled: !!plan?.enabled,
    key: plan?.key || null,
    target: plan?.target || null,
    reserveCredits: plan?.reserveCredits || 0,
    reserveMaterials: plan?.reserveMaterials || 0,
    status: value,
    reason:
      value === 'components'
        ? '\u041d\u0435 \u0445\u0432\u0430\u0442\u0430\u0435\u0442 \u044d\u043b\u0435\u043a\u0442\u0440\u043e\u043d\u0438\u043a\u0438'
        : value === 'warehouse'
          ? '\u0421\u043a\u043b\u0430\u0434 \u0437\u0430\u043f\u043e\u043b\u043d\u0435\u043d'
          : '',
    inventory,
    queued,
    stock,
    factoryQueued,
    sideQueued: counted.total,
    queueLimit: 24,
  };
}

export function factoryPlanStatus(s, side, id) {
  const b = factory(s, side, id);
  return b ? status(s, b, counts(s)[side]) : null;
}

export function updateFactoryPlans(s) {
  if (s.result) return;
  const counted = counts(s);
  for (const b of s.buildings) {
    if (b.key !== 'factory' || !b.productionPlan?.enabled) continue;
    const own = counted[b.side];
    if (status(s, b, own).status !== 'active') continue;
    const key = b.productionPlan.key;
    if (produce(s, b.side, key, 1, b.id) === true) {
      own.total++;
      own.weapons[key]++;
    }
  }
}
