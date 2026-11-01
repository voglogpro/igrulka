// Browser IIFE. Generate an injected version with prepare-native-reload-qa.mjs.
// Reinjection on renderer-attached continues across the ORIGINAL import/new reloads.
(async () => {
  if (window.__SKYFRONT_RELOAD_QA_RUNNING__) return;
  window.__SKYFRONT_RELOAD_QA_RUNNING__ = true;
  const KEY = 'skyfront-native-reload-qa-v1';
  const SAVE = 'skyfront-realtime-v3',
    SETTINGS = 'skyfront-settings-v4';
  const fixture = window.__SKYFRONT_RELOAD_FIXTURE__;
  const delay = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
  const query = (selector) => document.querySelector(selector);
  const post = (value) => window.chrome.webview.postMessage(value);
  let record, api, world;
  function store() {
    sessionStorage.setItem(KEY, JSON.stringify(record));
  }
  function check(name, passed, detail = null) {
    record.checks.push({ name, passed: !!passed, ...(detail == null ? {} : { detail }) });
    store();
    if (!passed) throw Error(name + (detail == null ? '' : ': ' + JSON.stringify(detail)));
  }
  async function until(predicate, label, timeout = 60000) {
    const deadline = performance.now() + timeout;
    while (!predicate()) {
      if (performance.now() > deadline) throw Error('Timed out: ' + label);
      await delay(25);
    }
  }
  async function click(selector) {
    const element = query(selector);
    if (!element || element.disabled) throw Error('Missing/disabled original control: ' + selector);
    element.click();
    await delay(15);
  }
  function settingsInput(selector, value) {
    const input = query(selector);
    if (!input) throw Error('Missing original settings field: ' + selector);
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  const summarize = (state) => ({
    version: state.version,
    time: state.time,
    rng: state.rng,
    mode: state.mode ?? null,
    difficulty: state.difficulty ?? null,
    resources: Object.fromEntries(
      ['credits', 'materials', 'oil', 'components'].map((key) => [key, state.sides[0][key] ?? 0]),
    ),
    buildings: state.buildings
      .filter((item) => item.side === 0)
      .map((item) => ({
        id: item.id,
        key: item.key,
        x: item.x,
        z: item.z,
        hp: item.hp,
        maxHp: item.maxHp,
        progress: item.progress,
      }))
      .sort((a, b) => a.id - b.id),
    roads: state.roads
      .filter((item) => item.side === 0)
      .map((item) => ({
        id: item.id,
        ax: item.ax,
        az: item.az,
        bx: item.bx,
        bz: item.bz,
        hp: item.hp,
        removed: !!item.removed,
      }))
      .sort((a, b) => a.id - b.id),
    groundUnits: state.groundUnits
      .filter((item) => item.side === 0)
      .map((item) => ({
        id: item.id,
        key: item.key,
        x: item.x,
        z: item.z,
        hp: item.hp,
        squadId: item.squadId ?? null,
        groundAmmo: item.groundAmmo,
        stance: item.stance ?? null,
      }))
      .sort((a, b) => a.id - b.id),
    aircraft: state.units
      .filter((item) => item.side === 0)
      .map((item) => ({
        id: item.id,
        key: item.key,
        x: item.x,
        y: item.y,
        z: item.z,
        sourceId: item.sourceId,
        launched: !!item.launched,
        hp: item.hp,
      }))
      .sort((a, b) => a.id - b.id),
  });
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
      renderer.render(world.scene, world.camera);
      await until(() => received && received.ack.seq > before, stage + ' native scene ACK');
      check(
        stage + ': native object registry matches current source scene',
        Number.isInteger(received.ack.scene?.objects) &&
          received.ack.scene.objects === received.expected.objects,
        {
          actual: received.ack.scene?.objects ?? null,
          expected: received.expected.objects,
          sequence: received.ack.seq,
        },
      );
      record.scenes.push({
        stage,
        sequence: received.ack.seq,
        native: received.ack.scene,
        expected: received.expected,
      });
      store();
    } finally {
      exporter.capture = originalCapture;
      transport.receive = originalReceive;
    }
  }
  function settingsMatch() {
    const actual = JSON.parse(localStorage.getItem(SETTINGS) || '{}');
    return (
      actual.sound === record.settings.sound &&
      actual.volume === record.settings.volume &&
      actual.shake === record.settings.shake &&
      actual.difficulty === record.settings.difficulty
    );
  }
  try {
    if (!fixture?.raw || !fixture.expected || !fixture.sha256)
      throw Error(
        'Missing legitimate fixture injection; run prepare-native-reload-qa.mjs and use its generated file',
      );
    record = JSON.parse(sessionStorage.getItem(KEY) || 'null') || {
      version: 1,
      fixtureSha256: fixture.sha256,
      phase: 0,
      checks: [],
      scenes: [],
      settings: { sound: false, volume: 0, shake: 0.23, difficulty: 'normal' },
    };
    if (record.fixtureSha256 !== fixture.sha256)
      throw Error('Reload QA fixture changed between pages');
    await until(
      () =>
        window.skyfront &&
        query('#welcome [data-action="start"]') &&
        !query('#welcome [data-action="start"]').disabled,
      'original startup after navigation',
    );
    api = window.skyfront;
    world = api.getWorld();
    check(
      'phase' + record.phase + ': original app uses ready Godot renderer',
      world.renderer.domElement.dataset.renderer === 'godot' &&
        world.renderer.transport.ready &&
        !window.__SKYFRONT_NATIVE_FAILED__,
    );
    check('phase' + record.phase + ': test remains outside network', !api.network());
    if (record.phase === 0) {
      const current = world.state;
      check(
        'initial page is fresh ordinary campaign',
        current.time === 0 && current.sides.length === 2 && current.sides[0].credits === 3200,
      );
      query('[data-difficulty="normal"]').click();
      query('#welcome [data-action="start"]').click();
      if (!api.isPaused()) query('#pause').click();
      await click('[data-panel="settings"]');
      settingsInput('#volume', 0);
      settingsInput('#shake', 23);
      check(
        'original settings saved before import',
        settingsMatch() && api.getAudio().enabled === false,
      );
      await click('#panel [data-action="close-panel"]');
      await nativeScene('before-import');
      const file = new File([fixture.raw], 'native-paid-original-city.json', {
        type: 'application/json',
      });
      check('legitimate import is under original file limit', file.size < 5e6);
      const transfer = new DataTransfer();
      transfer.items.add(file);
      const input = query('#import-file');
      check('original file input exists', !!input && input.type === 'file');
      record.phase = 1;
      record.importStarted = Date.now();
      store();
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      // A real reload destroys this task. Staying on this page is an actual failure.
      await delay(15000);
      throw Error('Original import did not reload the page');
    }
    if (record.phase === 1) {
      const actual = summarize(world.state),
        expected = fixture.expected;
      check(
        'imported time and RNG survive original replacement/reload',
        actual.time === expected.time && actual.rng === expected.rng,
        { time: actual.time, rng: actual.rng },
      );
      check(
        'imported resources preserved exactly',
        JSON.stringify(actual.resources) === JSON.stringify(expected.resources),
      );
      check(
        'imported own buildings preserved exactly',
        JSON.stringify(actual.buildings) === JSON.stringify(expected.buildings),
      );
      check(
        'imported own roads preserved exactly',
        JSON.stringify(actual.roads) === JSON.stringify(expected.roads),
      );
      check(
        'imported own soldiers and metadata preserved exactly',
        JSON.stringify(actual.groundUnits) === JSON.stringify(expected.groundUnits),
      );
      check(
        'imported own aircraft preserved exactly',
        JSON.stringify(actual.aircraft) === JSON.stringify(expected.aircraft),
      );
      check(
        'imported schema/mode/difficulty preserved',
        actual.version === expected.version &&
          actual.mode === expected.mode &&
          actual.difficulty === expected.difficulty,
      );
      check(
        'settings persist through import reload',
        settingsMatch() &&
          Math.abs(world.shakeStrength - 0.23) < 1e-9 &&
          api.getAudio().enabled === false,
      );
      check(
        'imported campaign returns to original continue menu',
        !query('#welcome').hidden &&
          /Продолжить/.test(query('#welcome [data-action="start"]').textContent) &&
          api.isPaused(),
      );
      await nativeScene('after-import');
      record.imported = {
        time: actual.time,
        rng: actual.rng,
        resources: actual.resources,
        ownBuildings: actual.buildings.length,
        ownSoldiers: actual.groundUnits.length,
        ownAircraft: actual.aircraft.length,
      };
      record.phase = 2;
      store();
      await click('[data-panel="settings"]');
      await click('#panel [data-action="new-confirm"]');
      check('original new-game confirmation is required', !!query('#panel [data-action="new"]'));
      await click('#panel [data-action="new"]');
      await delay(15000);
      throw Error('Original new-game confirmation did not reload the page');
    }
    if (record.phase === 2) {
      const fresh = world.state;
      check(
        'new game restores ordinary starting economy',
        fresh.time === 0 &&
          fresh.sides.length === 2 &&
          fresh.sides[0].credits === 3200 &&
          fresh.sides[0].materials === 200 &&
          fresh.sides[0].oil === 150,
      );
      check(
        'new game contains only original headquarters and no imported army',
        fresh.buildings.length === 2 &&
          fresh.buildings.every((item) => item.key === 'hq') &&
          fresh.groundUnits.length === 0 &&
          fresh.units.length === 0,
      );
      check(
        'fresh default mode matches browser semantics',
        fresh.mode == null || fresh.mode === 'solo',
      );
      check(
        'source welcome modes and difficulties remain',
        !query('#welcome').hidden &&
          ['solo', 'siege'].every((mode) => query(`[data-welcome-mode="${mode}"]`)) &&
          Object.keys(api.engine.DIFFICULTY).every((name) => query(`[data-difficulty="${name}"]`)),
      );
      check(
        'settings persist through new-game reload',
        settingsMatch() &&
          Math.abs(world.shakeStrength - 0.23) < 1e-9 &&
          api.getAudio().enabled === false,
      );
      const backup = JSON.parse(localStorage.getItem(SAVE + '-backup') || 'null');
      check(
        'source new-game backup retains imported campaign',
        backup?.time === fixture.expected.time &&
          backup?.rng === fixture.expected.rng &&
          backup?.sides?.[0]?.credits === fixture.expected.resources.credits,
      );
      await nativeScene('after-new-game');
      record.phase = 'complete';
      store();
      post({
        kind: 'qa-result',
        stage: 'complete',
        passed: true,
        scope:
          'Original file import + two actual page reloads + original confirmed new game; no state grants',
        checks: record.checks,
        imported: record.imported,
        settings: record.settings,
        resources: summarize(fresh).resources,
        fixture: { sha256: fixture.sha256, source: fixture.source },
        scenes: record.scenes,
        expectedNativeObjects: record.scenes.at(-1).expected.objects,
        limitations: [
          'Uses original File/DataTransfer input handler rather than the physical OS file chooser.',
          'Native object equality checks registry reset/cardinality, not every rendered pixel.',
          'Standalone fresh QA browser profile required; reinject generated script after each renderer-attached.',
        ],
      });
      return;
    }
    throw Error('Unexpected persisted QA phase: ' + record.phase);
  } catch (error) {
    post({
      kind: 'qa-result',
      stage: 'complete',
      passed: false,
      scope: 'Original import/reload/new-game acceptance',
      phase: record?.phase ?? null,
      checks: record?.checks || [],
      scenes: record?.scenes || [],
      error: String(error?.stack || error),
      fixture: fixture ? { sha256: fixture.sha256, source: fixture.source } : null,
      diagnostics: api?.diagnostics?.(),
    });
  }
})();
