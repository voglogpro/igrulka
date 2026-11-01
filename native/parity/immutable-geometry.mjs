// Only the native authored mesh banks opt into this contract. Source geometry,
// FX buffers and instance attributes must keep the normal change detection path.
// Register after attributes, index, groups and nativeLods are complete; never
// mutate a registered geometry. Replacing a mesh's geometry remains supported.
const owned = new WeakSet();

export function markNativeImmutableGeometry(geometry) {
  if (!geometry?.isBufferGeometry) throw Error('Expected an authored BufferGeometry');
  owned.add(geometry);
  return geometry;
}

export const isNativeImmutableGeometry = (geometry) => owned.has(geometry);
