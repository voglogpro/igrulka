import * as T from '../../../vendor/three/three.module.js';

// A genuine draw prepares shadow programs and GPU buffers that compileAsync
// cannot initialize. It never emits an effect, advances the game or paints fake
// prototypes onto the user's canvas.
export function drawWarmupFrame(world, { fullScene = false } = {}) {
  const { renderer, scene, camera, post } = world,
    previousTarget = renderer.getRenderTarget(),
    viewport = renderer.getViewport?.(new T.Vector4()),
    scissor = renderer.getScissor?.(new T.Vector4()),
    scissorTest = renderer.getScissorTest?.(),
    geometries = new Map(),
    frusta = new Map(),
    instances = new Map(),
    visibility = new Map(),
    targets = [];
  let rendered = false;
  try {
    world.updateDaylight?.();
    if (!fullScene)
      scene.traverse((object) => {
        if (!object.geometry) return;
        frusta.set(object, object.frustumCulled);
        // Warm far map tiles too: their real instance attributes stay uploaded
        // when the player first clicks a distant minimap location.
        object.frustumCulled = false;
        // Representatives own different instance attributes. Draw each real pool
        // once as well, including empty/offscreen pools, so its actual matrix
        // buffer is allocated before the first camera visit. Never write matrices.
        if (object.isInstancedMesh && object.instanceMatrix.count > 0) {
          instances.set(object, object.count);
          object.count = 1;
          for (let ancestor = object; ancestor; ancestor = ancestor.parent) {
            if (!visibility.has(ancestor)) visibility.set(ancestor, ancestor.visible);
            ancestor.visible = true;
          }
        }
        const geometry = object.geometry;
        if (geometries.has(geometry)) return;
        geometries.set(geometry, {
          start: geometry.drawRange.start,
          count: geometry.drawRange.count,
          instances: geometry.instanceCount,
        });
        const count = geometry.index?.count ?? geometry.attributes.position?.count ?? 0;
        geometry.setDrawRange(0, Math.min(3, count));
        if (geometry.isInstancedBufferGeometry) geometry.instanceCount = 1;
      });
    for (const target of [post.target, post.bloom]) {
      if (!target?.scissor) continue;
      targets.push({ target, scissor: target.scissor.clone(), enabled: target.scissorTest });
      if (fullScene) target.scissorTest = false;
      else {
        target.scissor.set(0, 0, 1, 1);
        target.scissorTest = true;
      }
    }
    renderer.setRenderTarget(null);
    renderer.setScissor?.(0, 0, 0, 0);
    renderer.setScissorTest?.(true);
    renderer.shadowMap.needsUpdate = true;
    post.render(scene, camera, world.battleTime);
    rendered = true;
  } finally {
    for (const [geometry, previous] of geometries) {
      geometry.setDrawRange(previous.start, previous.count);
      if (geometry.isInstancedBufferGeometry) geometry.instanceCount = previous.instances;
    }
    for (const [object, previous] of instances) object.count = previous;
    for (const [object, previous] of visibility) object.visible = previous;
    for (const [object, previous] of frusta) object.frustumCulled = previous;
    for (const saved of targets) {
      saved.target.scissor.copy(saved.scissor);
      saved.target.scissorTest = saved.enabled;
    }
    // Restore default framebuffer state before restoring the prior target,
    // whose own viewport/scissor must become current last.
    if (viewport) renderer.setViewport?.(viewport);
    if (scissor) renderer.setScissor?.(scissor);
    if (scissorTest != null) renderer.setScissorTest?.(scissorTest);
    renderer.setRenderTarget(previousTarget);
    // Miniature ranges/staged casters need replacement. A successful full real
    // scene already has a valid shadow map; keep any later external invalidation.
    if (!fullScene || !rendered) renderer.shadowMap.needsUpdate = true;
  }
}
