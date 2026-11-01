// Paid advanced native UI/callback scenario. Original imported city and E.step only.
// No resource/HP/speed/entity grants. Offline idle-human mode; NOT an internet/FPS/audio test.
(async () => {
  if (window.__SKYFRONT_PAID_ADVANCED_QA_RUNNING__) return;
  window.__SKYFRONT_PAID_ADVANCED_QA_RUNNING__ = true;
  const fixture = window.__SKYFRONT_PAID_ADVANCED_FIXTURE__;
  const KEY = 'skyfront-native-paid-advanced-v1';
  const query = (selector) => document.querySelector(selector);
  const delay = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
  const post = (value) => window.chrome.webview.postMessage(value);
  let record,
    api,
    world,
    state,
    engine,
    renderer,
    currentStage = 'startup',
    lastEvent = 0;
  const eventLog = [],
    merchantStates = new Set(),
    shipStates = new Set(),
    cargoTrips = new Map();
  const resources = () =>
    Object.fromEntries(
      ['credits', 'materials', 'oil', 'components'].map((key) => [key, state.sides[0][key] || 0]),
    );
  function store() {
    sessionStorage.setItem(KEY, JSON.stringify(record));
  }
  function check(name, passed, detail) {
    record.checks.push({ name, passed: !!passed, ...(detail === undefined ? {} : { detail }) });
    store();
    if (!passed) throw Error(name + (detail === undefined ? '' : ': ' + JSON.stringify(detail)));
  }
  function progress(stage, detail = {}) {
    currentStage = stage;
    post({
      kind: 'qa-result',
      stage: 'progress-advanced-' + stage,
      passed: true,
      simulationTime: state?.time,
      resources: state ? resources() : null,
      ...detail,
    });
  }
  async function until(predicate, label, timeout = 60000) {
    const deadline = performance.now() + timeout;
    while (!predicate()) {
      if (performance.now() > deadline) throw Error('Wall timeout: ' + label);
      await delay(25);
    }
  }
  async function click(selector) {
    const button = query(selector);
    if (!button || button.disabled) throw Error('Missing/disabled original button: ' + selector);
    button.click();
    await delay(25);
    return button;
  }
  function change(selector, value, type = 'change') {
    const input = query(selector);
    if (!input) throw Error('Missing original field: ' + selector);
    input.value = String(value);
    input.dispatchEvent(new Event(type, { bubbles: true }));
  }
  function key(code) {
    const canvas = renderer.domElement;
    canvas.focus();
    canvas.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true }));
    canvas.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true, cancelable: true }));
  }
  function observe() {
    for (const ship of state.ships) if (ship.side === 0) merchantStates.add(ship.state);
    for (const ship of state.warships) if (ship.side === 0) shipStates.add(ship.state);
    for (const event of state.events)
      if (event.id > lastEvent) {
        lastEvent = event.id;
        if (['produced', 'cargo', 'trade', 'launch', 'salvo', 'shipLaunched'].includes(event.type))
          eventLog.push({ ...event });
      }
    for (const vehicle of state.ammoVehicles) {
      if (vehicle.side !== 0 || vehicle.cargo?.kind !== 'weapon' || vehicle.cargo.key !== 'cruise')
        continue;
      let trip = cargoTrips.get(vehicle.id);
      if (!trip)
        cargoTrips.set(
          vehicle.id,
          (trip = {
            id: vehicle.id,
            depotId: vehicle.depotId,
            targetId: vehicle.targetId,
            first: { x: vehicle.x, z: vehicle.z },
            last: { x: vehicle.x, z: vehicle.z },
            statuses: new Set(),
            maximumCargo: 0,
          }),
        );
      trip.last = { x: vehicle.x, z: vehicle.z };
      trip.statuses.add(vehicle.status);
      trip.maximumCargo = Math.max(trip.maximumCargo, vehicle.cargo.amount);
    }
  }
  async function advanceUntil(predicate, label, maximumSeconds = 180) {
    const deadline = state.time + maximumSeconds,
      wallDeadline = performance.now() + 120000;
    let steps = 0;
    progress(label);
    while (!predicate()) {
      if (!api.isPaused() || api.network())
        throw Error('Manual source stepping requires a paused local campaign');
      if (state.result || state.time >= deadline || performance.now() > wallDeadline)
        throw Error(
          'Source readiness failed: ' +
            label +
            ' ' +
            JSON.stringify({
              time: state.time,
              result: state.result,
              units: state.groundUnits.map((u) => ({
                id: u.id,
                key: u.key,
                carrierId: u.carrierId,
                boardingId: u.boardingId,
                x: u.x,
                z: u.z,
                order: u.order,
                path: u.path?.length,
              })),
              warships: state.warships,
              delivery: engine.weaponDeliveryStatus(
                state,
                state.buildings.find((b) => b.id === fixture.ids.navalbase),
                'cruise',
              ),
            }),
        );
      engine.step(state, 0.05);
      record.steps++;
      observe();
      if (++steps % 20 === 0) {
        world.sync();
        await delay();
      }
    }
    world.sync();
    await delay(35);
    store();
  }
  async function nativeScene(stage) {
    const exporter = renderer.exporter,
      transport = renderer.transport,
      originalCapture = exporter.capture,
      originalReceive = transport.receive;
    const expected = new Map();
    let received;
    const before = renderer._seq;
    exporter.capture = function (...args) {
      const packet = originalCapture.apply(this, args);
      expected.set(packet.seq, {
        objects: this.objectCache.size,
        geometries: this.geometryCache.size,
        textures: this.textureCache.size,
      });
      if (expected.size > 8) expected.delete(expected.keys().next().value);
      return packet;
    };
    transport.receive = function (message) {
      let value = message;
      if (typeof value === 'string') {
        try {
          value = JSON.parse(value);
        } catch {
          value = null;
        }
      }
      if (value?.kind === 'scene-ack' && expected.has(value.seq))
        received = { ack: value, expected: expected.get(value.seq) };
      return originalReceive.call(this, message);
    };
    try {
      world.sync();
      world.post.render(world.scene, world.camera, world.battleTime);
      await until(() => received && received.ack.seq > before, stage + ' native ACK');
      check(
        stage + ': Godot registry equals the current original source scene',
        received.ack.scene?.objects === received.expected.objects,
        { native: received.ack.scene, expected: received.expected, sequence: received.ack.seq },
      );
      record.scenes.push({
        stage,
        native: received.ack.scene,
        expected: received.expected,
        sequence: received.ack.seq,
      });
      store();
    } finally {
      exporter.capture = originalCapture;
      transport.receive = originalReceive;
    }
  }
  function groundSignature(unit) {
    return Object.fromEntries(
      [
        'id',
        'key',
        'x',
        'z',
        'hp',
        'maxHp',
        'groundAmmo',
        'ammoReserve',
        'ammo',
        'carrierId',
        'boardingId',
        'autoDefense',
      ]
        .filter((key) => unit[key] !== undefined)
        .map((key) => [key, unit[key]]),
    );
  }
  function drawnInfantryIds() {
    const ids = new Set();
    for (const mesh of world.infantry.meshes) {
      for (let i = 0; i < mesh.count; i++) {
        const id = mesh.userData.unitIds?.[i];
        if (id >= 0) ids.add(id);
      }
    }
    return ids;
  }
  async function selectArmy(ids) {
    key('Escape');
    world.callbacks.onBoxSelect(ids, false);
    await until(
      () => JSON.stringify(api.getOrder().armySelection) === JSON.stringify(ids),
      'original army selection',
    );
    await delay(35);
  }
  try {
    if (!fixture?.raw || !fixture.sha256 || !fixture.paidLineage?.ok)
      throw Error('Missing paid-ready fixture/report lineage');
    record = JSON.parse(sessionStorage.getItem(KEY) || 'null') || {
      phase: 0,
      fixtureSha256: fixture.sha256,
      checks: [],
      scenes: [],
      steps: 0,
      financial: [],
    };
    if (record.fixtureSha256 !== fixture.sha256)
      throw Error('Paid fixture changed across original reload');
    await until(
      () =>
        window.skyfront &&
        query('#welcome [data-action="start"]') &&
        !query('#welcome [data-action="start"]').disabled,
      'original startup readiness',
      90000,
    );
    api = window.skyfront;
    world = api.getWorld();
    state = world.state;
    engine = api.engine;
    renderer = world.renderer;
    check(
      'phase' + record.phase + ': original native renderer and local pause',
      renderer.domElement.dataset.renderer === 'godot' &&
        renderer.transport.ready &&
        api.isPaused() &&
        !api.network() &&
        !window.__SKYFRONT_NATIVE_FAILED__,
    );
    if (record.phase === 0) {
      check(
        'fresh isolated profile before paid import',
        state.time === 0 && state.buildings.length === 2 && state.groundUnits.length === 0,
      );
      await click('#welcome [data-action="start"]');
      if (!api.isPaused()) await click('#pause');
      const file = new File([fixture.raw], 'native-paid-advanced-ready.json', {
          type: 'application/json',
        }),
        transfer = new DataTransfer();
      transfer.items.add(file);
      check('original file import remains within its size limit', file.size < 5e6);
      const input = query('#import-file');
      check('original file chooser input exists', input?.type === 'file');
      record.phase = 1;
      store();
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await delay(15000);
      throw Error('Original paid import did not reload the page');
    }
    check(
      'paid offline idle-human mode preserved',
      state.mode === 'multiplayer' && engine.aiSides(state).length === 0 && !api.network(),
    );
    check(
      'paid import retains time, resources and exact trained units',
      state.time === fixture.expected.time &&
        JSON.stringify(resources()) === JSON.stringify(fixture.expected.resources) &&
        JSON.stringify(state.groundUnits.map(groundSignature)) ===
          JSON.stringify(fixture.expected.groundUnits),
    );
    check(
      'original produced city has correct facilities and fleet',
      state.buildings.length === 15 &&
        state.groundUnits.length === 3 &&
        state.ships.length === 1 &&
        state.warships.length === 1 &&
        state.buildings.some((b) => b.id === fixture.ids.port && b.key === 'port') &&
        state.buildings.some((b) => b.id === fixture.ids.navalbase && b.key === 'navalbase'),
    );
    check(
      'fixture weather preserved without forcing clear conditions',
      JSON.stringify(state.weather) === JSON.stringify(fixture.expected.weather),
    );
    await click('#welcome [data-action="start"]');
    if (!api.isPaused()) await click('#pause');
    if (api.getAudio().enabled) await click('#sound');
    const passengers = fixture.ids.passengers.map((id) =>
        state.groundUnits.find((u) => u.id === id),
      ),
      apc = state.groundUnits.find((u) => u.id === fixture.ids.apc),
      navalbase = state.buildings.find((b) => b.id === fixture.ids.navalbase),
      factory = state.buildings.find((b) => b.id === fixture.ids.factory);
    const initialAmmo = passengers.map((u) => ({
      id: u.id,
      hp: u.hp,
      groundAmmo: u.groundAmmo,
      ammoReserve: u.ammoReserve,
    }));
    observe();
    progress('army-panel');
    key('KeyF');
    await until(
      () => !!query('#panel [data-recruit="infantry"]'),
      'original infantry recruitment panel',
    );
    check(
      'original barracks recruitment panel available',
      !!query('#panel [data-recruit="infantry"]'),
    );
    await click('#panel [data-army-category="vehicles"]');
    check(
      'original APC recruitment card available through paid vehicle base',
      !!query('#panel [data-recruit="apc"]'),
    );
    await selectArmy(fixture.ids.passengers);
    await click('#army-controls [data-troop="board"]');
    check('real boarding button enters original targeting', api.getOrder().troopMode === 'board');
    await world.callbacks.onGroundTarget({ x: apc.x, z: apc.z });
    check(
      'original callback orders both paid soldiers to board',
      passengers.every((u) => u.boardingId === apc.id),
    );
    await advanceUntil(
      () => passengers.every((u) => u.carrierId === apc.id),
      'physical-boarding',
      120,
    );
    await selectArmy([apc.id]);
    world.focus(apc.x, apc.z, 300, { instant: true });
    world.sync();
    await until(
      () => query('#ground-state')?.textContent.includes('Места: 2/8'),
      'original passenger inspector',
    );
    check(
      'original APC inspector shows actual two occupied seats',
      query('#ground-state').textContent.includes('Места: 2/8'),
    );
    check(
      'boarded infantry is removed from source visible instance pools',
      fixture.ids.passengers.every((id) => !drawnInfantryIds().has(id)),
    );
    const boardedCopy = engine.load(engine.save(state));
    check(
      'source save/load retains real passengers',
      fixture.ids.passengers.every(
        (id) => boardedCopy.groundUnits.find((u) => u.id === id)?.carrierId === apc.id,
      ),
    );
    await nativeScene('boarded-infantry-hidden');
    post({
      kind: 'qa-result',
      stage: 'capture-advanced-boarded',
      passed: true,
      holdMilliseconds: 5000,
      sourceTime: state.time,
      inspector: query('#ground-state').textContent,
    });
    await delay(5000);
    await world.callbacks.onGroundOrder({ ...fixture.transport.move });
    check(
      'original move callback preserves real passengers',
      apc.order && passengers.every((u) => u.carrierId === apc.id),
    );
    await advanceUntil(
      () =>
        Math.hypot(apc.x - fixture.transport.move.x, apc.z - fixture.transport.move.z) < 6 &&
        !apc.path.length,
      'loaded-apc-movement',
      120,
    );
    await selectArmy([apc.id]);
    await click('#army-controls [data-troop="unload"]');
    await until(
      () => passengers.every((u) => !u.carrierId && !u.boardingId),
      'original unload button',
    );
    check(
      'original unload places both soldiers on valid dry ground',
      passengers.every((u) =>
        engine.walkable(state, u.x, u.z, engine.GROUND_UNITS[u.key].size * 0.42),
      ),
    );
    world.focus(apc.x, apc.z, 250, { instant: true });
    world.sync();
    check(
      'unloaded infantry reappears in original instance pools',
      fixture.ids.passengers.every((id) => drawnInfantryIds().has(id)),
    );
    await nativeScene('unloaded-infantry-visible');
    await selectArmy(fixture.ids.passengers);
    await click('#army-controls [data-troop="board"]');
    await world.callbacks.onGroundTarget({ x: apc.x, z: apc.z });
    await advanceUntil(
      () => passengers.every((u) => u.carrierId === apc.id),
      'reboarding-before-delivery',
      90,
    );
    await selectArmy([apc.id]);
    await until(
      () => !query('#army-controls [data-troop="deliver"]')?.disabled,
      'delivery action enabled for occupied APC',
    );
    await click('#army-controls [data-troop="deliver"]');
    check('original deliver button arms point targeting', api.getOrder().troopMode === 'deliver');
    await world.callbacks.onGroundTarget({ ...fixture.transport.deliver });
    check('original point callback starts real transport delivery', !!apc.delivery);
    await advanceUntil(
      () => passengers.every((u) => !u.carrierId) && !apc.delivery,
      'automatic-delivery-and-unload',
      150,
    );
    check(
      'transport preserved original trained HP and ammunition',
      JSON.stringify(
        passengers.map((u) => ({
          id: u.id,
          hp: u.hp,
          groundAmmo: u.groundAmmo,
          ammoReserve: u.ammoReserve,
        })),
      ) === JSON.stringify(initialAmmo),
    );
    await nativeScene('transport-delivery-complete');

    key('Escape');
    world.callbacks.onSelect(factory.id);
    await until(() => !query('#inspector')?.hidden, 'original factory inspector');
    check(
      'original paid factory inspector shows real warehouse',
      query('#inspector').textContent.includes('Склад завода'),
    );
    key('Escape');
    key('KeyE');
    await until(
      () => !!query('#panel [data-produce="cruise"]'),
      'original arsenal factory controls',
    );
    change('#factory-order-count', 1, 'input');
    const orderBefore = resources();
    await click('#panel [data-produce="cruise"]');
    check(
      'original finite order waits unpaid until source simulation',
      engine.factoryOrderStatus(state, 0, null, 'cruise').unpaid === 1 &&
        JSON.stringify(resources()) === JSON.stringify(orderBefore),
    );
    const payBefore = resources(),
      econ = engine.economy(state, 0, 0.05),
      componentsPaidBefore = state.sides[0].componentProductionSpent || 0,
      eventBefore = lastEvent;
    engine.step(state, 0.05);
    record.steps++;
    observe();
    const payAfter = resources(),
      componentCredits = (state.sides[0].componentProductionSpent || 0) - componentsPaidBefore;
    const newEvents = eventLog.filter((e) => e.id > eventBefore),
      cargoCash = newEvents
        .filter((e) => e.type === 'cargo' && e.side === 0)
        .reduce((n, e) => n + (e.credits || 0), 0),
      oilPurchase = newEvents
        .filter((e) => e.type === 'trade' && e.side === 0)
        .reduce((n, e) => n + (e.bought || 0) * engine.BUILDINGS.port.port.buy.price, 0);
    const derivedCost =
      payBefore.credits +
      econ.net * 0.05 +
      cargoCash -
      oilPurchase -
      payAfter.credits -
      componentCredits;
    record.financial.push({
      stage: 'deferred-cruise-payment',
      before: payBefore,
      after: payAfter,
      sourceCost: engine.WEAPONS.cruise.cost,
      normalIncome: econ.net * 0.05,
      componentCredits,
      cargoCash,
      oilPurchase,
      derivedWeaponDebit: derivedCost,
    });
    store();
    check(
      'original source step pays exact cruise credit cost',
      Math.abs(derivedCost - engine.WEAPONS.cruise.cost) < 1e-5,
      record.financial.at(-1),
    );
    check(
      'paid queue and components reflect genuine manufacture',
      factory.queue.some((q) => q.key === 'cruise') &&
        engine.factoryOrderStatus(state, 0, null, 'cruise').unpaid === 0 &&
        payAfter.components ===
          payBefore.components -
            engine.WEAPONS.cruise.components +
            componentCredits / engine.ELECTRONICS.credits,
    );
    await click('#panel [data-weapon="cruise"]');
    await until(
      () => !!query(`#strike-site option[value="${navalbase.id}"]`),
      'original naval launch-site option',
    );
    change('#strike-site', navalbase.id);
    // getOrder intentionally exposes no launcherId; the original site control
    // plus selectedLaunchSite and resulting demand are its public contract.
    await until(
      () =>
        query('#strike-site')?.value === String(navalbase.id) &&
        engine.selectedLaunchSite(state, 0, Number(query('#strike-site').value), 'cruise')?.id ===
          navalbase.id &&
        (navalbase.weaponDemand?.cruise || 0) === 1,
      'original naval supply selection',
    );
    check(
      'original naval selection requests demand without granting a missile',
      engine.availableLaunchStock(navalbase, 'cruise') === 0 && api.getOrder().weapon === 'cruise',
    );
    await advanceUntil(
      () => engine.availableLaunchStock(navalbase, 'cruise') === 1,
      'paid-production-physical-cargo-and-ship-loading',
      300,
    );
    const ship = state.warships.find((s) => s.baseId === navalbase.id);
    check(
      'real paid weapon cargo drove from source factory to naval base',
      [...cargoTrips.values()].some(
        (trip) =>
          trip.depotId === factory.id &&
          trip.targetId === navalbase.id &&
          trip.maximumCargo > 0 &&
          Math.hypot(trip.last.x - trip.first.x, trip.last.z - trip.first.z) > 5,
      ),
      [...cargoTrips.values()].map((trip) => ({ ...trip, statuses: [...trip.statuses] })),
    );
    check(
      'factory warehouse transfer preserved one total manufactured weapon',
      engine.weaponStock(state, 0, 'cruise') === 1 &&
        engine.factoryWarehouseStatus(state, factory).stock.cruise === 0 &&
        engine.availableLaunchStock(navalbase, 'cruise') === 1,
    );
    await advanceUntil(() => ship.state === 'station', 'loaded-ship-to-firing-station', 150);
    await until(
      () => query('#strike-stock')?.textContent.includes('На площадке: 1'),
      'original naval stock HUD refresh',
    );
    check(
      'original naval UI reports its physically delivered stock',
      query('#strike-stock').textContent.includes('На площадке: 1'),
    );
    check(
      'source fleet is visible in the original naval renderer',
      world.warships.diagnostics().warships === 1 &&
        world.ships.diagnostics().ships === 1 &&
        engine.isWater(ship.x, ship.z),
    );
    world.focus(ship.x, ship.z, 300, { instant: true });
    await nativeScene('loaded-missile-ship-station');
    post({
      kind: 'qa-result',
      stage: 'capture-advanced-naval-loaded',
      passed: true,
      holdMilliseconds: 5000,
      ship: { ...ship },
      stock: engine.availableLaunchStock(navalbase, 'cruise'),
      sourceTime: state.time,
    });
    await delay(5000);
    const originalUnitIds = new Set(state.units.map((u) => u.id)),
      stockBefore = engine.availableLaunchStock(navalbase, 'cruise'),
      sourceLaunch = { x: ship.x, z: ship.z };
    await world.callbacks.onAimPoint({ ...fixture.navalAim });
    const missile = state.units.find(
      (u) => !originalUnitIds.has(u.id) && u.key === 'cruise' && u.sourceId === navalbase.id,
    );
    check(
      'original aiming callback launches from ship and consumes local magazine',
      !!missile &&
        Math.hypot(missile.startX - sourceLaunch.x, missile.startZ - sourceLaunch.z) < 1e-6 &&
        engine.availableLaunchStock(navalbase, 'cruise') === stockBefore - 1,
      {
        sourceLaunch,
        missile: missile
          ? {
              id: missile.id,
              startX: missile.startX,
              startZ: missile.startZ,
              sourceId: missile.sourceId,
            }
          : null,
        stockBefore,
        stockAfter: engine.availableLaunchStock(navalbase, 'cruise'),
      },
    );
    await advanceUntil(() => missile.launched, 'real-naval-missile-takeoff', 15);
    world.sync();
    check('real missile receives its original 3D model', world.unitModels.has(missile.id));
    await nativeScene('naval-missile-launched');
    key('Escape');
    await advanceUntil(() => ship.state === 'docked', 'empty-missile-ship-returns', 150);
    check(
      'empty ship returns without inventing replacement stock',
      engine.availableLaunchStock(navalbase, 'cruise') === 0 &&
        engine.factoryOrderStatus(state, 0, null, 'cruise').unpaid === 0,
    );
    await advanceUntil(
      () =>
        merchantStates.has('outbound') &&
        merchantStates.has('trading') &&
        merchantStates.has('returning') &&
        eventLog.some((e) => e.type === 'cargo' && e.side === 0),
      'real-merchant-island-and-port-return',
      180,
    );
    check(
      'merchant trip and goods delivery were genuine source events',
      eventLog.some((e) => e.type === 'trade' && e.side === 0) &&
        eventLog.some((e) => e.type === 'cargo' && e.side === 0),
      {
        states: [...merchantStates],
        events: eventLog.filter((e) => ['trade', 'cargo'].includes(e.type)),
      },
    );
    const finalCopy = engine.load(engine.save(state));
    check(
      'final original save retains fleet, passengers and paid resources',
      finalCopy.time === state.time &&
        finalCopy.sides[0].credits === state.sides[0].credits &&
        finalCopy.warships[0].state === 'docked' &&
        fixture.ids.passengers.every(
          (id) => !finalCopy.groundUnits.find((u) => u.id === id).carrierId,
        ),
    );
    await nativeScene('advanced-complete');
    check(
      'native transport remains healthy after all paid transitions',
      !renderer.transport.failed && !window.__SKYFRONT_NATIVE_FAILED__,
    );
    record.phase = 'complete';
    store();
    post({
      kind: 'qa-result',
      stage: 'complete',
      passed: true,
      scope:
        'Original native DOM/callback boarding, transport, paid cruise production/cargo/naval launch/return and merchant trips; paused original E.step',
      checks: record.checks,
      scenes: record.scenes,
      steps: record.steps,
      time: state.time,
      resources: resources(),
      financial: record.financial,
      observed: {
        merchantStates: [...merchantStates],
        shipStates: [...shipStates],
        events: eventLog,
        cargoTrips: [...cargoTrips.values()].map((trip) => ({
          ...trip,
          statuses: [...trip.statuses],
        })),
      },
      fixture: { source: fixture.source, sha256: fixture.sha256, paidLineage: fixture.paidLineage },
      weather: state.weather,
      stats: renderer.diagnostics(),
      original: api.diagnostics(),
      limitations: [
        'Offline original multiplayer-mode imported city with an idle human opponent; no network connection/external internet proof.',
        'Physical OS mouse/file chooser and audible audio are not exercised.',
        'Source simulation is stepped while paused for functional acceptance; no real-time FPS or balance claim.',
      ],
    });
  } catch (error) {
    post({
      kind: 'qa-result',
      stage: 'complete',
      passed: false,
      scope: 'Paid advanced native UI acceptance',
      phase: record?.phase,
      currentStage,
      checks: record?.checks || [],
      scenes: record?.scenes || [],
      financial: record?.financial || [],
      error: String(error?.stack || error),
      time: state?.time,
      resources: state ? resources() : null,
      stats: world?.renderer?.diagnostics?.(),
      original: api?.diagnostics?.(),
    });
  }
})();
