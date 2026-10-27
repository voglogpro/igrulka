import { GROUND_UNITS, isInfantry } from '../../config.js';
import { allied } from '../../factions.js';
import { groundPath, groundStepClear } from './navigation.js';

export const GROUND_RECOVERY_PATHS_PER_STEP = 2;
const CELL = 16;
const CLEARANCE = 0.35;
const TURN_ANGLES = [0, 0.45, -0.45, 0.85, -0.85, 1.2, -1.2, 1.57, -1.57];
const REVERSE_ANGLES = [2.1, -2.1, Math.PI];
const frames = new WeakMap();
const radiusOf = (u, frame) => (frame.civic.has(u) ? 3 : (GROUND_UNITS[u.key]?.size || 3) * 0.42);
const column = (x) => Math.floor(x / CELL);
const bucketKey = (x, z) => `${x},${z}`;
const participates = (u, frame) =>
  frame.civic.has(u) ? u.hp == null || u.hp > 0 : u.hp > 0 && !u.carrierId && !!GROUND_UNITS[u.key];
const civicRecoveryDue = (s, u) => (Math.round(s.time * 20) + u.id) % 32 === 0;

function add(frame, u) {
  const key = bucketKey(column(u.x), column(u.z));
  let bucket = frame.buckets.get(key);
  if (!bucket) frame.buckets.set(key, (bucket = new Set()));
  bucket.add(u);
  frame.keys.set(u, key);
}

function movementFrame(s) {
  let frame = frames.get(s);
  const ammo = s.ammoVehicles || [],
    services = s.serviceVehicles || [];
  if (
    frame &&
    frame.time === s.time &&
    frame.units === s.groundUnits &&
    frame.count === s.groundUnits.length &&
    frame.ammoCount === ammo.length &&
    frame.serviceCount === services.length &&
    (frame.ammo === ammo || ammo.every((u) => frame.civic.has(u))) &&
    (frame.services === services || services.every((u) => frame.civic.has(u)))
  ) {
    // A service reconciliation can copy the array without changing membership.
    // Remember that verified reference once, rather than rechecking the fleet
    // again for every soldier that moves later in this same simulation step.
    frame.ammo = ammo;
    frame.services = services;
    return frame;
  }
  const earlier = frame?.time === s.time ? frame : null;
  frame = {
    time: s.time,
    units: s.groundUnits,
    count: s.groundUnits.length,
    ammo,
    services,
    ammoCount: ammo.length,
    serviceCount: services.length,
    civic: new Set([...ammo, ...services]),
    buckets: new Map(),
    keys: new Map(),
    largest: 0,
    recovery: [],
    usedRecovery: earlier?.usedRecovery || 0,
    metrics: earlier?.metrics || {
      moves: 0,
      candidates: 0,
      neighbors: 0,
      checks: 0,
      replans: 0,
      blocked: 0,
      indexBuilds: 0,
    },
  };
  frame.metrics.indexBuilds++;
  for (const fleet of [s.groundUnits, ammo, services])
    for (const u of fleet) {
      if (!participates(u, frame)) continue;
      add(frame, u);
      frame.largest = Math.max(frame.largest, radiusOf(u, frame));
      // Existing retry clocks give older blocked routes priority without a new saved queue.
      if (
        u.path?.length &&
        (frame.civic.has(u) ? civicRecoveryDue(s, u) : u.repathAt > 0 && u.repathAt <= s.time)
      ) {
        const p = u.path[0],
          length = Math.hypot(p.x - u.x, p.z - u.z),
          scale = Math.min(1, 2 / (length || 1));
        if (
          !groundStepClear(
            s,
            u,
            { x: u.x + (p.x - u.x) * scale, z: u.z + (p.z - u.z) * scale },
            radiusOf(u, frame),
          )
        )
          frame.recovery.push(u);
      }
    }
  frame.recovery.sort((a, b) => (a.repathAt || s.time) - (b.repathAt || s.time) || a.id - b.id);
  // Rotate the admission slots with logical time: a unit stopped to engage an
  // enemy must not reserve both replan slots forever ahead of a waiting column.
  if (frame.recovery.length > GROUND_RECOVERY_PATHS_PER_STEP) {
    const start = Math.round(s.time * 20) % frame.recovery.length;
    frame.recovery = Array.from(
      { length: GROUND_RECOVERY_PATHS_PER_STEP },
      (_, i) => frame.recovery[(start + i) % frame.recovery.length],
    );
  }
  frames.set(s, frame);
  return frame;
}

function moved(frame, u) {
  const old = frame.keys.get(u),
    next = bucketKey(column(u.x), column(u.z));
  if (old === next) return;
  frame.buckets.get(old)?.delete(u);
  add(frame, u);
}

function nearby(frame, u, reach) {
  const result = [];
  for (let z = column(u.z - reach); z <= column(u.z + reach); z++)
    for (let x = column(u.x - reach); x <= column(u.x + reach); x++)
      for (const v of frame.buckets.get(bucketKey(x, z)) || []) {
        if (
          v !== u &&
          participates(v, frame) &&
          v.id !== u.boardingId &&
          u.id !== v.boardingId &&
          Math.abs(v.x - u.x) <= reach &&
          Math.abs(v.z - u.z) <= reach
        )
          result.push(v);
      }
  frame.metrics.neighbors += result.length;
  return result;
}

function clearOfUnits(frame, u, dx, dz, distance, neighbors) {
  for (const v of neighbors) {
    frame.metrics.checks++;
    const vx = v.x - u.x,
      vz = v.z - u.z,
      initial = vx * vx + vz * vz,
      combined = radiusOf(u, frame) + radiusOf(v, frame) + CLEARANCE,
      along = Math.max(0, Math.min(distance, vx * dx + vz * dz)),
      cx = vx - dx * along,
      cz = vz - dz * along,
      closest = cx * cx + cz * cz;
    if (initial < combined * combined - 1e-6) {
      // Recruitment/unloading and old saves can start overlapped. Walk out physically,
      // but never deepen that overlap or push the stationary unit out of its order.
      const ex = vx - dx * distance,
        ez = vz - dz * distance;
      if (closest < initial - 1e-6 || ex * ex + ez * ez <= initial + 1e-6) return false;
    } else if (closest < combined * combined - 1e-6) return false;
  }
  return true;
}

function freeAhead(frame, u, dx, dz, horizon, neighbors) {
  let clear = horizon;
  for (const v of neighbors) {
    frame.metrics.checks++;
    const vx = v.x - u.x,
      vz = v.z - u.z,
      along = vx * dx + vz * dz,
      radius = radiusOf(u, frame) + radiusOf(v, frame) + CLEARANCE;
    if (along <= 0 || along > horizon + radius) continue;
    const across = vx * vx + vz * vz - along * along;
    if (across >= radius * radius) continue;
    clear = Math.min(clear, Math.max(0, along - Math.sqrt(radius * radius - across)));
  }
  return clear / horizon;
}

function shouldReverse(s, frame, u, dx, dz, neighbors) {
  for (const v of neighbors) {
    if (u.id < v.id || !allied(s, u.side, v.side) || !v.path?.length) continue;
    const vx = v.x - u.x,
      vz = v.z - u.z,
      length = Math.hypot(vx, vz),
      p = v.path[0],
      hx = p.x - v.x,
      hz = p.z - v.z,
      heading = Math.hypot(hx, hz);
    if (
      length < radiusOf(u, frame) + radiusOf(v, frame) + 10 &&
      vx * dx + vz * dz > 0 &&
      heading > 0 &&
      (hx * dx + hz * dz) / heading < -0.45
    )
      return true;
  }
  return false;
}

function singleFile(s, frame, u, dx, dz, neighbors) {
  let widest = radiusOf(u, frame);
  for (const v of neighbors) widest = Math.max(widest, radiusOf(v, frame));
  const offset = radiusOf(u, frame) + widest + CLEARANCE + 0.5;
  // Back out until a real passing bay opens. Without this full-footprint probe,
  // a tiny lateral step in a narrow lane alternates with forward/reverse forever.
  return ![1, -1].some((side) =>
    groundStepClear(
      s,
      u,
      { x: u.x + dz * offset * side, z: u.z - dx * offset * side },
      radiusOf(u, frame),
    ),
  );
}

function recover(s, frame, u, goal) {
  const civic = frame.civic.has(u);
  if (civic ? !civicRecoveryDue(s, u) : (u.repathAt || 0) > s.time) return;
  if (
    frame.usedRecovery >= GROUND_RECOVERY_PATHS_PER_STEP ||
    (frame.recovery.length && !frame.recovery.includes(u))
  ) {
    // Remember the first wait, rather than moving every blocked soldier's deadline
    // forward on every tick. Oldest work will eventually enter the shared budget.
    if (!civic && !(u.repathAt > 0)) u.repathAt = Math.max(1e-6, s.time);
    return;
  }
  frame.usedRecovery++;
  frame.metrics.replans++;
  if (!civic) u.repathAt = s.time + 1.2 + (u.id % 17) * 0.07;
  const path = groundPath(s, u, u.order || u.goal || u.path.at(-1) || goal, radiusOf(u, frame));
  // A blocked endpoint remains a waiting physical route; do not lose a manual
  // order, supply trip, delivery or later Shift-waypoints when A* cannot pass yet.
  if (path.length) {
    u.path = path;
    if (civic) u.revision = s.networkRevision;
    else u.navRevision = s.networkRevision;
  }
}

/** Physical local steering; does not replace orders, missions or queue ownership. */
export function moveGroundUnit(s, u, dt, speed) {
  if (GROUND_UNITS[u.key]) u.moving = false;
  if (!u.path?.length || !(speed > 0) || !(dt > 0)) return;
  if (u.delivery?.status === 'blocked' && u.delivery.retryAt > s.time) return;
  const frame = movementFrame(s),
    radius = radiusOf(u, frame),
    civic = frame.civic.has(u);
  if (!civic) u.moving = false;
  let p = u.path[0],
    dx = p.x - u.x,
    dz = p.z - u.z,
    length = Math.hypot(dx, dz),
    distance = Math.min(length, speed * dt);
  if (length < 1e-8) {
    u.path.shift();
    return;
  }
  if (
    !groundStepClear(
      s,
      u,
      { x: u.x + (dx / length) * distance, z: u.z + (dz / length) * distance },
      radius,
    )
  ) {
    recover(s, frame, u, p);
    p = u.path[0];
    dx = p.x - u.x;
    dz = p.z - u.z;
    length = Math.hypot(dx, dz);
    distance = Math.min(length, speed * dt);
  }
  if (!(distance > 0)) return;
  dx /= length;
  dz /= length;
  let horizon = Math.max(distance, Math.min(length, speed * 0.35 + radius * 2));
  const neighbors = nearby(frame, u, horizon + radius + frame.largest + CLEARANCE);
  if (u.path.length > 1 && length < radius + frame.largest + 8) {
    const occupied = neighbors.find(
      (v) => Math.hypot(v.x - p.x, v.z - p.z) < radius + radiusOf(v, frame) + CLEARANCE,
    );
    if (occupied) {
      const next = u.path[1],
        nx = next.x - p.x,
        nz = next.z - p.z,
        leg = Math.hypot(nx, nz),
        skip = Math.min(leg, radius + radiusOf(occupied, frame) + CLEARANCE + 3),
        join = { x: p.x + (nx / (leg || 1)) * skip, z: p.z + (nz / (leg || 1)) * skip };
      // A deployed MOG or another marching unit can occupy the same A* corner.
      // Join the next existing leg outside its footprint instead of circling a
      // shared vertex forever while both columns keep their real destinations.
      // This is a short swept join, not another search or a discarded player goal.
      if (groundStepClear(s, u, join, radius)) {
        if (skip === leg) u.path.shift();
        else u.path[0] = join;
        p = u.path[0];
        dx = p.x - u.x;
        dz = p.z - u.z;
        length = Math.hypot(dx, dz);
        distance = Math.min(length, speed * dt);
        dx /= length || 1;
        dz /= length || 1;
        horizon = Math.max(distance, Math.min(length, speed * 0.35 + radius * 2));
      }
    }
  }
  let best;
  const consider = (angle, reverse = false) => {
    frame.metrics.candidates++;
    const cosine = Math.cos(angle),
      sine = Math.sin(angle),
      x = dx * cosine + dz * sine,
      z = dz * cosine - dx * sine,
      point = { x: u.x + x * distance, z: u.z + z * distance };
    if (!groundStepClear(s, u, point, radius) || !clearOfUnits(frame, u, x, z, distance, neighbors))
      return;
    const score =
      cosine * 0.85 +
      freeAhead(frame, u, x, z, horizon, neighbors) * 1.5 -
      Math.abs(angle) * 0.03 +
      (angle > 0 ? 0.01 : 0) +
      (reverse ? 1 : 0);
    if (!best || score > best.score) best = { point, score, x, z, reverse };
  };
  consider(0);
  // A clear straight step is the maximum-scoring forward candidate. Most of a
  // 500-unit march needs one static test, not nine speculative steering probes.
  if (!best || best.score < 2.35 - 1e-8)
    for (let i = 1; i < TURN_ANGLES.length; i++) consider(TURN_ANGLES[i]);
  // Keep-right steering resolves normal meetings. A deterministic lower-ID right
  // of way lets the other vehicle reverse physically out of a single-file choke.
  if (shouldReverse(s, frame, u, dx, dz, neighbors)) {
    if (singleFile(s, frame, u, dx, dz, neighbors)) {
      const forward = best;
      best = null;
      consider(Math.PI, true);
      if (!best) best = forward;
    } else if (!best || best.score < 1.1) for (const angle of REVERSE_ANGLES) consider(angle, true);
  }
  if (!best) {
    frame.metrics.blocked++;
    return;
  }
  u.x = best.point.x;
  u.z = best.point.z;
  const threatFacing =
    !isInfantry(u.key) &&
    u.order?.mode === 'cover' &&
    Number.isFinite(u.threatX) &&
    Number.isFinite(u.threatZ) &&
    s.time - (u.threatAt ?? -Infinity) < 4;
  u.yaw = threatFacing
    ? Math.atan2(u.threatX - u.x, u.threatZ - u.z)
    : Math.atan2(best.reverse ? -best.x : best.x, best.reverse ? -best.z : best.z);
  if (Math.hypot(p.x - u.x, p.z - u.z) <= 1) u.path.shift();
  if (!civic) u.moving = !!u.path.length;
  frame.metrics.moves++;
  moved(frame, u);
}

// Keep the original van travel budget across short/zero-length path segments.
// The shared helper only changes physical position/path/yaw and existing revision.
export function moveCivicVehicle(s, u, dt, speed) {
  let remaining = dt;
  for (let leg = 0; leg < 16 && u.path?.length && remaining > 1e-8; leg++) {
    const x = u.x,
      z = u.z,
      point = u.path[0];
    moveGroundUnit(s, u, remaining, speed);
    const moved = Math.hypot(u.x - x, u.z - z);
    if (moved > 1e-8) remaining = Math.max(0, remaining - moved / speed);
    else if (point === u.path[0]) break;
  }
}

// Per-step counters are derived diagnostics, never game state or saved data.
export function groundMovementMetrics(s) {
  const frame = frames.get(s);
  return frame?.time === s.time ? { ...frame.metrics, buckets: frame.buckets.size } : null;
}
