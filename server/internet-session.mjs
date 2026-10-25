import { setTimeout as sleep } from 'node:timers/promises';
import { startInternetTunnel } from './internet.mjs';
import { waitForPublicServer } from './tunnel.mjs';

// Forwarding is replaceable transport. This controller never owns the HTTP server,
// rooms, credentials or simulation, so a provider failure cannot destroy a match.
export function createInternetSession({
  localUrl,
  signal,
  startTunnel = startInternetTunnel,
  check = waitForPublicServer,
  wait = (ms, abortSignal) => sleep(ms, undefined, { signal: abortSignal }),
  onChange = () => {},
  onProgress = () => {},
  attemptTimeoutMs = 20_000,
} = {}) {
  const lifetime = new AbortController();
  let state = { publicUrl: null, status: 'recovering', retryCount: 0 };
  const publish = (patch) => {
    state = { ...state, ...patch };
    onChange({ ...state });
  };
  const cancel = () => lifetime.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  const done = (async () => {
    publish({});
    while (!lifetime.signal.aborted) {
      const attempt = new AbortController();
      const startupTimer = setTimeout(() => attempt.abort(), attemptTimeoutMs);
      startupTimer.unref?.();
      const abortAttempt = () => attempt.abort();
      lifetime.signal.addEventListener('abort', abortAttempt, { once: true });
      let candidate = null,
        ready = false,
        ended = false,
        revision = 0;
      let release;
      const exited = new Promise((resolve) => {
        release = resolve;
      });
      const lost = () => {
        if (ended) return;
        ended = true;
        ready = false;
        publish({ publicUrl: null, status: 'recovering' });
        attempt.abort();
        release();
      };
      try {
        candidate = await startTunnel({
          localUrl,
          signal: attempt.signal,
          onProgress,
          check: (url, options) => check(url, { ...options, probeBytes: 2048, successes: 1 }),
          onExit: lost,
          onPublicUrl: (url) => {
            if (!ready || ended || attempt.signal.aborted) return;
            if (url === state.publicUrl) return;
            const checking = ++revision;
            publish({ publicUrl: null, status: 'recovering' });
            if (!url) {
              lost();
              return;
            }
            Promise.resolve()
              .then(() =>
                check(url, {
                  signal: attempt.signal,
                  successes: 1,
                  probeBytes: 2048,
                  timeoutMs: 20_000,
                }),
              )
              .then(
                () => {
                  if (!ended && !attempt.signal.aborted && checking === revision)
                    publish({ publicUrl: url, status: 'ready' });
                },
                () => {
                  if (checking === revision && !ended) lost();
                },
              );
          },
        });
        if (ended || lifetime.signal.aborted) throw Error('Forwarder stopped during startup');
        if (attempt.signal.aborted) throw Error('Forwarder startup timed out');
        clearTimeout(startupTimer);
        ready = true;
        publish({ publicUrl: candidate.url, status: 'ready' });
        await Promise.race([
          exited,
          new Promise((resolve) => {
            attempt.signal.addEventListener('abort', resolve, { once: true });
            if (attempt.signal.aborted) resolve();
          }),
        ]);
      } catch {
        // Provider startup errors are recoverable; never terminate the room host.
      } finally {
        clearTimeout(startupTimer);
        ready = false;
        ended = true;
        attempt.abort();
        candidate?.stop();
        lifetime.signal.removeEventListener('abort', abortAttempt);
      }
      if (lifetime.signal.aborted) break;
      publish({ publicUrl: null, status: 'recovering', retryCount: state.retryCount + 1 });
      onProgress('Интернет-соединение потеряно. Восстанавливаю; локальная комната сохранена.');
      const delay = Math.min(15_000, 1000 * 2 ** Math.min(state.retryCount - 1, 4));
      try {
        await wait(delay, lifetime.signal);
      } catch {
        if (!lifetime.signal.aborted) throw Error('Recovery timer failed');
      }
    }
    publish({ publicUrl: null, status: 'stopped' });
  })().finally(() => signal?.removeEventListener('abort', cancel));
  return {
    get state() {
      return { ...state };
    },
    done,
    async stop() {
      lifetime.abort();
      await done;
    },
  };
}
