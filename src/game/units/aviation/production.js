import { WEAPONS } from '../../config.js';
import { clamp } from '../../shared/math.js';
export function produce(s, owner, key, count = 1) {
  if (s.result) return 'Кампания завершена';
  const f = s.sides[owner],
    d = WEAPONS[key];
  count = clamp(Math.floor(count) || 1, 1, 6);
  if (!d || (d.tech && !f.tech.includes(d.tech))) return 'Нужно исследование';
  const factories = s.buildings.filter(
    (b) => b.side === owner && b.key === 'factory' && b.hp > 0 && b.progress >= 1,
  );
  if (!factories.length) return 'Сначала постройте сборочный завод';
  if (f.credits < d.cost * count || f.materials < d.metal * count)
    return 'Не хватает денег или сплавов';
  if (factories.reduce((n, b) => n + (b.queue?.length || 0), 0) + count > 24)
    return 'Очередь завода заполнена';
  f.credits -= d.cost * count;
  f.materials -= d.metal * count;
  for (let i = 0; i < count; i++) {
    factories.sort((a, b) => (a.queue?.length || 0) - (b.queue?.length || 0));
    (factories[0].queue ||= []).push({ key, progress: 0 });
  }
  return true;
}
