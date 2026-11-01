// Actual original native DOM/NetworkSession Guest. No fake peer or source changes.
// Controlled dual-GPU functional acceptance only; NOT an FPS/performance benchmark.
(async () => {
  if (window.__SKYFRONT_DUAL_NATIVE_GUEST_RUNNING__) return;
  window.__SKYFRONT_DUAL_NATIVE_GUEST_RUNNING__ = true;
  const config = window.__SKYFRONT_DUAL_NATIVE_GUEST__;
  const checks = [];
  const post = (value) => window.chrome.webview.postMessage(value);
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const query = (selector) => document.querySelector(selector);
  let api, world, restoreComparison;
  function check(name, passed, detail) {
    checks.push({ name, passed: !!passed, ...(detail === undefined ? {} : { detail }) });
    if (!passed) throw Error(name + (detail === undefined ? '' : ': ' + JSON.stringify(detail)));
  }
  async function until(predicate, label, timeout = 90000) {
    const end = performance.now() + timeout;
    while (!predicate()) {
      if (performance.now() > end)
        throw Error('Timed out: ' + label + '; original UI: ' + query('#net-error')?.textContent);
      await delay(40);
    }
  }
  async function click(selector) {
    const button = query(selector);
    if (!button || button.disabled) throw Error('Missing/disabled original control: ' + selector);
    button.click();
    await delay(25);
  }
  function differences(before, after) {
    const result = { count: 0, samples: [] };
    const record = (path, a, b) => {
      result.count++;
      if (result.samples.length < 100) result.samples.push({ path, before: a, after: b });
    };
    const visit = (a, b, path) => {
      if (Object.is(a, b)) return;
      if (
        a &&
        b &&
        typeof a === 'object' &&
        typeof b === 'object' &&
        Array.isArray(a) === Array.isArray(b)
      ) {
        for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
          if (!Object.hasOwn(a, key)) record(path + '.' + key, '<missing>', b[key]);
          else if (!Object.hasOwn(b, key)) record(path + '.' + key, a[key], '<missing>');
          else visit(a[key], b[key], path + '.' + key);
        }
      } else record(path, a, b);
    };
    visit(before, after, '$');
    return result;
  }
  function paidRoadsFor(side, hq) {
    return world.state.roads.filter(
      (r) =>
        r.side === side &&
        Math.abs(Math.abs(r.az - hq.z) - 45) < 0.00001 &&
        Math.abs(r.bz - r.az) < 0.00001 &&
        Math.min(Math.abs(r.ax - hq.x), Math.abs(r.bx - hq.x)) >= 89.99 &&
        Math.max(Math.abs(r.ax - hq.x), Math.abs(r.bx - hq.x)) <= 230.01,
    );
  }
  async function nativeScene(label) {
    const renderer = world.renderer,
      exporter = renderer.exporter,
      transport = renderer.transport;
    const capture = exporter.capture,
      receive = transport.receive,
      expected = new Map();
    let result;
    const sequence = renderer._seq;
    exporter.capture = function (...args) {
      const packet = capture.apply(this, args);
      expected.set(packet.seq, this.objectCache.size);
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
        result = { native: value.scene, expected: expected.get(value.seq), sequence: value.seq };
      return receive.call(this, message);
    };
    try {
      world.sync();
      renderer.render(world.scene, world.camera);
      await until(() => result && result.sequence > sequence, label + ' real Godot scene ACK');
      check(
        label + ': native registry matches original source scene',
        result.native?.objects === result.expected,
        result,
      );
      return result;
    } finally {
      exporter.capture = capture;
      transport.receive = receive;
    }
  }
  try {
    check(
      'coordinator supplied loopback room',
      config &&
        ['pvp', 'coop'].includes(config.mode) &&
        /^[A-HJ-NP-Z2-9]{6}$/.test(config.code) &&
        ['127.0.0.1', 'localhost'].includes(new URL(config.endpoint).hostname),
    );
    await until(
      () =>
        window.skyfront &&
        query('#welcome [data-action="start"]') &&
        !query('#welcome [data-action="start"]').disabled,
      'Guest original startup readiness',
    );
    api = window.skyfront;
    world = api.getWorld();
    check(
      'Guest has real native renderer and isolated fresh profile',
      world.renderer.domElement.dataset.renderer === 'godot' &&
        world.renderer.transport.ready &&
        !api.network() &&
        world.state.time === 0 &&
        world.state.sides[0].credits === 3200,
    );
    const soloBefore = api.engine.save(world.state);
    const expectedRestore = api.engine.save(api.engine.load(soloBefore));
    await click('#welcome [data-action="network"]');
    await until(
      () => !query('#network-lobby').hidden && query('#net-code') && query('#net-address'),
      'Guest original join form',
    );
    query('#net-name').value = 'Native Guest ' + config.mode;
    query('#net-code').value = config.code;
    query('#net-address').value = config.endpoint;
    await click('#network-lobby [data-net="join"]');
    await until(
      () =>
        api.network()?.room?.phase === 'waiting' &&
        api.network().room.code === config.code &&
        query('#network-lobby [data-net="ready"]'),
      'Guest real room join',
    );
    const authoritySide = config.mode === 'coop' ? 2 : 1;
    check(
      'Guest original network seat and room mode correct',
      api.network().side === authoritySide && api.network().room.mode === config.mode,
      api.network(),
    );
    await click('#network-lobby [data-net="ready"]');
    await until(
      () => api.network()?.room?.players?.[1]?.ready,
      'Guest original ready synchronized',
    );
    post({
      kind: 'qa-result',
      stage: 'native-guest-ready',
      passed: true,
      mode: config.mode,
      code: config.code,
      authoritySide,
    });
    const cityCount = config.mode === 'coop' ? 4 : 2;
    await until(
      () =>
        api.network()?.room?.phase === 'playing' &&
        world.state.sides.length === cityCount &&
        query('#network-lobby').hidden &&
        query('#welcome').hidden &&
        world.state.time > 0.15,
      'Host original UI starts actual native Guest view',
    );
    check(
      'Guest original network render loop running with correct city count',
      !api.isPaused() && world.state.buildings.filter((b) => b.key === 'hq').length === cityCount,
      {
        cities: cityCount,
        hq: world.state.buildings
          .filter((b) => b.key === 'hq')
          .map((b) => ({ id: b.id, side: b.side, x: b.x, z: b.z })),
      },
    );
    const hq = world.state.buildings.find((b) => b.side === 0 && b.key === 'hq');
    const treasury = world.state.sides[0].credits;
    await world.callbacks.onBuild('housing', hq.x + 55, hq.z - 80, 0);
    await until(
      () =>
        world.state.buildings.some(
          (b) => b.side === 0 && b.key === 'housing' && b.x === hq.x + 55 && b.z === hq.z - 80,
        ),
      'Guest paid housing authoritative snapshot',
    );
    const guestBuilding = world.state.buildings.find(
      (b) => b.side === 0 && b.key === 'housing' && b.x === hq.x + 55 && b.z === hq.z - 80,
    );
    const candidates = [
      [
        { x: hq.x + 90, z: hq.z - 45 },
        { x: hq.x + 230, z: hq.z - 45 },
      ],
      [
        { x: hq.x - 90, z: hq.z - 45 },
        { x: hq.x - 230, z: hq.z - 45 },
      ],
      [
        { x: hq.x + 90, z: hq.z + 45 },
        { x: hq.x + 230, z: hq.z + 45 },
      ],
    ];
    const road = candidates.find(
      ([a, b]) => !api.engine.roadPreview(world.state, 0, a.x, a.z, b.x, b.z).error,
    );
    check('Guest paid road plan legal under original rules', !!road);
    check('Guest original road callback accepted', await world.callbacks.onRoad(road[0], road[1]));
    await until(() => paidRoadsFor(0, hq).length >= 2, 'Guest paid road authoritative snapshot');
    const guestRoadIds = paidRoadsFor(0, hq).map((r) => r.id);
    check('Guest work charged its real treasury', world.state.sides[0].credits < treasury, {
      before: treasury,
      after: world.state.sides[0].credits,
    });
    const hostSide = config.mode === 'coop' ? 2 : 1;
    const hostHq = world.state.buildings.find((b) => b.side === hostSide && b.key === 'hq');
    await until(
      () => world.state.buildings.some((b) => b.side === hostSide && b.key === 'power'),
      'Host paid power reaches native Guest',
    );
    await until(
      () => paidRoadsFor(hostSide, hostHq).length >= 2,
      'Host paid road reaches native Guest',
    );
    const hostBuilding = world.state.buildings.find(
      (b) => b.side === hostSide && b.key === 'power',
    );
    const hostRoadIds = paidRoadsFor(hostSide, hostHq).map((r) => r.id);
    const denied = await api.command('demolish', { id: hostBuilding.id });
    check(
      'Guest original authoritative ownership rejects Host building demolition',
      typeof denied === 'string' && /принадлежит/.test(denied),
      denied,
    );
    const beforeTime = world.state.time;
    await until(
      () => world.state.time > beforeTime + 0.3 && api.network()?.room?.phase === 'playing',
      'Guest receives continuous authoritative snapshots',
    );
    const networkScene = await nativeScene('Guest network');
    check(
      'Guest keeps both paid cities in its source/native view',
      world.state.buildings.some((b) => b.id === guestBuilding.id && b.side === 0) &&
        world.state.buildings.some((b) => b.id === hostBuilding.id && b.side === hostSide),
    );
    const network = {
      mode: config.mode,
      code: config.code,
      cities: cityCount,
      authoritySide,
      hostSideInGuestView: hostSide,
      guestBuildingId: guestBuilding.id,
      hostBuildingId: hostBuilding.id,
      guestRoadIds,
      hostRoadIds,
      networkScene,
      authoritativeTime: world.state.time,
    };
    post({
      kind: 'qa-result',
      stage: 'native-guest-verified',
      passed: true,
      ...network,
      checks,
      scope:
        'Actual second native Godot client with original DOM/NetworkSession; functional loopback acceptance, not performance',
    });
    // Host's original Leave ends the room; the ORIGINAL MultiplayerUI.onClosed
    // invokes onLeave and restores the saved local campaign. Do not replace state here.
    await until(
      () => !api.network() && !query('#welcome').hidden,
      'original Guest room-close handler restores local campaign',
      150000,
    );
    const actualRestore = api.engine.save(world.state);
    restoreComparison = {
      contract: 'Original enterNetwork E.save -> MultiplayerUI.onClosed/onLeave E.load',
      expectedVersusActual: differences(JSON.parse(expectedRestore), JSON.parse(actualRestore)),
      sourceLoadChanges: differences(JSON.parse(soloBefore), JSON.parse(expectedRestore)),
      observedChanges: differences(JSON.parse(soloBefore), JSON.parse(actualRestore)),
    };
    check(
      'Guest original room close exactly restores original E.load result',
      restoreComparison.expectedVersusActual.count === 0,
      restoreComparison,
    );
    check(
      'Guest is back in original paused solo UI',
      api.isPaused() &&
        world.state.sides.length === 2 &&
        world.state.time === 0 &&
        !query('#welcome').hidden,
    );
    const restoredScene = await nativeScene('Guest restored solo');
    post({
      kind: 'qa-result',
      stage: 'complete',
      passed: true,
      role: 'native-guest',
      ...network,
      checks,
      restoreComparison,
      restoredScene,
      renderer: world.renderer.diagnostics(),
      limitations: [
        'Functional acceptance with two native GPU processes on one host; not an FPS benchmark.',
        'Loopback server, not public Internet acceptance.',
        'Original DOM handlers exercised; trusted physical mouse was verified separately.',
        'No state/resource injection or fake NetworkSession client.',
      ],
    });
  } catch (error) {
    post({
      kind: 'qa-result',
      stage: 'complete',
      passed: false,
      role: 'native-guest',
      mode: config?.mode,
      code: config?.code,
      error: String(error?.stack || error),
      checks,
      restoreComparison,
      network: api?.network?.(),
      renderer: world?.renderer?.diagnostics?.(),
      uiError: query('#net-error')?.textContent,
    });
  }
})();
