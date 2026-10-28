// Test-only instrumentation. No callbacks introduce simulation steps or GPU waits.
window.installHitchProbe = async ({ limit = 40000 } = {}) => {
  const w = skyfront.getWorld(),
    started = performance.now();
  performance.mark('skyfront-hitch-start');
  const q = (window.hitchProbe = {
    started,
    phase: 'startup',
    stages: {},
    spans: [],
    frames: [],
    longTasks: [],
    inputs: [],
    actions: [],
    heap: [],
    errors: [],
    counters: {},
    stopped: false,
  });
  let last = started,
    nextHeap = started,
    raf;
  const add = (list, value) => {
    if (list.length < limit) list.push(value);
  };
  const track = (host, key, label, gl = false) => {
    const fn = host?.[key];
    if (typeof fn !== 'function') return;
    host[key] = function (...args) {
      const begin = performance.now();
      const treesBefore = label === 'world.sync' ? q.stages['world.clearTrees']?.total || 0 : 0;
      const roadsBefore = label === 'world.sync' ? q.stages['world.road']?.total || 0 : 0;
      const eventsBefore = label === 'world.sync' ? q.stages['event-audio+fx']?.total || 0 : 0;
      try {
        return fn.apply(this, args);
      } finally {
        if (!q.stopped) {
          const ms = performance.now() - begin;
          const s = (q.stages[label] ||= { count: 0, total: 0, max: 0, bins: Array(1001).fill(0) });
          s.count++;
          s.total += ms;
          s.max = Math.max(s.max, ms);
          s.bins[Math.min(1000, Math.floor(ms))]++;
          if (ms >= (gl ? 4 : 8))
            add(q.spans, {
              phase: q.phase,
              label,
              at: begin - started,
              ms,
              ...(label === 'world.sync'
                ? {
                    treeMs: (q.stages['world.clearTrees']?.total || 0) - treesBefore,
                    roadMs: (q.stages['world.road']?.total || 0) - roadsBefore,
                    eventMs: (q.stages['event-audio+fx']?.total || 0) - eventsBefore,
                  }
                : {}),
            });
        }
      }
    };
  };
  track(w.callbacks, 'onFrame', 'simulation+ui');
  track(w.callbacks, 'onAmbient', 'ambient-audio');
  track(w.callbacks, 'onEvent', 'event-audio+fx');
  for (const key of [
    'sync',
    'select',
    'model',
    'aircraft',
    'road',
    'syncTrenches',
    'clearTrees',
    'setBuild',
    'pointerUp',
    'groundPoint',
    'updateGhost',
    'updateMinimap',
    'updateDaylight',
    'resizeRender',
  ])
    track(w, key, `world.${key}`);
  track(w.post, 'render', 'post.render');
  track(w.renderer, 'render', 'renderer.render');
  for (const key of ['setRenderTarget', 'clear', 'setSize', 'setDrawingBufferSize'])
    track(w.renderer, key, `renderer.${key}`);
  track(w.renderer.shadowMap, 'render', 'shadowMap.render');
  track(w.post, 'resize', 'post.resize');
  for (const [label, host] of Object.entries({
    infantry: w.infantry,
    vehicleBatch: w.vehicleBatch,
    buildingBatch: w.buildingBatch,
    roadBatch: w.roadBatch,
    fortifications: w.fortifications,
    combatFX: w.combatFX,
    weatherFX: w.weatherFX,
    traffic: w.traffic,
    ships: w.ships,
    serviceFleet: w.serviceFleet,
    ammoFleet: w.ammoFleet,
    ammoCrates: w.ammoCrates,
  })) {
    for (const key of ['sync', 'update', 'emit', 'explode', 'flush', 'finish'])
      track(host, key, `${label}.${key}`);
  }
  const gl = w.renderer.getContext();
  for (const key of [
    'linkProgram',
    'getProgramInfoLog',
    'getProgramParameter',
    'getShaderParameter',
    'getShaderInfoLog',
    'bufferData',
    'bufferSubData',
    'texImage2D',
    'texSubImage2D',
    'texStorage2D',
    'drawElementsInstanced',
    'drawArraysInstanced',
    'drawElements',
    'drawArrays',
    'clear',
    'bindFramebuffer',
    'checkFramebufferStatus',
    'renderbufferStorageMultisample',
    'framebufferTexture2D',
    'blitFramebuffer',
    'getParameter',
    'flush',
    'fenceSync',
    'clientWaitSync',
    'readPixels',
    'finish',
    'createTexture',
    'deleteTexture',
    'bindTexture',
    'createFramebuffer',
    'deleteFramebuffer',
    'framebufferRenderbuffer',
    'createRenderbuffer',
    'deleteRenderbuffer',
    'renderbufferStorage',
    'createBuffer',
    'deleteBuffer',
    'useProgram',
  ])
    track(gl, key, `gl.${key}`, true);
  track(Storage.prototype, 'setItem', 'storage.setItem');
  track(JSON, 'stringify', 'JSON.stringify');
  track(JSON, 'parse', 'JSON.parse');
  if (location.protocol === 'http:' || location.protocol === 'https:') {
    try {
      const { GameAudio } = await import(new URL('/src/audio/game-audio.js', location.href));
      for (const key of ['unlock', 'sample', 'play', 'renderBuffers', 'createEngines'])
        track(GameAudio.prototype, key, `audio.${key}`);
    } catch {
      /* Portable/CDN builds expose no source modules. */
    }
  }
  for (const type of ['pointerdown', 'pointerup', 'keydown'])
    document.addEventListener(
      type,
      (e) => {
        if (q.stopped) return;
        const el = e.target.closest?.('[data-action],[data-tab],[data-panel],[id]');
        const record = {
          phase: q.phase,
          type,
          control:
            el?.id ||
            el?.dataset.action ||
            el?.dataset.tab ||
            el?.dataset.panel ||
            e.target.tagName,
          key: e.code,
          at: performance.now() - started,
          trusted: e.isTrusted,
        };
        add(q.inputs, record);
        requestAnimationFrame(() => {
          record.nextFrameMs = performance.now() - started - record.at;
          record.selected = w.selected;
          record.armyCount = w.armySelection.length;
        });
      },
      true,
    );
  const observer = new PerformanceObserver((list) => {
    for (const e of list.getEntries())
      if (e.startTime >= started)
        add(q.longTasks, {
          phase: q.phase,
          at: e.startTime - started,
          ms: e.duration,
          name: e.name,
        });
  });
  observer.observe({ type: 'longtask', buffered: true });
  const frame = (now) => {
    if (q.stopped) return;
    add(q.frames, { phase: q.phase, at: now - started, ms: now - last });
    last = now;
    if (now >= nextHeap) {
      nextHeap = now + 1000;
      add(q.heap, { at: now - started, phase: q.phase, used: performance.memory?.usedJSHeapSize });
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  q.mark = (name) => {
    q.phase = name;
    performance.mark('skyfront-phase:' + name);
    add(q.actions, {
      name,
      at: performance.now() - started,
      time: w.state.time,
      renderScale: w.renderBudget?.scale,
      shadowMapSize: w.sun?.shadow?.mapSize?.x,
      programs: w.renderer.info.programs.length,
    });
  };
  q.stop = () => {
    q.stopped = true;
    observer.disconnect();
    cancelAnimationFrame(raf);
  };
  q.result = () => {
    q.stop();
    const extension = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      started: q.started,
      elapsedMs: performance.now() - started,
      timeOrigin: performance.timeOrigin,
      stages: q.stages,
      spans: q.spans,
      frames: q.frames,
      longTasks: q.longTasks,
      inputs: q.inputs,
      actions: q.actions,
      heap: q.heap,
      adapter: extension
        ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER),
      glError: gl.getError(),
      diagnostics: skyfront.diagnostics(),
      audio: skyfront.getAudio(),
      time: w.state.time,
      units: w.state.groundUnits.length,
      buildings: w.state.buildings.length,
      projectiles: w.state.projectiles.length,
    };
  };
  return { started, timeOrigin: performance.timeOrigin };
};

window.hitchFixture = ({ count = 90, battle = false, automatic = false, coop = false } = {}) => {
  window.hitchProbe?.mark(`fixture-${battle ? 'battle' : automatic ? 'defense' : 'quiet'}`);
  const E = skyfront.engine,
    w = skyfront.getWorld(),
    s = E.createGame(812, { mode: coop ? 'coop' : 'multiplayer' });
  s.rules.rear = false;
  s.rules.oil = false;
  for (const plan of [s.ai, ...Object.values(s.aiBySide || {})])
    plan.nextBuild = plan.nextAttack = plan.nextArmy = 1e9;
  s.weather.kind = 'clear';
  s.weather.amount = 0;
  if (automatic)
    for (const d of s.districts) {
      d.owner = 0;
      d.control = 1;
    }
  const keys = battle ? ['infantry', 'machinegunner', 'atgm', 'leopard', 'shilka'] : ['infantry'];
  for (let i = 0; i < count; i++) {
    const side = battle ? i % 2 : 0,
      j = battle ? Math.floor(i / 2) : i,
      key = keys[j % keys.length];
    let p;
    if (battle)
      p = { x: (side ? 1 : -1) * (60 + Math.floor(j / 20) * 18), z: -1350 + ((j % 20) - 9.5) * 14 };
    else {
      const band = j % 2 ? 1 : -1,
        k = Math.floor(j / 2);
      p = { x: -1750 + (k % 50) * 18, z: band * (1260 + Math.floor(k / 50) * 18) };
    }
    if (!E.walkable(s, p.x, p.z, E.GROUND_UNITS[key].size * 0.42)) continue;
    const u = E.makeGround(s, side, key, p.x, p.z);
    if (battle) u.hp = u.maxHp = 10000; // Labelled endurance fixture, not balance QA.
    u.holdFire = !battle;
    if (automatic) {
      u.autoDefense = true;
      u.stance = { mode: 'defend', post: 'auto' };
    } else {
      u.guard = { ...p };
      u.order = { mode: 'guard', ...p };
      u.setup = 1;
    }
    s.groundUnits.push(u);
  }
  Object.assign(w.state, s);
  w.previousSimTime = 0;
  w.focus(0, -1350, 600);
  w.controls.update(3);
  w.sync();
  return { count: s.groundUnits.length, automatic, battle, coop, time: s.time };
};
