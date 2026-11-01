import { BUILDINGS } from '../config.js';
import { supplyFactor } from './economy.js';

// Industrial complexes: a production building works faster when the plants that feed it stand
// next to it. Each distinct partner type within reach adds its share, up to the cap. The bonus is
// read from live positions, so moving a city's industry apart loses it at once.
export const COMPLEX = Object.freeze({
  radius: 130,
  rules: {
    ammofactory: { partners: ['industry', 'electronics'], each: 0.15 },
    factory: { partners: ['electronics', 'refinery'], each: 0.15 },
    electronics: { partners: ['industry', 'power'], each: 0.12 },
    refinery: { partners: ['oiltank', 'oilwell'], each: 0.15 },
    industry: { partners: ['power', 'housing'], each: 0.08 },
  },
});
const working = (b) => b.hp > 0 && !b.demolished && b.progress >= 1;
const cache = new WeakMap();

export function complexStatus(s, b) {
  const rule = COMPLEX.rules[b?.key];
  // Village buildings are an ordinary town layout, not a planned complex.
  if (!rule || b.settlementId) return null;
  let entry = cache.get(s);
  if (!entry || entry.time !== s.time || entry.count !== s.buildings.length) {
    entry = { time: s.time, count: s.buildings.length, values: new Map() };
    cache.set(s, entry);
  }
  if (entry.values.has(b.id)) return entry.values.get(b.id);
  const present = new Set();
  for (const other of s.buildings) {
    if (
      other === b ||
      other.side !== b.side ||
      !working(other) ||
      !rule.partners.includes(other.key) ||
      present.has(other.key) ||
      Math.hypot(other.x - b.x, other.z - b.z) > COMPLEX.radius
    )
      continue;
    if (supplyFactor(s, other) < 1) continue;
    present.add(other.key);
  }
  const partners = rule.partners.filter((key) => present.has(key));
  const value = {
    bonus: 1 + partners.length * rule.each,
    max: 1 + rule.partners.length * rule.each,
    partners,
    missing: rule.partners.filter((key) => !present.has(key)),
  };
  entry.values.set(b.id, value);
  return value;
}
export const complexBonus = (s, b) => complexStatus(s, b)?.bonus ?? 1;
export const complexLabel = (status) =>
  status
    ? `Комплекс +${Math.round((status.bonus - 1) * 100)}% из +${Math.round((status.max - 1) * 100)}%` +
      (status.missing.length
        ? ` · рядом не хватает: ${status.missing.map((key) => BUILDINGS[key]?.name || key).join(', ')}`
        : ' · комплекс собран')
    : '';
