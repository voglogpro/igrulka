import { BUILDINGS } from '../../config.js';
import { event as emit } from '../../shared/events.js';
import { buildingConnected } from '../../city/road-network.js';
import { groundPath } from './navigation.js';
import { freeSpot } from '../vehicles/transport.js';
import { makeGround } from './recruitment.js';
import { GROUND_UNITS } from '../../config.js';

// Trade caravans: while both sides own a market, a civilian truck drives from each market to the
// nearest enemy market. A delivered trip pays the sender and, a little less, the receiver.
export const TRADE = {
  every: 55,
  owner: { credits: 110, materials: 4 },
  partner: { credits: 70, materials: 1 },
  arrival: 38,
};

const ready = (b) => b.key === 'market' && b.hp > 0 && b.progress >= 1 && !b.demolished;

export function tradeReport(s, side) {
  const trips = s.groundUnits.filter((u) => u.side === side && u.trade && u.hp > 0).length;
  const markets = s.buildings.filter((b) => b.side === side && ready(b)).length;
  const partners = s.buildings.filter((b) => b.side !== side && ready(b)).length;
  return { markets, partners, trips, active: markets > 0 && partners > 0 };
}

function pay(s, u) {
  const from = s.sides[u.side],
    to = s.sides[s.buildings.find((b) => b.id === u.trade.to)?.side ?? u.side ^ 1];
  const bonus = u.trade.bonus || 1;
  from.credits += TRADE.owner.credits * bonus;
  from.materials += TRADE.owner.materials * bonus;
  to.credits += TRADE.partner.credits * bonus;
  to.materials += TRADE.partner.materials * bonus;
  s.stats.trades = (s.stats.trades || 0) + 1;
  emit(s, 'trade', {
    x: u.x,
    z: u.z,
    side: u.side,
    credits: TRADE.owner.credits * bonus,
    key: 'tradetruck',
  });
}

export function updateTrade(s) {
  // Arrivals.
  for (const u of s.groundUnits) {
    if (!u.trade || u.hp <= 0) continue;
    const market = s.buildings.find((b) => b.id === u.trade.to && ready(b));
    if (!market) {
      // The destination was destroyed: the caravan turns back and is paid nothing.
      u.trade.to = null;
      u.hp = 0;
      continue;
    }
    if (
      Math.hypot(market.x - u.x, market.z - u.z) <
      TRADE.arrival + (BUILDINGS.market.size || 24) * 0.5
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
    const targets = s.buildings
      .filter((o) => o.side !== b.side && ready(o))
      .sort((p, q) => Math.hypot(p.x - b.x, p.z - b.z) - Math.hypot(q.x - b.x, q.z - b.z));
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
    truck.trade = { from: b.id, to: dest.id, bonus: 1 };
    s.groundUnits.push(truck);
    b.tradeAt = s.time + TRADE.every;
    emit(s, 'tradeStart', { x: spot.x, z: spot.z, side: b.side, key: 'tradetruck' });
  }
}
