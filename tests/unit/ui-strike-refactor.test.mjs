import test from 'node:test';
import assert from 'node:assert/strict';
import { createStrikeController } from '../../src/ui/controllers/strike-controller.js';

function fixture() {
  const calls = [],
    elements = new Map();
  let revision = 0,
    epoch = 0,
    localStock = 2,
    started = true,
    supplyReply = Promise.resolve(true),
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
        heavy: { name: 'Heavy', blast: 25, speed: 80, tech: 'heavy' },
        cruise: { name: 'Cruise', blast: 40, speed: 100 },
      },
      MAP: { width: 1728, depth: 1152 },
      COMBAT: { queueLimit: 12 },
      BUILDINGS: { launcher: { name: 'Drone launcher' }, silo: { name: 'Missile silo' } },
      launchSites: (s, side, key) =>
        s.buildings.filter(
          (b) =>
            b.side === side &&
            (['ballistic', 'cruise'].includes(key) ? b.key === 'silo' : b.key === 'launcher'),
        ),
      availableLaunchStock: () => localStock,
      weaponStock: () => 10,
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
    getEpoch: () => epoch,
    execute: (...args) => {
      calls.push(['execute', ...args]);
      return args[0] === 'launch-supply' ? supplyReply : reply;
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
    elements,
    setRevision: (value) => (revision = value),
    setEpoch: (value) => (epoch = value),
    setStock: (value) => (localStock = value),
    setStarted: (value) => (started = value),
    setReply: (value) => (reply = value),
    setSupplyReply: (value) => (supplyReply = value),
    setState: (value) => (state = value),
  };
}

test('arming an empty compatible rack requests bounded physical supply without launching or duplicating pending demand', async () => {
  const f = fixture();
  f.setStock(0);
  let resolve;
  f.setSupplyReply(new Promise((done) => (resolve = done)));
  f.controller.armStrike('drone');
  await f.controller.requestSupply();
  assert.deepEqual(
    f.calls.filter((c) => c[0] === 'execute'),
    [['execute', 'launch-supply', { id: 7, key: 'drone', count: 1 }]],
  );
  f.setEpoch(1);
  resolve(true);
  await Promise.resolve();
  assert.ok(!f.calls.includes('persist'), 'late supply reply cannot write the next campaign');
  assert.ok(!f.calls.some((c) => c[0] === 'execute' && c[1] === 'launch'));
});

test('switching to an already stocked weapon replaces stale supply preferences without autoattack', async () => {
  const f = fixture();
  f.setState({
    buildings: [{ id: 7, key: 'silo', side: 0, hp: 10, progress: 1 }],
    sides: [{ inventory: { ballistic: 0, cruise: 4 } }],
  });
  f.setStock(0);
  f.controller.armStrike('ballistic');
  await Promise.resolve();
  f.setStock(4);
  f.controller.armStrike('cruise');
  await Promise.resolve();
  assert.deepEqual(
    f.calls.filter((c) => c[0] === 'execute'),
    [
      ['execute', 'launch-supply', { id: 7, key: 'ballistic', count: 1 }],
      ['execute', 'launch-supply', { id: 7, key: 'cruise', count: 1 }],
    ],
  );
});

test('changing weapon removes incompatible selected sites and shows local stock separately', () => {
  const f = fixture();
  f.setState({
    buildings: [
      { id: 7, key: 'launcher', side: 0, hp: 10, progress: 1 },
      { id: 9, key: 'silo', side: 0, hp: 10, progress: 1 },
    ],
    sides: [{ inventory: { drone: 100, ballistic: 100 } }],
  });
  f.controller.model.launcherId = 7;
  f.controller.armStrike('ballistic');
  assert.equal(f.controller.model.launcherId, null);
  const select = f.elements.get('#strike-site');
  assert.match(select.innerHTML, /value="9"/);
  assert.doesNotMatch(select.innerHTML, /value="7"/);
  assert.equal(f.elements.get('#strike-stock').textContent, 'На площадке: 2 · всего 10');
});

test('strike model is local and all weapons arm without a technology prerequisite', () => {
  const f = fixture();
  f.controller.armStrike('heavy');
  assert.ok(!f.calls.some((c) => Array.isArray(c) && c[0] === 'panel'));
  assert.equal(f.controller.model.aiming, true);
  assert.equal(f.controller.model.weapon, 'heavy');
  assert.ok(f.calls.some((c) => c[0] === 'focus' && c[1] === 615));
  f.calls.length = 0;
  f.controller.armStrike('drone');
  assert.equal(f.controller.model.aiming, true);
  assert.equal(f.controller.model.weapon, 'drone');
  const second = fixture();
  assert.equal(second.controller.model.aiming, false);
});

test('strike routes keep original map/ten-point limits and ballistic launches discard waypoints', async () => {
  const f = fixture(),
    strike = f.controller;
  strike.armStrike();
  await Promise.resolve();
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
  const launch = f.calls.find((c) => c[0] === 'execute' && c[1] === 'launch');
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
  await Promise.resolve();
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

test('reopening aiming controls never changes the physical supply preference', async () => {
  const f = fixture();
  f.controller.actions.aim();
  await Promise.resolve();
  f.controller.actions.launch();
  await Promise.resolve();
  f.controller.updateStrikeHUD();
  assert.equal(f.calls.filter((c) => c[0] === 'execute').length, 0);
  f.controller.armStrike('drone');
  await Promise.resolve();
  assert.deepEqual(
    f.calls.filter((c) => c[0] === 'execute'),
    [['execute', 'launch-supply', { id: 7, key: 'drone', count: 1 }]],
  );
});
