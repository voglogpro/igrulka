// Match the Float32 values sent to WebGL before marking an instance buffer
// dirty. Repeated paused/simulation-intermediate frames keep their GPU data and
// picking bounds; real pose/culling changes still become visible immediately.
const updates = new WeakMap();

function recordFor(mesh) {
  let record = updates.get(mesh);
  if (!record || record.attribute !== mesh.instanceMatrix) {
    record = {
      attribute: mesh.instanceMatrix,
      count: record?.count ?? mesh.count,
      first: Infinity,
      end: 0,
    };
    updates.set(mesh, record);
  }
  return record;
}

export function writeInstanceMatrix(mesh, index, matrix) {
  const record = recordFor(mesh),
    array = record.attribute.array,
    elements = matrix.elements,
    offset = index * 16;
  for (let i = 0; i < 16; i++)
    if (array[offset + i] !== Math.fround(elements[i])) {
      matrix.toArray(array, offset);
      record.first = Math.min(record.first, offset);
      record.end = Math.max(record.end, offset + 16);
      return true;
    }
  return false;
}

export function finishInstanceUpdates(mesh, count) {
  const record = recordFor(mesh),
    attribute = record.attribute,
    changed = record.end > record.first;
  if (changed) {
    // A hidden batch or multiple sync calls may still have pending writes from
    // before its last GPU draw. Merge those ranges rather than losing them or
    // growing an unbounded list while the renderer is not consuming updates.
    let first = record.first,
      end = record.end;
    for (const range of attribute.updateRanges) {
      first = Math.min(first, range.start);
      end = Math.max(end, range.start + range.count);
    }
    attribute.clearUpdateRanges();
    attribute.addUpdateRange(first, end - first);
    attribute.needsUpdate = true;
    record.first = Infinity;
    record.end = 0;
  }
  if (changed || record.count !== count) {
    mesh.boundingSphere = null;
    mesh.boundingBox = null;
  }
  record.count = mesh.count = count;
  mesh.visible = count > 0;
  return changed;
}
