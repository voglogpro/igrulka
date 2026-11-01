import * as T from '../../vendor/three/three.module.js';
import { nativeVehicleWarmupModels } from './vehicle-art.mjs';
import { nativeInfantryWarmupMeshes } from './infantry-art.mjs';
import { shaderFamily } from './scene-protocol.mjs';

export function sourceShaderWarmup(world) {
  const objects = [],
    geometries = [];
  world.scene.traverse((source) => {
    const material = source.material;
    if (!source.geometry || !material?.isShaderMaterial) return;
    const family = shaderFamily(material);
    if (!['particle', 'streak', 'scar', 'weather'].includes(family)) return;
    const geometry = source.geometry.clone();
    const elements = geometry.index?.count || geometry.attributes.position?.count || 0;
    if (!elements) {
      geometry.dispose();
      return;
    }
    geometry.setDrawRange(
      0,
      Math.min(elements, source.isLineSegments ? 2 : source.isPoints ? 1 : 6),
    );
    let object;
    if (source.isInstancedMesh) {
      object = new T.InstancedMesh(geometry, material, 1);
      object.setMatrixAt(0, new T.Matrix4());
      object.instanceMatrix.needsUpdate = true;
    } else if (source.isLineSegments) object = new T.LineSegments(geometry, material);
    else if (source.isLine) object = new T.Line(geometry, material);
    else if (source.isPoints) object = new T.Points(geometry, material);
    else object = new T.Mesh(geometry, material);
    object.name = 'native-startup-' + family;
    object.visible = true;
    object.castShadow = source.castShadow;
    object.receiveShadow = source.receiveShadow;
    objects.push(object);
    geometries.push(geometry);
  });
  return { objects, geometries };
}

// Presentation-only shader preparation behind the original welcome screen.
// Both ordinary and instanced vehicle variants are actually drawn. Gameplay
// arrays, clocks, picking registries and saves receive no synthetic entities.
export function attachNativeArtWarmup(world) {
  const sourceShaders = sourceShaderWarmup(world);
  const objects = [
    ...nativeVehicleWarmupModels(),
    ...nativeInfantryWarmupMeshes(),
    ...sourceShaders.objects,
  ];
  if (!objects.length) return null;
  const group = new T.Group();
  group.name = 'native-art-startup-preparation';
  world.camera.updateMatrixWorld(true);
  group.position
    .copy(world.camera.position)
    .add(world.camera.getWorldDirection(new T.Vector3()).multiplyScalar(12));
  group.quaternion.copy(world.camera.quaternion);
  let meshes = 0;
  for (const [index, object] of objects.entries()) {
    const holder = new T.Group();
    holder.position.set(((index % 8) - 3.5) * 0.25, (Math.floor(index / 8) - 2) * 0.25, 0);
    holder.scale.setScalar(0.02);
    object.updateMatrixWorld(true);
    if (object.isInstancedMesh) {
      object.setMatrixAt(0, new T.Matrix4());
      object.instanceMatrix.needsUpdate = true;
      object.userData.nativePose = new T.InstancedBufferAttribute(new Float32Array(4), 4);
    } else {
      const copies = [];
      object.traverse((node) => {
        if (!node.isMesh || !node.visible) return;
        const instance = new T.InstancedMesh(node.geometry, node.material, 1);
        instance.setMatrixAt(0, node.matrixWorld);
        instance.instanceMatrix.needsUpdate = true;
        instance.castShadow = instance.receiveShadow = true;
        instance.frustumCulled = false;
        copies.push(instance);
        meshes++;
      });
      for (const copy of copies) holder.add(copy);
    }
    object.traverse((node) => {
      if (node.isMesh) meshes++;
    });
    holder.add(object);
    group.add(holder);
  }
  group.traverse((node) => {
    node.frustumCulled = false;
  });
  world.scene.add(group);
  return {
    models: objects.length,
    meshes,
    dispose: () => {
      group.removeFromParent();
      group.traverse((node) => {
        if (node.isInstancedMesh) node.dispose();
      });
      for (const geometry of sourceShaders.geometries) geometry.dispose();
    },
  };
}
