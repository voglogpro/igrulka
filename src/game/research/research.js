import { TECH } from '../config.js';
export function research(s, owner, key) {
  if (s.result) return 'Кампания завершена';
  const f = s.sides[owner],
    d = TECH[key];
  if (!d || f.tech.includes(key)) return 'Уже изучено';
  if (f.research) return 'Уже идёт исследование';
  if (!s.buildings.some((b) => b.side === owner && b.key === 'lab' && b.hp > 0 && b.progress >= 1))
    return 'Постройте лабораторию';
  if (d.requires && !f.tech.includes(d.requires)) return 'Нужно предыдущее исследование';
  if (f.science < d.science || f.credits < d.cost) return 'Не хватает науки или денег';
  f.science -= d.science;
  f.credits -= d.cost;
  f.research = { key, progress: 0 };
  return true;
}
