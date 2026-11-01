// Physical Windows input + ORIGINAL export button acceptance only.
// No synthetic Start/W/export clicks, no download/Blob interception, no state edits.
(async () => {
  if (window.__SKYFRONT_NATIVE_INPUT_EXPORT_QA__) return;
  window.__SKYFRONT_NATIVE_INPUT_EXPORT_QA__ = true;
  const checks = [];
  const post = (value) => window.chrome.webview.postMessage(value);
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const query = (selector) => document.querySelector(selector);
  const listeners = [],
    heartbeatStops = [];
  let api,
    world,
    phase = 'startup',
    expectedExport,
    trustedExportAtUtc;
  const keyDowns = [],
    keyUps = [];
  function check(name, passed, detail) {
    checks.push({ name, passed: !!passed, ...(detail === undefined ? {} : { detail }) });
    if (!passed) throw Error(name + (detail === undefined ? '' : ': ' + JSON.stringify(detail)));
  }
  async function until(predicate, label, timeout = 300000) {
    const end = performance.now() + timeout;
    while (!predicate()) {
      if (performance.now() > end) throw Error('Timed out: ' + label);
      await delay(30);
    }
  }
  function listen(element, type, handler, capture = true) {
    element.addEventListener(type, handler, capture);
    listeners.push(() => element.removeEventListener(type, handler, capture));
  }
  function rectangle(element) {
    const r = element.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }
  function inputStage(stage, element, point, instruction, extra = {}) {
    const inputId = stage + '-' + Date.now();
    let pointSequence = 0,
      stopped = false;
    const send = () => {
      if (stopped) return;
      const r = rectangle(element);
      post({
        kind: 'qa-result',
        stage,
        inputId,
        pointSequence: ++pointSequence,
        postedAtUtc: new Date().toISOString(),
        target: element.id || element.dataset.action || element.tagName,
        rect: r,
        point:
          typeof point === 'function'
            ? point(r)
            : point || { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) },
        viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
        coordinates:
          'CSS client pixels; scale to actual owned HWND client pixels if DPI dimensions differ',
        instruction,
        ...extra,
      });
    };
    send();
    const timer = setInterval(send, 500);
    const stop = () => {
      stopped = true;
      clearInterval(timer);
    };
    heartbeatStops.push(stop);
    return stop;
  }
  async function nativeScene(label) {
    const renderer = world.renderer,
      exporter = renderer.exporter,
      transport = renderer.transport;
    const originalCapture = exporter.capture,
      originalReceive = transport.receive,
      expected = new Map();
    let result;
    const sequence = renderer._seq;
    exporter.capture = function (...args) {
      const packet = originalCapture.apply(this, args);
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
      return originalReceive.call(this, message);
    };
    try {
      world.sync();
      renderer.render(world.scene, world.camera);
      await until(() => result && result.sequence > sequence, label + ' Godot scene ACK', 30000);
      check(
        label + ': actual native registry matches original scene',
        result.native?.objects === result.expected,
        result,
      );
      return result;
    } finally {
      exporter.capture = originalCapture;
      transport.receive = originalReceive;
    }
  }
  try {
    await until(
      () =>
        window.skyfront &&
        query('#welcome [data-action="start"]') &&
        !query('#welcome [data-action="start"]').disabled,
      'original app readiness',
      90000,
    );
    api = window.skyfront;
    world = api.getWorld();
    check(
      'fresh original solo state and real Godot renderer',
      !api.network() &&
        api.isPaused() &&
        world.state.time === 0 &&
        world.state.sides[0].credits === 3200 &&
        world.renderer.transport.ready &&
        world.renderer.domElement.dataset.renderer === 'godot',
    );
    let trustedStart = false;
    const start = query('#welcome [data-action="start"]');
    listen(start, 'click', (event) => {
      if (event.isTrusted) trustedStart = true;
    });
    phase = 'start';
    const stopStart = inputStage(
      'await-native-start',
      start,
      null,
      'Root: real -Hardware click at this original Start button; DOM synthetic click does not satisfy acceptance',
    );
    await until(() => trustedStart && query('#welcome').hidden, 'real trusted native Start click');
    stopStart();
    if (!api.isPaused()) query('#pause').click();
    check(
      'original Start received trusted Windows input',
      trustedStart && query('#welcome').hidden,
    );
    check('source simulation paused before camera test', api.isPaused() && !api.network());
    const canvas = world.renderer.domElement;
    const desiredBefore = world.controls.desired.clone();
    const cameraBefore = world.camera.position.clone();
    phase = 'wasd';
    listen(window, 'keydown', (event) => {
      if (phase === 'wasd' && event.code === 'KeyW' && event.isTrusted)
        keyDowns.push({ at: event.timeStamp, repeat: event.repeat, target: event.target?.tagName });
    });
    listen(window, 'keyup', (event) => {
      if (phase === 'wasd' && event.code === 'KeyW' && event.isTrusted)
        keyUps.push({ at: event.timeStamp, target: event.target?.tagName });
    });
    const bounds = canvas.getBoundingClientRect();
    const point = {
      x: Math.round(bounds.x + bounds.width * 0.75),
      y: Math.round(bounds.y + bounds.height * 0.46),
    };
    const hit = document.elementFromPoint(point.x, point.y);
    check(
      'requested key point is in the original world canvas',
      hit === canvas || !!hit?.closest?.('#world'),
      { tag: hit?.tagName, id: hit?.id },
    );
    const stopKey = inputStage(
      'await-native-keypoint',
      canvas,
      (r) => ({ x: Math.round(r.x + r.width * 0.75), y: Math.round(r.y + r.height * 0.46) }),
      'Root: scripts/native-parity-owned-input.ps1 -Hardware -KeyW -HoldMilliseconds 330 at this empty canvas point; pass viewport width/height as CssWidth/CssHeight for DPI conversion; helper must verify owned foreground root',
      { desiredBefore: { x: desiredBefore.x, y: desiredBefore.y, z: desiredBefore.z } },
    );
    await until(
      () =>
        keyDowns.length && keyUps.length && world.controls.desired.distanceTo(desiredBefore) > 0.05,
      'trusted native W down/up and original camera motion',
    );
    stopKey();
    phase = 'camera-ack';
    check(
      'original page received real trusted W down and up',
      keyDowns.length > 0 && keyUps.length > 0,
      { down: keyDowns, up: keyUps },
    );
    check(
      'original camera desired target moved under real W',
      world.controls.desired.distanceTo(desiredBefore) > 0.05,
      { distance: world.controls.desired.distanceTo(desiredBefore) },
    );
    await delay(200);
    check('actual source camera moved too', world.camera.position.distanceTo(cameraBefore) > 0.05, {
      distance: world.camera.position.distanceTo(cameraBefore),
    });
    const cameraScene = await nativeScene('trusted-WASD');
    query('[data-panel="settings"]').click();
    await until(
      () => query('#panel [data-action="export"]') && !query('#panel').hidden,
      'original settings/export control',
    );
    const button = query('#panel [data-action="export"]');
    button.scrollIntoView({ block: 'center', inline: 'nearest' });
    await delay(80);
    check(
      'export button is enabled in original solo UI',
      !button.disabled && !api.network() && api.isPaused(),
    );
    const raw = api.engine.save(world.state),
      bytes = new TextEncoder().encode(raw);
    check('secure native origin provides SHA-256', isSecureContext && !!crypto.subtle);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const sha256 = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('');
    const notBeforeUtc = new Date().toISOString();
    expectedExport = {
      requestedFilename: `skyfront-city-${Math.floor(world.state.time)}.json`,
      sha256,
      bytes: bytes.byteLength,
      encoding: 'UTF-8',
      notBeforeUtc,
    };
    let trustedExport = false,
      unchangedAtClick = false;
    listen(button, 'click', (event) => {
      if (event.isTrusted) {
        trustedExport = true;
        trustedExportAtUtc = new Date().toISOString();
        unchangedAtClick = api.engine.save(world.state) === raw;
      }
    });
    const exportRect = button.getBoundingClientRect();
    const exportPoint = {
      x: Math.round(exportRect.x + exportRect.width / 2),
      y: Math.round(exportRect.y + exportRect.height / 2),
    };
    check(
      'export point actually hits original export button',
      document
        .elementFromPoint(exportPoint.x, exportPoint.y)
        ?.closest?.('[data-action="export"]') === button,
    );
    phase = 'export';
    const stopExport = inputStage(
      'await-native-export',
      button,
      null,
      'Root: real -Hardware click on this original export button; expected JSON hash was computed before input, original Blob/download code is untouched',
      { expectedExport, fileOnDiskVerified: false },
    );
    await until(() => trustedExport, 'real trusted export click');
    stopExport();
    check('original export button received trusted Windows click', trustedExport);
    check('source JSON remained exactly the pre-click hash input', unchangedAtClick);
    await delay(3000);
    const exportScene = await nativeScene('after-original-export');
    check(
      'original UI stays alive after export',
      !!document.querySelector('#game') &&
        query('#welcome').hidden &&
        !api.network() &&
        api.isPaused(),
    );
    check(
      'renderer healthy after actual native input/export',
      !world.renderer.transport.failed && !window.__SKYFRONT_NATIVE_FAILED__,
    );
    phase = 'complete';
    post({
      kind: 'qa-result',
      stage: 'complete',
      passed: true,
      scope:
        'Real owned Windows Start + W down/up + original export-button input; disk file verification remains external',
      checks,
      cameraScene,
      exportScene,
      expectedExport,
      trustedExportAtUtc,
      fileOnDiskVerified: false,
      renderer: world.renderer.diagnostics(),
      limitations: [
        'Original settings was opened with its existing DOM button; Start/W/export themselves require trusted Windows input.',
        'This browser-side PASS proves input/handler/renderer health; Root must separately verify a NEW Downloads file with the expected exact hash/bytes.',
        'No Blob/download/URL interception, raw save contents logged, resource grants or state edits.',
      ],
    });
  } catch (error) {
    post({
      kind: 'qa-result',
      stage: 'complete',
      passed: false,
      scope: 'Real native input/export',
      phase,
      checks,
      expectedExport,
      trustedExportAtUtc,
      error: String(error?.stack || error),
      renderer: world?.renderer?.diagnostics?.(),
    });
  } finally {
    for (const stop of heartbeatStops) stop();
    for (const remove of listeners) remove();
  }
})();
