// Native transport may omit vertices that the geometry-global draw range cannot
// reference. IDs stay unchanged: keep the prefix, never compact/remap vertices.
export const FULL_GEOMETRY_PREFIX = Object.freeze({ vertexPrefix: null, indexPrefix: null });
const integer = (value) => Number.isSafeInteger(value) && value >= 0;

export class ReferencedVertexPrefixCache {
  constructor() {
    this.entries = new WeakMap();
    this.indexScans = 0;
  }

  get(geometry) {
    // LOD indices use the same vertex bank and may reach beyond the base range.
    const lods = geometry.userData?.nativeLods;
    if (lods && (!Array.isArray(lods) || lods.length)) return FULL_GEOMETRY_PREFIX;
    const positionCount = geometry.attributes?.position?.count,
      index = geometry.index || null,
      indexOwner = index?.isInterleavedBufferAttribute ? index.data : index,
      indexVersion = indexOwner?.version ?? 0,
      indexCount = index?.count ?? 0,
      indexArray = indexOwner?.array,
      start = geometry.drawRange?.start,
      count = geometry.drawRange?.count;
    const old = this.entries.get(geometry);
    if (
      old &&
      old.index === index &&
      old.indexVersion === indexVersion &&
      old.indexCount === indexCount &&
      old.indexArray === indexArray &&
      old.positionCount === positionCount &&
      old.start === start &&
      old.count === count
    )
      return old.plan;
    const entry = {
      index,
      indexVersion,
      indexCount,
      indexArray,
      positionCount,
      start,
      count,
      plan: FULL_GEOMETRY_PREFIX,
    };
    this.entries.set(geometry, entry);
    if (!integer(positionCount) || !integer(start) || !(integer(count) || count === Infinity))
      return entry.plan;
    const elements = index ? indexCount : positionCount;
    if (!integer(elements) || start > elements) return entry.plan;
    const end = count === Infinity ? elements : start + count;
    if (!integer(end) || end > elements) return entry.plan;
    if (!index) {
      entry.plan = { vertexPrefix: end, indexPrefix: null };
      return entry.plan;
    }
    if (
      !(index.isBufferAttribute || index.isInterleavedBufferAttribute) ||
      index.itemSize !== 1 ||
      index.normalized ||
      !ArrayBuffer.isView(indexArray)
    )
      return entry.plan;
    const stride = index.isInterleavedBufferAttribute ? index.data.stride : 1,
      offset = index.isInterleavedBufferAttribute ? index.offset : 0;
    if (
      !integer(stride) ||
      stride < 1 ||
      !integer(offset) ||
      offset >= stride ||
      (end > 0 && (end - 1) * stride + offset >= indexArray.length)
    )
      return entry.plan;
    let maximum = -1;
    this.indexScans++;
    for (let i = start; i < end; i++) {
      const value = indexArray[i * stride + offset];
      if (!integer(value) || value >= positionCount) return entry.plan;
      if (value > maximum) maximum = value;
    }
    entry.plan = { vertexPrefix: maximum + 1, indexPrefix: end };
    return entry.plan;
  }
}
