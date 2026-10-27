import { walkable } from '../units/ground/navigation.js';

export const TRENCH_LINK_MAX_SPAN = 180;
export const TRENCH_LINK_MAX_LATERAL = 12;
const CELL = 64;
const caches = new WeakMap();
const batches = new WeakMap();

export function invalidateTrenchLinks(s) {
  const batch = batches.get(s);
  if (batch) {
    batch.dirty = true;
    return;
  }
  caches.delete(s);
}

// All soldiers in one ground update see the same derived connection geometry.
// Persistent endpoint records stay live; completed/captured links become fresh
// immediately after the outer batch ends, even while simulation time is paused.
export function beginTrenchLinkBatch(s) {
  const batch = batches.get(s);
  if (batch) {
    batch.depth++;
    return;
  }
  prepare(s);
  batches.set(s, { depth: 1, dirty: false });
}

export function endTrenchLinkBatch(s) {
  const batch = batches.get(s);
  if (!batch || --batch.depth > 0) return;
  batches.delete(s);
  if (batch.dirty) caches.delete(s);
}

function clearLink(s, a, b) {
  const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 6);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (!walkable(s, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, 2.5)) return false;
  }
  return true;
}

function prepare(s) {
  let cache = caches.get(s);
  const trenches = s.trenches || [];
  if (cache && batches.has(s)) return cache;
  if (
    cache &&
    cache.revision === s.networkRevision &&
    cache.trenches === trenches &&
    cache.count === trenches.length
  )
    return cache;
  const completed = trenches
    .filter((t) => t.progress >= 1)
    .sort((a, b) => a.z - b.z || a.x - b.x || a.id - b.id);
  const links = [];
  // At most two cardinal neighbours per position: a connected front/rear
  // rectangle stays bounded even when the persistent trench graph is full.
  for (let i = 0; i < completed.length; i++) {
    const a = completed[i];
    let b = null,
      best = Infinity;
    for (let j = i + 1; j < completed.length; j++) {
      const candidate = completed[j],
        dz = candidate.z - a.z;
      if (dz > TRENCH_LINK_MAX_SPAN) break;
      if (dz < 10 || Math.abs(candidate.x - a.x) > TRENCH_LINK_MAX_LATERAL) continue;
      const range = Math.hypot(candidate.x - a.x, dz);
      if (range > TRENCH_LINK_MAX_SPAN) continue;
      if (range < best || (range === best && candidate.id < b?.id)) {
        b = candidate;
        best = range;
      }
    }
    if (b && clearLink(s, a, b))
      links.push({ id: `${a.id}:${b.id}`, a, b, side: a.side === b.side ? a.side : null });
    let across = null,
      acrossRange = Infinity;
    for (const candidate of completed) {
      const dx = candidate.x - a.x;
      if (
        dx < 10 ||
        dx > TRENCH_LINK_MAX_SPAN ||
        Math.abs(candidate.z - a.z) > TRENCH_LINK_MAX_LATERAL
      )
        continue;
      const range = Math.hypot(dx, candidate.z - a.z);
      if (range < acrossRange || (range === acrossRange && candidate.id < across?.id)) {
        across = candidate;
        acrossRange = range;
      }
    }
    if (across && across !== b && clearLink(s, a, across))
      links.push({
        id: `${a.id}:${across.id}`,
        a,
        b: across,
        side: a.side === across.side ? a.side : null,
      });
  }
  const buckets = new Map();
  for (const link of links)
    for (
      let z = Math.floor(Math.min(link.a.z, link.b.z) / CELL);
      z <= Math.floor(Math.max(link.a.z, link.b.z) / CELL);
      z++
    )
      for (
        let x = Math.floor(Math.min(link.a.x, link.b.x) / CELL);
        x <= Math.floor(Math.max(link.a.x, link.b.x) / CELL);
        x++
      ) {
        const key = `${x},${z}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(link);
      }
  cache = { revision: s.networkRevision, trenches, count: trenches.length, links, buckets };
  caches.set(s, cache);
  return cache;
}

// Read-only derived geometry; a/b reference the persistent, public trench
// records. A captured endpoint changes the mixed-owner section to neutral.
export function trenchLinks(s) {
  return prepare(s).links;
}

export function trenchLinksAt(s, x, z, radius = 5) {
  const { buckets } = prepare(s),
    result = new Set();
  for (let row = Math.floor((z - radius) / CELL); row <= Math.floor((z + radius) / CELL); row++)
    for (let col = Math.floor((x - radius) / CELL); col <= Math.floor((x + radius) / CELL); col++)
      for (const link of buckets.get(`${col},${row}`) || []) result.add(link);
  return result;
}
