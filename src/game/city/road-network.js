// Road graph and frontage geometry, shared by placement, economy, AI and the map.
export const ROAD_WIDTH = 10,
  ROAD_HP = 120,
  ROAD_REACH = 27;
const cache = new WeakMap();
export function projectPoint(x, z, r) {
  const dx = r.bx - r.ax,
    dz = r.bz - r.az,
    t = Math.max(0, Math.min(1, ((x - r.ax) * dx + (z - r.az) * dz) / (dx * dx + dz * dz || 1)));
  const px = r.ax + t * dx,
    pz = r.az + t * dz;
  return { x: px, z: pz, t, distance: Math.hypot(x - px, z - pz) };
}
export const segmentDistance = (x, z, ax, az, bx, bz) =>
  projectPoint(x, z, { ax, az, bx, bz }).distance;
export const passable = (r) => !r.removed && !r.blocked && r.hp > (r.maxHp || ROAD_HP) * 0.3;
function cross(ax, az, bx, bz) {
  return ax * bz - az * bx;
}
export function overlappingRoad(s, ax, az, bx, bz) {
  const length = Math.hypot(bx - ax, bz - az);
  if (length < 1) return null;
  const ux = (bx - ax) / length,
    uz = (bz - az) / length;
  for (const r of s.roads) {
    if (r.removed) continue;
    const dx = r.bx - r.ax,
      dz = r.bz - r.az,
      rl = Math.hypot(dx, dz);
    if (rl < 1 || Math.abs((dx * ux + dz * uz) / rl) < 0.985) continue;
    const a = (r.ax - ax) * ux + (r.az - az) * uz,
      b = (r.bx - ax) * ux + (r.bz - az) * uz,
      lo = Math.max(0, Math.min(a, b)),
      hi = Math.min(length, Math.max(a, b));
    if (hi - lo <= 3) continue;
    const middle = (lo + hi) / 2,
      width = r.connectorTo ? 5 : 10;
    if (projectPoint(ax + ux * middle, az + uz * middle, r).distance < (10 + width) / 2 - 0.6)
      return r;
  }
  return null;
}
export function roadsTouch(a, b) {
  const dx = a.bx - a.ax,
    dz = a.bz - a.az,
    ex = b.bx - b.ax,
    ez = b.bz - b.az,
    den = cross(dx, dz, ex, ez);
  if (Math.abs(den) > 1e-7) {
    const t = cross(b.ax - a.ax, b.az - a.az, ex, ez) / den,
      u = cross(b.ax - a.ax, b.az - a.az, dx, dz) / den;
    if (t >= -1e-6 && t <= 1.000001 && u >= -1e-6 && u <= 1.000001) return true;
  }
  return (
    Math.min(
      projectPoint(a.ax, a.az, b).distance,
      projectPoint(a.bx, a.bz, b).distance,
      projectPoint(b.ax, b.az, a).distance,
      projectPoint(b.bx, b.bz, a).distance,
    ) < 2.5
  );
}
export function dirtyNetwork(s) {
  s.networkRevision = (s.networkRevision || 0) + 1;
}
export function normalizeRoadOverlaps(s) {
  const originals = [...s.roads],
    kept = [];
  let changed = false;
  for (const r of originals) {
    if (r.removed || r.connectorTo) {
      kept.push(r);
      continue;
    }
    const length = Math.hypot(r.bx - r.ax, r.bz - r.az),
      ux = (r.bx - r.ax) / length,
      uz = (r.bz - r.az) / length;
    let intervals = [[0, length]];
    for (const other of kept) {
      if (other.removed || other.connectorTo || other.side !== r.side) continue;
      const dx = other.bx - other.ax,
        dz = other.bz - other.az,
        ol = Math.hypot(dx, dz);
      if (
        !ol ||
        Math.abs(dx * uz - dz * ux) / ol > 0.0001 ||
        Math.abs((other.ax - r.ax) * uz - (other.az - r.az) * ux) > 0.4
      )
        continue;
      const a = (other.ax - r.ax) * ux + (other.az - r.az) * uz,
        b = (other.bx - r.ax) * ux + (other.bz - r.az) * uz,
        lo = Math.min(a, b),
        hi = Math.max(a, b),
        next = [];
      for (const [start, end] of intervals) {
        if (hi <= start + 0.01 || lo >= end - 0.01) {
          next.push([start, end]);
          continue;
        }
        changed = true;
        if (lo - start > 3) next.push([start, Math.min(lo, end)]);
        if (end - hi > 3) next.push([Math.max(hi, start), end]);
      }
      intervals = next;
    }
    if (!intervals.length) {
      r.removed = true;
      r.hp = 0;
      kept.push(r);
    } else
      intervals.forEach(([a, b], i) =>
        kept.push({
          ...r,
          id: i ? s.nextId++ : r.id,
          ax: r.ax + ux * a,
          az: r.az + uz * a,
          bx: r.ax + ux * b,
          bz: r.az + uz * b,
        }),
      );
  }
  if (changed) {
    s.roads = kept;
    for (const b of s.buildings)
      if (b.roadLink && s.roads.some((r) => r.id === b.roadLink && r.removed)) {
        const near = s.roads
          .filter((r) => !r.removed && r.side === b.side)
          .sort(
            (a, c) => projectPoint(b.x, b.z, a).distance - projectPoint(b.x, b.z, c).distance,
          )[0];
        if (near) b.roadLink = near.id;
        else delete b.roadLink;
      }
    dirtyNetwork(s);
  }
  return changed;
}
export function network(s, side) {
  let entry = cache.get(s);
  if (!entry || entry.revision !== s.networkRevision) {
    entry = { revision: s.networkRevision, sides: [] };
    cache.set(s, entry);
  }
  if (entry.sides[side]) return entry.sides[side];
  const roads = s.roads.filter((r) => r.side === side && passable(r)),
    hq = s.buildings.find((b) => b.side === side && b.key === 'hq' && b.hp > 0),
    ids = new Set(),
    queue = [];
  if (hq)
    for (const r of roads)
      if (projectPoint(hq.x, hq.z, r).distance <= 50) {
        ids.add(r.id);
        queue.push(r);
      }
  for (let i = 0; i < queue.length; i++)
    for (const r of roads)
      if (!ids.has(r.id) && roadsTouch(queue[i], r)) {
        ids.add(r.id);
        queue.push(r);
      }
  const value = { roads, connected: queue, ids };
  entry.sides[side] = value;
  return value;
}
export function buildingConnected(s, b, size) {
  if (b.key === 'hq') return true;
  const n = network(s, b.side);
  if (b.roadLink && n.ids.has(b.roadLink)) return true;
  return n.connected.some((r) => projectPoint(b.x, b.z, r).distance <= size * 0.5 + 11);
}
export function nearestRoad(s, side, x, z, { connected = false, includeDriveways = false } = {}) {
  const roads = connected
    ? network(s, side).connected
    : s.roads.filter((r) => r.side === side && passable(r));
  let best = null;
  for (const r of roads) {
    if (!includeDriveways && r.connectorTo) continue;
    const p = projectPoint(x, z, r);
    if (!best || p.distance < best.distance) best = { ...p, road: r };
  }
  return best;
}
export function snapRoadPoint(s, side, x, z, anchor = null, straight = false) {
  x = Math.round(x / 2) * 2;
  z = Math.round(z / 2) * 2;
  let best = { x, z },
    distance = 13;
  const roads = s.roads.filter((r) => r.side === side && !r.removed);
  for (const r of roads)
    for (const p of [
      { x: r.ax, z: r.az },
      { x: r.bx, z: r.bz },
    ]) {
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < distance) {
        distance = d;
        best = { x: p.x, z: p.z };
      }
    }
  if (distance < 13) return best;
  for (const r of roads) {
    const p = projectPoint(x, z, r);
    if (p.distance < distance) {
      distance = p.distance;
      best = { x: p.x, z: p.z };
    }
  }
  if (anchor && distance === 13) {
    const dx = best.x - anchor.x,
      dz = best.z - anchor.z,
      length = Math.hypot(dx, dz),
      angle = Math.atan2(dz, dx),
      snapped = (Math.round(angle / (Math.PI / 4)) * Math.PI) / 4;
    if (straight || Math.abs(angle - snapped) < 0.1) {
      best = { x: anchor.x + Math.cos(snapped) * length, z: anchor.z + Math.sin(snapped) * length };
    }
  }
  return best;
}

// A driveway belongs to its building: it disappears with the ruin instead of needing its own
// demolition or repair.
export function removeDriveways(s, buildingId) {
  let changed = false;
  for (const drive of s.roads)
    if (drive.connectorTo === buildingId && !drive.removed) {
      drive.removed = true;
      drive.hp = 0;
      changed = true;
    }
  if (changed) dirtyNetwork(s);
  return changed;
}
