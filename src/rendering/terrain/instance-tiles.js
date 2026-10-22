import * as T from '../../../vendor/three/three.module.js';

// Small spatial batches let both the view camera and the shadow camera reject distant trees.
// Mesh geometry, colors, positions and total instance count remain identical.
export function tileInstances(scene, sources, records, tileSize = 256) {
  const groups = new Map();
  for (const tree of records) {
    const key = Math.floor(tree.x / tileSize) + ':' + Math.floor(tree.z / tileSize);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(tree);
  }
  const matrix = new T.Matrix4(),
    color = new T.Color(),
    chunks = [];
  for (const trees of groups.values()) {
    const meshes = sources.map((source) => {
      const mesh = new T.InstancedMesh(source.geometry, source.material, trees.length);
      mesh.castShadow = source.castShadow;
      mesh.receiveShadow = source.receiveShadow;
      return mesh;
    });
    for (let i = 0; i < trees.length; i++) {
      const tree = trees[i];
      for (let j = 0; j < sources.length; j++) {
        sources[j].getMatrixAt(tree.index, matrix);
        meshes[j].setMatrixAt(i, matrix);
        if (sources[j].instanceColor) {
          sources[j].getColorAt(tree.index, color);
          meshes[j].setColorAt(i, color);
        }
      }
      tree.index = i;
      tree.meshes = meshes;
    }
    for (const mesh of meshes) {
      mesh.computeBoundingSphere();
      scene.add(mesh);
    }
    chunks.push(meshes);
  }
  for (const source of sources) source.dispose();
  return { chunks };
}
