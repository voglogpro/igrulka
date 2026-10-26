// Called once after fixed terrain is built, before mobile views enter the scene.
// Tree clearing, water normals and weather change instance buffers/materials;
// these scenery object transforms themselves remain fixed for the whole match.
export function freezeStaticScenery(scene, { exclude = [] } = {}) {
  const excluded = new Set(exclude);
  let count = 0;
  scene.updateMatrixWorld(true);
  const freeze = (object) => {
    if (object.isLight || excluded.has(object)) return;
    object.matrixAutoUpdate = object.matrixWorldAutoUpdate = false;
    count++;
    for (const child of object.children) freeze(child);
  };
  // Keep the scene itself and every subsequently added unit/overlay dynamic.
  for (const root of scene.children) freeze(root);
  return count;
}
