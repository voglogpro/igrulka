// Native WebView2 signal + synthetic visual-weather acceptance.
// Original production source is not modified. This is not an audible listening test,
// campaign weather-cycle proof, real combat proof or multiplayer benchmark.
(async () => {
  if (window.__SKYFRONT_WEATHER_AUDIO_QA_RUNNING__) return;
  window.__SKYFRONT_WEATHER_AUDIO_QA_RUNNING__ = true;
  const checks = [],
    sourceStarts = [],
    measurements = [],
    phases = [];
  const post = (value) => window.chrome.webview.postMessage(value);
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const query = (selector) => document.querySelector(selector);
  let api, world, master, analyser, context, originalWeather, weatherSnapshot;
  let gainDescriptor,
    startOriginal,
    trustedStart = false,
    startButton;
  let phaseLabel = 'setup';
  const originalStartListener = (ev) => {
    if (ev.isTrusted) trustedStart = true;
  };
  const check = (name, passed, detail) => {
    checks.push({ name, passed: !!passed, ...(detail === undefined ? {} : { detail }) });
    if (!passed) throw Error(name + (detail === undefined ? '' : ': ' + JSON.stringify(detail)));
  };
  async function until(predicate, label, timeout = 60000) {
    const end = performance.now() + timeout;
    while (!predicate()) {
      if (performance.now() > end) throw Error('Timed out: ' + label);
      await delay(35);
    }
  }
  function sourceStats(buffer) {
    if (!buffer) return { buffer: false };
    const samples = buffer.getChannelData(0);
    const stride = Math.max(1, Math.floor(samples.length / 4096));
    let sum = 0,
      count = 0,
      peak = 0;
    for (let i = 0; i < samples.length; i += stride) {
      const v = samples[i];
      sum += v * v;
      peak = Math.max(peak, Math.abs(v));
      count++;
    }
    return {
      buffer: true,
      duration: buffer.duration,
      sampleRate: buffer.sampleRate,
      channels: buffer.numberOfChannels,
      rms: Math.sqrt(sum / count),
      peak,
    };
  }
  async function measure(label, milliseconds) {
    const samples = new Float32Array(analyser.fftSize);
    const start = performance.now();
    let maximumRms = 0,
      maximumPeak = 0,
      polls = 0;
    while (performance.now() - start < milliseconds) {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0,
        peak = 0;
      for (const value of samples) {
        sum += value * value;
        peak = Math.max(peak, Math.abs(value));
      }
      maximumRms = Math.max(maximumRms, Math.sqrt(sum / samples.length));
      maximumPeak = Math.max(maximumPeak, peak);
      polls++;
      await delay(45);
    }
    const result = {
      label,
      maximumRms,
      maximumPeak,
      polls,
      elapsedMilliseconds: performance.now() - start,
    };
    measurements.push(result);
    return result;
  }
  function weather(kind, amount = 1) {
    const base = api.engine.WEATHER[kind];
    Object.assign(world.state.weather, {
      kind,
      amount,
      goal: 1,
      until: world.state.time + 120,
      next: 'clear',
      visibility: base.visibility,
      spread: base.spread,
      speed: base.speed,
    });
    world.updateDaylight();
  }
  async function visualPhase(kind, seconds) {
    weather(kind);
    // A visual-only advance through the original WeatherFX API. Simulation remains paused.
    world.weatherFX.update(3, world.controls.target, world.state.weather);
    world.updateDaylight();
    world.post.render(world.scene, world.camera, world.battleTime);
    const expectedFog = kind === 'fog' ? 0.27 : kind === 'storm' ? 0.075 : 0.04;
    check(
      kind + ': source post carries expected low-fog amount',
      Math.abs(world.post.uniforms.groundFog.value - expectedFog) < 0.00001,
    );
    const startSequence = world.renderer._seq;
    await until(
      () => world.renderer._seq > startSequence && world.renderer.diagnostics().acked > 0,
      kind + ' native scene',
    );
    phases.push({
      kind,
      groundFog: world.post.uniforms.groundFog.value,
      weather: world.weatherFX.diagnostics(),
      sequence: world.renderer._seq,
    });
    post({
      kind: 'qa-result',
      stage: 'weather-capture-' + kind,
      passed: true,
      syntheticVisualOnly: true,
      holdSeconds: seconds,
      phase: phases.at(-1),
      scope:
        'Original WeatherFX + source post telemetry -> native shader, NOT campaign weather cycle',
    });
    const end = performance.now() + seconds * 1000;
    while (performance.now() < end) {
      world.weatherFX.update(0.12, world.controls.target, world.state.weather);
      await delay(120);
    }
  }
  function restoreVisuals() {
    if (!world || !originalWeather) return;
    world.state.weather = structuredClone(originalWeather);
    if (weatherSnapshot) {
      const fx = world.weatherFX,
        saved = weatherSnapshot;
      fx.time = saved.time;
      fx.amount = saved.amount;
      fx.flash = saved.flash;
      fx.rain.visible = saved.visible;
      fx.uniforms.time.value = saved.uniformTime;
      fx.uniforms.amount.value = saved.uniformAmount;
      fx.uniforms.center.value.copy(saved.center);
      fx.uniforms.wind.value.copy(saved.wind);
      fx.uniforms.drift.value.copy(saved.drift);
    }
    world.updateDaylight();
    world.post.render(world.scene, world.camera, world.battleTime);
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
      'Godot transport ready',
      world.renderer.transport.ready && world.renderer.domElement.dataset.renderer === 'godot',
    );
    check(
      'fresh original campaign outside network',
      api.isPaused() && !api.network() && world.state.time === 0,
    );
    // A real Win32 mouse gesture must traverse WebView2's original input pipeline.
    // Synthetic DOM click does not count as acceptance here.
    startButton = query('#welcome [data-action="start"]');
    startButton.addEventListener('click', originalStartListener, true);
    const rect = startButton.getBoundingClientRect();
    post({
      kind: 'qa-result',
      stage: 'await-audio-input',
      target: '#welcome [data-action="start"]',
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      viewport: { width: innerWidth, height: innerHeight },
      instruction:
        'Root: real trusted Win32 click on this owned WebView button; no autoplay policy override',
    });
    await until(
      () => trustedStart && query('#welcome').hidden,
      'real trusted original Start click',
      180000,
    );
    await until(
      () => api.getAudio().state === 'running',
      'asynchronous original AudioContext.resume',
      15000,
    );
    if (!api.isPaused()) query('#pause').click();
    check(
      'real native input reached original Start handler',
      trustedStart && query('#welcome').hidden,
    );
    check(
      'original Start unlocked real WebAudio',
      api.getAudio().state === 'running',
      api.getAudio(),
    );
    api.openPanel('settings');
    await until(() => query('#volume'), 'original volume input');
    gainDescriptor = Object.getOwnPropertyDescriptor(GainNode.prototype, 'gain');
    check(
      'native gain getter is observable for test-only master tap',
      gainDescriptor?.get && gainDescriptor.configurable,
    );
    const candidates = [];
    Object.defineProperty(GainNode.prototype, 'gain', {
      ...gainDescriptor,
      get() {
        candidates.push(this);
        return gainDescriptor.get.call(this);
      },
    });
    try {
      const input = query('#volume');
      input.value = '35';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    } finally {
      Object.defineProperty(GainNode.prototype, 'gain', gainDescriptor);
      gainDescriptor = null;
    }
    // saveSettings -> GameAudio.set reads master.gain synchronously, without a frame/yield.
    check(
      'original volume handler identified only master GainNode',
      candidates.length > 0 && candidates.every((node) => node === candidates[0]),
      { reads: candidates.length },
    );
    master = candidates[0];
    context = master.context;
    analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    master.connect(analyser); // parallel read-only tap; original master output remains intact.
    query('#panel [data-action="close-panel"]').click();
    const t0 = context.currentTime;
    await delay(250);
    check(
      'native context clock advances',
      context.state === 'running' && context.currentTime > t0 + 0.05,
      { before: t0, after: context.currentTime, sampleRate: context.sampleRate },
    );
    await until(
      () =>
        api.getAudio().bank.length > 0 &&
        api.getAudio().bank.every((bank) => bank.rendered === bank.total),
      'original PCM sample bank completion',
    );
    check(
      'original sample bank fully ready',
      api.getAudio().bank.every((bank) => bank.rendered === bank.total && bank.total > 0),
      api.getAudio().bank,
    );
    check(
      'original PCM worker completed real jobs',
      api.getAudio().bank.some((bank) => bank.workerJobs > 0),
      api.getAudio().bank,
    );
    originalWeather = structuredClone(world.state.weather);
    const fx = world.weatherFX;
    weatherSnapshot = {
      time: fx.time,
      amount: fx.amount,
      flash: fx.flash,
      visible: fx.rain.visible,
      uniformTime: fx.uniforms.time.value,
      uniformAmount: fx.uniforms.amount.value,
      center: fx.uniforms.center.value.clone(),
      wind: fx.uniforms.wind.value.clone(),
      drift: fx.uniforms.drift.value.clone(),
    };
    startOriginal = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      if (this.context === context)
        sourceStarts.push({
          phase: phaseLabel,
          loop: this.loop,
          at: context.currentTime,
          ...sourceStats(this.buffer),
        });
      return startOriginal.apply(this, args);
    };
    // A few seconds of the actual original real-time loop permits normal audio.update.
    // Events below are explicit synthetic QA events through original handleEvent/play.
    weather('rain');
    query('#pause').click();
    await delay(350);
    check('ordinary source loop runs for signal test', !api.isPaused());
    const point = { x: world.controls.target.x, y: 1, z: world.controls.target.z, side: 0 };
    for (const [label, event] of [
      ['ballistic-launch', { type: 'launch', key: 'ballistic' }],
      ['cruise-launch', { type: 'launch', key: 'cruise' }],
      ['artillery-shot', { type: 'shot', key: 'cannon', shooter: 'howitzer', ground: true }],
      ['heavy-impact', { type: 'impact', key: 'ballistic' }],
    ]) {
      phaseLabel = label;
      const count = sourceStarts.length;
      world.callbacks.onEvent({ ...point, ...event });
      const signal = await measure(label, 1600);
      check(
        label + ': original event started non-silent AudioBuffer',
        sourceStarts.slice(count).some((source) => source.buffer && source.rms > 0.00001),
        sourceStarts.slice(count),
      );
      check(
        label + ': master analyser receives nonzero signal',
        signal.maximumRms > 0.00001 && Number.isFinite(signal.maximumPeak),
        signal,
      );
    }
    check(
      'original recorded-rain voice is active under rain',
      api.getAudio().rain > 0.01,
      api.getAudio(),
    );
    if (!api.isPaused()) query('#pause').click();
    AudioBufferSourceNode.prototype.start = startOriginal;
    startOriginal = null;
    check('source simulation paused for visual weather demonstration', api.isPaused());
    await visualPhase('fog', 15);
    await visualPhase('storm', 15);
    restoreVisuals();
    check(
      'synthetic weather restored exactly',
      JSON.stringify(world.state.weather) === JSON.stringify(originalWeather),
    );
    check(
      'native renderer still healthy after audio/weather',
      !world.renderer.transport.failed && !window.__SKYFRONT_NATIVE_FAILED__,
    );
    post({
      kind: 'qa-result',
      stage: 'complete',
      passed: true,
      scope:
        'Real native Start gesture + original WebAudio bank/events/master signal + synthetic native weather visuals',
      checks,
      audio: api.getAudio(),
      context: {
        state: context.state,
        sampleRate: context.sampleRate,
        currentTime: context.currentTime,
      },
      sourceStarts,
      measurements,
      phases,
      renderer: world.renderer.diagnostics(),
      original: api.diagnostics(),
      limitations: [
        'Not an audible listening or subjective sound-quality test.',
        'QA combat audio events are synthetic, handled by unchanged original methods.',
        'Weather is a temporary visual override, restored afterward; not a campaign-cycle test.',
        'Master analyser is a parallel test-only tap; no production mix/source changes.',
        'Autoplay must be unlocked by an actual trusted native Start click.',
      ],
    });
  } catch (error) {
    post({
      kind: 'qa-result',
      stage: 'complete',
      passed: false,
      scope: 'Native input/audio signal and synthetic weather',
      checks,
      error: String(error?.stack || error),
      audio: api?.getAudio?.(),
      renderer: world?.renderer?.diagnostics?.(),
      sourceStarts,
      measurements,
      phases,
    });
  } finally {
    if (gainDescriptor) Object.defineProperty(GainNode.prototype, 'gain', gainDescriptor);
    if (startOriginal) AudioBufferSourceNode.prototype.start = startOriginal;
    if (master && analyser) {
      try {
        master.disconnect(analyser);
        analyser.disconnect();
      } catch {}
    }
    if (startButton) startButton.removeEventListener('click', originalStartListener, true);
    if (api && !api.isPaused()) query('#pause')?.click();
    restoreVisuals();
  }
})();
