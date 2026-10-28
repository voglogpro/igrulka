import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bindStartupReadiness,
  prepareStartupAudio,
} from '../../src/ui/session/startup-readiness.js';

function pending() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test('start stays disabled with a visible loading status until world preparation settles', async () => {
  const warmup = pending();
  const button = { textContent: 'Начать развёртывание ↗', disabled: false };
  const status = { hidden: true };
  const startup = bindStartupReadiness({ button, status, warmup: warmup.promise });
  assert.equal(startup.ready, false);
  assert.equal(button.disabled, true);
  assert.equal(button.textContent, 'Подготовка города…');
  assert.equal(status.hidden, false);
  await Promise.resolve();
  assert.equal(startup.ready, false);
  warmup.resolve({ status: 'ready' });
  await startup.done;
  assert.equal(startup.ready, true);
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, 'Начать развёртывание ↗');
  assert.equal(status.hidden, true);
});

test('bounded timeout or error releases the start UI and restores the resumed label', async () => {
  for (const outcome of ['timeout', 'error']) {
    const warmup = pending();
    const button = { textContent: 'Продолжить ↗' };
    const status = {};
    const startup = bindStartupReadiness({ button, status, warmup: warmup.promise });
    if (outcome === 'error') warmup.reject(Error('optional GPU preparation failed'));
    else warmup.resolve({ status: outcome });
    await startup.done;
    assert.equal(startup.ready, true);
    assert.equal(button.disabled, false);
    assert.equal(button.textContent, 'Продолжить ↗');
    assert.equal(status.hidden, true);
  }
});

function scheduler() {
  const tasks = [];
  let timer,
    delay,
    cleared = 0;
  return {
    options: {
      schedule: (callback) => tasks.push(callback),
      setTimer: (callback, milliseconds) => {
        timer = callback;
        delay = milliseconds;
        return 1;
      },
      clearTimer: () => {
        cleared++;
      },
    },
    run: () => tasks.shift()(),
    timeout: () => timer(),
    get delay() {
      return delay;
    },
    get cleared() {
      return cleared;
    },
  };
}

test('loading waits for both graphics and deferred optional audio without preparing inside the initial UI task', async () => {
  const graphics = pending();
  const audio = pending();
  const queue = scheduler();
  let preparations = 0;
  const audioReady = prepareStartupAudio(() => {
    preparations++;
    return audio.promise;
  }, queue.options);
  const button = { textContent: 'Продолжить ↗' };
  const status = {};
  const startup = bindStartupReadiness({
    button,
    status,
    warmup: Promise.allSettled([graphics.promise, audioReady]),
  });
  assert.equal(preparations, 0);
  graphics.resolve({ status: 'ready' });
  await Promise.resolve();
  assert.equal(startup.ready, false);
  queue.run();
  assert.equal(preparations, 1);
  assert.equal(startup.ready, false);
  audio.resolve();
  await startup.done;
  assert.equal(startup.ready, true);
  assert.equal(button.disabled, false);
  assert.equal(queue.cleared, 1);
  assert.equal(queue.delay, 5000);
});

test('optional audio timeout cannot trap loading or start a stale expensive preparation after release', async () => {
  const queue = scheduler();
  let preparations = 0;
  const done = prepareStartupAudio(() => preparations++, queue.options);
  queue.timeout();
  await done;
  queue.run();
  assert.equal(preparations, 0);
  assert.equal(queue.cleared, 1);

  const started = scheduler();
  const neverReady = prepareStartupAudio(() => new Promise(() => {}), started.options);
  started.run();
  started.timeout();
  await neverReady;
  assert.equal(started.cleared, 1);
});

test('optional audio errors release readiness while graphics preparation remains independent', async () => {
  for (const prepare of [
    () => {
      throw Error('denied');
    },
    () => Promise.reject(Error('denied')),
  ]) {
    const queue = scheduler();
    const done = prepareStartupAudio(prepare, queue.options);
    queue.run();
    await done;
    assert.equal(queue.cleared, 1);
  }
});
