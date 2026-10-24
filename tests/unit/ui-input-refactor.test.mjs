import test from 'node:test';
import assert from 'node:assert/strict';
import { createKeyboardController, bindKeyboard } from '../../src/ui/input/keyboard.js';
import {
  bindPointerActivity,
  bindMinimap,
  bindPageLifecycle,
} from '../../src/ui/input/browser-events.js';
import { createArmyNavigation } from '../../src/ui/controllers/army-navigation.js';

function hub() {
  const listeners = [];
  return {
    listeners,
    addEventListener: (type, fn, capture = false) => listeners.push({ type, fn, capture }),
    removeEventListener(type, fn, capture = false) {
      const i = listeners.findIndex((x) => x.type === type && x.fn === fn && x.capture === capture);
      if (i >= 0) listeners.splice(i, 1);
    },
    emit(type, event = {}) {
      for (const item of [...listeners]
        .filter((x) => x.type === type)
        .sort((a, b) => Number(b.capture) - Number(a.capture))) {
        item.fn(event);
        if (event.stopped) break;
      }
    },
  };
}
function key(code, fields = {}) {
  return {
    code,
    repeat: false,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    target: { closest: () => null, matches: () => false },
    preventDefault() {
      this.prevented = true;
    },
    stopImmediatePropagation() {
      this.stopped = true;
    },
    ...fields,
  };
}
function keyboardFixture() {
  const calls = [],
    mode = {
      started: true,
      panel: null,
      lobbyOpen: false,
      tool: null,
      aiming: false,
      armySelection: [9],
      paused: false,
    };
  let time = 1000;
  const action =
    (name) =>
    (...args) =>
      calls.push([name, ...args]);
  const army = Object.fromEntries(
    [
      'clearArmySelection',
      'clearTroopTarget',
      'focusUnits',
      'selectArmy',
      'saveGroup',
      'cycleArmy',
      'nextIdleUnit',
      'troopCommand',
      'selectAll',
    ].map((name) => [name, action(name)]),
  );
  army.getGroup = (n) => (n === 1 ? [2, 9] : []);
  const controller = createKeyboardController({
    getMode: () => mode,
    army,
    tools: Object.fromEntries(
      ['cancelTool', 'clearInspection', 'pause', 'openPanel', 'chooseBuild'].map((name) => [
        name,
        action(name),
      ]),
    ),
    strike: Object.fromEntries(
      ['finishRoute', 'undoWaypoint', 'armStrike'].map((name) => [name, action(name)]),
    ),
    focusInput: action('focusInput'),
    now: () => time,
    createChangeEvent: () => ({ type: 'change', bubbles: true }),
  });
  return { calls, mode, controller, tick: (ms) => (time += ms) };
}

test('keyboard capture preserves group precedence, double tap focus and Ctrl+Shift union', () => {
  const f = keyboardFixture(),
    window = hub(),
    dispose = bindKeyboard(window, f.controller);
  const first = key('Digit1');
  window.emit('keydown', first);
  assert.equal(first.stopped, true);
  assert.deepEqual(f.calls, [['selectArmy', [2, 9], false]]);
  f.tick(200);
  window.emit('keydown', key('Digit1'));
  assert.deepEqual(f.calls.slice(-2), [
    ['focusUnits', [2, 9]],
    ['selectArmy', [2, 9], false],
  ]);
  window.emit('keydown', key('Digit1', { ctrlKey: true, shiftKey: true }));
  assert.deepEqual(f.calls.at(-1), ['saveGroup', 1, [2, 9]]);
  assert.ok(!f.calls.some((c) => c[0] === 'chooseBuild'));
  dispose();
  assert.equal(window.listeners.length, 0);
});

test('WASD pass through, form input suppresses shortcuts, and number Enter commits before camera focus', () => {
  const f = keyboardFixture();
  for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) {
    const event = key(code);
    f.controller.capture(event);
    f.controller.bubble(event);
    assert.equal(event.prevented, undefined);
  }
  assert.deepEqual(f.calls, []);
  const typing = key('KeyE', { target: { closest: () => ({}), matches: () => false } });
  f.controller.capture(typing);
  f.controller.bubble(typing);
  assert.deepEqual(f.calls, []);
  const target = {
    closest: () => ({}),
    matches: () => true,
    dispatchEvent: (event) => f.calls.push(['change', event.bubbles]),
  };
  f.controller.capture(key('Enter', { target }));
  assert.deepEqual(f.calls, [['change', true], ['focusInput']]);
  f.calls.length = 0;
  f.mode.panel = 'settings';
  f.controller.bubble(key('Space'));
  assert.deepEqual(f.calls, []);
  f.mode.panel = null;
  f.mode.lobbyOpen = true;
  f.controller.capture(key('Tab'));
  assert.deepEqual(f.calls, []);
});

test('Escape cancels tools/selection before focus even in editable controls; repeats do nothing', () => {
  const f = keyboardFixture();
  f.mode.aiming = true;
  const event = key('Escape', { target: { closest: () => ({}) } });
  f.controller.capture(event);
  assert.equal(event.stopped, true);
  assert.deepEqual(f.calls, [
    ['cancelTool'],
    ['clearArmySelection'],
    ['clearTroopTarget'],
    ['focusInput'],
  ]);
  f.calls.length = 0;
  f.controller.capture(key('Escape', { repeat: true }));
  f.controller.bubble(key('KeyE', { repeat: true }));
  assert.deepEqual(f.calls, []);
});

test('browser lifecycle releases pointer on blur, suspends audio and saves only started hidden campaigns', () => {
  const document = hub(),
    window = hub(),
    calls = [];
  let started = false;
  const disposePointer = bindPointerActivity({
    document,
    window,
    setBusy: (v) => calls.push(['busy', v]),
    unlockAudio: () => calls.push('unlock'),
  });
  const disposePage = bindPageLifecycle({
    document,
    window,
    resetAccumulator: () => calls.push('reset'),
    focusAudio: (v) => calls.push(['audio', v]),
    hasStarted: () => started,
    persist: () => calls.push('save'),
  });
  document.emit('pointerdown');
  window.emit('blur');
  assert.deepEqual(calls, [['busy', true], 'unlock', ['busy', false]]);
  calls.length = 0;
  document.hidden = true;
  document.emit('visibilitychange');
  assert.deepEqual(calls, ['reset', ['audio', false]]);
  started = true;
  document.emit('visibilitychange');
  window.emit('beforeunload');
  assert.equal(calls.filter((c) => c === 'save').length, 2);
  disposePointer();
  disposePage();
  assert.equal(document.listeners.length + window.listeners.length, 0);
});

test('minimap restores keyboard focus before converting click to unchanged world coordinates', () => {
  const minimap = hub(),
    calls = [];
  minimap.getBoundingClientRect = () => ({ left: 10, top: 20, width: 200, height: 100 });
  const dispose = bindMinimap(minimap, {
    focusInput: () => calls.push('focus'),
    focus: (x, z) => calls.push([x, z]),
    map: { width: 1728, depth: 1152 },
  });
  minimap.emit('click', { currentTarget: minimap, clientX: 160, clientY: 45 });
  assert.deepEqual(calls, ['focus', [432, -288]]);
  dispose();
  assert.equal(minimap.listeners.length, 0);
});

test('army navigation reads replacement state and excludes transported/civil units from squad cycling', () => {
  const calls = [];
  let state = {
    groundUnits: [
      { id: 1, side: 0, hp: 10, x: 10, z: 20 },
      { id: 2, side: 0, hp: 10, x: 30, z: 40 },
      { id: 3, side: 0, hp: 10, civil: true, x: 90, z: 90 },
      { id: 4, side: 0, hp: 10, carrierId: 8 },
    ],
  };
  const nav = createArmyNavigation({
    game: { squadRoster: () => [{ ids: [1, 2, 4] }] },
    getState: () => state,
    getSelection: () => [1],
    getWorld: () => ({ focus: (...args) => calls.push(args), controls: { zoomDistance: 500 } }),
    selectArmy: (ids) => calls.push(ids),
    toast: () => {},
  });
  assert.deepEqual(nav.armyStops(), [[1, 2]]);
  nav.cycleArmy(1);
  assert.deepEqual(calls, [
    [1, 2],
    [20, 30, 320],
  ]);
  state = { groundUnits: [{ id: 7, side: 0, hp: 5, x: 100, z: 200 }] };
  assert.deepEqual(nav.armyStops(), [[7]]);
});
