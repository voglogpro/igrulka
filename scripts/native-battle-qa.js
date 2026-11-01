// Synthetic500entity density; original unpaused combat for60wallseconds. No state ticking/buffs in this script.
(async () => {
  if (window.__SKYFRONT_BATTLE_QA_RUNNING__) return;
  window.__SKYFRONT_BATTLE_QA_RUNNING__ = true;
  const fixture = window.__SKYFRONT_BATTLE_FIXTURE__,
    KEY = 'skyfront-native-battle-density-v1';
  const post = (value) => window.chrome.webview.postMessage(value),
    query = (selector) => document.querySelector(selector);
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let record, api, world, originalReceive, transport, observer;
  function check(name, passed, detail) {
    record.checks.push({ name, passed: !!passed, ...(detail === undefined ? {} : { detail }) });
    sessionStorage.setItem(KEY, JSON.stringify(record));
    if (!passed) throw Error(name + (detail === undefined ? '' : ': ' + JSON.stringify(detail)));
  }
  async function until(predicate, label, timeout = 90000) {
    const deadline = performance.now() + timeout;
    while (!predicate()) {
      if (performance.now() > deadline) throw Error('Timed out: ' + label);
      await delay(40);
    }
  }
  const signature = (unit) =>
    Object.fromEntries(
      [
        'hp',
        'maxHp',
        'ammo',
        'ammoReserve',
        'groundAmmo',
        'groundReload',
        'reloadLeft',
        'fpvAmmo',
        'ammoCargo',
        'level',
      ]
        .filter((key) => unit[key] !== undefined)
        .map((key) => [key, unit[key]]),
    );
  try {
    if (!fixture?.raw || !fixture.syntheticDensityOnly)
      throw Error('Missing explicit synthetic-density fixture');
    record = JSON.parse(sessionStorage.getItem(KEY) || 'null') || {
      phase: 0,
      sha256: fixture.sha256,
      checks: [],
    };
    if (record.sha256 !== fixture.sha256) throw Error('Fixture changed across reload');
    await until(
      () =>
        window.skyfront &&
        query('#welcome [data-action="start"]') &&
        !query('#welcome [data-action="start"]').disabled,
      'original startup',
    );
    api = window.skyfront;
    world = api.getWorld();
    check(
      'phase' + record.phase + ': real native renderer ready',
      world.renderer.transport.ready &&
        world.renderer.domElement.dataset.renderer === 'godot' &&
        !window.__SKYFRONT_NATIVE_FAILED__,
    );
    check(
      'phase' + record.phase + ': isolated paused campaign outside network',
      api.isPaused() && !api.network(),
    );
    if (record.phase === 0) {
      query('#welcome [data-action="start"]').click();
      if (!api.isPaused()) query('#pause').click();
      const input = query('#import-file'),
        transfer = new DataTransfer();
      transfer.items.add(
        new File([fixture.raw], 'native-synthetic-battle-density.json', {
          type: 'application/json',
        }),
      );
      check('fixture within original file limit', transfer.files[0].size < 5e6);
      record.phase = 1;
      sessionStorage.setItem(KEY, JSON.stringify(record));
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await delay(15000);
      throw Error('Original import did not reload');
    }
    check('original import retains all500default groups', world.state.groundUnits.length === 500);
    for (const item of fixture.expected.units)
      check(
        'unit' + item.id + ': original HP/ammo constructor defaults',
        JSON.stringify(signature(world.state.groundUnits.find((u) => u.id === item.id))) ===
          JSON.stringify(item.defaults),
      );
    check(
      'all paid facilities complete',
      fixture.expected.facilities.every((item) =>
        world.state.buildings.some(
          (b) => b.id === item.id && b.key === item.key && b.progress === 1,
        ),
      ),
    );
    const baseline = api.engine.save(world.state);
    world.sync();
    check(
      'paused visual sync cannot modify fixture state',
      api.engine.save(world.state) === baseline,
    );
    const initial = new Map(
      world.state.groundUnits.map((u) => [
        u.id,
        {
          x: u.x,
          z: u.z,
          hp: u.hp,
          ammo: (u.ammo || 0) + (u.groundAmmo || 0) + (u.ammoReserve || 0),
        },
      ]),
    );
    const previousHp = new Map(world.state.groundUnits.map((u) => [u.id, u.hp]));
    const moved = new Set(),
      spent = new Set(),
      wounded = new Set(),
      patients = new Set();
    let shots = 0,
      lastEvent = Math.max(0, ...world.state.events.map((e) => e.id)),
      maxProjectiles = 0,
      maxSupplyVehicles = 0,
      maxCrates = 0,
      maxReloading = 0,
      healingObservations = 0,
      acks = 0,
      lastNativeScene;
    transport = world.renderer.transport;
    originalReceive = transport.receive;
    transport.receive = function (message) {
      let value = message;
      if (typeof value === 'string') {
        try {
          value = JSON.parse(value);
        } catch {
          value = null;
        }
      }
      if (value?.kind === 'scene-ack') {
        acks++;
        lastNativeScene = value.scene;
      }
      return originalReceive.call(this, message);
    };
    const nativeErrors = [],
      longTasks = [];
    if (typeof PerformanceObserver === 'function') {
      observer = new PerformanceObserver((list) => {
        for (const item of list.getEntries()) longTasks.push(item.duration);
      });
      try {
        observer.observe({ type: 'longtask', buffered: false });
      } catch {
        observer = null;
      }
    }
    const startTime = world.state.time;
    world.focus(fixture.cameras[0].x, fixture.cameras[0].z, fixture.cameras[0].distance, {
      instant: true,
    });
    query('#welcome [data-action="start"]').click();
    if (api.isPaused()) query('#pause').click();
    if (api.getAudio().enabled) query('#sound').click();
    check('normal original simulation is unpaused', !api.isPaused());
    post({
      kind: 'qa-result',
      stage: 'battle-start',
      passed: true,
      syntheticDensityOnly: true,
      wallSeconds: fixture.battleSeconds,
      startTime,
      count: 500,
    });
    const began = performance.now();
    let changedCamera = false;
    while (performance.now() - began < fixture.battleSeconds * 1000) {
      await delay(100);
      const state = world.state;
      if (window.__SKYFRONT_NATIVE_FAILED__ || world.renderer.transport.failed)
        nativeErrors.push(
          String(window.__SKYFRONT_NATIVE_FAILED__ || world.renderer.transport.failed),
        );
      if (api.isPaused())
        throw Error('Original simulation unexpectedly paused during active battle');
      for (const event of state.events)
        if (event.id > lastEvent && event.type === 'shot' && event.ground) shots++;
      lastEvent = Math.max(lastEvent, ...state.events.map((e) => e.id));
      maxProjectiles = Math.max(maxProjectiles, state.projectiles.length);
      maxSupplyVehicles = Math.max(maxSupplyVehicles, state.ammoVehicles.length);
      maxCrates = Math.max(maxCrates, state.ammoCrates.length);
      maxReloading = Math.max(
        maxReloading,
        state.groundUnits.filter((u) => u.groundReload > 0 || u.reloadLeft > 0).length,
      );
      for (const unit of state.groundUnits) {
        const before = initial.get(unit.id);
        if (!before) continue;
        if (Math.hypot(unit.x - before.x, unit.z - before.z) > 1) moved.add(unit.id);
        if (unit.hp < unit.maxHp) wounded.add(unit.id);
        if ((unit.ammo || 0) + (unit.groundAmmo || 0) + (unit.ammoReserve || 0) < before.ammo)
          spent.add(unit.id);
        if (unit.hp > (previousHp.get(unit.id) ?? unit.hp)) healingObservations++;
        previousHp.set(unit.id, unit.hp);
        if (unit.key === 'medic' && unit.patientId) patients.add(unit.id);
        if (!Number.isFinite(unit.x + unit.y + unit.z + unit.hp) || unit.hp > unit.maxHp)
          throw Error('Invalid authoritative unit state');
      }
      if (!changedCamera && performance.now() - began > 30000) {
        const target = fixture.cameras[1];
        world.focus(target.x, target.z, target.distance, { instant: true });
        changedCamera = true;
        post({
          kind: 'qa-result',
          stage: 'capture-battle-south',
          passed: true,
          syntheticDensityOnly: true,
          count: state.groundUnits.length,
        });
      }
    }
    observer?.disconnect();
    if (!api.isPaused()) query('#pause').click();
    check(
      'real wall-clock battle completed without transport failure',
      nativeErrors.length === 0,
      nativeErrors,
    );
    check('original simulation actually advanced unpaused', world.state.time - startTime > 10, {
      elapsedSimulation: world.state.time - startTime,
      elapsedWallMs: performance.now() - began,
    });
    check(
      'real autonomous shooting and projectile simulation occurred',
      shots > 0 && maxProjectiles > 0,
      { shotsObservedLowerBound: shots, maxProjectiles },
    );
    check('original damage and finite ammo were consumed', wounded.size > 0 && spent.size > 0, {
      wounded: wounded.size,
      ammoUsed: spent.size,
    });
    check('original deferred navigation moved actual units', moved.size > 0, { moved: moved.size });
    check(
      'original medics selected and actually healed combat casualties',
      patients.size > 0 && healingObservations > 0,
      { medicsWithPatients: patients.size, healingObservations },
    );
    check(
      'original ammo reload and physical supply dispatch occurred',
      maxReloading > 0 && maxSupplyVehicles > 0,
      {
        maxReloading,
        maxSupplyVehicles,
        deliveredCratesObserved: maxCrates,
        note: 'Dispatch does not prove a completed delivery',
      },
    );
    check(
      'native continued acknowledging real combat scenes',
      acks > 10 && lastNativeScene?.objects > 0,
      { acks, lastNativeScene },
    );
    const result = {
      wallMs: performance.now() - began,
      simulationSeconds: world.state.time - startTime,
      simulationToWallRatio: (world.state.time - startTime) / ((performance.now() - began) / 1000),
      initial: 500,
      remaining: world.state.groundUnits.length,
      moved: moved.size,
      wounded: wounded.size,
      ammoUsed: spent.size,
      shotsObservedLowerBound: shots,
      maxProjectiles,
      medicsWithPatients: patients.size,
      healingObservations,
      maxReloading,
      maxSupplyVehicles,
      maxCrates,
      nativeAcks: acks,
      lastNativeScene,
      longTasks: {
        count: longTasks.length,
        maximumMs: Math.max(0, ...longTasks),
        totalMs: longTasks.reduce((a, b) => a + b, 0),
      },
    };
    post({
      kind: 'qa-result',
      stage: 'capture-battle-complete',
      passed: true,
      syntheticDensityOnly: true,
      result,
    });
    record.phase = 'complete';
    sessionStorage.setItem(KEY, JSON.stringify(record));
    post({
      kind: 'qa-result',
      stage: 'complete',
      passed: true,
      syntheticDensityOnly: true,
      paidRecruitment: false,
      checks: record.checks,
      result,
      renderer: world.renderer.diagnostics(),
      fixture: { sha256: fixture.sha256 },
      limitations: fixture.limitations,
    });
  } catch (error) {
    if (api && !api.isPaused()) query('#pause')?.click();
    post({
      kind: 'qa-result',
      stage: 'complete',
      passed: false,
      syntheticDensityOnly: true,
      phase: record?.phase,
      checks: record?.checks || [],
      error: error.stack || error.message,
    });
  } finally {
    observer?.disconnect();
    if (transport && originalReceive) transport.receive = originalReceive;
  }
})();
