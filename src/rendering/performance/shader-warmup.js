// Compile existing combat batches (including hidden/empty ones) before battle,
// with the same output targets as EveningPost.render. Never hold the render
// target across an await or let a lost context keep the game at its intro.
export function warmSceneShaders(renderer, scene, camera, post, { timeoutMs = 3000 } = {}) {
  return new Promise((resolve) => {
    const canvas = renderer.domElement;
    let completed = false,
      timer = null;
    const finish = (status) => {
      if (completed) return;
      completed = true;
      clearTimeout(timer);
      canvas?.removeEventListener?.('webglcontextlost', contextLost);
      resolve({ status });
    };
    const contextLost = () => finish('context-lost');
    canvas?.addEventListener?.('webglcontextlost', contextLost, { once: true });
    timer = setTimeout(
      () => finish('timeout'),
      Number.isFinite(timeoutMs) ? Math.max(0, Math.min(3000, timeoutMs)) : 3000,
    );
    let previous = null,
      savedTarget = false;
    const tasks = [];
    const compile = (target, compilingScene, compilingCamera) => {
      renderer.setRenderTarget(target);
      // Attach rejection handlers immediately, even if a later pass throws.
      tasks.push(
        Promise.resolve(renderer.compileAsync(compilingScene, compilingCamera)).then(
          () => true,
          () => false,
        ),
      );
    };
    try {
      if (renderer.getContext?.()?.isContextLost?.()) {
        finish('context-lost');
        return;
      }
      previous = renderer.getRenderTarget();
      savedTarget = true;
      compile(post.target, scene, camera);
      compile(post.bloom, post.bloomScene, post.camera);
      compile(null, post.scene, post.camera);
      Promise.all(tasks).then((ready) => finish(ready.every(Boolean) ? 'ready' : 'failed'));
    } catch {
      finish('failed');
    } finally {
      if (savedTarget)
        try {
          renderer.setRenderTarget(previous);
        } catch {
          finish('failed');
        }
    }
  });
}
