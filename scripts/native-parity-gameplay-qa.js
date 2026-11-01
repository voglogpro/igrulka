/* global skyfront */
// Browser-side integration scenario for the trusted Native host-eval channel.
// Uses the real original UI, commands and E.step on its live paused state.
// No resource grants, direct state edits, spawned fixtures, import or reload.
(async () => {
  const checks = [];
  const limitations = [
    'Uses DOM events and original callbacks/commands; physical OS mouse input is not exercised.',
    'Simulation advances with original E.step while paused; this is not a real-time FPS benchmark.',
    'No import/reload, long combat, vehicle boarding, multiplayer or audible audio acceptance in this scenario.',
  ];
  const post = (value) => window.chrome.webview.postMessage(value);
  const delay = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
  const query = (selector) => document.querySelector(selector);
  function check(name, value, detail = null) {
    checks.push({ name, passed: !!value, ...(detail == null ? {} : { detail }) });
    if (!value) throw Error(name + (detail == null ? '' : ': ' + JSON.stringify(detail)));
  }
  async function until(predicate, label, timeout = 30000) {
    const deadline = performance.now() + timeout;
    while (!predicate()) {
      if (performance.now() > deadline) throw Error('Timed out: ' + label);
      await delay(25);
    }
  }
  async function click(selector) {
    const button = query(selector);
    if (!button || button.disabled) throw Error('Unavailable original control: ' + selector);
    button.click();
    await delay(20);
    return button;
  }
  function change(selector, value, type = 'change') {
    const input = query(selector);
    if (!input) throw Error('Missing original field: ' + selector);
    input.value = String(value);
    input.dispatchEvent(new Event(type, { bubbles: true }));
  }
  let api, world, state, engine, renderer;
  const resources = () =>
    state
      ? Object.fromEntries(
          ['credits', 'materials', 'oil', 'components'].map((key) => [
            key,
            state.sides[0][key] || 0,
          ]),
        )
      : null;
  const ownUnits = () => state.groundUnits.filter((unit) => unit.side === 0 && unit.hp > 0);
  function key(code, modifiers = {}) {
    const canvas = renderer.domElement;
    canvas.focus();
    canvas.dispatchEvent(
      new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true, ...modifiers }),
    );
    canvas.dispatchEvent(
      new KeyboardEvent('keyup', { code, bubbles: true, cancelable: true, ...modifiers }),
    );
  }
  async function command(type, args = {}) {
    const result = await api.command(type, args);
    // Original commands have individual success contracts (including void/zero).
    // Reject only their explicit error forms; each operation checks its effects below.
    if (typeof result === 'string' || result === false) throw Error(type + ': ' + String(result));
    return result;
  }
  let sawCargo = false,
    sawPaidQueue = false;
  async function advanceUntil(predicate, label, maxTime = 130) {
    let steps = 0;
    while (!predicate()) {
      if (!api.isPaused() || api.network())
        throw Error('QA simulation must remain local and paused');
      if (state.time >= maxTime || state.result)
        throw Error(label + ': ordinary scenario ended before readiness');
      engine.step(state, 0.05);
      sawCargo ||= state.ammoVehicles.some(
        (vehicle) =>
          vehicle.side === 0 &&
          vehicle.hp > 0 &&
          vehicle.cargo?.kind === 'weapon' &&
          vehicle.cargo.key === 'drone' &&
          vehicle.cargo.amount > 0,
      );
      sawPaidQueue ||= state.buildings.some(
        (building) =>
          building.side === 0 &&
          building.key === 'factory' &&
          building.queue?.some((item) => item.key === 'drone'),
      );
      if (++steps % 20 === 0) await delay();
    }
    world.sync();
    await delay(30);
  }
  try {
    await until(
      () =>
        window.skyfront &&
        query('#welcome [data-action="start"]') &&
        !query('#welcome [data-action="start"]').disabled,
      'original app and native startup readiness',
      60000,
    );
    api = skyfront;
    world = api.getWorld();
    state = world.state;
    engine = api.engine;
    renderer = world.renderer;
    check(
      'native Godot renderer is attached',
      renderer.domElement.dataset.renderer === 'godot' &&
        typeof renderer.present === 'function' &&
        renderer.transport?.ready === true,
    );
    check(
      'renderer has no actual WebGL context',
      renderer.getContext().isContextLost() === false &&
        typeof renderer.getContext().getExtension !== 'function',
    );
    check(
      'original welcome modes present',
      ['solo', 'siege'].every((mode) => query(`[data-welcome-mode="${mode}"]`)) &&
        !!query('#welcome [data-action="network"]'),
    );
    check(
      'all original difficulties present',
      Object.keys(engine.DIFFICULTY).every((name) => query(`[data-difficulty="${name}"]`)),
    );
    check(
      'fresh normal-budget QA campaign',
      (state.mode == null || state.mode === 'solo') &&
        state.sides.length === 2 &&
        state.time === 0 &&
        state.sides[0].credits === 3200 &&
        !api.network(),
      {
        mode: state.mode,
        sides: state.sides.length,
        time: state.time,
        credits: state.sides[0].credits,
      },
    );
    await click('[data-difficulty="normal"]');
    query('#welcome [data-action="start"]').click();
    if (!api.isPaused()) query('#pause').click();
    check(
      'real start and pause controls work',
      query('#welcome').hidden && api.isPaused() && !query('#paused').hidden,
    );
    check('normal difficulty chosen through original UI', state.difficulty === 'normal');
    key('KeyE');
    check(
      'E opens original arsenal',
      !query('#panel').hidden && !!query('#factory-order-count') && !!query('#launch-site'),
    );
    key('Escape');
    check('Escape closes original panel', query('#panel').hidden);
    key('KeyF');
    check(
      'F opens original army controls',
      !query('#panel').hidden && !!query('.army-recruit') && !!query('#rear-auto'),
    );
    check(
      'original army categories present',
      ['infantry', 'vehicles', 'artillery', 'rear', 'defense'].every((category) =>
        query(`[data-army-category="${category}"]`),
      ),
    );
    key('Escape');
    await click('[data-panel="settings"]');
    check(
      'original settings actions present',
      ['save', 'export', 'import', 'new-confirm', 'network'].every((action) =>
        query(`#panel [data-action="${action}"]`),
      ) &&
        !!query('#volume') &&
        !!query('#shake'),
    );
    change('#volume', 0, 'input');
    change('#shake', 0, 'input');
    check('QA sound muted by original setting', api.getAudio().enabled === false);
    await click('#panel [data-action="close-panel"]');
    api.chooseBuild('housing');
    const rotation = world.rotation,
      yaw = world.controls.yaw;
    key('KeyR');
    check(
      'R rotates original build tool',
      Math.abs(world.rotation - rotation - Math.PI / 4) < 1e-6 && world.controls.yaw === yaw,
    );
    key('Escape');
    check('Escape cancels building tool', world.buildKey == null);
    key('KeyQ');
    check('unselected Q does not rotate camera', world.controls.yaw === yaw);
    const beforePan = world.controls.desired.clone();
    renderer.domElement.focus();
    renderer.domElement.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true, cancelable: true }),
    );
    await delay(180);
    renderer.domElement.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', bubbles: true }));
    check('original WASD camera pan works', world.controls.desired.distanceTo(beforePan) > 0.05);
    const hq = state.buildings.find((building) => building.side === 0 && building.key === 'hq');
    const enemy = state.buildings.find((building) => building.side === 1 && building.key === 'hq');
    world.focus(hq.x, hq.z, 540);
    const start = { x: hq.x + 90, z: hq.z - 45 },
      end = { x: hq.x + 360, z: hq.z - 45 };
    check(
      'source road plan is valid',
      !engine.roadPreview(state, 0, start.x, start.z, end.x, end.z).error,
    );
    const roadBudget = state.sides[0].credits;
    check('original road callback accepted', await world.callbacks.onRoad(start, end));
    check('road was normally paid', state.sides[0].credits < roadBudget);
    const buildings = [];
    for (const [name, dx, dz] of [
      ['power', -65, -10],
      ['housing', -65, -80],
      ['industry', -5, -80],
      ['factory', 65, -10],
      ['electronics', 65, -80],
      ['launcher', 125, -10],
      ['housing', 125, -80],
      ['barracks', 185, -10],
      ['ammofactory', 185, -80],
    ]) {
      const x = hq.x + dx,
        z = hq.z + dz;
      const plan = engine.placementPlan(state, 0, name, x, z);
      if (plan.error) throw Error(name + ': ' + plan.error);
      const before = state.sides[0].credits;
      const ids = new Set(state.buildings.map((building) => building.id));
      await world.callbacks.onBuild(name, x, z, 0);
      const building = state.buildings.find(
        (item) => item.side === 0 && item.key === name && !ids.has(item.id),
      );
      if (!building || state.sides[0].credits >= before)
        throw Error('Paid original building callback failed: ' + name);
      buildings.push(building);
    }
    check(
      'nine original buildings paid and placed',
      buildings.length === 9 && state.sides[0].credits >= 0,
    );
    await advanceUntil(
      () => buildings.every((building) => building.progress >= 1) && state.sides[0].components >= 1,
      'construction/electronics',
    );
    check(
      'original economy is connected',
      engine.economy(state, 0).supply > 0.9 &&
        buildings.every((building) => engine.supplyFactor(state, building) > 0),
    );
    key('KeyF');
    await until(() => !!query('[data-recruit="infantry"]'), 'source infantry card');
    await click('[data-recruit-mode="point"]');
    await click('[data-recruit-count="1"]');
    const deploy = { x: hq.x + 250, z: hq.z + 100 };
    check(
      'original deployment plan accepted',
      engine.deploymentPlan(state, 0, 'infantry', deploy, 1).ok,
    );
    await click('[data-recruit="infantry"]');
    check('recruit card enters original point targeting', api.getOrder().troopMode === 'deploy');
    world.callbacks.onGroundHover(deploy);
    const recruitMoney = state.sides[0].credits;
    await world.callbacks.onGroundTarget(deploy);
    const roster = engine
      .squadRoster(state, 0)
      .find((squad) => squad.key === 'infantry' && squad.queued === 1);
    check(
      'paid deploy preserves source squad and queued destination',
      !!roster &&
        Math.abs(recruitMoney - state.sides[0].credits - engine.GROUND_UNITS.infantry.cost) < 1e-6,
    );
    key('Escape');
    await command('recruit', { key: 'operator', count: 1 });
    key('KeyF');
    change('[data-army-target="machinegunner"]', 1);
    await until(
      () => engine.armyCompositionStatus(state, 0).targets.machinegunner === 1,
      'source garrison target',
    );
    check(
      'original garrison reserves unchanged',
      engine.armyCompositionStatus(state, 0).reserves.credits === 250 &&
        engine.armyCompositionStatus(state, 0).reserves.materials === 5,
    );
    key('Escape');
    key('KeyE');
    change('#factory-order-count', 1, 'input');
    const orderBudget = state.sides[0].credits;
    await click('[data-produce="drone"]');
    check(
      'original finite production order accepted',
      engine.factoryOrderStatus(state, 0, null, 'drone').unpaid === 1 &&
        state.sides[0].credits === orderBudget,
    );
    check(
      'original factory plan and reserve fields present',
      !!query('#factory-plan-credits') &&
        !!query('#factory-plan-materials') &&
        !!query('#factory-plan-save'),
    );
    key('Escape');
    api.armStrike('drone');
    const launcher = buildings.find((building) => building.key === 'launcher');
    await until(
      () => !!query(`#strike-site option[value="${launcher.id}"]`),
      'physical launch site UI',
    );
    change('#strike-site', launcher.id);
    await advanceUntil(
      () =>
        (launcher.launchStore?.drone || 0) >= 1 &&
        ownUnits().some((unit) => unit.key === 'infantry') &&
        ownUnits().some((unit) => unit.key === 'operator') &&
        ownUnits().some((unit) => unit.key === 'machinegunner'),
      'paid soldiers and physical drone delivery',
    );
    check('paid production and actual weapon cargo observed', sawPaidQueue && sawCargo);
    check(
      'source squad metadata survived paid recruitment',
      engine
        .squadRoster(state, 0)
        .some((squad) => squad.id === roster.id && squad.ids.length === 1),
    );
    const waypoint = { x: hq.x + 700, z: hq.z + 250 };
    await world.callbacks.onAimPoint(waypoint, { shift: true });
    check('original route waypoint added', api.getOrder().waypoints.length === 1);
    key('Backspace');
    check('original Backspace removes waypoint', api.getOrder().waypoints.length === 0);
    await world.callbacks.onAimPoint(waypoint, { shift: true });
    await click('#route-toggle');
    check('original route editing enabled', api.getOrder().routeEditing);
    key('Enter');
    check('original Enter completes route editing', !api.getOrder().routeEditing);
    const localStock = launcher.launchStore.drone;
    await world.callbacks.onAimPoint({ x: enemy.x, z: enemy.z });
    check(
      'real launch consumes local physical stock',
      launcher.launchStore.drone === localStock - 1,
    );
    await advanceUntil(
      () =>
        state.units.some(
          (unit) =>
            unit.side === 0 &&
            unit.key === 'drone' &&
            unit.sourceId === launcher.id &&
            unit.launched,
        ),
      'original drone takeoff',
    );
    key('Escape');
    check(
      'Escape cancels targeting without removing launched drone',
      !world.aiming &&
        state.units.some(
          (unit) => unit.side === 0 && unit.sourceId === launcher.id && unit.launched,
        ),
    );
    const operator = ownUnits().find((unit) => unit.key === 'operator');
    api.selectArmy([operator.id]);
    const operatorYaw = world.controls.yaw;
    key('KeyQ');
    check(
      'selected Q enters original FPV targeting',
      api.getOrder().troopMode === 'fpv' && world.controls.yaw === operatorYaw,
    );
    key('Escape');
    const ids = ownUnits().map((unit) => unit.id);
    world.callbacks.onBoxSelect(ids);
    check(
      'original army selection preserved',
      api.getOrder().armySelection.length === ids.length && ids.length >= 3,
    );
    key('Digit1', { ctrlKey: true });
    await until(
      () => engine.getGroup(state, 0, 1).length === ids.length,
      'source control group save',
    );
    key('Escape');
    key('Digit1');
    check(
      'original group recall keyboard works',
      api.getOrder().armySelection.length === ids.length,
    );
    await world.callbacks.onGroundOrder({ x: hq.x + 280, z: hq.z + 140 });
    check(
      'source selected troops received real move order',
      ownUnits().every((unit) => unit.order),
    );
    key('KeyL');
    check('original L enters line-defense targeting', api.getOrder().troopMode === 'defendline');
    await world.callbacks.onGroundLine(
      { x: hq.x + 280, z: hq.z + 80 },
      { x: hq.x + 280, z: hq.z + 240 },
    );
    const guards = ownUnits().filter((unit) => unit.guard);
    check(
      'source line-defense assigns distinct real posts',
      guards.length >= 2 && new Set(guards.map((unit) => Math.round(unit.guard.z))).size >= 2,
    );
    const dig = await command('stance', { ids, command: 'dig' });
    check('source dig command accepted', typeof dig === 'number' && dig > 0);
    const damaged = [...state.buildings, ...state.roads].find(
      (object) =>
        object.side === 0 &&
        object.hp > 0 &&
        object.hp < object.maxHp &&
        object.progress >= 1 &&
        !object.repairing,
    );
    if (damaged && state.sides[0].credits >= Math.ceil((damaged.maxHp - damaged.hp) * 0.55)) {
      const beforeRepair = state.sides[0].credits;
      await command('repair', { id: damaged.id });
      check(
        'normally damaged own object repaired through source command',
        damaged.repairing && state.sides[0].credits < beforeRepair,
      );
    } else
      limitations.push(
        'No eligible natural own damage occurred; repair was not manufactured or marked tested.',
      );
    api.save();
    const raw = localStorage.getItem('skyfront-realtime-v3');
    const saved = JSON.parse(raw);
    check(
      'original source save persisted actual state',
      saved.time === state.time &&
        saved.rng === state.rng &&
        saved.sides[0].credits === state.sides[0].credits &&
        saved.groundUnits.filter((unit) => unit.side === 0).length === ownUnits().length &&
        saved.units.some((unit) => unit.sourceId === launcher.id && unit.launched),
    );
    const seq = renderer._seq;
    world.sync();
    renderer.render(world.scene, world.camera);
    await until(() => renderer._seq > seq, 'post-gameplay native scene submission');
    const pending = renderer._pending;
    const ack = pending
      ? await Promise.race([
          pending,
          delay(30000).then(() => {
            throw Error('Native gameplay scene ACK timed out');
          }),
        ])
      : null;
    check(
      'native scene accepted after original gameplay',
      !renderer.transport.failed && !window.__SKYFRONT_NATIVE_FAILED__ && renderer._seq > seq,
    );
    post({
      kind: 'qa-result',
      stage: 'complete',
      passed: true,
      checks,
      resources: resources(),
      gameTime: state.time,
      buildings: buildings.length,
      ownUnits: ownUnits().map((unit) => ({ id: unit.id, key: unit.key })),
      physicalDrone: true,
      limitations,
      diagnostics: api.diagnostics(),
      rendererStats: {
        constructor: renderer.constructor.name,
        dataset: renderer.domElement.dataset.renderer,
        seq: renderer._seq,
        acknowledgedSequence: ack?.seq ?? null,
        calls: renderer.info.render.calls,
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
      },
    });
  } catch (error) {
    post({
      kind: 'qa-result',
      stage: 'complete',
      passed: false,
      checks,
      resources: resources(),
      error: String(error?.stack || error),
      limitations,
      diagnostics: api?.diagnostics?.(),
      rendererStats: renderer
        ? {
            constructor: renderer.constructor.name,
            seq: renderer._seq,
            calls: renderer.info.render.calls,
          }
        : null,
    });
  }
})();
