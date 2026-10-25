import { validSide } from '../../factions.js';
import { oilCost, hasOil, spendOil } from '../../city/oil.js';
import { WEAPONS } from '../../config.js';
import { clamp } from '../../shared/math.js';
export function produce(s, owner, key, count = 1, factoryId = null) {
  if (s.result) return 'Кампания завершена';
  if (!validSide(s, owner) || typeof key !== 'string' || !Object.hasOwn(WEAPONS, key))
    return 'Неизвестное вооружение';
  const f = s.sides[owner],
    d = WEAPONS[key];
  count = clamp(Math.floor(count) || 1, 1, 6);
  const living = s.buildings.filter(
    (b) => b.side === owner && b.key === 'factory' && b.hp > 0 && !b.demolished,
  );
  if (factoryId != null && (!Number.isSafeInteger(factoryId) || factoryId <= 0))
    return 'Выберите свою действующую базу дронов';
  const factories = living.filter(
    (b) => b.progress >= 1 && (factoryId == null || b.id === factoryId),
  );
  if (!factories.length) return 'Сначала постройте базу дронов';
  if (f.credits < d.cost * count || f.materials < d.metal * count)
    return 'Не хватает денег или сплавов';
  if (!hasOil(s, owner, oilCost(key) * count)) return 'Не хватает нефти: постройте нефтевышки';
  if (living.reduce((n, b) => n + (b.queue?.length || 0), 0) + count > 24)
    return 'Очередь завода заполнена';
  f.credits -= d.cost * count;
  f.materials -= d.metal * count;
  spendOil(s, owner, oilCost(key) * count);
  for (let i = 0; i < count; i++) {
    factories.sort((a, b) => (a.queue?.length || 0) - (b.queue?.length || 0));
    (factories[0].queue ||= []).push({ key, progress: 0 });
  }
  return true;
}
