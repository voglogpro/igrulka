import * as E from '../../src/game/index.js';
import {
  WarmupFamilies,
  warmupModelJobs,
} from '../../src/rendering/performance/warmup-families.js';
import { showNativeFailure, reportNativeStatus } from './native-failure.mjs';
import { registerVisualWorld } from './visual-bindings.mjs';

const paint = () => new Promise((resolve) => globalThis.requestAnimationFrame(resolve));
const identity = (state) => [
  state,
  state.buildings,
  state.sides,
  state.settlements,
  state.seed,
  state.mode,
];
const equal = (a, b) => a.every((part, i) => part === b[i]);

// Preserve the original CPU model caches and navigation preparation; GPU ownership
// changes only to a native readiness/first complete scene acknowledgement.
export async function warmStartupScene(world, options) {
  registerVisualWorld(world);
  try {
    return await prepareNativeScene(world, options);
  } catch (error) {
    showNativeFailure(error.message);
    throw error;
  }
}
async function prepareNativeScene(
  world,
  {
    schedule = paint,
    clock = () => globalThis.performance.now(),
    budgetMs = 8,
    timeoutMs = 30000,
    jobs: specifiedJobs,
    navigation = E.navigationWarmup,
  } = {},
) {
  const started = clock(),
    families = new WarmupFamilies(world);
  const limit = Number.isFinite(timeoutMs) ? Math.max(0, Math.min(30000, timeoutMs)) : 30000;
  const expired = () => clock() - started >= limit;
  const yieldFrame = async () => {
    if (expired()) return;
    let timer;
    try {
      await Promise.race([
        schedule(),
        new Promise((resolve) => {
          timer = globalThis.setTimeout(resolve, Math.max(0, limit - (clock() - started)));
        }),
      ]);
    } finally {
      globalThis.clearTimeout(timer);
    }
  };
  const progress = (world.shaderWarmupProgress = { phase: 'models', completed: 0, total: 0 });
  await yieldFrame();
  await yieldFrame();
  reportNativeStatus('models', { hidden: globalThis.document?.hidden });
  let navigationComplete = !!world.callbacks?.isNetwork?.(),
    iterator = null;
  try {
    if (!expired()) families.collectExisting();
    const jobs = specifiedJobs || warmupModelJobs(world);
    progress.total = jobs.length;
    for (let index = 0; index < jobs.length && !expired();) {
      const slice = clock();
      do {
        families.prepare(jobs[index++]);
        progress.completed = index;
      } while (index < jobs.length && clock() - slice < budgetMs && !expired());
      if (index < jobs.length && !expired()) await yieldFrame();
    }
    if (!world.callbacks?.isNetwork?.() && !expired() && navigation) {
      reportNativeStatus('navigation');
      let campaign = identity(world.state);
      iterator = navigation(world.state);
      while (iterator && !expired()) {
        if (world.callbacks?.isNetwork?.()) {
          iterator.return?.();
          break;
        }
        if (!equal(campaign, identity(world.state))) {
          iterator.return?.();
          campaign = identity(world.state);
          iterator = navigation(world.state);
        }
        const slice = clock();
        do {
          const step = iterator.next();
          if (step.done) {
            iterator = null;
            navigationComplete = true;
            break;
          }
          Object.assign(progress, step.value, {
            phase: 'navigation',
            navigationPhase: step.value?.phase,
          });
        } while (clock() - slice < budgetMs && !expired());
        if (iterator && !expired()) await yieldFrame();
      }
    }
  } finally {
    iterator?.return?.();
    families.dispose();
  }
  const cpuElapsedMs = clock() - started;
  const cpuTimedOut = expired() && (progress.completed < progress.total || !navigationComplete);
  if (cpuTimedOut)
    reportNativeStatus('cpu-preparation-timeout', {
      completed: progress.completed,
      total: progress.total,
      cpuElapsedMs,
    });
  progress.phase = 'native';
  reportNativeStatus('native-warmup');
  await world.renderer.transport.waitReady();
  world.updateDaylight();
  await world.renderer.present(world.scene, world.camera, {
    time: world.battleTime,
    post: {
      daylight: world.post.daylight,
      groundFog: world.post.uniforms.groundFog.value,
      fogTint: world.post.uniforms.fogTint.value.toArray(),
      grain: true,
      bloom: true,
    },
  });
  progress.phase = 'ready';
  reportNativeStatus('first-scene-ack');
  return {
    status: 'ready',
    ...families.diagnostics(),
    elapsedMs: clock() - started,
    cpuElapsedMs,
    cpuTimedOut,
    preparedModels: progress.completed,
    totalModels: progress.total,
    navigationComplete,
    renderer: 'Godot',
  };
}
