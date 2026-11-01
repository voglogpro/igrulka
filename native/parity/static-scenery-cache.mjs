// Native transport ownership only. Original Three objects, picking and game state stay intact.
// Trees are the sole supported resident owner: their source producer freezes world transforms
// and clearTrees changes only instance buffers. All other owners retain complete capture.
const registries = new WeakMap();
const identityScene = (scene) =>
  !scene.parent &&
  scene.position.x === 0 &&
  scene.position.y === 0 &&
  scene.position.z === 0 &&
  scene.quaternion.x === 0 &&
  scene.quaternion.y === 0 &&
  scene.quaternion.z === 0 &&
  scene.quaternion.w === 1 &&
  scene.scale.x === 1 &&
  scene.scale.y === 1 &&
  scene.scale.z === 1;

export function registerStaticWorld(world) {
  const scene = world?.scene;
  if (!scene?.isScene || !world.trees?.length || registries.has(scene)) return false;
  const meshes = new Set();
  for (const tree of world.trees) {
    if (!Array.isArray(tree.meshes) || tree.meshes.length !== 2) return false;
    for (const mesh of tree.meshes) {
      if (
        !mesh?.isInstancedMesh ||
        mesh.parent !== scene ||
        mesh.children.length ||
        mesh.matrixAutoUpdate !== false ||
        mesh.matrixWorldAutoUpdate !== false ||
        !mesh.geometry?.isBufferGeometry ||
        !mesh.material ||
        Array.isArray(mesh.material)
      )
        return false;
      meshes.add(mesh);
    }
  }
  const registry = {
    world,
    scene,
    trees: world.trees,
    treeCount: world.trees.length,
    meshes: [...meshes],
    meshSet: meshes,
    dynamicRoots: new Set(scene.children.filter((root) => !meshes.has(root))),
    detached: new Set(),
    unsupportedChildren: new Set(),
    notifications: new Map(),
    revision: 0,
    entries: [...meshes].map((object) => ({
      object,
      geometry: object.geometry,
      material: object.material,
    })),
    geometries: new Set([...meshes].map((object) => object.geometry)),
    materials: new Set([...meshes].map((object) => object.material)),
  };
  scene.addEventListener('childadded', ({ child }) => {
    if (meshes.has(child)) {
      registry.detached.delete(child);
      registry.notifications.set(child, ++registry.revision);
    } else registry.dynamicRoots.add(child);
  });
  scene.addEventListener('childremoved', ({ child }) => {
    if (meshes.has(child)) registry.detached.add(child);
    else registry.dynamicRoots.delete(child);
  });
  for (const mesh of meshes) {
    mesh.addEventListener('childadded', () => registry.unsupportedChildren.add(mesh));
    mesh.addEventListener('childremoved', () => {
      if (!mesh.children.length) registry.unsupportedChildren.delete(mesh);
    });
  }
  registries.set(scene, registry);
  return true;
}

export function notifyStaticTreeInstancesChanged(world, mesh) {
  const registry = registries.get(world?.scene);
  if (!registry?.meshSet.has(mesh)) return;
  registry.notifications.set(mesh, ++registry.revision);
}

export function getStaticCapturePlan(scene) {
  const registry = registries.get(scene);
  if (
    !registry ||
    !scene.visible ||
    !identityScene(scene) ||
    registry.detached.size ||
    registry.unsupportedChildren.size ||
    registry.world.trees !== registry.trees ||
    registry.world.trees.length !== registry.treeCount ||
    scene.children.length !== registry.meshes.length + registry.dynamicRoots.size
  )
    return null;
  let resourcesChanged = false;
  // Cheap sanity scan protects visibility/flags/counts through the exporter and avoids trusting
  // a newly animated/reparented/unknown owner. No world-matrix walk or per-leaf resource snapshot.
  for (const entry of registry.entries) {
    const object = entry.object;
    if (
      object.parent !== scene ||
      object.children.length ||
      object.matrixAutoUpdate !== false ||
      object.matrixWorldAutoUpdate !== false ||
      !object.geometry?.isBufferGeometry ||
      !object.material ||
      Array.isArray(object.material)
    )
      return null;
    if (entry.geometry !== object.geometry || entry.material !== object.material) {
      entry.geometry = object.geometry;
      entry.material = object.material;
      resourcesChanged = true;
    }
  }
  if (resourcesChanged) {
    registry.geometries = new Set(registry.entries.map((entry) => entry.geometry));
    registry.materials = new Set(registry.entries.map((entry) => entry.material));
  }
  return registry;
}

export function updateStaticSceneMatrices(plan) {
  const scene = plan.scene;
  if (scene.matrixAutoUpdate) scene.updateMatrix();
  let force = false;
  if (scene.matrixWorldNeedsUpdate) {
    if (scene.matrixWorldAutoUpdate) scene.matrixWorld.copy(scene.matrix);
    scene.matrixWorldNeedsUpdate = false;
    force = true;
  }
  for (const root of plan.dynamicRoots) root.updateMatrixWorld(force);
}
