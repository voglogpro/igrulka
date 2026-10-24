import { BUILDINGS, ISLAND, seaDistance } from '../config.js';
import { event } from '../shared/events.js';
import { supplyFactor } from './economy.js';
import { oilStorage } from './oil.js';

// Merchant shipping. Each port keeps its own cargo ship that sails on its own to the neutral
// island exchange and back: it sells surplus oil, buys oil when the city runs short and brings
// goods home. The player only builds the port; trade runs in the background.
const cfg = () => BUILDINGS.port.port;
const live = (b) => b.hp > 0 && b.progress >= 1 && !b.demolished;

// The berth in front of a port: walk from the building straight out to deep water.
export function berthOf(b) {
  let x = b.x,
    z = b.z;
  const dx = ISLAND.x - b.x,
    dz = ISLAND.z - b.z,
    l = Math.hypot(dx, dz) || 1;
  for (let i = 0; i < 60 && seaDistance(x, z) > -26; i++) {
    x += (dx / l) * 4;
    z += (dz / l) * 4;
  }
  return { x, z };
}

// The quay of the island on the side facing the port.
export function quayOf(b) {
  const side = Math.sign(b.x - ISLAND.x) || 1,
    along = Math.max(-28, Math.min(28, (b.z - ISLAND.z) * 0.05));
  return { x: ISLAND.x + side * ISLAND.quay, z: ISLAND.z + along };
}

function route(b, outbound) {
  const berth = berthOf(b),
    quay = quayOf(b),
    // Open water halfway, so ships swing wide of the shore.
    mid = { x: (berth.x + quay.x) / 2, z: (berth.z + quay.z) / 2 };
  return outbound ? [mid, quay] : [mid, berth];
}

function trade(s, ship, f, storage) {
  const p = cfg();
  ship.cargo = { credits: p.goods.credits, materials: p.goods.materials, oil: 0, sold: 0 };
  if (f.oil > storage * p.sell.above) {
    const amount = Math.min(p.sell.max, f.oil - storage * p.sell.above);
    f.oil -= amount;
    ship.cargo.sold = amount;
    ship.cargo.credits += amount * p.sell.price;
  } else if (f.oil < storage * p.buy.below) {
    const amount = Math.min(p.buy.max, storage * p.buy.below * 2 - f.oil, f.credits / p.buy.price);
    if (amount > 1) {
      f.credits -= amount * p.buy.price;
      ship.cargo.oil = amount;
    }
  }
  event(s, 'trade', {
    side: ship.side,
    x: ship.x,
    z: ship.z,
    sold: ship.cargo.sold,
    bought: ship.cargo.oil,
  });
}

export function updatePorts(s, dt) {
  s.ships ||= [];
  const p = cfg(),
    ports = new Map(s.buildings.filter((b) => b.key === 'port' && live(b)).map((b) => [b.id, b]));
  // A ship whose port burned down is lost with whatever it carried.
  s.ships = s.ships.filter((ship) => ports.has(ship.portId));
  for (const b of ports.values())
    while (s.ships.filter((ship) => ship.portId === b.id).length < p.ships) {
      const berth = berthOf(b);
      s.ships.push({
        id: s.nextId++,
        side: b.side,
        portId: b.id,
        x: berth.x,
        z: berth.z,
        yaw: 0,
        state: 'docked',
        wait: p.dock,
        path: [],
        cargo: null,
      });
    }
  for (const ship of s.ships) {
    const port = ports.get(ship.portId),
      f = s.sides[ship.side];
    if (ship.path.length) {
      const q = ship.path[0],
        dx = q.x - ship.x,
        dz = q.z - ship.z,
        l = Math.hypot(dx, dz),
        step = p.speed * (s.weather?.speed ?? 1) * dt;
      ship.yaw = Math.atan2(dx, dz);
      if (l <= step) {
        ship.x = q.x;
        ship.z = q.z;
        ship.path.shift();
      } else {
        ship.x += (dx / l) * step;
        ship.z += (dz / l) * step;
      }
      if (ship.path.length) continue;
      ship.wait = ship.state === 'outbound' ? p.trade : p.dock;
      ship.state = ship.state === 'outbound' ? 'trading' : 'docked';
      continue;
    }
    ship.wait = Math.max(0, ship.wait - dt);
    if (ship.wait > 0) continue;
    if (ship.state === 'trading') {
      trade(s, ship, f, oilStorage(s, ship.side));
      ship.state = 'returning';
      ship.path = route(port, false);
    } else {
      // Unload at home: goods pay only through a port that is connected to the city.
      if (ship.cargo) {
        const factor = supplyFactor(s, port);
        f.credits += ship.cargo.credits * factor;
        f.materials += ship.cargo.materials * factor;
        f.oil = Math.min(oilStorage(s, ship.side), (f.oil ?? 0) + ship.cargo.oil);
        event(s, 'cargo', {
          side: ship.side,
          x: port.x,
          z: port.z,
          credits: ship.cargo.credits * factor,
        });
        ship.cargo = null;
      }
      ship.state = 'outbound';
      ship.path = route(port, true);
    }
  }
}
