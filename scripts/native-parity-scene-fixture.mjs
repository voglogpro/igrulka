import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import * as T from '../vendor/three/three.module.js';
import { SceneExporter } from '../native/parity/scene-protocol.mjs';
import { ParticleBatch } from '../src/rendering/effects/particles.js';
import { StreakBatch } from '../src/rendering/effects/streaks.js';
import { GroundScarBatch } from '../src/rendering/effects/ground-scars.js';
import { WeatherFX } from '../src/rendering/effects/weather-fx.js';

const scene = new T.Scene();
scene.background = new T.Color('#263d4a');
scene.add(new T.AmbientLight('#b9c9c0', 0.65));
const sun = new T.DirectionalLight('#fff1cc', 2);
sun.position.set(-8, 15, 12);
scene.add(sun);
const camera = new T.PerspectiveCamera(45, 16 / 9, 0.1, 200);
camera.position.set(12, 11, 18);
camera.lookAt(0, 0, 0);
const ground = new T.Mesh(
  new T.PlaneGeometry(50, 50),
  new T.MeshStandardMaterial({ color: '#45603e' }),
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
const box = new T.Mesh(
  new T.BoxGeometry(3, 3, 3),
  new T.MeshStandardMaterial({ color: '#768463' }),
);
box.position.set(-3, 1.5, 0);
box.castShadow = true;
scene.add(box);
const instances = new T.InstancedMesh(
  new T.BoxGeometry(1, 2, 1),
  new T.MeshStandardMaterial({ color: '#384936' }),
  3,
);
const matrix = new T.Matrix4();
for (let i = 0; i < 3; i++) {
  matrix.makeTranslation(i * 2, 1, 2);
  instances.setMatrixAt(i, matrix);
}
instances.instanceMatrix.needsUpdate = true;
scene.add(instances);
const line = new T.Line(
  new T.BufferGeometry().setFromPoints([new T.Vector3(-5, 0.2, -4), new T.Vector3(5, 0.2, -4)]),
  new T.LineBasicMaterial({ color: '#e0b976' }),
);
scene.add(line);
const sprite = new T.Sprite(
  new T.SpriteMaterial({ color: '#e1ddbd', opacity: 0.8, transparent: true }),
);
sprite.position.set(0, 4, 0);
sprite.scale.set(2, 2, 1);
scene.add(sprite);
const texture = new T.Texture({ width: 1, height: 1 });
sprite.material.map = texture;
const particles = new ParticleBatch(scene, 2, 0);
particles.spawn(0, 2, -4, { size: 1.5, life: 4 });
particles.update(0.1, camera);
const streaks = new StreakBatch(scene, 2);
streaks.begin(camera);
streaks.add(0, 3, -3, 1, 0.1, 0, 5, 0.3, [4, 2, 0.6], 0.8);
streaks.end();
const scars = new GroundScarBatch(scene);
scars.update([{ id: 1, x: 4, z: -2, radius: 2.5, time: 0 }], 1, () => 0);
const weather = new WeatherFX(scene);
weather.rain.visible = true;
weather.rain.geometry.setDrawRange(0, 12);
weather.update(0.1, new T.Vector3(), { kind: 'rain', amount: 0.5 });
const sky = new T.Mesh(
  new T.SphereGeometry(80, 16, 12),
  new T.ShaderMaterial({
    uniforms: { daylight: { value: 0.4 }, overcast: { value: 0.1 } },
    side: T.BackSide,
    depthWrite: false,
  }),
);
scene.add(sky);
const smokeTexture = await readFile(
  new URL('../native/Skyfront.Client/Assets/effects/smoke.png', import.meta.url),
);
const smokeData = 'data:image/png;base64,' + smokeTexture.toString('base64');
const packet = new SceneExporter({ encodeTexture: () => smokeData }).capture(scene, camera, 1);
const output = path.resolve(process.argv[2] || 'artifacts/native/parity-scene-fixture.json');
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(packet), 'utf8');
console.log(
  JSON.stringify({
    output,
    scope: 'synthetic scene protocol integration, not a game campaign',
    objects: packet.frame.objects.length,
  }),
);
