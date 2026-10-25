import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../../vendor/three/three.module.js';
import * as E from '../../src/game/index.js';
import { SettlementView } from '../../src/rendering/terrain/settlements.js';
import { DistrictView } from '../../src/rendering/terrain/districts.js';
import { factionHex } from '../../src/rendering/team-colors.js';
import {
  SETTLEMENTS,
  SETTLEMENT_FOOTPRINTS,
  settlementHouseOffsets,
} from '../../src/game/territory/settlements.config.js';

function world() {
  const box = new T.BoxGeometry(1, 1, 1),
    cylinder = new T.CylinderGeometry(1, 1, 1, 8),
    materials = new Map();
  const w = {
    scene: new T.Scene(),
    armySelection: [],
    groundTargeting: null,
    clearTrees() {},
    mat(color) {
      if (!materials.has(color))
        materials.set(color, new T.MeshStandardMaterial({ color, roughness: 0.9 }));
      return materials.get(color);
    },
  };
  w.box = (parent, x, y, z, a, b, c, color) => {
    const m = new T.Mesh(box, w.mat(color));
    m.position.set(x, y + b / 2, z);
    m.scale.set(a, b, c);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  w.cyl = (parent, x, y, z, r, h, color) => {
    const m = new T.Mesh(cylinder, w.mat(color));
    m.position.set(x, y + h / 2, z);
    m.scale.set(r, h, r);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  return w;
}
test('eight settlement models batch houses, keep geometry stable and display all four owner colors', () => {
  const w = world(),
    view = new SettlementView(w),
    s = E.createGame(810, { mode: 'coop' });
  assert.equal(view.sites.size, 8);
  const before = [];
  w.scene.traverse((o) => {
    if (o.isMesh) before.push(o);
  });
  assert.ok(before.length <= 24, `too many static village draws: ${before.length}`);
  for (let i = 0; i < 8; i++) Object.assign(s.settlements[i], { owner: i % 4, control: 1 });
  for (let i = 0; i < 40; i++) view.sync(s);
  const after = [];
  w.scene.traverse((o) => {
    if (o.isMesh) after.push(o);
  });
  assert.deepEqual(after, before);
  for (let i = 0; i < 8; i++) {
    const model = view.sites.get(s.settlements[i].id);
    assert.equal(model.sign.material.color.getHexString(), factionHex(i % 4).slice(1));
    assert.equal(model.root.userData.settlementId, s.settlements[i].id);
    assert.equal(model.body.children.length, 1);
  }
  const ray = new T.Raycaster(new T.Vector3(-1515, 150, -1415), new T.Vector3(0, -1, 0));
  w.scene.updateMatrixWorld(true);
  assert.equal(view.pick(ray), 'north-village-1');
});
test('the sixteen static house footprints share the exact renderer positions and leave the central road approach open', () => {
  assert.equal(SETTLEMENT_FOOTPRINTS.length, 16);
  for (const d of SETTLEMENTS) {
    for (const house of settlementHouseOffsets(d))
      assert.ok(
        SETTLEMENT_FOOTPRINTS.some(
          (p) => p.x === d.x + house.x && p.z === d.z + house.z && p.r === 8,
        ),
      );
    assert.equal(
      SETTLEMENT_FOOTPRINTS.some((p) => Math.hypot(p.x - d.x, p.z - d.z) < p.r + 5),
      false,
    );
  }
});
test('both central depots use distinct third/fourth city colors and bounded capture ring geometry', () => {
  const w = world(),
    view = new DistrictView(w),
    s = E.createGame(810, { mode: 'coop' });
  for (let i = 0; i < 2; i++)
    Object.assign(s.districts[i], { owner: i + 2, control: i ? -0.5 : 0.5, capturing: i + 2 });
  view.sync(s);
  for (let i = 0; i < 2; i++) {
    const model = view.sites.get(s.districts[i].id);
    assert.equal(model.flag.material.color.getHexString(), factionHex(i + 2).slice(1));
    assert.equal(model.progress.material.color.getHexString(), factionHex(i + 2).slice(1));
    assert.equal(model.progress.geometry.drawRange.count, 48 * 6);
  }
});
test('changing house mask rebuilds only the affected village once, disposes its batch and preserves all signs', () => {
  const w = world(),
    view = new SettlementView(w),
    s = E.createGame(810);
  view.sync(s);
  const first = view.sites.get(s.settlements[0].id),
    other = view.sites.get(s.settlements[1].id),
    old = first.body,
    sign = first.sign,
    otherBody = other.body;
  const geometry = old.children[0].geometry;
  const count = geometry.attributes.position.count;
  let disposed = 0;
  geometry.addEventListener('dispose', () => disposed++);
  s.settlementHouseMask &= ~3;
  view.sync(s);
  assert.notEqual(first.body, old);
  assert.equal(disposed, 1);
  assert.equal(first.sign, sign);
  assert.equal(other.body, otherBody);
  assert.ok(first.body.children[0].geometry.attributes.position.count < count);
  const replacement = first.body;
  for (let i = 0; i < 30; i++) view.sync(s);
  assert.equal(first.body, replacement);
  assert.equal(disposed, 1);
  assert.equal(view.sites.size, 8);
  s.settlementHouseMask = 65535;
  view.sync(s);
  assert.notEqual(first.body, replacement);
  assert.equal(first.body.children[0].geometry.attributes.position.count, count);
  assert.equal(other.body, otherBody);
});
