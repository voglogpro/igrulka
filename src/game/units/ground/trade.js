import { BUILDINGS } from '../../config.js';
import { pairedEnemy } from '../../factions.js';
import { SETTLEMENTS, settlementOperational } from '../../territory/settlements.js';
import { event as emit } from '../../shared/events.js';
import { buildingConnected } from '../../city/road-network.js';
import { groundPath } from './navigation.js';
import { freeSpot } from '../vehicles/transport.js';
import { makeGround } from './recruitment.js';
import { GROUND_UNITS } from '../../config.js';

// Trade caravans. A market sends a civilian truck to its city's nearest operating village; while
// an enemy market stands, long-distance trips across the corridor pay more and also pay the
// receiver. A delivered trip pays on arrival; a destroyed truck pays nothing.
export const TRADE = {
  every: 55,
  owner: { credits: 110, materials: 4 },
  partner: { credits: 70, materials: 1 },
  domestic: { credits: 80, materials: 3 },
  arrival: 38,
};

const ready = (b) => b.key === 'market' && b.hp > 0 && b.progress >= 1 && !b.demolished;

const villages = (s, side) =>
  SETTLEMENTS.filter((site) => settlementOperational(s, site.id, side)).map((site) => ({
    id: site.id,
    x: site.x,
    z: site.z,
    village: true,
  }));

export function tradeReport(s, side) {
  const trips = s.groundUnits.filter((u) => u.side === side && u.trade && u.hp > 0).length;
  const markets = s.buildings.filter((b) => b.side === side && ready(b)).length;
  const partners = s.buildings.filter((b) => b.side !== side && ready(b)).length;
  const routes = villages(s, side).length;
  return {
    markets,
    partners,
    villages: routes,
    trips,
    delivered: s.sides[side]?.trades || 0,
    earned: Math.round(s.sides[side]?.tradeIncome || 0),
    active: markets > 0 && (partners > 0 || routes > 0),
  };
}

function pay(s, u) {
  const from = s.sides[u.side],
    bonus = u.trade.bonus || 1,
    domestic = !!u.trade.village,
    earned = (domestic ? TRADE.domestic : TRADE.owner).credits * bonus;
  from.credits += earned;
  from.materials += (domestic ? TRADE.domestic : TRADE.owner).materials * bonus;
  from.trades = (from.trades || 0) + 1;
  from.tradeIncome = (from.tradeIncome || 0) + earned;
  if (!domestic) {
    const to =
      s.sides[s.buildings.find((b) => b.id === u.trade.to)?.side ?? pairedEnemy(s, u.side)];
    to.credits += TRADE.partner.credits * bonus;
    to.materials += TRADE.partner.materials * bonus;
  }
  s.stats.trades = (s.stats.trades || 0) + 1;
  emit(s, 'trade', {
    x: u.x,
    z: u.z,
    side: u.side,
    credits: earned,
    key: 'tradetruck',
  });
}

export function updateTrade(s) {
  // Arrivals.
  for (const u of s.groundUnits) {
    if (!u.trade || u.hp <= 0) continue;
    const market = u.trade.village
      ? villages(s, u.side).find((v) => v.id === u.trade.village)
      : s.buildings.find((b) => b.id === u.trade.to && ready(b));
    if (!market) {
      // The destination was destroyed: the caravan turns back and is paid nothing.
      u.trade.to = null;
      u.hp = 0;
      continue;
    }
    if (
      Math.hypot(market.x - u.x, market.z - u.z) <
      TRADE.arrival + (u.trade.village ? 0 : (BUILDINGS.market.size || 24) * 0.5)
    ) {
      pay(s, u);
      u.trade = null;
      u.hp = 0;
      u.delivered = true;
    }
  }
  if ((s.tradeNext || 0) > s.time) return;
  s.tradeNext = s.time + 3;
  for (const b of s.buildings) {
    if (!ready(b) || (b.tradeAt || 0) > s.time) continue;
    if (!buildingConnected(s, b, BUILDINGS.market.size)) continue;
    if (s.groundUnits.some((u) => u.trade?.from === b.id && u.hp > 0)) continue;
    // Alternate: a long trip to a foreign market when one stands, otherwise the home villages.
    const foreign = s.buildings.filter((o) => o.side !== b.side && ready(o)),
      abroad = foreign.length && (b.tradeTrips || 0) % 2 === 1;
    const targets = (abroad || !villages(s, b.side).length ? foreign : villages(s, b.side)).sort(
      (p, q) => Math.hypot(p.x - b.x, p.z - b.z) - Math.hypot(q.x - b.x, q.z - b.z),
    );
    if (!targets.length) continue;
    const spot = freeSpot(s, b, GROUND_UNITS.tradetruck.size * 0.5);
    if (!spot) continue;
    const dest = targets[0];
    const truck = makeGround(s, b.side, 'tradetruck', spot.x, spot.z);
    const path = groundPath(s, truck, dest, GROUND_UNITS.tradetruck.size * 0.42);
    if (!path.length) {
      b.tradeAt = s.time + 20;
      continue;
    }
    truck.path = path;
    truck.order = { x: dest.x, z: dest.z, mode: 'trade' };
    truck.trade = dest.village
      ? { from: b.id, to: null, village: dest.id, bonus: 1 }
      : { from: b.id, to: dest.id, bonus: 1 };
    b.tradeTrips = (b.tradeTrips || 0) + 1;
    s.groundUnits.push(truck);
    b.tradeAt = s.time + TRADE.every;
    emit(s, 'tradeStart', { x: spot.x, z: spot.z, side: b.side, key: 'tradetruck' });
  }
}
