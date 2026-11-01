import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as T from '../../vendor/three/three.module.js';
import {
  SceneExporter,
  encodeAttribute,
  shaderFamily,
} from '../../native/parity/scene-protocol.mjs';
import { NativeTransport, GodotRenderer } from '../../native/parity/godot-renderer.mjs';
import { ParticleBatch } from '../../src/rendering/effects/particles.js';
import { StreakBatch } from '../../src/rendering/effects/streaks.js';
import { GroundScarBatch } from '../../src/rendering/effects/ground-scars.js';
import { WeatherFX } from '../../src/rendering/effects/weather-fx.js';
import { nativeInviteTransform } from '../../native/parity/invite-host-transform.mjs';
import { buildNativeParityWeb } from '../../scripts/build-native-parity-web.mjs';
import { warmStartupScene } from '../../native/parity/native-warmup.mjs';

function scene() {
  const scene = new T.Scene(),
    camera = new T.PerspectiveCamera(45, 16 / 9, 2, 9000);
  camera.position.set(0, 8, 20);
  camera.lookAt(0, 0, 0);
  const material = new T.MeshStandardMaterial({ color: '#476843' });
  const mesh = new T.Mesh(new T.BoxGeometry(3, 2, 4), material);
  mesh.position.set(5, 1, -3);
  scene.add(mesh);
  return { scene, camera, material, mesh, exporter: new SceneExporter() };
}
const floats = (attribute) => {
  const bytes = Buffer.from(attribute.data, 'base64');
  return [...new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)];
};

test('native scene retains original geometry, groups, matrix and material without mutating them', () => {
  const s = scene(),
    positions = [...s.mesh.geometry.attributes.position.array];
  const first = s.exporter.capture(s.scene, s.camera, 1);
  assert.equal(first.protocol, 1);
  assert.equal(first.reset, true);
  assert.equal(first.frame.mode, 'delta');
  assert.deepEqual(floats(first.definitions.geometries[0].attributes.position), positions);
  assert.deepEqual(first.definitions.geometries[0].groups, s.mesh.geometry.groups);
  assert.equal(first.frame.objects[0].matrix[12], 5);
  assert.equal(first.frame.objects[0].matrix[13], 1);
  assert.equal(first.frame.objects[0].matrix[14], -3);
  assert.deepEqual(first.definitions.materials[0].color, s.material.color.toArray());
  assert.deepEqual([...s.mesh.geometry.attributes.position.array], positions);
  const second = s.exporter.capture(s.scene, s.camera, 2);
  assert.equal(second.reset, false);
  assert.equal(second.definitions.geometries.length, 0);
  assert.equal(second.definitions.materials.length, 0);
  assert.equal(
    second.frame.objects.length,
    0,
    'omitted unchanged objects must remain visible at the receiver',
  );
  s.mesh.position.x = 8;
  const moved = s.exporter.capture(s.scene, s.camera, 3);
  assert.equal(moved.frame.objects[0].matrix[12], 8);
  assert.equal(moved.definitions.geometries.length, 0);
});

test('scene visibility removals and reappearance preserve resources and all original instances', () => {
  const s = scene(),
    parent = new T.Group();
  s.scene.add(parent);
  const instances = new T.InstancedMesh(s.mesh.geometry, s.material, 7);
  const dummy = new T.Object3D();
  for (let i = 0; i < 7; i++) {
    dummy.position.set(i * 3, 2, 10);
    dummy.updateMatrix();
    instances.setMatrixAt(i, dummy.matrix);
  }
  instances.instanceMatrix.needsUpdate = true;
  parent.add(instances);
  const first = s.exporter.capture(s.scene, s.camera, 1);
  const batch = first.frame.objects.find((object) => object.id === instances.uuid);
  assert.equal(batch.instances.count, 7);
  assert.equal(floats(batch.instances.matrix).length, 7 * 16);
  assert.equal(floats(batch.instances.matrix)[6 * 16 + 12], 18);
  s.exporter.capture(s.scene, s.camera, 2);
  parent.visible = false;
  const hidden = s.exporter.capture(s.scene, s.camera, 3);
  assert.deepEqual(hidden.frame.removed, [instances.uuid]);
  parent.visible = true;
  const restored = s.exporter.capture(s.scene, s.camera, 4);
  assert.equal(
    restored.frame.objects.find((object) => object.id === instances.uuid).instances.matrix.count,
    7,
  );
  assert.equal(restored.definitions.geometries.length, 0);
});

test('shared resources are inspected once per capture and remain invalidatable on the next capture', () => {
  const s = scene();
  for (let i = 0; i < 30; i++) {
    const copy = new T.Mesh(s.mesh.geometry, s.material);
    copy.position.x = i;
    s.scene.add(copy);
  }
  let colorReads = 0;
  const materialColor = s.material.color;
  Object.defineProperty(s.material, 'color', {
    get() {
      colorReads++;
      return materialColor;
    },
  });
  const first = s.exporter.capture(s.scene, s.camera, 1);
  assert.equal(first.definitions.geometries.length, 1);
  assert.equal(first.definitions.materials.length, 1);
  assert.equal(first.frame.objects.length, 31);
  assert.equal(colorReads, 1);
  colorReads = 0;
  const second = s.exporter.capture(s.scene, s.camera, 2);
  assert.equal(second.frame.objects.length, 0);
  assert.equal(colorReads, 1);
  materialColor.set('#cc7733');
  s.mesh.geometry.attributes.position.setX(0, 42);
  s.mesh.geometry.attributes.position.needsUpdate = true;
  colorReads = 0;
  const changed = s.exporter.capture(s.scene, s.camera, 3);
  assert.equal(changed.frame.materialUpdates.length, 1);
  assert.equal(changed.frame.geometryUpdates.length, 1);
  assert.equal(changed.frame.objects.length, 0);
  assert.equal(colorReads, 1);
  assert.equal(floats(changed.frame.geometryUpdates[0].attributes.position)[0], 42);
});

test('replaced equal-version equal-count vertex/index/instance buffers carry new identities', () => {
  const s = scene();
  const batch = new T.InstancedMesh(s.mesh.geometry, s.material, 2);
  s.scene.add(batch);
  const first = s.exporter.capture(s.scene, s.camera, 1);
  const geometry = first.definitions.geometries[0];
  const initialBatch = first.frame.objects.find((object) => object.id === batch.uuid);
  const oldPosition = s.mesh.geometry.attributes.position;
  const positions = new Float32Array(oldPosition.array);
  positions[0] = 77;
  s.mesh.geometry.setAttribute('position', new T.BufferAttribute(positions, 3));
  const indices = new Uint16Array(s.mesh.geometry.index.array);
  [indices[0], indices[1]] = [indices[1], indices[0]];
  s.mesh.geometry.setIndex(new T.BufferAttribute(indices, 1));
  const matrices = new Float32Array(batch.instanceMatrix.array);
  matrices[12] = 99;
  batch.instanceMatrix = new T.InstancedBufferAttribute(matrices, 16);
  const changed = s.exporter.capture(s.scene, s.camera, 2);
  const update = changed.frame.geometryUpdates[0];
  assert.equal(update.attributes.position.version, geometry.attributes.position.version);
  assert.equal(update.attributes.position.count, geometry.attributes.position.count);
  assert.notEqual(update.attributes.position.identity, geometry.attributes.position.identity);
  assert.notEqual(update.index.identity, geometry.index.identity);
  const nextBatch = changed.frame.objects.find((object) => object.id === batch.uuid);
  assert.equal(nextBatch.instances.matrix.version, initialBatch.instances.matrix.version);
  assert.notEqual(nextBatch.instances.matrix.identity, initialBatch.instances.matrix.identity);
  assert.equal(floats(nextBatch.instances.matrix)[12], 99);
});

test('geometry buffers, topology ranges and uniforms invalidate independently of unchanged objects', () => {
  const s = scene();
  s.exporter.capture(s.scene, s.camera, 1);
  s.mesh.geometry.attributes.position.setX(0, 19);
  s.mesh.geometry.attributes.position.needsUpdate = true;
  s.mesh.geometry.clearGroups();
  s.mesh.geometry.addGroup(0, 12, 0);
  s.mesh.geometry.setDrawRange(0, 12);
  const changed = s.exporter.capture(s.scene, s.camera, 2);
  assert.equal(changed.frame.geometryUpdates[0].attributes.position.count, 24);
  assert.deepEqual(changed.frame.geometryUpdates[0].groups, [
    { start: 0, count: 12, materialIndex: 0 },
  ]);
  assert.equal(changed.frame.objects[0].drawRange.count, 12);
  s.material.color.set('#75482b');
  const colored = s.exporter.capture(s.scene, s.camera, 3);
  assert.equal(colored.frame.objects.length, 0);
  assert.deepEqual(colored.frame.materialUpdates[0].color, s.material.color.toArray());
});

test('unchanged static leaves do not allocate matrix records while metadata and parent changes still propagate', () => {
  const s = scene();
  s.exporter.capture(s.scene, s.camera, 1);
  s.mesh.matrixWorld.toArray = () => {
    throw Error('static matrix serialization should be skipped');
  };
  const same = s.exporter.capture(s.scene, s.camera, 2);
  assert.equal(same.frame.objects.length, 0);
  assert.equal(s.exporter.diagnostics().unchangedLeaves, 1);
  assert.equal(s.exporter.diagnostics().changedLeaves, 0);
  s.mesh.renderOrder = 12;
  s.mesh.frustumCulled = false;
  s.mesh.castShadow = true;
  s.mesh.receiveShadow = true;
  s.mesh.name = 'updated';
  const metadata = s.exporter.capture(s.scene, s.camera, 3).frame.objects[0];
  assert.equal(metadata.renderOrder, 12);
  assert.equal(metadata.frustumCulled, false);
  assert.equal(metadata.castShadow, true);
  assert.equal(metadata.receiveShadow, true);
  assert.equal(metadata.name, 'updated');
  const material = new T.MeshBasicMaterial({ color: '#abcd12' });
  s.mesh.material = [s.material, material];
  const arrayMaterial = s.exporter.capture(s.scene, s.camera, 4);
  assert.deepEqual(arrayMaterial.frame.objects[0].materials, [s.material.uuid, material.uuid]);
  s.mesh.material[0] = material;
  assert.deepEqual(s.exporter.capture(s.scene, s.camera, 5).frame.objects[0].materials, [
    material.uuid,
    material.uuid,
  ]);
  const parent = new T.Group();
  parent.position.x = 100;
  s.scene.add(parent);
  parent.add(s.mesh);
  assert.equal(s.exporter.capture(s.scene, s.camera, 6).frame.objects[0].matrix[12], 105);
  const sprite = new T.Sprite(new T.SpriteMaterial());
  s.scene.add(sprite);
  s.exporter.capture(s.scene, s.camera, 7);
  sprite.center.set(0.2, 0.8);
  assert.deepEqual(
    s.exporter
      .capture(s.scene, s.camera, 8)
      .frame.objects.find((object) => object.id === sprite.uuid).center,
    [0.2, 0.8],
  );
});

test('empty dirty draw ranges send no unused buffers and return with current data once visible', () => {
  const s = scene();
  s.scene.remove(s.mesh);
  const geometry = new T.BufferGeometry().setAttribute(
    'position',
    new T.BufferAttribute(new Float32Array(9216), 3),
  );
  geometry.setDrawRange(0, 0);
  const tracer = new T.LineSegments(geometry, new T.LineBasicMaterial());
  s.scene.add(tracer);
  let packet = s.exporter.capture(s.scene, s.camera, 1);
  assert.equal(packet.frame.objects.length, 0);
  assert.equal(packet.definitions.geometries.length, 0);
  geometry.attributes.position.needsUpdate = true;
  packet = s.exporter.capture(s.scene, s.camera, 2);
  assert.equal(packet.frame.geometryUpdates.length, 0);
  assert.equal(packet.frame.objects.length, 0);
  geometry.attributes.position.setX(0, 19);
  geometry.attributes.position.needsUpdate = true;
  geometry.setDrawRange(0, 2);
  packet = s.exporter.capture(s.scene, s.camera, 3);
  assert.equal(packet.frame.objects.length, 1);
  assert.equal(packet.definitions.geometries.length, 1);
  assert.equal(floats(packet.definitions.geometries[0].attributes.position)[0], 19);
  geometry.setDrawRange(0, 0);
  geometry.attributes.position.needsUpdate = true;
  packet = s.exporter.capture(s.scene, s.camera, 4);
  assert.deepEqual(packet.frame.removed, [tracer.uuid]);
  assert.equal(packet.frame.geometryUpdates.length, 0);
  geometry.attributes.position.setX(0, 23);
  geometry.attributes.position.needsUpdate = true;
  geometry.setDrawRange(0, 2);
  packet = s.exporter.capture(s.scene, s.camera, 5);
  assert.equal(packet.frame.objects[0].id, tracer.uuid);
  assert.equal(packet.frame.geometryUpdates.length, 1);
  assert.equal(floats(packet.frame.geometryUpdates[0].attributes.position)[0], 23);
});

test('all five original shader families retain their custom attributes and uniforms', () => {
  const s = scene();
  const particles = new ParticleBatch(s.scene, 2, 0),
    streaks = new StreakBatch(s.scene, 2);
  const scars = new GroundScarBatch(s.scene),
    weather = new WeatherFX(s.scene);
  assert.equal(shaderFamily(particles.mesh.material), 'particle');
  assert.equal(shaderFamily(streaks.mesh.material), 'streak');
  assert.equal(shaderFamily(scars.mesh.material), 'scar');
  assert.equal(shaderFamily(weather.rain.material), 'weather');
  assert.equal(
    shaderFamily(
      new T.ShaderMaterial({ uniforms: { daylight: { value: 0.1 }, overcast: { value: 0 } } }),
    ),
    'sky',
  );
  particles.mesh.geometry.attributes.aOpacity.setX(0, 0.7);
  const attribute = encodeAttribute(particles.mesh.geometry.attributes.aOpacity);
  assert.equal(attribute.instanced, true);
  assert.ok(Math.abs(floats(attribute)[0] - 0.7) < 1e-6);
  weather.rain.visible = true;
  const packet = s.exporter.capture(s.scene, s.camera, 1);
  const rain = packet.definitions.materials.find((material) => material.type === 'weather');
  assert.deepEqual(rain.uniforms.box, weather.uniforms.box.value.toArray());
  assert.ok(
    packet.definitions.geometries.some(
      (geometry) =>
        geometry.attributes.aSeed && geometry.attributes.aDensity && geometry.attributes.aEnd,
    ),
  );
});

test('texture image is sent once while offset changes and replacement pixels remain visible', () => {
  const s = scene();
  let encodes = 0;
  s.exporter = new SceneExporter({
    encodeTexture: () => {
      encodes++;
      return 'data:image/png;base64,fixture';
    },
  });
  const texture = new T.Texture({ width: 1, height: 1 });
  s.material.map = texture;
  const first = s.exporter.capture(s.scene, s.camera, 1);
  assert.equal(first.definitions.textures.length, 1);
  assert.equal(encodes, 1);
  texture.offset.x = 0.4;
  const offset = s.exporter.capture(s.scene, s.camera, 2);
  assert.equal(encodes, 1);
  assert.equal(offset.frame.textureUpdates[0].offset[0], 0.4);
  assert.equal(offset.frame.textureUpdates[0].data, undefined);
  texture.needsUpdate = true;
  const pixels = s.exporter.capture(s.scene, s.camera, 3);
  assert.equal(encodes, 2);
  assert.ok(pixels.frame.textureUpdates[0].data);
});

test('native renderer applies backpressure before serialization and samples the latest camera after ACK', async () => {
  const s = scene(),
    sent = [];
  let listener;
  const view = {
    addEventListener: (_, callback) => {
      listener = callback;
    },
    postMessage: (message) => sent.push(message),
  };
  const transport = new NativeTransport(view);
  assert.equal(sent[0].kind, 'renderer-attached');
  listener({ data: { kind: 'native-ready', protocol: 1 } });
  const renderer = new GodotRenderer({
    transport,
    exporter: s.exporter,
    canvas: { dataset: {}, style: {} },
  });
  renderer.render(s.scene, s.camera);
  for (let i = 0; i < 100; i++) {
    s.camera.position.x = i;
    renderer.render(s.scene, s.camera);
  }
  assert.equal(sent.filter((packet) => packet.kind === 'scene').length, 1);
  listener({ data: { kind: 'scene-ack', seq: 1 } });
  await Promise.resolve();
  const packets = sent.filter((packet) => packet.kind === 'scene');
  assert.equal(packets.length, 2);
  assert.equal(packets[1].frame.camera.matrix[12], 99);
  listener({ data: { kind: 'scene-ack', seq: 2 } });
  await Promise.resolve();
  assert.equal(transport.pending.size, 0);
});

test('renderer timing diagnostics use actual capture/send/ack boundaries without serializing again', async () => {
  const s = scene();
  let time = 0,
    resolveAck;
  const capture = s.exporter.capture.bind(s.exporter);
  s.exporter.capture = (...args) => {
    time += 7;
    return capture(...args);
  };
  const transport = {
    ready: true,
    send: () => {
      time += 2;
      return new Promise((resolve) => {
        resolveAck = resolve;
      });
    },
  };
  const renderer = new GodotRenderer({
    transport,
    exporter: s.exporter,
    canvas: { dataset: {}, style: {} },
    clock: () => time,
  });
  renderer.render(s.scene, s.camera);
  assert.equal(renderer.diagnostics().captureMs, 7);
  assert.equal(renderer.diagnostics().postMessageMs, 2);
  assert.equal(renderer.diagnostics().submitted, 1);
  assert.equal(renderer.diagnostics().pending, true);
  time += 20;
  resolveAck({ packetBytes: 12345, applyMs: 4, parseMs: 1 });
  await Promise.resolve();
  const stats = renderer.diagnostics();
  assert.equal(stats.acked, 1);
  assert.equal(stats.ackMs, 22);
  assert.equal(stats.pending, false);
  assert.equal(stats.lastPacketBytes, 12345);
  assert.equal(stats.lastNativeApplyMs, 4);
  assert.equal(stats.lastNativeParseMs, 1);
});

test('bounded CPU warmup prepares normally until deadline, closes navigation, and still requires real scene ACK', async () => {
  let time = 0,
    models = 0,
    navRuns = 0,
    presented,
    ack;
  const called = new Promise((resolve) => {
    presented = resolve;
  });
  const present = new Promise((resolve) => {
    ack = resolve;
  });
  const geometry = new T.BoxGeometry(1, 1, 1),
    material = new T.MeshBasicMaterial();
  const body = new T.InstancedMesh(geometry, material, 1),
    legs = new T.InstancedMesh(geometry, material, 2);
  const state = {
    buildings: [],
    sides: [],
    settlements: [],
    seed: 1,
    mode: 'solo',
    time: 0,
    rng: 42,
  };
  const world = {
    state,
    scene: new T.Scene(),
    camera: new T.PerspectiveCamera(),
    sharedGeometries: new Set(),
    sharedMaterials: new Set(),
    infantry: {
      pool() {
        models++;
        time += 10;
        return { body, legs };
      },
    },
    callbacks: { isNetwork: () => false },
    renderer: {
      transport: { waitReady: async () => {} },
      present() {
        presented();
        return present;
      },
    },
    post: { daylight: 0, uniforms: { groundFog: { value: 0 }, fogTint: { value: new T.Color() } } },
    updateDaylight() {},
    battleTime: 0,
  };
  let complete = false;
  const ready = warmStartupScene(world, {
    clock: () => time,
    schedule: async () => {},
    budgetMs: 8,
    timeoutMs: 15,
    jobs: [1, 2, 3].map(() => ({ kind: 'infantry', key: 'infantry', side: 0 })),
    navigation: function* () {
      navRuns++;
      yield {};
    },
  }).then((result) => {
    complete = true;
    return result;
  });
  await called;
  assert.equal(models, 2, 'work that fits before deadline is preserved');
  assert.equal(navRuns, 0);
  assert.equal(complete, false, 'deadline does not fake an applied native frame');
  assert.equal(state.time, 0);
  assert.equal(state.rng, 42);
  ack();
  const result = await ready;
  assert.equal(result.cpuTimedOut, true);
  assert.equal(result.preparedModels, 2);
  assert.equal(result.status, 'ready');
  time = 0;
  let closed = false,
    navSteps = 0;
  world.renderer.present = async () => {};
  const navResult = await warmStartupScene(world, {
    clock: () => time,
    schedule: async () => {},
    budgetMs: 8,
    timeoutMs: 15,
    jobs: [],
    navigation: function* () {
      try {
        while (true) {
          navSteps++;
          time += 10;
          yield {};
        }
      } finally {
        closed = true;
      }
    },
  });
  assert.equal(navSteps, 2);
  assert.equal(closed, true, 'deadline must close its own unfinished navigation iterator');
  assert.equal(navResult.cpuTimedOut, true);
  assert.equal(navResult.navigationComplete, false);
});

test('native default server adapts only its asset hostname, leaving browser endpoints unchanged', async () => {
  const source = await readFile(new URL('../../src/network/invite.js', import.meta.url), 'utf8');
  const result = nativeInviteTransform(source);
  assert.match(result, /page\.hostname === 'skyfront\.localhost'/);
  assert.match(result, /__SKYFRONT_NATIVE__/);
  assert.equal(
    result.replace(
      /\/\/ Only the native virtual asset origin[\s\S]*?return normalizeServerAddress\(page\.hostname[\s\S]*?pageURL\);/,
      "return normalizeServerAddress(page.protocol === 'file:' ? fallback : page.origin, pageURL);",
    ),
    source,
  );
});

test('a complete native first frame is not ready until its actual acknowledgement', async () => {
  const s = scene(),
    sent = [];
  let listener, posted;
  const firstScene = new Promise((resolve) => {
    posted = resolve;
  });
  const transport = new NativeTransport({
    addEventListener: (_, callback) => {
      listener = callback;
    },
    postMessage: (message) => {
      sent.push(message);
      if (message.kind === 'scene') posted(message);
    },
  });
  listener({ data: { kind: 'native-ready', protocol: 1 } });
  const renderer = new GodotRenderer({
    transport,
    exporter: s.exporter,
    canvas: { dataset: {}, style: {} },
  });
  let complete = false;
  const ready = renderer.present(s.scene, s.camera).then(() => {
    complete = true;
  });
  const scenePacket = await firstScene;
  assert.equal(complete, false);
  assert.ok(scenePacket);
  listener({ data: { kind: 'scene-ack', seq: scenePacket.seq } });
  await ready;
  assert.equal(complete, true);
});

test('native page reload resets caches and native-ready publishes the actual bundled server', async () => {
  const s = scene();
  const first = s.exporter.capture(s.scene, s.camera, 1);
  assert.equal(first.reset, true);
  s.exporter.capture(s.scene, s.camera, 2);
  const reloaded = new SceneExporter().capture(s.scene, s.camera, 1);
  assert.equal(reloaded.reset, true);
  assert.equal(reloaded.definitions.geometries.length, 1);
  assert.equal(reloaded.frame.objects.length, 1);
  let listener;
  const previousBootstrap = globalThis.__SKYFRONT_NATIVE__;
  try {
    globalThis.__SKYFRONT_NATIVE__ = { unchanged: 'setting' };
    const transport = new NativeTransport({
      addEventListener: (_, callback) => {
        listener = callback;
      },
      postMessage: () => {},
    });
    listener({
      data: { kind: 'native-ready', protocol: 1, serverAddress: 'http://127.0.0.1:54123' },
    });
    await transport.waitReady();
    assert.equal(globalThis.__SKYFRONT_NATIVE__.serverAddress, 'http://127.0.0.1:54123');
    assert.equal(globalThis.__SKYFRONT_NATIVE__.unchanged, 'setting');
  } finally {
    globalThis.__SKYFRONT_NATIVE__ = previousBootstrap;
  }
});

test('parity web bundle uses the original application, network and audio with only the Godot backend', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'skyfront-native-parity-'));
  try {
    const manifest = await buildNativeParityWeb(output);
    assert.equal(manifest.originalEntry, 'src/main.js');
    const javascript = await readFile(path.join(output, 'game.js'), 'utf8');
    for (const contract of [
      'class RTSWorld',
      'createStrikeController',
      'MultiplayerUI',
      'GameAudio',
      'renderer-attached',
      'original-game-godot-backend',
    ]) {
      if (contract === 'original-game-godot-backend') continue;
      assert.ok(
        javascript.includes(contract) || javascript.includes(contract.replace('class ', 'var ')),
        contract,
      );
    }
    assert.ok(
      !javascript.includes('new WebGLRenderer('),
      'the real WebGL renderer must not be constructed',
    );
    const html = await readFile(path.join(output, 'index.html'), 'utf8');
    assert.match(html, /game\.js/);
    assert.doesNotMatch(html, /src="src\/main\.js"/);
    assert.match(
      await readFile(path.join(output, 'style.css'), 'utf8'),
      /background:transparent!important/,
    );
    assert.ok((await readFile(path.join(output, 'assets/audio/LICENSE.md'), 'utf8')).length > 0);
  } finally {
    const relative = path.relative(path.resolve(tmpdir()), path.resolve(output));
    assert.ok(
      !relative.startsWith('..') &&
        !path.isAbsolute(relative) &&
        path.basename(output).startsWith('skyfront-native-parity-'),
      'only the owned temporary test directory may be removed',
    );
    await rm(output, { recursive: true, force: true });
  }
});
