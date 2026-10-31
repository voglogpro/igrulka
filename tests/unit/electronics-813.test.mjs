import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { updateElectronics } from '../../src/game/city/electronics.js';
import { updateAmmoProduction } from '../../src/game/city/ammo-production.js';

function fixture() {
  const s = E.createGame(813, { mode: 'multiplayer' });
  s.rules.rear = false;
  Object.assign(s.sides[0], { credits: 10000, materials: 1000, oil: 150 });
  const b = E.build(s, 0, 'electronics', -1272, -10);
  assert.equal(typeof b, 'object', String(b));
  b.progress = 1;
  b.hp = b.maxHp;
  return { s, b, f: s.sides[0] };
}
const rates = [{ productivity: 1 }, { productivity: 1 }];

test('real road-connected electronics converts paid alloy and oil only after assembly time', () => {
  const { s, b, f } = fixture(),
    before = { ...f };
  assert.equal(E.electronicsFactoryStatus(s, 0, b.id).status, 'active');
  updateElectronics(s, rates, E.ELECTRONICS.seconds - 1);
  assert.equal(f.components, 0);
  assert.equal(f.materials, before.materials);
  updateElectronics(s, rates, 1.01);
  assert.equal(f.components, 1);
  assert.equal(before.credits - f.credits, E.ELECTRONICS.credits);
  assert.equal(before.materials - f.materials, E.ELECTRONICS.metal);
  assert.ok(Math.abs(before.oil - f.oil - E.ELECTRONICS.oil) < 1e-9);
  assert.equal(f.componentProductionSpent, E.ELECTRONICS.credits);
  assert.ok(b.componentProgress > 0 && b.componentProgress < 0.01);
});

test('electronics preserves an operating reserve and stops for missing inputs, damage, stock, road and finish', () => {
  for (const reason of ['credits', 'materials', 'oil', 'stock', 'road', 'ruined', 'finished']) {
    const { s, b, f } = fixture();
    if (reason === 'credits') f.credits = E.ELECTRONICS.reserveCredits + 1;
    if (reason === 'materials') f.materials = E.ELECTRONICS.metal - 0.01;
    if (reason === 'oil') f.oil = E.ELECTRONICS.oil - 0.01;
    if (reason === 'stock') f.components = E.ELECTRONICS.capacity;
    if (reason === 'road') {
      for (const r of s.roads) if (r.side === 0) r.hp = 0;
      s.networkRevision++;
    }
    if (reason === 'ruined') b.hp = 0;
    if (reason === 'finished') s.result = { winner: 0 };
    const before = [f.credits, f.materials, f.oil, f.components];
    assert.equal(E.electronicsFactoryStatus(s, 0, b.id).status, reason);
    updateElectronics(s, rates, 30);
    assert.deepEqual([f.credits, f.materials, f.oil, f.components], before);
  }
  const { s, b, f } = fixture();
  f.credits = E.ELECTRONICS.reserveCredits + E.ELECTRONICS.credits;
  updateElectronics(s, rates, 60);
  assert.equal(f.components, 1);
  assert.equal(f.credits, E.ELECTRONICS.reserveCredits);
  assert.equal(E.electronicsFactoryStatus(s, 0, b.id).status, 'credits');
});

test('multiple shops share a bounded stock, never duplicate a last component, and resume after use', () => {
  const { s, b, f } = fixture();
  const other = E.build(s, 0, 'electronics', -1142, -10);
  assert.equal(typeof other, 'object', String(other));
  Object.assign(other, { progress: 1, hp: other.maxHp });
  f.components = E.ELECTRONICS.capacity - 1;
  b.componentProgress = other.componentProgress = 0.99;
  updateElectronics(s, rates, 1);
  assert.equal(f.components, E.ELECTRONICS.capacity);
  assert.equal(f.componentProductionSpent, E.ELECTRONICS.credits);
  f.components--;
  updateElectronics(s, rates, 1);
  assert.equal(f.components, E.ELECTRONICS.capacity);
  assert.equal(f.componentProductionSpent, E.ELECTRONICS.credits * 2);
});

test('all four weapons require and pay their electronics once, before the existing paid timed queue', () => {
  for (const key of Object.keys(E.WEAPONS)) {
    const { s, f } = fixture();
    const factory = E.build(s, 0, 'factory', -1142, -10);
    assert.equal(typeof factory, 'object', String(factory));
    Object.assign(factory, { progress: 1, hp: factory.maxHp });
    const d = E.WEAPONS[key];
    f.components = d.components - 1;
    const before = [f.credits, f.materials, f.oil, f.components];
    assert.match(E.produce(s, 0, key), /электроники/);
    assert.deepEqual([f.credits, f.materials, f.oil, f.components], before);
    f.components = d.components;
    assert.equal(E.produce(s, 0, key), true);
    assert.equal(f.components, 0);
    assert.equal(before[0] - f.credits, d.cost);
    assert.equal(before[1] - f.materials, d.metal);
    assert.equal(before[2] - f.oil, d.oil);
    assert.deepEqual(factory.queue, [{ key, progress: 0 }]);
  }
});

test('guided AA ammunition consumes electronics only after an available paid component', () => {
  const { s, f } = fixture();
  const plant = E.build(s, 0, 'ammofactory', -1142, -10);
  assert.equal(typeof plant, 'object', String(plant));
  Object.assign(plant, { progress: 1, hp: plant.maxHp });
  const sam = E.build(s, 0, 'sam', -1042, 250);
  assert.equal(typeof sam, 'object', String(sam));
  Object.assign(sam, { progress: 1, hp: sam.maxHp });
  f.ammoStock = E.createAmmoStock();
  assert.equal(E.ammoFactoryStatus(s, 0, plant.id).status, 'components');
  const before = [f.credits, f.materials, f.oil];
  updateAmmoProduction(s);
  assert.equal(f.ammoStock.sam, 0);
  assert.deepEqual([f.credits, f.materials, f.oil], before);
  f.components = 1;
  plant.ammoNextAt = 0;
  updateAmmoProduction(s);
  assert.equal(f.components, 0);
  assert.equal(f.ammoStock.sam, E.AMMUNITION.batches.sam);
  assert.ok(f.credits < before[0] && f.oil < before[2]);
});

test('ordinary rifle and tank-shell ammunition can be produced with zero electronics', () => {
  for (const [key, kind] of [
    ['machinegunner', 'small'],
    ['leopard', 'shell'],
  ]) {
    const { s, f } = fixture();
    const plant = E.build(s, 0, 'ammofactory', -1142, -10);
    assert.equal(typeof plant, 'object', String(plant));
    Object.assign(plant, { progress: 1, hp: plant.maxHp });
    s.groundUnits.push(E.makeGround(s, 0, key, -1042, 250));
    f.ammoStock = E.createAmmoStock();
    const before = f.credits;
    updateAmmoProduction(s);
    assert.equal(f.components, 0);
    assert.equal(f.ammoStock[kind], E.AMMUNITION.batches[kind]);
    assert.ok(f.credits < before);
  }
});

test('schema21 preserves assembly phase and rejects corrupt new fields; schema20 migrates without charging paid queues', () => {
  const { s, b, f } = fixture();
  updateElectronics(s, rates, E.ELECTRONICS.seconds / 2);
  f.components = 7;
  const loaded = E.load(E.save(s));
  assert.equal(loaded.sides[0].components, 7);
  assert.equal(loaded.buildings.find((v) => v.id === b.id).componentProgress, 0.5);
  updateElectronics(s, rates, E.ELECTRONICS.seconds / 2 + 0.01);
  updateElectronics(loaded, rates, E.ELECTRONICS.seconds / 2 + 0.01);
  assert.deepEqual(loaded.sides, s.sides);
  assert.equal(loaded.buildings.find((v) => v.id === b.id).componentProgress, b.componentProgress);
  assert.equal(loaded.rng, s.rng);
  for (const bad of [null, -1, 1.5, 1e10, '7']) {
    const raw = JSON.parse(E.save(s));
    raw.sides[0].components = bad;
    assert.throws(() => E.load(JSON.stringify(raw)), /электроника/);
  }
  const old = JSON.parse(E.save(s));
  old.version = 20;
  for (const side of old.sides) {
    delete side.components;
    delete side.componentProductionSpent;
  }
  const before = old.sides.map((side) => [side.credits, side.materials, side.oil]);
  const migrated = E.load(JSON.stringify(old));
  assert.equal(migrated.version, E.VERSION);
  assert.deepEqual(
    migrated.sides.map((side) => [side.credits, side.materials, side.oil]),
    before,
  );
  assert.deepEqual(
    migrated.sides.map((side) => side.components),
    [0, 0],
  );
});

test('oil-off isolated scenarios remain compatible, with an explicit component rule available', () => {
  const { s } = fixture();
  s.rules.oil = false;
  const factory = E.build(s, 0, 'factory', -1142, -10);
  factory.progress = 1;
  assert.equal(E.produce(s, 0, 'drone'), true);
  s.rules.components = true;
  assert.match(E.produce(s, 0, 'drone'), /электроники/);
});
