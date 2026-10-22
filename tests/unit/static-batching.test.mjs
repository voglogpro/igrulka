import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../../vendor/three/three.module.js';
import { batchStatic } from '../../src/rendering/mesh-utils.js';
test('already colored geometry and independently hidden details retain their attributes and visibility', () => {
  const root = new T.Group(),
    geo = new T.BoxGeometry().toNonIndexed();
  const colors = new Float32Array(geo.attributes.position.count * 3);
  colors.fill(0.5);
  geo.setAttribute('color', new T.BufferAttribute(colors, 3));
  const mat = new T.MeshStandardMaterial({ vertexColors: true });
  const a = new T.Mesh(geo, mat),
    b = new T.Mesh(geo, mat);
  const hidden = new T.Mesh(new T.BoxGeometry(), new T.MeshStandardMaterial());
  hidden.visible = false;
  root.add(a, b, hidden);
  batchStatic(root);
  assert.equal(a.parent, root);
  assert.equal(b.parent, root);
  assert.equal(a.geometry.attributes.color.array, colors);
  assert.equal(hidden.parent, root);
  assert.equal(hidden.visible, false);
});
test('opaque static colors merge without losing color, lit emission and moving turrets stay separate', () => {
  const root = new T.Group(),
    turret = new T.Group();
  turret.userData.dynamic = true;
  root.add(turret);
  const red = new T.MeshStandardMaterial({ color: '#ee3322', roughness: 0.8 });
  const green = new T.MeshStandardMaterial({ color: '#338833', roughness: 0.8 });
  const glowing = new T.MeshStandardMaterial({ color: '#ffeeaa', emissive: '#ffaa22' });
  for (const [i, mat] of [red, green, red, green, glowing].entries()) {
    const m = new T.Mesh(new T.BoxGeometry(), mat);
    m.position.x = i * 3;
    root.add(m);
  }
  const moving = new T.Mesh(new T.BoxGeometry(), red);
  turret.add(moving);
  batchStatic(root);
  const batches = root.children.filter((c) => c.isMesh);
  assert.equal(batches.length, 2);
  const colored = batches.find((c) => c.material.vertexColors);
  assert.equal(colored.geometry.attributes.position.count, 4 * 36);
  const colors = colored.geometry.attributes.color;
  assert.ok(Math.abs(colors.getX(0) - red.color.r) < 1e-6);
  assert.ok(Math.abs(colors.getY(36) - green.color.g) < 1e-6);
  assert.equal(moving.parent, turret);
  assert.ok(batches.some((c) => c.material === glowing));
  assert.equal(red.vertexColors, false);
});
