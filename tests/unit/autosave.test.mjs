import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutosave } from '../../src/ui/session/autosave.js';
import { createCampaignStore, SAVE } from '../../src/ui/session/campaign-store.js';
import { bindPageLifecycle } from '../../src/ui/input/browser-events.js';

function clock() {
  let time = 0,
    next = 0;
  const timers = new Map(),
    idle = new Map(),
    captured = [];
  const schedule = (callback, delay) => {
    const id = ++next;
    timers.set(id, { callback, at: time + delay });
    captured.push(callback);
    return id;
  };
  return {
    now: () => time,
    schedule,
    unschedule: (id) => timers.delete(id),
    requestIdle(callback, options) {
      const id = ++next;
      idle.set(id, { callback, options });
      captured.push(callback);
      return id;
    },
    cancelIdle: (id) => idle.delete(id),
    advance(ms) {
      const end = time + ms;
      for (;;) {
        const due = [...timers]
          .filter(([, task]) => task.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        time = due[1].at;
        timers.delete(due[0]);
        due[1].callback();
      }
      time = end;
    },
    runIdle() {
      for (const [id, task] of [...idle]) {
        idle.delete(id);
        task.callback();
      }
    },
    get jobs() {
      return timers.size + idle.size;
    },
    get idleTimeout() {
      return [...idle.values()][0]?.options.timeout;
    },
    captured,
  };
}

function fixture({ idle = true, fail = false } = {}) {
  const scheduler = clock(),
    writes = [],
    notices = [],
    values = new Map();
  let state = { time: 0, orders: [] },
    epoch = 0,
    session = null,
    serializations = 0;
  const game = {
    save(current) {
      serializations++;
      return JSON.stringify(current);
    },
  };
  const store = createCampaignStore({
    storage: {
      setItem(key, raw) {
        if (fail) throw Error('quota');
        writes.push([key, raw]);
        values.set(key, raw);
      },
    },
    game,
    notify: (...args) => notices.push(args),
    reload: () => {},
  });
  const autosave = createAutosave({
    ...scheduler,
    requestIdle: idle ? scheduler.requestIdle : null,
    getState: () => state,
    getEpoch: () => epoch,
    getSession: () => session,
    isBlocked: () => store.replacing,
    persist: (current) => store.persist(current),
  });
  return {
    scheduler,
    autosave,
    store,
    writes,
    notices,
    values,
    get state() {
      return state;
    },
    set state(value) {
      state = value;
    },
    get epoch() {
      return epoch;
    },
    set epoch(value) {
      epoch = value;
    },
    get session() {
      return session;
    },
    set session(value) {
      session = value;
    },
    get serializations() {
      return serializations;
    },
  };
}

test('100 command requests never serialize in input and one idle save reads latest state', () => {
  const f = fixture();
  for (let i = 0; i < 100; i++) {
    f.state.orders.push(i);
    f.autosave.request();
    assert.equal(f.serializations, 0);
    assert.ok(f.scheduler.jobs <= 2);
  }
  f.scheduler.advance(200);
  assert.equal(f.serializations, 0);
  assert.equal(f.scheduler.idleTimeout, 1300);
  f.state.time = 42;
  f.scheduler.runIdle();
  assert.equal(f.serializations, 1);
  assert.deepEqual(JSON.parse(f.values.get(SAVE)), {
    time: 42,
    orders: Array.from({ length: 100 }, (_, i) => i),
  });
  assert.equal(f.autosave.pending, false);
  assert.equal(f.scheduler.jobs, 0);
});

test('continuous commands cannot postpone the first save beyond 1500ms', () => {
  const f = fixture();
  f.autosave.request();
  for (let i = 1; i <= 14; i++) {
    f.scheduler.advance(100);
    f.state.time = i;
    f.autosave.request();
    assert.equal(f.serializations, 0);
    assert.ok(f.scheduler.jobs <= 2);
  }
  f.scheduler.advance(100);
  assert.equal(f.serializations, 1);
  assert.equal(JSON.parse(f.values.get(SAVE)).time, 14);
  assert.equal(f.scheduler.jobs, 0);
});

test('without requestIdleCallback save still runs in a later scheduled task', () => {
  const f = fixture({ idle: false });
  f.autosave.request();
  assert.equal(f.serializations, 0);
  f.scheduler.advance(199);
  assert.equal(f.serializations, 0);
  f.scheduler.advance(1);
  assert.equal(f.serializations, 1);
});

test('manual flush saves latest state synchronously, including without pending input', () => {
  const f = fixture();
  f.autosave.request();
  f.scheduler.advance(200);
  const obsolete = [...f.scheduler.captured];
  f.state.time = 9;
  assert.equal(f.autosave.flush(), true);
  assert.equal(f.serializations, 1);
  assert.equal(JSON.parse(f.values.get(SAVE)).time, 9);
  obsolete.forEach((callback) => callback());
  assert.equal(f.serializations, 1);
  f.state.time = 11;
  f.autosave.flush();
  assert.equal(JSON.parse(f.values.get(SAVE)).time, 11);
  assert.equal(f.scheduler.jobs, 0);
});

test('cancelled old timer and idle callbacks cannot clear or write a newer pending campaign', () => {
  const f = fixture();
  f.autosave.request();
  f.scheduler.advance(200);
  const obsolete = [...f.scheduler.captured];
  f.autosave.cancel();
  f.epoch++;
  f.state = { time: 88, orders: [1] };
  f.autosave.request();
  obsolete.forEach((callback) => callback());
  assert.equal(f.serializations, 0);
  assert.equal(f.autosave.pending, true);
  assert.equal(f.scheduler.jobs, 2);
  f.scheduler.advance(200);
  f.scheduler.runIdle();
  assert.equal(f.serializations, 1);
  assert.equal(JSON.parse(f.values.get(SAVE)).time, 88);
});

for (const changed of ['state', 'epoch', 'session']) {
  test(`changing ${changed} invalidates pending persistence without requiring a cancel hook`, () => {
    const f = fixture();
    f.autosave.request();
    f.scheduler.advance(200);
    if (changed === 'state') f.state = { time: 4, orders: [] };
    else if (changed === 'epoch') f.epoch++;
    else f.session = { id: 'network' };
    f.scheduler.runIdle();
    f.scheduler.advance(2000);
    assert.equal(f.serializations, 0);
    assert.equal(f.scheduler.jobs, 0);
  });
}

test('actual lifecycle binder flushes on hidden/unload and skips network snapshots', () => {
  const f = fixture(),
    document = target(),
    window = target();
  let started = true;
  const dispose = bindPageLifecycle({
    document,
    window,
    resetAccumulator() {},
    focusAudio() {},
    hasStarted: () => started,
    persist: () => f.autosave.flush(),
  });
  f.autosave.request();
  f.state.time = 12;
  document.hidden = true;
  document.emit('visibilitychange');
  assert.equal(JSON.parse(f.values.get(SAVE)).time, 12);
  f.state.time = 13;
  window.emit('beforeunload');
  assert.equal(JSON.parse(f.values.get(SAVE)).time, 13);
  f.session = { id: 'network' };
  f.state = { time: 99, orders: [] };
  f.autosave.request();
  document.emit('visibilitychange');
  window.emit('beforeunload');
  assert.equal(f.serializations, 2);
  f.session = null;
  started = false;
  window.emit('beforeunload');
  assert.equal(f.serializations, 2);
  dispose();
  assert.equal(document.listeners.size + window.listeners.size, 0);
});

test('atomic replacement preserves new save against cancelled callbacks and later lifecycle flush', () => {
  const f = fixture();
  f.autosave.request();
  f.scheduler.advance(200);
  const obsolete = [...f.scheduler.captured],
    current = f.state,
    next = { time: 0, orders: [] };
  f.store.replace(next, current, false, () => f.autosave.cancel());
  assert.equal(f.values.get(SAVE + '-backup'), JSON.stringify(current));
  obsolete.forEach((callback) => callback());
  assert.equal(f.autosave.flush(), false);
  assert.equal(f.values.get(SAVE), JSON.stringify(next));
  assert.equal(f.serializations, 2);
});

test('network entry flushes outgoing solo once and returning session starts an independent request', () => {
  const f = fixture();
  f.autosave.request();
  f.state.time = 3;
  f.autosave.flush();
  f.epoch++;
  f.session = { id: 'network' };
  f.state = { time: 20, orders: [] };
  f.autosave.request();
  f.autosave.flush();
  f.scheduler.advance(3000);
  assert.equal(f.serializations, 1);
  assert.equal(JSON.parse(f.values.get(SAVE)).time, 3);
  f.autosave.cancel();
  f.epoch++;
  f.session = null;
  f.state = { time: 4, orders: [] };
  f.autosave.request();
  f.scheduler.advance(200);
  f.scheduler.runIdle();
  assert.equal(f.serializations, 2);
  assert.equal(JSON.parse(f.values.get(SAVE)).time, 4);
});

test('storage failure retains existing notification and one attempt per coalesced batch', () => {
  const f = fixture({ fail: true });
  for (let i = 0; i < 100; i++) f.autosave.request();
  f.scheduler.advance(200);
  f.scheduler.runIdle();
  f.scheduler.captured.forEach((callback) => callback());
  assert.equal(f.serializations, 1);
  assert.equal(f.notices.length, 1);
  assert.equal(f.notices[0][1], true);
  assert.equal(f.autosave.pending, false);
});

function target() {
  const listeners = new Map();
  return {
    listeners,
    hidden: false,
    addEventListener: (event, handler) => listeners.set(event, handler),
    removeEventListener: (event, handler) => {
      if (listeners.get(event) === handler) listeners.delete(event);
    },
    emit: (event) => listeners.get(event)?.(),
  };
}
