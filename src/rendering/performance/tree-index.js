// Forest coordinates are static for the lifetime of one generated world.
// Cleared flags stay live; replacing/appending a forest rebuilds the index.
const CELL = 64;
const indices = new WeakMap();
const key = (x, z) => `${x},${z}`;
export function treesNear(world, x, z, radius) {
  const trees = world.trees;
  if (!trees?.length || !(radius > 0)) return [];
  if (![x, z, radius].every(Number.isFinite)) return trees;
  let index = indices.get(world);
  if (!index || index.trees !== trees || index.count !== trees.length) {
    index = { trees, count: trees.length, cells: new Map() };
    for (let order = 0; order < trees.length; order++) {
      const tree = trees[order],
        cell = key(Math.floor(tree.x / CELL), Math.floor(tree.z / CELL));
      if (!index.cells.has(cell)) index.cells.set(cell, []);
      index.cells.get(cell).push({ tree, order });
    }
    indices.set(world, index);
  }
  const fromX = Math.floor((x - radius) / CELL),
    toX = Math.floor((x + radius) / CELL);
  const fromZ = Math.floor((z - radius) / CELL),
    toZ = Math.floor((z + radius) / CELL);
  if (![fromX, toX, fromZ, toZ].every(Number.isSafeInteger)) return trees;
  const width = toX - fromX + 1,
    depth = toZ - fromZ + 1;
  if (width * depth > index.cells.size * 2) return trees;
  const candidates = [];
  for (let iz = fromZ; iz <= toZ; iz++)
    for (let ix = fromX; ix <= toX; ix++)
      for (const record of index.cells.get(key(ix, iz)) || []) candidates.push(record);
  // Retain source order, including the order of buffer invalidations.
  candidates.sort((a, b) => a.order - b.order);
  return candidates.map((record) => record.tree);
}
