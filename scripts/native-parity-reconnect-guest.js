// QA only: original native UI/NetworkSession, real native WebSocket close/resume.
// No fake transport, manual simulation steps, changed backoff, or resource grants.
(async () => {
  if (window.__SKYFRONT_RECONNECT_RUNNING__) return;
  window.__SKYFRONT_RECONNECT_RUNNING__ = true;
  const config = window.__SKYFRONT_RECONNECT_CONFIG__,
    checks = [],
    scenes = [];
  const post = (value) => window.chrome.webview.postMessage(value),
    query = (s) => document.querySelector(s),
    delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const OriginalWebSocket = window.WebSocket,
    sockets = [],
    joined = [],
    samples = [];
  let api,
    world,
    stage = 'startup',
    privateToken,
    lastSequence = 0,
    phaseLost = false,
    dropAt,
    resumeSent = false,
    sourceSequenceBeforeDrop,
    soloRestore;
  const wallet = (s) =>
    Object.fromEntries(['credits', 'materials', 'oil', 'components'].map((k) => [k, s[k] || 0]));
  const ammunition = (b) =>
    Object.fromEntries(
      ['groundAmmo', 'ammoReserve', 'ammo', 'missiles', 'reserve']
        .filter((k) => b[k] !== undefined)
        .map((k) => [k, b[k]]),
    );
  const check = (name, passed, detail) => {
    checks.push({ name, passed: !!passed, ...(detail === undefined ? {} : { detail }) });
    if (!passed) throw Error(name + (detail === undefined ? '' : ': ' + JSON.stringify(detail)));
  };
  const progress = (name, detail = {}) => {
    stage = name;
    post({ kind: 'qa-result', stage: 'reconnect-' + name, passed: true, ...detail });
  };
  async function until(test, label, timeout = 90000) {
    const end = performance.now() + timeout;
    while (!test()) {
      if (performance.now() > end)
        throw Error('Timed out: ' + label + '; ' + query('#net-error')?.textContent);
      await delay(25);
    }
  }
  async function click(selector) {
    const b = query(selector);
    if (!b || b.disabled) throw Error('Unavailable original control ' + selector);
    b.click();
    await delay(20);
  }
  async function control(name, body) {
    const r = await fetch(config.control + '/' + name, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const v = await r.json();
    if (!r.ok || v.failed) throw Error('QA authority ' + name + ': ' + v.error);
    return v;
  }
  async function statusUntil(test, label) {
    const end = performance.now() + 90000;
    while (true) {
      const value = await control('status');
      if (value.failed) throw Error(value.error);
      if (test(value)) return value;
      if (performance.now() > end) throw Error('Timed out host ' + label);
      await delay(40);
    }
  }
  async function snapshotProof(generation) {
    await until(
      () => samples.some((s) => s.generation === generation),
      'decoded original snapshot generation ' + generation,
    );
    const sample = samples.findLast((s) => s.generation === generation);
    const proof = await control('snapshot', sample);
    check(
      'generation' +
        generation +
        ': decoded source treasury/stock equals exact serialized authority frame',
      proof.matched,
      { generation: proof.generation, tick: proof.tick, syncSeq: proof.syncSeq },
    );
    return proof;
  }
  async function nativeScene(name) {
    const renderer = world.renderer,
      exporter = renderer.exporter,
      transport = renderer.transport,
      capture = exporter.capture,
      receive = transport.receive,
      expected = new Map(),
      before = renderer._seq;
    let actual;
    exporter.capture = function (...args) {
      const packet = capture.apply(this, args);
      expected.set(packet.seq, this.objectCache.size);
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
        actual = { sequence: value.seq, native: value.scene, expected: expected.get(value.seq) };
      return receive.call(this, message);
    };
    try {
      world.sync();
      world.post.render(world.scene, world.camera, world.battleTime);
      await until(() => actual && actual.sequence > before, name + ' native ACK');
      check(
        name + ': Godot registry equals original source scene',
        actual.native?.objects === actual.expected,
        actual,
      );
      scenes.push({ stage: name, ...actual });
    } finally {
      exporter.capture = capture;
      transport.receive = receive;
    }
  }
  class ObservedWebSocket extends OriginalWebSocket {
    constructor(...args) {
      super(...args);
      const url = new URL(String(args[0])),
        target = new URL(config.endpoint);
      if (url.hostname !== target.hostname || url.port !== target.port || url.pathname !== '/match')
        return;
      this.qaGeneration = sockets.length + 1;
      sockets.push(this);
      this.addEventListener('message', (event) => {
        let m;
        try {
          m = JSON.parse(event.data);
        } catch {
          return;
        }
        if (m.type === 'joined') {
          const tokenMatched = privateToken === undefined || privateToken === m.token;
          if (privateToken === undefined) privateToken = m.token;
          joined.push({
            generation: this.qaGeneration,
            side: m.side,
            seat: m.seat,
            code: m.room.code,
            lastSequence: m.lastSequence || 0,
            tokenMatched,
          });
        }
        if (m.room?.phase === 'disconnected') phaseLost = true;
      });
      // open is asynchronous: NetworkSession has already registered its original
      // message handler after this constructor returned. Append the audit handler
      // now so it reads the actual decoded state AFTER that original handler.
      this.addEventListener('open', () =>
        this.addEventListener('message', (event) => {
          let m;
          try {
            m = JSON.parse(event.data);
          } catch {
            return;
          }
          if (!(m.sync || m.state) || !api?.network() || !Number.isSafeInteger(m.tick)) return;
          const state = world.state;
          samples.push({
            generation: this.qaGeneration,
            tick: m.tick,
            syncSeq: m.sync?.seq || 0,
            time: state.time,
            resources: wallet(state.sides[0]),
            inventory: { ...state.sides[0].inventory },
            ammoStock: { ...state.sides[0].ammoStock },
          });
          if (samples.length > 100) samples.shift();
        }),
      );
      this.addEventListener('close', () => {
        if (this.qaGeneration === 1) phaseLost = true;
      });
    }
    send(raw) {
      let m;
      try {
        m = JSON.parse(raw);
      } catch {}
      if (m?.type === 'command') lastSequence = Math.max(lastSequence, m.sequence || 0);
      if (m?.type === 'resume') {
        resumeSent = true;
        check(
          'automatic source resume uses original private credential and same room',
          m.token === privateToken && m.code === config.code,
          { tokenMatched: m.token === privateToken, room: m.code },
        );
      }
      return super.send(raw);
    }
  }
  try {
    check(
      'QA endpoint is restricted to loopback',
      !!config &&
        ['127.0.0.1', 'localhost'].includes(new URL(config.endpoint).hostname) &&
        ['127.0.0.1', 'localhost'].includes(new URL(config.control).hostname),
    );
    window.WebSocket = ObservedWebSocket;
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
      'fresh original Godot profile is ready',
      !api.network() &&
        world.state.time === 0 &&
        world.renderer.transport.ready &&
        world.renderer.domElement.dataset.renderer === 'godot',
    );
    soloRestore = api.engine.save(api.engine.load(api.engine.save(world.state)));
    progress('join-original-room');
    await click('#welcome [data-action="network"]');
    await until(() => query('#net-address') && query('#net-code'), 'original join form');
    query('#net-address').value = config.endpoint;
    query('#net-code').value = config.code;
    query('#net-name').value = 'Native reconnect guest';
    await click('#network-lobby [data-net="join"]');
    await until(
      () => api.network()?.room?.phase === 'waiting' && query('#network-lobby [data-net="ready"]'),
      'original guest joins',
    );
    check(
      'actual first native socket joins the original second seat',
      sockets.length === 1 &&
        sockets[0] instanceof OriginalWebSocket &&
        joined[0]?.seat === 1 &&
        joined[0]?.side === 1 &&
        joined[0]?.code === config.code,
      joined[0],
    );
    await click('#network-lobby [data-net="ready"]');
    await until(
      () =>
        api.network()?.room?.phase === 'playing' &&
        !api.isPaused() &&
        world.state.time > 0.1 &&
        query('#network-lobby').hidden,
      'original authority starts playing',
    );
    await statusUntil((s) => !!s.hostBuildingId, 'host paid power');
    const hq = world.state.buildings.find((b) => b.key === 'hq' && b.side === 0);
    progress('paid-housing-and-mog');
    await world.callbacks.onBuild('housing', hq.x + 55, hq.z - 80, 0);
    await until(
      () => world.state.buildings.some((b) => b.key === 'housing' && b.side === 0),
      'paid housing snapshot',
    );
    const housing = world.state.buildings.find((b) => b.key === 'housing' && b.side === 0);
    const plot = [
      { x: hq.x - 130, z: hq.z + 130 },
      { x: hq.x + 130, z: hq.z + 150 },
      { x: hq.x - 170, z: hq.z - 160 },
    ].find((p) => api.engine.canPlace(world.state, 'gun', p.x, p.z, 0) === null);
    check('original placement rules offer legal MOG plot', !!plot);
    await world.callbacks.onBuild('gun', plot.x, plot.z, 0);
    await until(
      () => world.state.buildings.some((b) => b.key === 'gun' && b.side === 0),
      'paid MOG snapshot',
    );
    const mog = world.state.buildings.find((b) => b.key === 'gun' && b.side === 0);
    check(
      'original paid MOG has nonzero default ammunition',
      Number(mog.groundAmmo || mog.ammo || 0) > 0 || Number(mog.ammoReserve || 0) > 0,
      {
        id: mog.id,
        groundAmmo: mog.groundAmmo,
        ammo: mog.ammo,
        reserve: mog.ammoReserve,
        progress: mog.progress,
      },
    );
    await until(
      () => world.state.buildings.find((b) => b.id === mog.id)?.progress === 1,
      'original twelve-second MOG construction',
    );
    const mogStock = ammunition(world.state.buildings.find((b) => b.id === mog.id));
    await nativeScene('paid-before-drop');
    await snapshotProof(1);
    const armed = await control('arm', { guestBuildingId: housing.id, mogId: mog.id });
    sourceSequenceBeforeDrop = lastSequence;
    check(
      'source acknowledged all paid commands before drop',
      sourceSequenceBeforeDrop === armed.sequence && sourceSequenceBeforeDrop > 0,
      { sourceSequenceBeforeDrop, authority: armed.sequence },
    );
    progress('actual-native-websocket-drop', { generation: 1, sequence: sourceSequenceBeforeDrop });
    dropAt = performance.now();
    sockets[0].close(4000, 'QA transient drop');
    await until(
      () =>
        api.network()?.room?.phase === 'disconnected' && api.isPaused() && !query('#paused').hidden,
      'original connection-loss pause',
      5000,
    );
    check(
      'actual close exposes original pause and loss overlay',
      phaseLost && query('#paused').textContent.includes('СВЯЗЬ ПОТЕРЯНА'),
    );
    const deniedWhilePaused = await api.command('demolish', { id: housing.id });
    check(
      'original paused guest command is rejected without sequence increment',
      typeof deniedWhilePaused === 'string' && lastSequence === sourceSequenceBeforeDrop,
      { denied: deniedWhilePaused, sequence: lastSequence },
    );
    const frozen = await statusUntil((s) => !!s.freeze, 'authority frozen during actual drop');
    check(
      'original host proved paused authority with exact complete state hash',
      frozen.freeze.passed && frozen.freeze.before.hash === frozen.freeze.after.hash,
      {
        tick: frozen.freeze.after.tick,
        rng: frozen.freeze.after.rng,
        hash: frozen.freeze.after.hash,
      },
    );
    await until(
      () =>
        joined.length === 2 &&
        api.network()?.room?.phase === 'playing' &&
        !api.isPaused() &&
        query('#paused').hidden,
      'original automatic resume',
    );
    check(
      'actual replacement native socket resumes same private seat and sequence',
      sockets.length === 2 &&
        sockets[1] instanceof OriginalWebSocket &&
        joined[1].tokenMatched &&
        joined[1].seat === joined[0].seat &&
        joined[1].side === joined[0].side &&
        joined[1].code === joined[0].code &&
        joined[1].lastSequence === sourceSequenceBeforeDrop &&
        resumeSent,
      { joined, elapsedMilliseconds: Math.round(performance.now() - dropAt) },
    );
    await statusUntil((s) => !!s.reattach && !!s.recovered, 'same authority restored');
    await snapshotProof(2);
    progress('post-resume-paid-command');
    const nowHq = world.state.buildings.find((b) => b.key === 'hq' && b.side === 0);
    await world.callbacks.onBuild('power', nowHq.x - 55, nowHq.z - 80, 0);
    await until(
      () => world.state.buildings.some((b) => b.key === 'power' && b.side === 0),
      'post-resume power snapshot',
    );
    const power = world.state.buildings.find((b) => b.key === 'power' && b.side === 0),
      hostPower = world.state.buildings.find((b) => b.id === armed.hostBuildingId);
    const denied = await api.command('demolish', { id: hostPower.id });
    check(
      'resumed original authority still enforces ownership',
      typeof denied === 'string' && /принадлежит/.test(denied),
      denied,
    );
    check(
      'paid original IDs and nonzero MOG ammunition remain in native view',
      [housing.id, mog.id, hostPower.id].every(
        (id) =>
          world.state.buildings.filter((b) => b.id === id && b.hp > 0 && !b.demolished).length ===
          1,
      ) &&
        JSON.stringify(ammunition(world.state.buildings.find((b) => b.id === mog.id))) ===
          JSON.stringify(mogStock),
      { before: mogStock, after: ammunition(world.state.buildings.find((b) => b.id === mog.id)) },
    );
    await until(
      () => world.state.time > frozen.freeze.after.time + 0.2,
      'normal authority forward progress',
    );
    const verified = await control('verify', { postBuildingId: power.id });
    check(
      'authority verifies actual resume, paid spend, stock and continuing time',
      verified.passed,
      verified,
    );
    await nativeScene('after-real-reconnect');
    check(
      'native transport remains healthy after original automatic reconnect',
      !world.renderer.transport.failed && !window.__SKYFRONT_NATIVE_FAILED__,
    );
    progress('original-leave-and-restore');
    api.openPanel('settings');
    await until(() => query('#panel [data-action="network"]'), 'original settings network control');
    await click('#panel [data-action="network"]');
    await until(
      () => query('#network-lobby [data-net="leave"]') && !query('#network-lobby').hidden,
      'original leave control',
    );
    await click('#network-lobby [data-net="leave"]');
    await until(() => !api.network(), 'original network leave');
    check(
      'original leave restores complete source solo campaign',
      api.engine.save(world.state) === soloRestore,
    );
    await control('finish', {});
    window.WebSocket = OriginalWebSocket;
    post({
      kind: 'qa-result',
      stage: 'complete',
      passed: true,
      scope:
        'One actual native guest; real WebSocket close4000 and original automatic reconnect to original Node NetworkSession host; loopback only',
      checks,
      scenes,
      joined,
      authority: verified,
      physicalInput: false,
      publicInternetAcceptance: false,
      performanceBenchmark: false,
    });
  } catch (error) {
    window.WebSocket = OriginalWebSocket;
    post({
      kind: 'qa-result',
      stage: 'complete',
      passed: false,
      currentStage: stage,
      error: String(error?.stack || error),
      checks,
      scenes,
      joined,
      network: api?.network(),
      native: world?.renderer?.diagnostics?.(),
    });
  }
})();
