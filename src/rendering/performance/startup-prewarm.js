import * as E from '../../game/index.js';
import { warmSceneShaders } from './shader-warmup.js';
import { WarmupFamilies, warmupModelJobs } from './warmup-families.js';
import { drawWarmupFrame } from './warmup-draw.js';

const paint = () => new Promise((resolve) => requestAnimationFrame(resolve));
const now = () => performance.now();
function campaign(s) {
  return [s, s.buildings, s.sides, s.settlements, s.seed, s.mode];
}
const sameCampaign = (a, b) => a.every((part, i) => part === b[i]);

// Loading owns model/material preparation. All scheduling caches are renderer
// metadata: neither the simulation clock nor its random state advances here.
export function warmStartupScene(
  world,
  { timeoutMs = 30000, budgetMs = 8, schedule = paint, clock = now, jobs, navigation } = {},
) {
  let resolve,
    complete = false,
    iterator = null,
    families = null,
    fence = null,
    timer;
  const result = new Promise((done) => (resolve = done)),
    progress = (world.shaderWarmupProgress = { phase: 'loading', completed: 0, total: 0 }),
    started = clock(),
    canvas = world.renderer.domElement,
    limitMs = Number.isFinite(timeoutMs) ? Math.max(0, Math.min(30000, timeoutMs)) : 30000;
  const clearFence = () => {
    const pending = fence;
    fence = null;
    if (!pending) return;
    try {
      pending.gl.deleteSync(pending.sync);
    } catch {
      // A lost/destroyed context may already have discarded the GPU resource.
    }
  };
  const finish = (status) => {
    if (complete) return;
    complete = true;
    clearTimeout(timer);
    canvas?.removeEventListener?.('webglcontextlost', contextLost);
    let diagnostics;
    try {
      clearFence();
      iterator?.return?.();
      diagnostics = families?.diagnostics();
    } catch {
      status = 'failed';
    } finally {
      try {
        families?.dispose();
      } catch {
        status = 'failed';
      }
      const elapsedMs = clock() - started;
      // A synchronous driver call can outlast the deadline before its timer is
      // dispatched. Do not report a late completion as fully prepared startup.
      if (status === 'ready' && elapsedMs >= limitMs) status = 'timeout';
      progress.phase = status;
      resolve({ status, ...diagnostics, elapsedMs });
    }
  };
  const contextLost = () => finish('context-lost');
  canvas?.addEventListener?.('webglcontextlost', contextLost, { once: true });
  timer = setTimeout(() => finish('timeout'), limitMs);
  const active = () => !complete && !world.renderer.getContext?.()?.isContextLost?.();
  const isNetwork = () => !!world.callbacks?.isNetwork?.();
  const waitForAllPrograms = async () => {
    while (active()) {
      if ((world.renderer.info?.programs || []).every((p) => !p.isReady || p.isReady())) return;
      await schedule();
    }
  };
  const waitForGpu = async () => {
    const gl = world.renderer.getContext?.();
    // WebGL2 has fences; keep a safe fallback for non-GPU render/test adapters.
    if (!gl?.fenceSync || !gl.clientWaitSync || !gl.deleteSync || !gl.flush) return;
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (!sync) throw new Error('Could not create the startup GPU fence');
    fence = { gl, sync };
    try {
      gl.flush();
      while (active()) {
        // Zero timeout never blocks the main thread waiting for GPU completion.
        const status = gl.clientWaitSync(sync, 0, 0);
        if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) return;
        if (status !== gl.TIMEOUT_EXPIRED) throw new Error('Startup GPU fence failed');
        await schedule();
      }
    } finally {
      clearFence();
    }
  };
  const warmNavigation = async () => {
    const prepare = navigation || E.navigationWarmup;
    if (!prepare || isNetwork()) return;
    let identity = campaign(world.state);
    iterator = prepare(world.state);
    while (active()) {
      // A joined client receives replacement views continuously. Its server
      // owns pathfinding, so do not restart local preparation on every snapshot.
      if (isNetwork()) {
        iterator.return?.();
        iterator = null;
        return;
      }
      const current = campaign(world.state);
      if (!sameCampaign(identity, current)) {
        iterator.return?.();
        identity = current;
        iterator = prepare(world.state);
      }
      const slice = clock();
      do {
        const step = iterator.next();
        if (step.done) {
          iterator = null;
          return identity;
        }
        Object.assign(progress, step.value, {
          phase: 'navigation',
          navigationPhase: step.value?.phase,
        });
      } while (active() && clock() - slice < budgetMs);
      await schedule();
    }
  };
  const run = async () => {
    // Let the app install and paint its loading UI before any expensive work.
    await schedule();
    await schedule();
    if (!active()) return finish('context-lost');
    families = new WarmupFamilies(world);
    families.collectExisting();
    const work = jobs || warmupModelJobs(world);
    progress.phase = 'models';
    progress.total = work.length;
    let index = 0;
    while (index < work.length && active()) {
      const slice = clock();
      do {
        families.prepare(work[index++]);
        progress.completed = index;
      } while (index < work.length && active() && clock() - slice < budgetMs);
      if (index < work.length) await schedule();
    }
    if (!active()) return finish('context-lost');
    const warmedCampaign = await warmNavigation();
    if (!active()) return finish('context-lost');
    families.attach();
    world.updateDaylight?.();
    progress.phase = 'programs';
    const compiled = await warmSceneShaders(world.renderer, world.scene, world.camera, world.post, {
      timeoutMs: Math.max(0, limitMs - (clock() - started)),
    });
    if (!active()) return;
    if (compiled.status !== 'ready') return finish(compiled.status);
    // compileAsync only checks the last program of a shared material. Wait for
    // its ordinary/instanced variants too before their first use.
    await waitForAllPrograms();
    if (!active()) return;
    progress.phase = 'gpu';
    drawWarmupFrame(world);
    await waitForAllPrograms();
    if (!active()) return;
    // The miniature family draw prepares code/uploads, not a complete frame.
    // Execute the original full scene before enabling input, without staging
    // meshes or clipping its offscreen color/depth/shadow targets.
    families.detach();
    drawWarmupFrame(world, { fullScene: true });
    await waitForAllPrograms();
    if (!active()) return;
    await waitForGpu();
    if (!active()) return finish('context-lost');
    if (!isNetwork() && (!warmedCampaign || !sameCampaign(warmedCampaign, campaign(world.state))))
      await warmNavigation();
    if (active()) finish('ready');
  };
  run().catch(() => finish('failed'));
  return result;
}
