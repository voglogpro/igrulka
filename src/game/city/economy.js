import { ROAD_REQUIRED } from './rules.js';
import { buildingConnected } from './road-network.js';
import { BUILDINGS, GROUND_UNITS } from '../config.js';
import { districtIncome } from '../territory/districts.js';
import { difficultyOf } from '../ai/difficulty.config.js';
import { aiSides } from '../factions.js';
import { settlementIncome, settlementOperational } from '../territory/settlements.js';
export function supplyFactor(s, b) {
  if (b.settlementId)
    return settlementOperational(s, b.settlementId, b.side) &&
      buildingConnected(s, b, BUILDINGS[b.key].size)
      ? 1
      : 0;
  return ROAD_REQUIRED.has(b.key) && !buildingConnected(s, b, BUILDINGS[b.key].size) ? 0.2 : 1;
}

export const COMMUTE_INCOME = 0.07;
export function economy(s, owner) {
  const alive = s.buildings.filter((b) => b.side === owner && b.hp > 0 && b.progress >= 1);
  let power = 10,
    demand = 0,
    upkeep = 0,
    income = 1.8,
    materials = 0,
    science = 0,
    connected = 0,
    isolated = 0;
  const efficient = 1;
  for (const b of alive) {
    const d = BUILDINGS[b.key];
    if (!d) continue;
    const health = 0.5 + (0.5 * b.hp) / b.maxHp,
      road = supplyFactor(s, b);
    if (ROAD_REQUIRED.has(b.key)) {
      if (road === 1) connected++;
      else isolated++;
    }
    if (d.power < 0) power -= d.power * health * road;
    else demand += d.power;
    upkeep += d.upkeep;
  }
  const supply = demand ? Math.min(1, power / demand) : 1,
    productivity = 0.25 + 0.75 * supply;
  for (const b of alive) {
    const d = BUILDINGS[b.key];
    if (!d) continue;
    const f = productivity * (0.5 + (0.5 * b.hp) / b.maxHp) * supplyFactor(s, b);
    income += (d.income || 0) * f * efficient;
    materials += (d.materials || 0) * f * efficient;
    science += (d.science || 0) * f;
  }
  // Commuters: residents drive to the workplaces they can reach; every employed resident earns.
  let homes = 0,
    jobs = 0;
  for (const b of alive) {
    const d = BUILDINGS[b.key];
    if (!d || supplyFactor(s, b) < 1) continue;
    const health = 0.5 + (0.5 * b.hp) / b.maxHp;
    homes += (d.residents || 0) * health;
    jobs += (d.jobs || 0) * health;
  }
  const employed = Math.min(homes, jobs),
    commute = employed * COMMUTE_INCOME * productivity * efficient;
  income += commute;
  const armyUpkeep = (s.groundUnits || [])
    .filter((u) => u.side === owner && u.hp > 0)
    .reduce((n, u) => n + GROUND_UNITS[u.key].upkeep, 0);
  upkeep += armyUpkeep;
  const districts = districtIncome(s, owner);
  const outputBonus = 1 + (districts.outputBonus || 0);
  income *= outputBonus;
  materials *= outputBonus;
  science *= outputBonus;
  const settlements = settlementIncome(s, owner, { productivity, outputBonus });
  income += districts.income;
  materials += districts.materials;
  science += districts.science;
  const bonus = aiSides(s).includes(owner) ? difficultyOf(s).bonus : 1;
  return {
    gross: income * bonus,
    upkeep,
    net: income * bonus - upkeep,
    materials: materials * bonus,
    science: science * bonus,
    power,
    demand,
    supply,
    productivity,
    bonus,
    outputBonus,
    settlements: {
      ...settlements,
      income: settlements.income * bonus,
      materials: settlements.materials * bonus,
    },
    connected,
    isolated,
    armyUpkeep,
    commute: {
      homes: Math.round(homes),
      jobs: Math.round(jobs),
      employed: Math.round(employed),
      income: commute * bonus * outputBonus,
    },
    districts: {
      ...districts,
      income: districts.income * bonus,
      materials: districts.materials * bonus,
      science: districts.science * bonus,
    },
    population: alive.filter((b) => b.key === 'housing' && supplyFactor(s, b) > 0).length * 120,
  };
}

export function buildingOutput(s, b) {
  const d = BUILDINGS[b.key],
    e = economy(s, b.side);
  if (!d) return null;
  const road = supplyFactor(s, b),
    health = 0.5 + (0.5 * b.hp) / b.maxHp,
    factor = b.hp > 0 && b.progress >= 1 ? road * health * e.productivity : 0,
    bonus = e.bonus * e.outputBonus,
    efficient = 1;
  return {
    road,
    health,
    power: e.productivity,
    factor,
    income: (d.income || 0) * factor * efficient * bonus,
    materials: (d.materials || 0) * factor * efficient * bonus,
    science: (d.science || 0) * factor * bonus,
    upkeep: d.upkeep,
    powerUse: d.power,
  };
}
