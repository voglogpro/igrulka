// SYNTHETIC VISUAL QA ONLY: existing original models, upgrade/damage poses and FX.
// No simulation ticks, paid-production proof, battle performance or audio claim.
(async () => {
  if (window.__SKYFRONT_GALLERY_QA_RUNNING__) return;
  window.__SKYFRONT_GALLERY_QA_RUNNING__ = true;
  const fixture = window.__SKYFRONT_GALLERY_FIXTURE__;
  const holdMilliseconds = fixture?.holdMilliseconds ?? 45000;
  const KEY = 'skyfront-native-visual-gallery-v1';
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const query = (selector) => document.querySelector(selector);
  const post = (value) => window.chrome.webview.postMessage(value);
  let record, api, world;
  function store() {
    sessionStorage.setItem(KEY, JSON.stringify(record));
  }
  function check(name, passed, detail) {
    record.checks.push({ name, passed: !!passed, ...(detail === undefined ? {} : { detail }) });
    store();
    if (!passed) throw Error(name + (detail === undefined ? '' : ': ' + JSON.stringify(detail)));
  }
  async function until(predicate, label, timeout = 90000) {
    const deadline = performance.now() + timeout;
    while (!predicate()) {
      if (performance.now() > deadline) throw Error('Timed out: ' + label);
      await delay(30);
    }
  }
  async function nativeScene(stage) {
    const renderer = world.renderer,
      exporter = renderer.exporter,
      transport = renderer.transport;
    const originalCapture = exporter.capture,
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
      await until(() => received && received.ack.seq > before, stage + ' original scene ACK');
      check(
        stage + ': Godot object registry matches source scene',
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
  function resourceSummary(state) {
    return Object.fromEntries(
      ['credits', 'materials', 'components', 'oil'].map((k) => [k, state.sides[0][k]]),
    );
  }
  function entitySignature(entity) {
    const fields = [
      'id',
      'key',
      'x',
      'z',
      'hp',
      'maxHp',
      'progress',
      'level',
      'ammo',
      'ammoReserve',
      'groundAmmo',
      'groundReload',
      'fpvAmmo',
      'ammoCargo',
      'downed',
    ];
    return Object.fromEntries(
      fields.filter((k) => entity[k] !== undefined).map((k) => [k, entity[k]]),
    );
  }
  async function holdCamera(name, point, distance) {
    world.focus(point.x, point.z, distance, { instant: true });
    await delay(450);
    check(
      name + ': source camera limits respected',
      world.controls.distance >= 100 && world.controls.distance <= 720,
    );
    await nativeScene('camera-' + name);
    post({
      kind: 'qa-result',
      stage: 'capture-gallery-' + name,
      passed: true,
      holdMilliseconds,
      syntheticVisualOnly: true,
      camera: world.controls.diagnostics(),
      scene: record.scenes.at(-1),
      original: api.diagnostics(),
    });
    await delay(holdMilliseconds);
  }
  // No public World.handleEvent exists. Its ORIGINAL sync() consumes state.events,
  // calls CombatEffects.handle, recoil, corpse/wreck and shake paths, then onEvent.
  function syntheticVisualEvent(type, key, point, extra = {}) {
    const state = world.state;
    const id = Math.max(state.nextId, world.eventId + 1, ...state.events.map((e) => e.id + 1));
    state.nextId = id + 1;
    const entry = {
      id,
      type,
      key,
      time: state.time,
      side: 0,
      x: point.x,
      y: 2,
      z: point.z,
      ...extra,
    };
    state.events.push(entry);
    world.sync();
    return entry;
  }
  window.skyfrontGalleryProbe = {
    focusId(id, distance = 250) {
      const entity = [
        ...world.state.buildings,
        ...world.state.groundUnits,
        ...world.state.warships,
        ...world.state.ships,
      ].find((e) => e.id === id);
      if (!entity) throw Error('Unknown fixture entity');
      world.focus(entity.x, entity.z, distance, { instant: true });
      return entity;
    },
    visualEvent: syntheticVisualEvent,
    advanceVisual(seconds = 0.1) {
      let remaining = seconds;
      while (remaining > 0) {
        const dt = Math.min(1 / 60, remaining);
        world.combatFX.update(dt, world.elapsed, world.camera);
        remaining -= dt;
      }
      return world.combatFX.diagnostics();
    },
  };
  try {
    if (!fixture?.raw || !fixture.sha256 || !fixture.expected)
      throw Error('Missing gallery fixture injection');
    record = JSON.parse(sessionStorage.getItem(KEY) || 'null') || {
      phase: 0,
      fixtureSha256: fixture.sha256,
      checks: [],
      scenes: [],
      syntheticVisualOnly: true,
    };
    if (record.fixtureSha256 !== fixture.sha256)
      throw Error('Gallery fixture changed across reload');
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
      'phase' + record.phase + ': original Godot renderer ready',
      world.renderer.domElement.dataset.renderer === 'godot' &&
        world.renderer.transport.ready &&
        !window.__SKYFRONT_NATIVE_FAILED__,
    );
    check('phase' + record.phase + ': original pause and solo', api.isPaused() && !api.network());
    if (record.phase === 0) {
      check(
        'fresh isolated profile before original import',
        world.state.time === 0 &&
          world.state.buildings.length === 2 &&
          world.state.groundUnits.length === 0,
      );
      query('#welcome [data-action="start"]').click();
      if (!api.isPaused()) query('#pause').click();
      const file = new File([fixture.raw], 'native-synthetic-visual-gallery.json', {
        type: 'application/json',
      });
      check('gallery within original file limit', file.size < 5e6);
      const transfer = new DataTransfer();
      transfer.items.add(file);
      const input = query('#import-file');
      check('original import file input exists', !!input && input.type === 'file');
      record.phase = 1;
      store();
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await delay(15000);
      throw Error('Original import failed to reload page');
    }
    const state = world.state,
      expected = fixture.expected;
    check(
      'original import retained synthetic gallery counts',
      Object.entries(expected.counts).every(([key, count]) => state[key].length === count),
      Object.fromEntries(Object.keys(expected.counts).map((key) => [key, state[key].length])),
    );
    check(
      'all source building keys represented',
      expected.buildingKeys.every((key) => state.buildings.some((b) => b.key === key)),
    );
    check(
      'all source ground keys represented',
      expected.groundKeys.every((key) => state.groundUnits.some((u) => u.key === key)),
    );
    check(
      'all seven original weapon models represented',
      expected.weaponKeys.every((key) => state.units.some((u) => u.key === key)),
    );
    check(
      'source fleet classes present on water',
      state.warships.some((s) => s.class === 'patrol') &&
        state.warships.some((s) => s.class === 'missile') &&
        [...state.ships, ...state.warships].every((s) => api.engine.isWater(s.x, s.z)),
    );
    check(
      'HP and ammunition metadata survived original reload exactly',
      JSON.stringify([...state.buildings, ...state.groundUnits].map(entitySignature)) ===
        JSON.stringify(expected.entities),
    );
    check(
      'all source fortification stages survived',
      JSON.stringify(state.trenches.map((t) => api.engine.fortificationStatus(t).level)) ===
        JSON.stringify([0, 1, 2, 3, 4, 5]),
    );
    check(
      'normal budget preserved in visual fixture',
      JSON.stringify(resourceSummary(state)) === JSON.stringify(expected.resources),
    );
    query('#welcome [data-action="start"]').click();
    if (!api.isPaused()) query('#pause').click();
    if (api.getAudio().enabled) query('#sound').click();
    world.sync();
    check(
      'all original building models allocated',
      world.models.size === expected.counts.buildings,
      { models: world.models.size, expected: expected.counts.buildings },
    );
    check(
      'all original ground models allocated',
      world.groundModels.size === expected.counts.groundUnits,
      { models: world.groundModels.size, expected: expected.counts.groundUnits },
    );
    check(
      'all original aircraft models allocated',
      world.unitModels.size === expected.counts.units,
      { models: world.unitModels.size, expected: expected.counts.units },
    );
    await nativeScene('imported-gallery');
    for (const camera of fixture.cameras) await holdCamera(camera.name, camera, camera.distance);
    check(
      'paused gallery retained all models',
      api.isPaused() &&
        state.time === 0 &&
        world.models.size === expected.counts.buildings &&
        world.groundModels.size === expected.counts.groundUnits &&
        !world.renderer.transport.failed,
    );
    record.phase = 'complete';
    store();
    post({
      kind: 'qa-result',
      stage: 'complete',
      passed: true,
      scope:
        'Synthetic paused model/upgrade/damage/fleet coverage; NOT paid-production, real battle, performance or audio proof',
      checks: record.checks,
      scenes: record.scenes,
      fixture: { sha256: fixture.sha256, source: fixture.source },
      stats: world.renderer.diagnostics(),
      original: api.diagnostics(),
      coverage: fixture.coverage,
      limitations: fixture.limitations,
    });
  } catch (error) {
    post({
      kind: 'qa-result',
      stage: 'complete',
      passed: false,
      scope: 'Synthetic visual model gallery',
      phase: record?.phase,
      checks: record?.checks || [],
      scenes: record?.scenes || [],
      error: String(error?.stack || error),
      stats: world?.renderer?.diagnostics?.(),
      original: api?.diagnostics?.(),
    });
  }
})();
