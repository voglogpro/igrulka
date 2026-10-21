export const ROAD_SURFACE = {
  asphaltBase: 0.12,
  asphaltThickness: 0.34,
  curbBase: 0.04,
  curbHeight: 0.58,
  markBase: 0.67,
  markThickness: 0.025,
  bridgeElevation: 24,
};
export const RIVER_SURFACE = {
  level: -1.4,
  bed: -8,
  bedHalfWidth: 72,
  bankWidth: 54,
  meshHalfWidth: 150,
  exclusion: 138,
};
export function smoothstep(min, max, value) {
  const t = Math.max(0, Math.min(1, (value - min) / (max - min)));
  return t * t * (3 - 2 * t);
}

// Clip a decoration strip to another street's footprint, leaving a clear junction.
function clipStreet(a, b, street, padding) {
  const dx = street.b.x - street.a.x,
    dz = street.b.z - street.a.z,
    length = Math.hypot(dx, dz);
  if (length < 0.001) return null;
  const tx = dx / length,
    tz = dz / length,
    cx = (street.a.x + street.b.x) / 2,
    cz = (street.a.z + street.b.z) / 2;
  const start = [(a.x - cx) * tz - (a.z - cz) * tx, (a.x - cx) * tx + (a.z - cz) * tz];
  const end = [(b.x - cx) * tz - (b.z - cz) * tx, (b.x - cx) * tx + (b.z - cz) * tz];
  const bounds = [street.width / 2 + padding, length / 2 + padding];
  let enter = 0,
    exit = 1;
  for (let axis = 0; axis < 2; axis++) {
    const delta = end[axis] - start[axis],
      limit = bounds[axis];
    if (Math.abs(delta) < 1e-9) {
      if (Math.abs(start[axis]) > limit) return null;
      continue;
    }
    let lo = (-limit - start[axis]) / delta,
      hi = (limit - start[axis]) / delta;
    if (lo > hi) [lo, hi] = [hi, lo];
    enter = Math.max(enter, lo);
    exit = Math.min(exit, hi);
    if (enter >= exit) return null;
  }
  return [enter, exit];
}
export function streetDecorationSpans(street, network, lateral, padding = 1.2) {
  const dx = street.b.x - street.a.x,
    dz = street.b.z - street.a.z,
    length = Math.hypot(dx, dz),
    px = dz / length,
    pz = -dx / length;
  const a = { x: street.a.x + px * lateral, z: street.a.z + pz * lateral },
    b = { x: street.b.x + px * lateral, z: street.b.z + pz * lateral },
    blocked = [];
  for (const other of network) {
    if (other === street || Math.abs((other.elevation || 0) - (street.elevation || 0)) > 0.5)
      continue;
    const ox = other.b.x - other.a.x,
      oz = other.b.z - other.a.z,
      ol = Math.hypot(ox, oz);
    if (Math.abs((dx * ox + dz * oz) / (length * ol)) > 0.999) {
      if (
        street.width > other.width + 0.01 ||
        (Math.abs(street.width - other.width) < 0.01 && street.index < other.index)
      )
        continue;
    }
    const overlap = clipStreet(a, b, other, padding);
    if (overlap) blocked.push(overlap);
  }
  blocked.sort((a, b) => a[0] - b[0]);
  const spans = [];
  let cursor = 0;
  for (const [start, end] of blocked) {
    if (start > cursor + 1e-5) spans.push([cursor * length, start * length]);
    cursor = Math.max(cursor, end);
  }
  if (cursor < 1 - 1e-5) spans.push([cursor * length, length]);
  return spans;
}
