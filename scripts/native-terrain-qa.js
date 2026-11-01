// SYNTHETIC VISUAL ONLY. Original import, CPU art/picking and native terrain acceptance.
// No paid recruitment, AI, navigation, frame-rate, balance or natural-weather claim.
(async () => {
  if (window.__SKYFRONT_TERRAIN_QA_RUNNING__) return;
  window.__SKYFRONT_TERRAIN_QA_RUNNING__ = true;
  const fixture = window.__SKYFRONT_TERRAIN_FIXTURE__;
  const KEY = 'skyfront-native-terrain-art-v1';
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const query = (selector) => document.querySelector(selector);
  const post = (value) => window.chrome.webview.postMessage(value);
  const webview = window.chrome.webview,
    originalPost = webview.postMessage;
  const observedBindings = {};
  // QA is injected on renderer-attached, before CPU warmup's first scene. Observe packets in flight;
  // never call exporter.capture separately because that would consume production deltas without sending them.
  webview.postMessage = function (value) {
    const bindings = value?.kind === 'scene' && value.frame?.visualBindings;
    if (bindings?.terrain) observedBindings.terrain = structuredClone(bindings.terrain);
    if (bindings?.trenches) observedBindings.trenches = structuredClone(bindings.trenches);
    return originalPost.call(this, value);
  };
  let record, api, world, baseline, originalTime, originalWeather, enhancedMode;
  const store = () => sessionStorage.setItem(KEY, JSON.stringify(record));
  function check(name, passed, detail) {
    record.checks.push({ name, passed: !!passed, ...(detail === undefined ? {} : { detail }) });
    store();
    if (!passed) throw Error(name + (detail === undefined ? '' : ': ' + JSON.stringify(detail)));
  }
  async function until(predicate, label, timeout = 60000) {
    const deadline = performance.now() + timeout;
    while (!predicate()) {
      if (performance.now() > deadline) throw Error('Timed out: ' + label);
      await delay(35);
    }
  }
  const smooth = (a, b, value) => {
    const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  function expectedY(unit, x, z) {
    if (!enhancedMode) return unit.y || 1;
    const t = world.fortifications.models.get(unit.trenchId);
    if (!t) return Math.max(0, world.height(x, z)) + 0.05;
    const c = Math.cos(t.yaw),
      s = Math.sin(t.yaw),
      dx = x - t.x,
      dz = z - t.z;
    const horizontal = dx * c - dz * s;
    const along = horizontal / (t.stretch * Math.cos(t.roll));
    const across = dx * s + dz * c;
    const distance = Math.hypot(Math.max(0, Math.abs(along) - 6.8), across);
    const depth =
      1.55 *
      smooth(0, 0.75, t.progress) *
      smooth(0, 2.8, 9 - Math.abs(along)) *
      smooth(0, 0.65, 2.2 - distance);
    return depth
      ? t.y + horizontal * Math.tan(t.roll) + 0.05 - depth * Math.cos(t.roll)
      : Math.max(0, world.height(x, z)) + 0.05;
  }
  async function scene(stage) {
    const renderer = world.renderer,
      exporter = renderer.exporter,
      transport = renderer.transport;
    const capture = exporter.capture,
      receive = transport.receive;
    let accepted;
    const expected = new Map();
    exporter.capture = function (...args) {
      const packet = capture.apply(this, args);
      const bindings = packet.frame.visualBindings;
      if (bindings?.terrain) record.bindings.terrain = bindings.terrain;
      if (bindings?.trenches) record.bindings.trenches = bindings.trenches;
      expected.set(packet.seq, { objects: this.objectCache.size, bindings: !!bindings });
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
        accepted = { ack: value, expected: expected.get(value.seq) };
      return receive.call(this, message);
    };
    try {
      const before = api.engine.save(world.state);
      world.sync();
      world.updateDaylight();
      world.post.render(world.scene, world.camera, world.battleTime);
      await until(() => accepted, stage + ' native ACK');
      check(
        stage + ': sync/render never changes authoritative save',
        api.engine.save(world.state) === before,
      );
      check(
        stage + ': original object registry retained',
        accepted.ack.scene?.objects === accepted.expected.objects,
      );
      check(
        stage +
          (enhancedMode
            ? ': native enhanced terrain and deep sections active'
            : ': baseline terrain and original flat trenches retained'),
        enhancedMode
          ? accepted.ack.scene?.enhancedTerrain === true &&
              accepted.ack.scene.trenches?.sections === 4 &&
              accepted.ack.scene.trenches?.occupiedTiles > 0 &&
              accepted.ack.scene.trenches?.maskBytes > 0
          : accepted.ack.scene?.enhancedTerrain === false &&
              accepted.ack.scene.trenches?.sections === 0 &&
              accepted.ack.scene.trenches?.occupiedTiles === 0,
        accepted.ack.scene,
      );
      record.scenes.push({
        stage,
        graphicsMode: record.graphicsMode,
        sequence: accepted.ack.seq,
        native: accepted.ack.scene,
      });
      store();
    } finally {
      exporter.capture = capture;
      transport.receive = receive;
    }
  }
  function sourceInstances(caseLabels) {
    const samples = [];
    for (const item of fixture.expected.units) {
      if (caseLabels && !caseLabels.includes(item.label) && !item.departing) continue;
      const unit = world.state.groundUnits.find((u) => u.id === item.id);
      const pool = world.infantry.pools.get(unit.key + unit.side);
      if (!pool) continue;
      for (let i = 0; i < pool.body.count; i++) {
        if (pool.body.userData.unitIds[i] !== unit.id) continue;
        const matrix = new world.camera.matrixWorld.constructor();
        pool.body.getMatrixAt(i, matrix);
        const x = matrix.elements[12],
          y = matrix.elements[13],
          z = matrix.elements[14];
        const wanted = expectedY(unit, x, z);
        check(
          'unit ' +
            unit.id +
            ' member ' +
            i +
            (enhancedMode
              ? ': CPU/picking instance shares actual excavation floor'
              : ': CPU/picking instance retains original baseline height'),
          Math.abs(y - wanted) < 0.12,
          { x, y, z, wanted },
        );
        if (item.departing)
          check(
            'departing member uses correct outside-trench floor',
            Math.abs(y - (enhancedMode ? Math.max(0, world.height(x, z)) + 0.05 : unit.y || 1)) <
              0.12,
          );
        else if (enhancedMode && item.label === 'flat-full')
          check('full trench member is visibly below old unit root', y < unit.y - 0.7);
        samples.push({ id: unit.id, index: i, x, y, z, wanted, departing: !!item.departing });
      }
    }
    check('visible source unit/member mapping is present', samples.length > 0);
    record.instances.push(...samples);
    return samples;
  }
  function pickLoweredInfantry() {
    const item = fixture.expected.units.find((u) => u.label === 'flat-full' && u.slot === 0);
    const unit = world.state.groundUnits.find((u) => u.id === item.id);
    const body = world.infantry.pools.get(unit.key + unit.side).body;
    const index = body.userData.unitIds.indexOf(unit.id);
    check(
      (enhancedMode ? 'lowered' : 'baseline') + ' infantry has exact source instance mapping',
      index >= 0 && index < body.count,
    );
    const matrix = new world.camera.matrixWorld.constructor();
    body.getMatrixAt(index, matrix);
    const point = world.camera.position
      .clone()
      .set(0, 1.88, 0)
      .applyMatrix4(matrix)
      .applyMatrix4(body.matrixWorld);
    const projected = point.clone().project(world.camera);
    world.pointer.set(projected.x, projected.y);
    world.ray.setFromCamera(world.pointer, world.camera);
    const hit = world.ray
      .intersectObjects(
        world.infantry.meshes.filter((m) => m.visible),
        true,
      )
      .find((h) => h.object.userData.infantryBatch && h.object.userData.unitIds[h.instanceId]);
    check(
      'original CPU ray hits ' +
        (enhancedMode ? 'lowered' : 'baseline') +
        ' model with correct authoritative ID',
      hit?.object.userData.unitIds[hit.instanceId] === unit.id,
      {
        id: unit.id,
        actualId: hit?.object.userData.unitIds[hit.instanceId],
        projected: projected.toArray(),
        hitY: hit?.point.y,
      },
    );
  }
  function restore() {
    if (!world || originalTime === undefined) return;
    world.state.time = originalTime;
    world.state.weather = structuredClone(originalWeather);
    world.updateDaylight();
    world.weatherFX.update(0, world.controls.target, world.state.weather);
  }
  try {
    if (!fixture?.raw || !fixture.sha256 || !fixture.syntheticVisualOnly)
      throw Error('Missing explicit synthetic fixture');
    record = JSON.parse(sessionStorage.getItem(KEY) || 'null') || {
      phase: 0,
      fixtureSha256: fixture.sha256,
      checks: [],
      scenes: [],
      bindings: {},
      instances: [],
    };
    if (record.fixtureSha256 !== fixture.sha256) throw Error('Fixture changed across reload');
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
      'native runtime explicitly reports graphics mode',
      typeof window.__SKYFRONT_NATIVE__?.enhancedGraphics === 'boolean',
    );
    enhancedMode = window.__SKYFRONT_NATIVE__.enhancedGraphics;
    const graphicsMode = enhancedMode ? 'enhanced' : 'baseline';
    if (record.graphicsMode && record.graphicsMode !== graphicsMode)
      throw Error('Graphics mode changed across reload');
    record.graphicsMode = graphicsMode;
    check(
      'phase ' + record.phase + ': original native renderer ready',
      world.renderer.transport.ready &&
        world.renderer.domElement.dataset.renderer === 'godot' &&
        !window.__SKYFRONT_NATIVE_FAILED__,
    );
    check('phase ' + record.phase + ': paused outside network', api.isPaused() && !api.network());
    if (record.phase === 0) {
      query('#welcome [data-action="start"]').click();
      if (!api.isPaused()) query('#pause').click();
      const file = new File([fixture.raw], 'native-synthetic-terrain.json', {
        type: 'application/json',
      });
      check('fixture within original import limit', file.size < 5e6);
      const transfer = new DataTransfer();
      transfer.items.add(file);
      const input = query('#import-file');
      check('original file input available', input?.type === 'file');
      record.phase = 1;
      store();
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await delay(15000);
      throw Error('Original import did not reload');
    }
    check(
      'all fixture counts retained by original load',
      Object.entries(fixture.expected.counts).every(
        ([key, value]) => world.state[key].length === value,
      ),
    );
    check(
      'all original trench records retained',
      JSON.stringify(world.state.trenches) === JSON.stringify(fixture.expected.trenches),
    );
    query('#welcome [data-action="start"]').click();
    if (!api.isPaused()) query('#pause').click();
    if (api.getAudio().enabled) query('#sound').click();
    originalTime = world.state.time;
    originalWeather = structuredClone(world.state.weather);
    baseline = api.engine.save(world.state);
    Object.assign(record.bindings, observedBindings);
    // The renderer may deliver its first static binding before host-eval installs
    // this observer on a fast reload. Inspect the actual receiving renderer's
    // retained identity via a fresh ACK; never force a second consuming capture.
    await scene('received-bindings');
    const receivedBindings = record.scenes.at(-1).native;
    check(
      'actual received terrain binding references original object and geometry',
      receivedBindings.terrainObjectId === world.ground?.uuid &&
        receivedBindings.terrainGeometryId === world.ground?.geometry.uuid,
      {
        objectId: receivedBindings.terrainObjectId,
        geometryId: receivedBindings.terrainGeometryId,
      },
    );
    check(
      'actual received bindings retain all four original trenches',
      receivedBindings.sourceTrenchIds?.length === 4 &&
        fixture.expected.trenches.every((t) =>
          receivedBindings.sourceTrenchIds.includes(String(t.id)),
        ),
    );
    for (const camera of fixture.cameras) {
      restore();
      world.state.time = camera.time;
      world.state.weather = { ...structuredClone(originalWeather), ...camera.weather };
      world.controls.yaw = camera.yaw;
      world.controls.pitch = camera.pitch;
      world.controls.rotate(0, 0);
      world.focus(camera.x, camera.z, camera.distance, { instant: true });
      world.weatherFX.update(3, world.controls.target, world.state.weather);
      world.updateDaylight();
      await delay(450);
      await scene(camera.name);
      sourceInstances(
        camera.name === 'slope-night'
          ? ['slope-longitudinal', 'slope-oblique']
          : ['flat-full', 'flat-digging'],
      );
      if (camera.name === 'close-day') pickLoweredInfantry();
      post({
        kind: 'qa-result',
        stage: 'capture-terrain-' + camera.name,
        passed: true,
        syntheticVisualOnly: true,
        graphicsMode: record.graphicsMode,
        holdMilliseconds: fixture.holdMilliseconds,
        camera: world.controls.diagnostics(),
        scene: record.scenes.at(-1),
        daylight: world.post.daylight,
        weather: camera.weather,
      });
      await delay(fixture.holdMilliseconds);
      restore();
      check(
        camera.name + ': original campaign restored exactly',
        api.engine.save(world.state) === baseline,
      );
    }
    world.sync();
    await scene('restored');
    check(
      'all four source poses available including genuine slopes',
      world.fortifications.models.size === 4 &&
        [...world.fortifications.models.values()].filter((t) => Math.abs(t.roll) > 0.025).length >=
          2,
    );
    check('final save exactly unchanged by art QA', api.engine.save(world.state) === baseline);
    record.phase = 'complete';
    store();
    post({
      kind: 'qa-result',
      stage: 'complete',
      passed: true,
      syntheticVisualOnly: true,
      graphicsMode: record.graphicsMode,
      checks: record.checks,
      scenes: record.scenes,
      bindings: record.bindings,
      instances: record.instances,
      fixture: { sha256: fixture.sha256 },
      limitations: fixture.limitations,
      scope:
        'Original imported paused synthetic terrain/trench art, native mask and CPU picking; no balance/combat/performance claim',
    });
  } catch (error) {
    restore();
    post({
      kind: 'qa-result',
      stage: 'complete',
      passed: false,
      syntheticVisualOnly: true,
      graphicsMode: record?.graphicsMode,
      phase: record?.phase,
      checks: record?.checks || [],
      scenes: record?.scenes || [],
      error: error.stack || error.message,
    });
  } finally {
    webview.postMessage = originalPost;
  }
})();
