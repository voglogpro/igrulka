// Source-paid victory/owned-ruins inspector acceptance. No HP/result/resource grants.
// Local idle-human fixture; File/DataTransfer+DOM/callbacks, not physical mouse/network/audio.
(async () => {
  if (window.__SKYFRONT_PAID_ENDGAME_RUNNING__) return;
  window.__SKYFRONT_PAID_ENDGAME_RUNNING__ = true;
  const fixture = window.__SKYFRONT_PAID_ENDGAME_FIXTURE__,
    KEY = 'skyfront-native-paid-endgame-v1',
    SAVE = 'skyfront-realtime-v3';
  const query = (s) => document.querySelector(s),
    delay = (ms = 0) => new Promise((r) => setTimeout(r, ms)),
    post = (value) => window.chrome.webview.postMessage(value);
  let record,
    api,
    world,
    state,
    engine,
    renderer,
    currentStage = 'startup';
  const resources = () =>
    Object.fromEntries(
      ['credits', 'materials', 'oil', 'components'].map((k) => [k, state.sides[0][k] || 0]),
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
      stage: 'progress-endgame-' + stage,
      passed: true,
      phase: record?.phase,
      time: state?.time,
      ...detail,
    });
  }
  async function until(predicate, label, timeout = 60000) {
    const end = performance.now() + timeout;
    while (!predicate()) {
      if (performance.now() > end) throw Error('Wall timeout ' + label);
      await delay(25);
    }
  }
  async function click(selector) {
    const button = query(selector);
    if (!button || button.disabled) throw Error('Missing/disabled original control ' + selector);
    button.click();
    await delay(25);
  }
  function key(code) {
    renderer.domElement.focus();
    for (const type of ['keydown', 'keyup'])
      renderer.domElement.dispatchEvent(
        new KeyboardEvent(type, { code, bubbles: true, cancelable: true }),
      );
  }
  function change(selector, value) {
    const input = query(selector);
    if (!input) throw Error('Missing original field ' + selector);
    input.value = String(value);
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  async function nativeScene(stage) {
    const exporter = renderer.exporter,
      transport = renderer.transport,
      originalCapture = exporter.capture,
      originalReceive = transport.receive,
      expected = new Map(),
      before = renderer._seq;
    let received;
    exporter.capture = function (...args) {
      const packet = originalCapture.apply(this, args);
      expected.set(packet.seq, {
        objects: this.objectCache.size,
        geometries: this.geometryCache.size,
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
        stage + ': Godot registry equals original source scene',
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
  async function advanceToResult() {
    const deadline = state.time + 120;
    let steps = 0;
    progress('last-paid-missile-flight');
    while (!state.result) {
      if (!api.isPaused() || api.network()) throw Error('Source stepping requires local pause');
      if (state.time >= deadline) throw Error('Original final missile failed to finish campaign');
      engine.step(state, 0.05);
      record.steps++;
      if (++steps % 20 === 0) {
        world.sync();
        await delay();
      }
    }
    world.sync();
    await delay(50);
  }
  try {
    if (!fixture?.raw || !fixture.sha256 || !fixture.lineage?.ok)
      throw Error('Missing paid endgame fixture lineage');
    record = JSON.parse(sessionStorage.getItem(KEY) || 'null') || {
      phase: 0,
      fixtureSha256: fixture.sha256,
      checks: [],
      scenes: [],
      steps: 0,
    };
    if (record.fixtureSha256 !== fixture.sha256) throw Error('Fixture changed between reloads');
    await until(
      () =>
        window.skyfront &&
        query('#welcome [data-action="start"]') &&
        !query('#welcome [data-action="start"]').disabled,
      'original startup',
      90000,
    );
    api = window.skyfront;
    world = api.getWorld();
    state = world.state;
    engine = api.engine;
    renderer = world.renderer;
    check(
      'phase' + record.phase + ': original Godot backend and local profile',
      renderer.domElement.dataset.renderer === 'godot' &&
        renderer.transport.ready &&
        !api.network() &&
        !window.__SKYFRONT_NATIVE_FAILED__,
    );
    if (record.phase === 0) {
      check(
        'isolated fresh profile before import',
        state.time === 0 && state.buildings.length === 2 && state.groundUnits.length === 0,
      );
      await click('#welcome [data-action="start"]');
      if (!api.isPaused()) await click('#pause');
      const file = new File([fixture.raw], 'native-paid-endgame-prefinish.json', {
          type: 'application/json',
        }),
        transfer = new DataTransfer();
      transfer.items.add(file);
      check('paid checkpoint fits original import limit', file.size < 5e6);
      const input = query('#import-file');
      check('original import input exists', input?.type === 'file');
      record.phase = 1;
      store();
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await delay(15000);
      throw Error('Original import failed to reload');
    }
    if (record.phase === 1) {
      const enemy = state.buildings.find((b) => b.id === fixture.ids.enemyHQ),
        ruin = state.buildings.find((b) => b.id === fixture.ids.ruin),
        base = state.buildings.find((b) => b.id === fixture.ids.navalbase),
        ship = state.warships.find((s) => s.baseId === base.id);
      check(
        'paid prefinish resources and naturally reduced HQ HP preserved',
        state.time === fixture.expected.time &&
          state.result === null &&
          enemy.hp === fixture.expected.enemyHp &&
          enemy.hp > 0 &&
          JSON.stringify(resources()) === JSON.stringify(fixture.expected.resources),
      );
      check(
        'real owned ruin and paid final local missile preserved',
        ruin.side === 0 &&
          ruin.hp === 0 &&
          !ruin.demolished &&
          engine.availableLaunchStock(base, 'cruise') === 1 &&
          ship.state === 'station',
      );
      check(
        'original source weather preserved',
        JSON.stringify(state.weather) === JSON.stringify(fixture.expected.weather),
      );
      await click('#welcome [data-action="start"]');
      if (!api.isPaused()) await click('#pause');
      if (api.getAudio().enabled) await click('#sound');
      world.focus(ruin.x, ruin.z, 240, { instant: true });
      await nativeScene('owned-ruin-before-demolition');
      progress('original-ruins-inspector');
      world.callbacks.onSelect(ruin.id);
      await until(() => !!query(`#inspector [data-demolish="${ruin.id}"]`), 'owned ruins action');
      check(
        'original inspector identifies ruin and exposes dismantle action',
        query('#inspector').textContent.includes('руины') &&
          query(`#inspector [data-demolish="${ruin.id}"]`).textContent === 'Разобрать руины',
      );
      const demolitionBudget = resources();
      await click(`#inspector [data-demolish="${ruin.id}"]`);
      await until(() => ruin.demolished === true, 'original demolition command');
      world.sync();
      check(
        'original demolition removes the actual ruined model',
        ruin.hp === 0 &&
          ruin.demolished &&
          !world.models.has(ruin.id) &&
          query('#inspector').hidden,
      );
      check(
        'ruin demolition changes no resources and frees the original plot',
        JSON.stringify(resources()) === JSON.stringify(demolitionBudget) &&
          engine.canPlace(state, ruin.key, ruin.x, ruin.z, 0) === null,
      );
      await nativeScene('owned-ruin-removed');
      key('Escape');
      key('KeyE');
      await until(() => !!query('#panel [data-weapon="cruise"]'), 'original arsenal');
      await click('#panel [data-weapon="cruise"]');
      await until(() => !!query(`#strike-site option[value="${base.id}"]`), 'original naval site');
      change('#strike-site', base.id);
      await click('#strike-controls [data-salvo="1"]');
      check(
        'final weapon is already paid and locally ready',
        engine.availableLaunchStock(base, 'cruise') === 1 &&
          engine.factoryOrderStatus(state, 0, null, 'cruise').unpaid === 0 &&
          query('#strike-site').value === String(base.id),
      );
      const beforeUnits = new Set(state.units.map((u) => u.id)),
        launchWallet = resources(),
        shipOrigin = { x: ship.x, z: ship.z };
      await world.callbacks.onAimPoint({ x: enemy.x, z: enemy.z });
      const missile = state.units.find((u) => !beforeUnits.has(u.id) && u.sourceId === base.id);
      check(
        'original final click consumes paid magazine at ship origin',
        !!missile &&
          Math.hypot(missile.startX - shipOrigin.x, missile.startZ - shipOrigin.z) < 1e-6 &&
          engine.availableLaunchStock(base, 'cruise') === 0 &&
          JSON.stringify(resources()) === JSON.stringify(launchWallet),
      );
      check(
        'launch does not assign victory or reduce HQ HP directly',
        state.result === null && enemy.hp === fixture.expected.enemyHp,
      );
      await advanceToResult();
      check(
        'actual original missile impact destroys HQ and decides victory',
        state.result === 'victory' &&
          state.winnerTeam === 0 &&
          enemy.hp === 0 &&
          state.stats.impacts > fixture.expected.impacts,
      );
      await until(() => !query('#result').hidden, 'original victory overlay');
      check(
        'original victory title and new-campaign action displayed',
        query('#result h2')?.textContent === 'Командный пункт врага уничтожен' &&
          query('#result [data-action="new"]')?.textContent === 'Новая кампания',
      );
      check(
        'source overlay has no invented continue control',
        !query('#result [data-action="continue"]'),
      );
      await nativeScene('original-victory-overlay');
      record.winner = {
        time: state.time,
        resources: resources(),
        enemyHp: enemy.hp,
        result: state.result,
        winnerTeam: state.winnerTeam,
        ruinDemolished: ruin.demolished,
      };
      store();
      post({
        kind: 'qa-result',
        stage: 'capture-endgame-victory',
        passed: true,
        holdMilliseconds: 5000,
        winner: record.winner,
        overlay: query('#result').textContent,
      });
      await delay(5000);
      api.save();
      await until(() => {
        const saved = JSON.parse(localStorage.getItem(SAVE) || 'null');
        return (
          saved?.result === 'victory' &&
          saved.buildings.find((b) => b.id === ruin.id)?.demolished === true
        );
      }, 'original finished campaign saved');
      record.phase = 2;
      store();
      progress('reopen-finished-campaign');
      location.reload();
      await delay(15000);
      throw Error('Reopen lifecycle did not reload');
    }
    if (record.phase === 2) {
      const enemy = state.buildings.find((b) => b.id === fixture.ids.enemyHQ),
        ruin = state.buildings.find((b) => b.id === fixture.ids.ruin);
      check(
        'finished campaign survives actual native-page reopen',
        state.result === 'victory' &&
          state.winnerTeam === 0 &&
          enemy.hp === 0 &&
          ruin.demolished &&
          state.time === record.winner.time &&
          JSON.stringify(resources()) === JSON.stringify(record.winner.resources),
      );
      check(
        'original welcome exposes continue for the saved campaign',
        !query('#welcome').hidden &&
          query('#welcome [data-action="start"]').textContent.includes('Продолжить'),
      );
      await click('#welcome [data-action="start"]');
      await until(
        () => query('#welcome').hidden && !query('#result').hidden,
        'continued finished campaign overlay',
      );
      check(
        'continue preserves the completed result and original victory UI',
        state.result === 'victory' &&
          enemy.hp === 0 &&
          query('#result h2')?.textContent === 'Командный пункт врага уничтожен' &&
          state.time === record.winner.time,
      );
      await nativeScene('finished-campaign-continued');
      record.phase = 3;
      store();
      progress('original-new-campaign');
      await click('#result [data-action="new"]');
      await delay(15000);
      throw Error('Original new campaign action failed to reload');
    }
    if (record.phase === 3) {
      check(
        'new campaign has normal starting economy and no result',
        state.result === null &&
          state.time === 0 &&
          state.sides[0].credits === 3200 &&
          state.sides[0].materials === 200 &&
          state.sides[0].oil === 150 &&
          state.sides[0].components === 0,
      );
      check(
        'new campaign has only two intact original HQs',
        state.buildings.length === 2 &&
          state.buildings.every((b) => b.key === 'hq' && b.hp === b.maxHp) &&
          state.groundUnits.length === 0 &&
          state.units.length === 0 &&
          state.ships.length === 0 &&
          state.warships.length === 0,
      );
      check(
        'new campaign clears victory overlay and retains original start menu',
        query('#result').hidden &&
          !query('#welcome').hidden &&
          !query('#welcome [data-action="start"]').textContent.includes('Продолжить'),
      );
      const backup = JSON.parse(localStorage.getItem(SAVE + '-backup') || 'null');
      check(
        'original new-campaign backup preserves finished paid campaign',
        backup?.result === 'victory' &&
          backup.buildings.find((b) => b.id === fixture.ids.enemyHQ)?.hp === 0 &&
          backup.buildings.find((b) => b.id === fixture.ids.ruin)?.demolished === true,
      );
      await nativeScene('fresh-campaign-after-victory');
      check(
        'native backend remains healthy after three real reloads',
        !renderer.transport.failed && !window.__SKYFRONT_NATIVE_FAILED__,
      );
      record.phase = 'complete';
      store();
      post({
        kind: 'qa-result',
        stage: 'complete',
        passed: true,
        scope:
          'Paid source-missile endgame, actual owned-ruins inspector/demolition, original victory overlay, save/reopen/continue/new campaign',
        checks: record.checks,
        scenes: record.scenes,
        steps: record.steps,
        winner: record.winner,
        fixture: { sha256: fixture.sha256, source: fixture.source, lineage: fixture.lineage },
        stats: renderer.diagnostics(),
        original: api.diagnostics(),
        limitations: [
          'The CPU lineage includes an explicitly paid friendly-fire cruise mission against an isolated paid MOG to create own ruins.',
          'Offline idle-human mode; no network, competitive balance, physical OS input or audible audio proof.',
          'Continue is the original saved-campaign welcome action, not an invented victory-overlay button.',
          'Only the final paid missile flight is advanced here with original E.step while paused; no real-time FPS claim.',
        ],
      });
      return;
    }
    throw Error('Unexpected lifecycle phase ' + record.phase);
  } catch (error) {
    post({
      kind: 'qa-result',
      stage: 'complete',
      passed: false,
      scope: 'Paid endgame/ruins native acceptance',
      phase: record?.phase,
      currentStage,
      checks: record?.checks || [],
      scenes: record?.scenes || [],
      error: String(error?.stack || error),
      time: state?.time,
      result: state?.result,
      resources: state ? resources() : null,
      stats: world?.renderer?.diagnostics?.(),
      original: api?.diagnostics?.(),
    });
  }
})();
