// Actual original native NetworkSession/MultiplayerUI + real loopback server.
// A Node peer runs the ORIGINAL NetworkSession; no second GPU and no fake client.
(async () => {
  if (window.__SKYFRONT_NETWORK_QA_RUNNING__) return;
  window.__SKYFRONT_NETWORK_QA_RUNNING__ = true;
  const checks = [],
    modes = [];
  const post = (value) => window.chrome.webview.postMessage(value);
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const query = (selector) => document.querySelector(selector);
  let api, world, lastRestoreComparison;
  const check = (name, passed, detail) => {
    checks.push({ name, passed: !!passed, ...(detail === undefined ? {} : { detail }) });
    if (!passed) throw Error(name + (detail === undefined ? '' : ': ' + JSON.stringify(detail)));
  };
  async function until(predicate, label, timeout = 60000) {
    const end = performance.now() + timeout;
    while (!predicate()) {
      if (performance.now() > end)
        throw Error('Timed out: ' + label + '; UI error: ' + query('#net-error')?.textContent);
      await delay(35);
    }
  }
  async function click(selector) {
    const button = query(selector);
    if (!button || button.disabled) throw Error('Unavailable original control: ' + selector);
    button.click();
    await delay(20);
  }
  function stateDifferences(before, after) {
    const result = { count: 0, samples: [] };
    const missing = '<missing>';
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
          const child = path + '.' + key;
          if (!Object.hasOwn(a, key)) record(child, missing, b[key]);
          else if (!Object.hasOwn(b, key)) record(child, a[key], missing);
          else visit(a[key], b[key], child);
        }
      } else record(path, a, b);
    };
    visit(before, after, '$');
    return result;
  }
  async function nativeScene() {
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
      await until(() => result && result.sequence > sequence, 'native network view ACK');
      check(
        'actual Godot network registry matches source scene',
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
    await until(
      () =>
        window.skyfront &&
        query('#welcome [data-action="start"]') &&
        !query('#welcome [data-action="start"]').disabled,
      'original startup readiness',
    );
    api = window.skyfront;
    world = api.getWorld();
    check(
      'native original renderer and local fresh profile ready',
      world.renderer.transport.ready &&
        world.renderer.domElement.dataset.renderer === 'godot' &&
        !api.network() &&
        world.state.time === 0,
    );
    for (const mode of ['pvp', 'coop']) {
      const checkStart = checks.length;
      await click('#welcome [data-action="network"]');
      await until(
        () => !query('#network-lobby').hidden && query('#net-address'),
        'original network menu',
      );
      await click('#network-lobby [data-net-mode="' + mode + '"]');
      const provided = globalThis.__SKYFRONT_NATIVE__?.serverAddress;
      const endpoint = query('#net-address').value;
      const original = new URL(provided),
        actual = new URL(endpoint);
      check(
        mode + ': original form defaults to bundled live endpoint',
        ['127.0.0.1', 'localhost'].includes(actual.hostname) &&
          actual.hostname === original.hostname &&
          actual.port === original.port,
        { endpoint, provided },
      );
      query('#net-name').value = 'Native UI ' + mode;
      // Exact ORIGINAL restore contract: enterNetwork saves, leaveNetwork loads.
      // E.load increments networkRevision and performs original canonicalization.
      // Compute from this round's complete state; exclude/ignore NO state fields.
      const soloBefore = api.engine.save(world.state);
      const expectedSoloRestore = api.engine.save(api.engine.load(soloBefore));
      await click('#network-lobby [data-net="create"]');
      await until(
        () =>
          api.network()?.room?.phase === 'waiting' && query('#network-lobby [data-net="ready"]'),
        'original create-room UI',
      );
      const room = api.network().room;
      check(
        mode + ': room mode and native owner match original UI',
        room.mode === mode && api.network().side === 0 && /^[A-HJ-NP-Z2-9]{6}$/.test(room.code),
        { code: room.code, mode: room.mode, side: api.network().side },
      );
      post({
        kind: 'qa-result',
        stage: 'await-network-peer',
        mode,
        endpoint,
        code: room.code,
        loopbackOnly: true,
        instruction:
          'Run original Node NetworkSession peer: node native/network/native-peer.mjs "' +
          endpoint +
          '" ' +
          room.code +
          ' ' +
          mode,
      });
      await until(
        () =>
          api.network()?.room?.players?.length === 2 &&
          api.network().room.players.every((player) => player?.connected) &&
          api.network().room.players[1]?.ready,
        'real original Node peer joins and readies',
        90000,
      );
      await click('#network-lobby [data-net="ready"]');
      await until(
        () =>
          query('#network-lobby [data-net="start"]') &&
          !query('#network-lobby [data-net="start"]').disabled,
        'original Start becomes enabled after both ready',
      );
      check(
        mode + ': actual ready state synchronized',
        api.network().room.players.every((player) => player?.connected && player.ready),
      );
      await click('#network-lobby [data-net="start"]');
      const cityCount = mode === 'coop' ? 4 : 2,
        peerSide = mode === 'coop' ? 2 : 1;
      await until(
        () =>
          api.network()?.room?.phase === 'playing' &&
          world.state.sides.length === cityCount &&
          query('#welcome').hidden &&
          query('#network-lobby').hidden &&
          world.state.time > 0.15,
        'real authoritative network game enters original render loop',
      );
      check(
        mode + ': original started view has expected cities',
        world.state.buildings.filter((b) => b.key === 'hq').length === cityCount && !api.isPaused(),
        {
          cities: world.state.sides.length,
          hq: world.state.buildings
            .filter((b) => b.key === 'hq')
            .map((b) => ({ side: b.side, x: b.x, z: b.z })),
        },
      );
      const hq = world.state.buildings.find((b) => b.side === 0 && b.key === 'hq');
      const beforeCredits = world.state.sides[0].credits;
      const initialRoadIds = new Set(world.state.roads.map((r) => r.id));
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
      check(mode + ': paid native road preview legal', !!road);
      check(
        mode + ': original road callback accepted authoritative command',
        await world.callbacks.onRoad(road[0], road[1]),
      );
      await until(
        () => world.state.roads.some((r) => r.side === 0 && !initialRoadIds.has(r.id)),
        'native paid road snapshot',
      );
      const nativeRoadIds = world.state.roads
        .filter((r) => r.side === 0 && !initialRoadIds.has(r.id))
        .map((r) => r.id);
      await world.callbacks.onBuild('power', hq.x - 55, hq.z - 80, 0);
      await until(
        () =>
          world.state.buildings.some(
            (b) => b.side === 0 && b.key === 'power' && b.x === hq.x - 55 && b.z === hq.z - 80,
          ),
        'native paid power snapshot',
      );
      const nativeBuilding = world.state.buildings.find((b) => b.side === 0 && b.key === 'power');
      check(
        mode + ': native own work charged real treasury',
        world.state.sides[0].credits < beforeCredits,
        { before: beforeCredits, after: world.state.sides[0].credits },
      );
      await until(
        () => world.state.buildings.some((b) => b.side === peerSide && b.key === 'housing'),
        'Node peer paid building reaches native snapshot',
      );
      const peerHq = world.state.buildings.find((b) => b.side === peerSide && b.key === 'hq');
      const isPaidPeerRoad = (r) =>
        r.side === peerSide &&
        Math.abs(Math.abs(r.az - peerHq.z) - 45) < 0.00001 &&
        Math.abs(r.bz - r.az) < 0.00001 &&
        Math.min(Math.abs(r.ax - peerHq.x), Math.abs(r.bx - peerHq.x)) >= 89.99 &&
        Math.max(Math.abs(r.ax - peerHq.x), Math.abs(r.bx - peerHq.x)) <= 230.01;
      await until(
        () => world.state.roads.some(isPaidPeerRoad),
        'Node peer paid roads reach native snapshot',
      );
      const peerBuilding = world.state.buildings.find(
        (b) => b.side === peerSide && b.key === 'housing',
      );
      const peerRoadIds = world.state.roads.filter(isPaidPeerRoad).map((r) => r.id);
      const denied = await api.command('demolish', { id: peerBuilding.id });
      check(
        mode + ': original authoritative ownership rejects native demolish of peer building',
        typeof denied === 'string' && /принадлежит/.test(denied),
        denied,
      );
      const time = world.state.time;
      await until(
        () => world.state.time > time + 0.3 && api.network()?.room?.phase === 'playing',
        'continuous native authoritative snapshots',
      );
      const native = await nativeScene();
      check(
        mode + ': both paid cities visible simultaneously to native',
        world.state.buildings.some((b) => b.id === nativeBuilding.id) &&
          world.state.buildings.some((b) => b.id === peerBuilding.id),
      );
      const result = {
        mode,
        code: room.code,
        endpoint,
        cities: cityCount,
        nativeSide: 0,
        peerSide,
        nativeBuildingId: nativeBuilding.id,
        peerBuildingId: peerBuilding.id,
        nativeRoadIds,
        peerRoadIds,
        checks: checks.slice(checkStart),
        authoritativeTime: world.state.time,
        native,
      };
      modes.push(result);
      post({
        kind: 'qa-result',
        stage: 'network-mode-complete',
        passed: true,
        ...result,
        scope: 'Actual native original lobby + original Node NetworkSession peer; loopback only',
      });
      await delay(2500);
      api.openPanel('settings');
      await until(
        () => query('#panel [data-action="network"]'),
        'original settings network button',
      );
      await click('#panel [data-action="network"]');
      await until(
        () => query('#network-lobby [data-net="leave"]') && !query('#network-lobby').hidden,
        'original active room menu',
      );
      await click('#network-lobby [data-net="leave"]');
      await until(
        () => !api.network() && !query('#welcome').hidden,
        'original leave restores local campaign',
      );
      const actualSoloRestore = api.engine.save(world.state);
      lastRestoreComparison = {
        mode,
        contract:
          'Original enterNetwork E.save -> original leaveNetwork E.load, including load normalization/revision increment',
        expectedVersusActual: stateDifferences(
          JSON.parse(expectedSoloRestore),
          JSON.parse(actualSoloRestore),
        ),
        sourceLoadChanges: stateDifferences(
          JSON.parse(soloBefore),
          JSON.parse(expectedSoloRestore),
        ),
        observedChanges: stateDifferences(JSON.parse(soloBefore), JSON.parse(actualSoloRestore)),
        revision: {
          before: JSON.parse(soloBefore).networkRevision,
          expected: JSON.parse(expectedSoloRestore).networkRevision,
          actual: JSON.parse(actualSoloRestore).networkRevision,
        },
      };
      result.soloRestore = lastRestoreComparison;
      check(
        mode + ': original leave exactly matches original E.load restore contract',
        lastRestoreComparison.expectedVersusActual.count === 0,
        lastRestoreComparison,
      );
      post({
        kind: 'qa-result',
        stage: 'network-original-restore',
        passed: true,
        mode,
        comparison: lastRestoreComparison,
      });
      await delay(200);
    }
    post({
      kind: 'qa-result',
      stage: 'complete',
      passed: true,
      scope:
        'Actual native original network UI and original Node peer: PvP2 + coop4, paid roads/buildings both directions, ownership, original leave',
      loopbackOnly: true,
      checks,
      modes,
      renderer: world.renderer.diagnostics(),
      limitations: [
        'Loopback transport, not public Internet hosting.',
        'Node peer uses original NetworkSession without a second GPU.',
        'Original UI DOM events used for room actions; physical mouse verified separately.',
      ],
    });
  } catch (error) {
    post({
      kind: 'qa-result',
      stage: 'complete',
      passed: false,
      scope: 'Actual native original network UI + original Node peer',
      checks,
      modes,
      error: String(error?.stack || error),
      room: api?.network?.(),
      restoreComparison: lastRestoreComparison,
      renderer: world?.renderer?.diagnostics?.(),
      uiError: query('#net-error')?.textContent,
    });
  }
})();
