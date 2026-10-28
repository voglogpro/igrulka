// Three rebuilds renderer.shadowMap when its context returns. Resolve that
// current object in the event handler, rather than retaining the discarded one.
// Static shadows otherwise remain unrendered while the simulation is paused.
export function bindShadowRestore(renderer, lights = []) {
  const restore = () => {
    renderer.shadowMap.needsUpdate = true;
    for (const light of lights) if (light.shadow) light.shadow.needsUpdate = true;
  };
  renderer.domElement.addEventListener('webglcontextrestored', restore);
  return () => renderer.domElement.removeEventListener('webglcontextrestored', restore);
}
