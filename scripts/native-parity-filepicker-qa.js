// Actual original Windows FilePicker. NO DataTransfer, FileList injection,
// FileReader replacement, direct state assignment or raw save text in logs.
(async () => {
  if (window.__SKYFRONT_REAL_PICKER_RUNNING__) return;
  window.__SKYFRONT_REAL_PICKER_RUNNING__ = true;
  const fixture = window.__SKYFRONT_REAL_FILEPICKER_FIXTURE__,
    KEY = 'skyfront-real-native-filepicker-v1';
  const query = (s) => document.querySelector(s),
    delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const post = (value) => window.chrome.webview.postMessage(value),
    stops = [],
    removers = [];
  let record, api, world;
  const store = () => sessionStorage.setItem(KEY, JSON.stringify(record));
  function check(name, passed, detail) {
    record.checks.push({ name, passed: !!passed, ...(detail === undefined ? {} : { detail }) });
    store();
    if (!passed) throw Error(name);
  }
  async function until(test, label, timeout = 300000) {
    const end = performance.now() + timeout;
    while (!test()) {
      if (performance.now() > end) throw Error('Timed out: ' + label);
      await delay(30);
    }
  }
  function listen(element, type, fn) {
    element.addEventListener(type, fn, true);
    removers.push(() => element.removeEventListener(type, fn, true));
  }
  function awaitInputStage(stage, element) {
    const inputId = stage + '-' + Date.now();
    let seq = 0,
      stopped = false;
    const send = () => {
      if (stopped) return;
      const r = element.getBoundingClientRect();
      post({
        kind: 'qa-result',
        stage,
        inputId,
        pointSequence: ++seq,
        postedAtUtc: new Date().toISOString(),
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
        point: { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) },
        viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
        file: { filename: fixture.filename, bytes: fixture.bytes, sha256: fixture.sha256 },
      });
    };
    send();
    const timer = setInterval(send, 500);
    const stop = () => {
      stopped = true;
      clearInterval(timer);
    };
    stops.push(stop);
    return stop;
  }
  function fullStateDifference(expected, actual) {
    let count = 0;
    const paths = [];
    const add = (p) => {
      count++;
      if (paths.length < 100) paths.push(p);
    };
    const visit = (a, b, p) => {
      if (Object.is(a, b)) return;
      if (
        a &&
        b &&
        typeof a === 'object' &&
        typeof b === 'object' &&
        Array.isArray(a) === Array.isArray(b)
      ) {
        for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
          if (!Object.hasOwn(a, key) || !Object.hasOwn(b, key)) add(p + '.' + key);
          else visit(a[key], b[key], p + '.' + key);
        }
      } else add(p);
    };
    visit(expected, actual, '$');
    return { count, paths };
  }
  async function nativeScene() {
    const r = world.renderer,
      e = r.exporter,
      t = r.transport,
      c = e.capture,
      receive = t.receive,
      expected = new Map();
    let ack;
    const seq = r._seq;
    e.capture = function (...args) {
      const p = c.apply(this, args);
      expected.set(p.seq, this.objectCache.size);
      return p;
    };
    t.receive = function (message) {
      let v = message;
      if (typeof v === 'string') {
        try {
          v = JSON.parse(v);
        } catch {
          v = null;
        }
      }
      if (v?.kind === 'scene-ack' && expected.has(v.seq))
        ack = { actual: v.scene, expected: expected.get(v.seq), sequence: v.seq };
      return receive.call(this, message);
    };
    try {
      world.sync();
      r.render(world.scene, world.camera);
      await until(() => ack && ack.sequence > seq, 'native imported scene ACK', 30000);
      check(
        'native imported scene registry equals original source',
        ack.actual?.objects === ack.expected,
        ack,
      );
      return ack;
    } finally {
      e.capture = c;
      t.receive = receive;
    }
  }
  try {
    if (!fixture?.expected || !fixture.sha256) throw Error('Missing verified own-file fixture');
    record = JSON.parse(sessionStorage.getItem(KEY) || 'null') || {
      phase: 0,
      fixtureSha256: fixture.sha256,
      checks: [],
    };
    if (record.fixtureSha256 !== fixture.sha256) throw Error('Fixture changed across reload');
    await until(
      () =>
        window.skyfront &&
        query('#welcome [data-action="start"]') &&
        !query('#welcome [data-action="start"]').disabled,
      'original readiness',
      90000,
    );
    api = window.skyfront;
    world = api.getWorld();
    check(
      'phase' + record.phase + ': original app uses real Godot backend',
      world.renderer.transport.ready &&
        world.renderer.domElement.dataset.renderer === 'godot' &&
        !window.__SKYFRONT_NATIVE_FAILED__,
    );
    if (record.phase === 0) {
      check(
        'new isolated solo campaign before actual file picker',
        !api.network() &&
          api.isPaused() &&
          world.state.time === 0 &&
          world.state.sides[0].credits === 3200,
      );
      check(
        'pre-import campaign differs from expected own file',
        fullStateDifference(fixture.expected, JSON.parse(api.engine.save(world.state))).count > 0,
      );
      let started = false;
      const start = query('#welcome [data-action="start"]');
      listen(start, 'click', (ev) => {
        if (ev.isTrusted) started = true;
      });
      const stopStart = awaitInputStage('await-native-filepicker-start', start);
      await until(() => started && query('#welcome').hidden, 'real Start click');
      stopStart();
      if (!api.isPaused()) query('#pause').click();
      check('real original Start accepted trusted input', started && api.isPaused());
      let settings = false;
      const gear = query('[data-panel="settings"]');
      listen(gear, 'click', (ev) => {
        if (ev.isTrusted) settings = true;
      });
      const stopSettings = awaitInputStage('await-native-filepicker-settings', gear);
      await until(
        () => settings && !query('#panel').hidden && query('#panel [data-action="import"]'),
        'real settings click',
      );
      stopSettings();
      check('original settings opened with trusted input', settings);
      const button = query('#panel [data-action="import"]');
      button.scrollIntoView({ block: 'center' });
      await delay(80);
      check('original import button enabled', !button.disabled && !api.network());
      check('native file input starts empty', query('#import-file')?.files?.length === 0);
      listen(query('#import-file'), 'change', (ev) => {
        record.fileChangeTrusted = ev.isTrusted;
        const selected = ev.target.files[0];
        record.selectedFile = selected
          ? { name: selected.name, bytes: selected.size, type: selected.type }
          : null;
        store();
      });
      let clicked = false;
      listen(button, 'click', (ev) => {
        if (ev.isTrusted) {
          clicked = true;
          record.phase = 1;
          record.importClickTrusted = true;
          record.importClickUtc = new Date().toISOString();
          store();
          post({
            kind: 'qa-result',
            stage: 'await-owned-file-dialog',
            passed: true,
            file: { filename: fixture.filename, bytes: fixture.bytes, sha256: fixture.sha256 },
            scope:
              'Use ONLY exact controls of the proven owned #32770: filename WM_SETTEXT and ID1 BM_CLICK; no Name/Value/list reads or screenshots',
          });
        }
      });
      const stopImport = awaitInputStage('await-native-filepicker-import', button);
      await until(() => clicked, 'real import click');
      stopImport();
      // Native chooser + original file.text + actual navigation destroy this task.
      await delay(60000);
      throw Error('Original file picker import did not reload the page');
    }
    if (record.phase !== 1) throw Error('Unexpected persisted phase');
    check('original import button click was trusted', record.importClickTrusted === true);
    check('FileList change came from native picker', record.fileChangeTrusted === true);
    check(
      'native picker selected the verified own file metadata',
      record.selectedFile?.name === fixture.filename &&
        record.selectedFile?.bytes === fixture.bytes,
      { filename: record.selectedFile?.name, bytes: record.selectedFile?.bytes },
    );
    const actual = JSON.parse(api.engine.save(world.state)),
      difference = fullStateDifference(fixture.expected, actual);
    check(
      'ALL imported fields exactly match original load-save-load',
      difference.count === 0,
      difference,
    );
    check(
      'original imported campaign returns to paused Continue UI',
      api.isPaused() &&
        !query('#welcome').hidden &&
        fixture.expectedOriginalContinue &&
        /Продолжить/.test(query('#welcome [data-action="start"]').textContent),
    );
    const native = await nativeScene();
    record.phase = 'complete';
    store();
    post({
      kind: 'qa-result',
      stage: 'complete',
      passed: true,
      scope:
        'Actual trusted Start/settings/import + native Windows picker + original FileReader/reload and complete state equality',
      checks: record.checks,
      native,
      file: { filename: fixture.filename, bytes: fixture.bytes, sha256: fixture.sha256 },
      fullStateDifference: difference,
      expectedOriginalContinue: true,
      expectedRevision: fixture.expected.networkRevision,
      actualRevision: actual.networkRevision,
      renderer: world.renderer.diagnostics(),
      limitations: [
        'Only the proven owned native dialog filename and ID1 Open controls may be touched.',
        'No DataTransfer, file input assignment, direct state mutation or raw JSON logging.',
        'Original save from this test is intentionally small; not a large-file or performance benchmark.',
      ],
    });
  } catch (error) {
    post({
      kind: 'qa-result',
      stage: 'complete',
      passed: false,
      phase: record?.phase,
      checks: record?.checks || [],
      error: String(error?.stack || error),
      renderer: world?.renderer?.diagnostics?.(),
    });
  } finally {
    for (const stop of stops) stop();
    for (const remove of removers) remove();
  }
})();
