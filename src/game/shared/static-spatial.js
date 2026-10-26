// Buildings and trenches stay at fixed positions. Rebuild a small centre index
// once per structural change, rather than scanning the entire
// growing city and all dug positions for every infantry sight/cover query.
// Placement edits must bump networkRevision, as they do for navigation. Array
// replacement/count changes also invalidate; hp/progress/ownership/demolition
// stay live through the indexed object references and need no copied snapshot.
const CELL = 64;
const indices = new WeakMap();
function indexFor(s, field) {
  let stateIndices = indices.get(s);
  if (!stateIndices) {
    stateIndices = new Map();
    indices.set(s, stateIndices);
  }
  const objects = s[field] || [];
  let cache = stateIndices.get(field);
  if (
    cache &&
    cache.revision === s.networkRevision &&
    cache.objects === objects &&
    cache.count === objects.length
  )
    return cache.buckets;
  const buckets = new Map();
  for (let i = 0; i < objects.length; i++) {
    const object = objects[i];
    const key = `${Math.floor(object.x / CELL)},${Math.floor(object.z / CELL)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push({ object, order: i });
  }
  cache = { revision: s.networkRevision, objects, count: objects.length, buckets };
  stateIndices.set(field, cache);
  return buckets;
}

export function staticObjectsInBounds(s, field, minX, minZ, maxX, maxZ) {
  const objects = s[field] || [];
  const firstRow = Math.floor(minZ / CELL),
    lastRow = Math.floor(maxZ / CELL),
    firstColumn = Math.floor(minX / CELL),
    lastColumn = Math.floor(maxX / CELL);
  // A new city has only its HQ. Likewise, a long artillery ray can cover most
  // of the map. In either case a linear scan is cheaper than bucket queries.
  if (
    objects.length <= 16 ||
    (lastRow - firstRow + 1) * (lastColumn - firstColumn + 1) >= objects.length
  )
    return objects;
  const buckets = indexFor(s, field);
  const entries = [];
  for (let row = firstRow; row <= lastRow; row++)
    for (let col = firstColumn; col <= lastColumn; col++)
      for (const entry of buckets.get(`${col},${row}`) || []) entries.push(entry);
  // Keep the canonical array order: overlapping walls/trenches and equal
  // distances must choose the same object before and after this optimization.
  entries.sort((a, b) => a.order - b.order);
  return entries.map((entry) => entry.object);
}
