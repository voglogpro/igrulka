import { OIL_FIELDS, BUILDINGS, seaDistance } from '../config.js';
import { build, canPlace } from '../city/construction.js';
import { nearestRoad } from '../city/road-network.js';
import { buildRoad } from '../city/roads.js';
import { oilStorage } from '../city/oil.js';

// The bot's oil industry: wells on the fields nearest its city, a road to each of them, tank
// farms for the stock and a port on its shore. Returns true when it spent this planning turn.
const REACH = 760;

function connect(s, side, x, z) {
  const near = nearestRoad(s, side, x, z, { connected: true });
  if (!near) return false;
  const dx = x - near.x,
    dz = z - near.z,
    l = Math.hypot(dx, dz);
  if (l < 30) return false;
  // Stop a little short of the site so the driveway has room.
  const stop = Math.max(0, l - 22);
  return (
    typeof buildRoad(
      s,
      side,
      near.x,
      near.z,
      near.x + (dx / l) * stop,
      near.z + (dz / l) * stop,
    ) !== 'string'
  );
}

function tryBuild(s, side, key, x, z) {
  const error = canPlace(s, key, x, z, side);
  if (!error) return typeof build(s, side, key, x, z) !== 'string';
  return /улиц/.test(error) && connect(s, side, x, z);
}

// Shore spots in front of the city, nearest first.
function portSites(hq) {
  const sites = [];
  for (let dz = 0; dz <= 360; dz += 40)
    for (const z of dz ? [hq.z - dz, hq.z + dz] : [hq.z]) {
      let x = hq.x;
      const step = hq.x > 0 ? -4 : 4;
      while (Math.abs(x) > 60 && seaDistance(x, z) > 22) x += step;
      if (seaDistance(x, z) > 8) sites.push({ x, z });
    }
  return sites;
}

export function oilPlan(s, side, hq, active) {
  const f = s.sides[side];
  // A city first: oil comes once there is power and the first homes.
  if (
    f.credits < 900 ||
    !active('power').length ||
    active('housing').length < 3 ||
    !active('industry').length
  )
    return false;
  const wells = active('oilwell'),
    wanted = s.time > 900 ? 3 : s.time > 420 ? 2 : 1;
  if (wells.length < wanted && f.credits > BUILDINGS.oilwell.cost + 500) {
    const fields = OIL_FIELDS.filter((field) => Math.hypot(field.x - hq.x, field.z - hq.z) < REACH)
      .filter(
        (field) =>
          !s.buildings.some(
            (b) => !b.demolished && Math.hypot(b.x - field.x, b.z - field.z) < field.r,
          ),
      )
      .sort((a, b) => Math.hypot(a.x - hq.x, a.z - hq.z) - Math.hypot(b.x - hq.x, b.z - hq.z));
    for (const field of fields) if (tryBuild(s, side, 'oilwell', field.x, field.z)) return true;
  }
  const tanks = active('oiltank');
  // A new tank only when the stock presses against the storage.
  if (
    wells.length &&
    tanks.length < 3 &&
    f.oil > oilStorage(s, side) * 0.8 &&
    f.credits > BUILDINGS.oiltank.cost + 600
  ) {
    // Tanks stand apart from each other and from the city centre, so one fire does not take all.
    for (const [dx, dz] of [
      [-150, -240],
      [150, 250],
      [-210, 200],
      [200, -230],
    ]) {
      const x = hq.x + (hq.x > 0 ? -dx : dx),
        z = hq.z + dz;
      if (tanks.some((b) => Math.hypot(b.x - x, b.z - z) < 70)) continue;
      if (tryBuild(s, side, 'oiltank', x, z)) return true;
    }
  }
  if (s.time > 360 && !active('port').length && f.credits > BUILDINGS.port.cost + 600)
    for (const p of portSites(hq)) if (tryBuild(s, side, 'port', p.x, p.z)) return true;
  return false;
}
