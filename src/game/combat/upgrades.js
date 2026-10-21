import { BUILDINGS, GROUND_UNITS } from '../config.js';
export function upgradeDefense(s, side, id) {
  const b =
      s.buildings.find((b) => b.id === Number(id)) ||
      (s.groundUnits || []).find((u) => u.id === Number(id)),
    f = s.sides[side];
  if (s.result) return 'Кампания завершена';
  if (
    !b ||
    b.side !== side ||
    b.hp <= 0 ||
    b.progress < 1 ||
    !(BUILDINGS[b.key] || GROUND_UNITS[b.key])?.range
  )
    return 'Выберите готовую установку ПВО';
  if (!f.tech.includes('targeting')) return 'Изучите стабилизацию огня';
  if ((b.level || 0) >= 2) return 'Максимальный уровень';
  const cost = 220 * (1 + (b.level || 0)),
    metal = 18 * (1 + (b.level || 0));
  if (f.credits < cost || f.materials < metal) return 'Не хватает ресурсов';
  f.credits -= cost;
  f.materials -= metal;
  b.level = (b.level || 0) + 1;
  return true;
}
