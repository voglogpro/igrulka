import test from 'node:test';
import assert from 'node:assert/strict';
import { createStrikeController } from '../../src/ui/controllers/strike-controller.js';

function fixture() {
  const calls = [],
    elements = new Map();
  let revision = 0,
    started = true,
    reply = Promise.resolve(2);
  const query = (key) => {
    if (!elements.has(key))
      elements.set(key, {
        dataset: {},
        classList: { add() {}, toggle() {} },
        querySelector: query,
      });
    return elements.get(key);
  };
  let state = {
    buildings: [{ id: 7, key: 'launcher', side: 0, hp: 10, x: 0, z: 0, progress: 1 }],
    sides: [{ inventory: { drone: 10, ballistic: 2 }, tech: [] }],
  };
  const controller = createStrikeController({
    game: {
      WEAPONS: {
        drone: { name: 'Drone', blast: 10, speed: 100 },
        ballistic: { name: 'Ballistic', blast: 50, speed: 100 },
        heavy: { tech: 'heavy' },
      },
      MAP: { width: 1728, depth: 1152 },
      COMBAT: { queueLimit: 12 },
      queuedLaunches: () => 0,
      selectedLaunchSite: () => ({ id: 7 }),
      launchStatus: () => null,
      flightRoute: () => [{ d: 100 }],
    },
    getState: () => state,
    getWorld: () => ({
      setOrderPreview: (value) => calls.push(['preview', value]),
      setAiming: (value) => calls.push(['aiming', value]),
      focus: (...args) => calls.push(['focus', ...args]),
    }),
    getStarted: () => started,
    getRevision: () => revision,
    execute: (...args) => {
      calls.push(['execute', ...args]);
      return reply;
    },
    interaction: {
      clearTroopTarget: () => calls.push('clear-target'),
      clearArmySelection: () => calls.push('clear-army'),
      openPanel: (...args) => calls.push(['panel', ...args]),
      getBuildTool: () => null,
      chooseBuild() {},
      clearInspection: () => calls.push('clear-inspector'),
    },
    home: () => ({ x: 615, z: 0 }),
    persist: () => calls.push('persist'),
    updateHUD: () => calls.push('hud'),
    toast: (...args) => calls.push(['toast', ...args]),
    document: { querySelectorAll: () => [] },
    query,
  });
  return {
    controller,
    calls,
    setRevision: (value) => (revision = value),
    setStarted: (value) => (started = value),
    setReply: (value) => (reply = value),
    setState: (value) => (state = value),
  };
}

test('strike model belongs to controller; locked weapons open research without arming', () => {
  const f = fixture();
  f.controller.armStrike('heavy');
  assert.deepEqual(f.calls, ['clear-target', 'clear-army', ['panel', 'research', true]]);
  assert.equal(f.controller.model.aiming, false);
  f.calls.length = 0;
  f.controller.armStrike('drone');
  assert.equal(f.controller.model.aiming, true);
  assert.ok(f.calls.some((c) => c[0] === 'focus' && c[1] === 615));
  const second = fixture();
  assert.equal(second.controller.model.aiming, false);
});

test('strike routes keep original map/ten-point limits and ballistic launches discard waypoints', async () => {
  const f = fixture(),
    strike = f.controller;
  strike.armStrike();
  f.calls.length = 0;
  strike.model.routeEditing = true;
  await strike.chooseAimPoint({ x: 10, z: 20 });
  assert.deepEqual(strike.model.waypoints, [{ x: 10, z: 20 }]);
  assert.ok(!f.calls.some((c) => c[0] === 'execute'));
  await strike.chooseAimPoint({ x: 9999, z: 20 });
  assert.equal(strike.model.waypoints.length, 1);
  strike.model.waypoints = Array.from({ length: 10 }, () => ({ x: 0, z: 0 }));
  await strike.chooseAimPoint({ x: 20, z: 20 });
  assert.equal(strike.model.waypoints.length, 10);
  strike.armStrike('ballistic');
  assert.equal(strike.model.routeEditing, false);
  await strike.chooseAimPoint({ x: 100, z: 200 }, { shift: true });
  const launch = f.calls.find((c) => c[0] === 'execute');
  assert.deepEqual(launch, [
    'execute',
    'launch',
    { key: 'ballistic', aim: { x: 100, z: 200, waypoints: [] }, count: 1, siteId: null },
  ]);
});

test('late launch replies cannot repaint a newer interaction; unlocked route edits use current state', async () => {
  const f = fixture(),
    strike = f.controller;
  strike.armStrike();
  f.calls.length = 0;
  let resolve;
  f.setReply(new Promise((done) => (resolve = done)));
  const launch = strike.chooseAimPoint({ x: 200, z: 100 });
  f.setRevision(1);
  resolve(2);
  await launch;
  assert.deepEqual(
    f.calls.map((c) => c[0]),
    ['execute'],
  );
  f.setStarted(false);
  f.calls.length = 0;
  await strike.chooseAimPoint({ x: 20, z: 20 });
  assert.deepEqual(f.calls, []);
});
