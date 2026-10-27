import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { COVER_PATCHES } from '../../src/game/units/infantry/cover.js';

function fixture() {
  const s = E.createGame(812),
    key = 'sam';
  s.sides[0].credits = 10000;
  s.sides[0].materials = 1000;
  for (let x = -1500; x <= -800; x += 40)
    for (let z = -400; z <= 400; z += 40) if (!E.canPlace(s, key, x, z)) return { s, key, x, z };
  throw Error('No test placement');
}

test('construction refuses a live soldier, MOG and paid civic vehicle without charging or trapping it', () => {
  for (const kind of ['infantry', 'mog', 'ammo', 'repair']) {
    const { s, key, x, z } = fixture();
    if (kind === 'ammo')
      s.ammoVehicles.push({
        id: s.nextId++,
        side: 0,
        x,
        z,
        hp: 100,
        cargo: { kind: 'ammo', key: 'small', amount: 100 },
      });
    else if (kind === 'repair')
      s.serviceVehicles.push({ id: s.nextId++, side: 0, x, z, stationId: s.buildings[0].id });
    else s.groundUnits.push(E.makeGround(s, 0, kind, x, z));
    const before = E.save(s);
    assert.match(E.canPlace(s, key, x, z), /площадку/);
    assert.equal(typeof E.build(s, 0, key, x, z), 'string');
    assert.equal(
      E.save(s),
      before,
      'failed placement must preserve money, paid cargo and unit position',
    );
  }
});

test('embarked passengers and destroyed objects do not reserve a second invisible footprint', () => {
  const { s, key, x, z } = fixture();
  const apc = E.makeGround(s, 0, 'ifv', x + 120, z),
    foot = E.makeGround(s, 0, 'infantry', x, z);
  foot.carrierId = apc.id;
  s.groundUnits.push(apc, foot);
  s.ammoVehicles.push({ id: s.nextId++, side: 0, x, z, hp: 0 });
  assert.equal(E.canPlace(s, key, x, z), null);
  assert.equal(typeof E.build(s, 0, key, x, z), 'object');
});

test('placement preview does not expose concealed hostile infantry, actual collision still prevents burying it', () => {
  const s = E.createGame(813),
    key = 'sam';
  s.sides[0].credits = 10000;
  s.sides[0].materials = 1000;
  const point = COVER_PATCHES.find((p) => Math.abs(p.x) > 700 && !E.canPlace(s, key, p.x, p.z));
  assert.ok(point, 'a physical hidden-cover construction site exists');
  const u = E.makeGround(s, 1, 'sniper', point.x, point.z);
  u.camouflaged = true;
  s.groundUnits.push(u);
  assert.equal(E.groundVisible(s, 0, u), false);
  assert.equal(
    E.canPlace(s, key, point.x, point.z),
    null,
    'hover does not query hidden coordinates',
  );
  const before = E.save(s);
  assert.equal(E.build(s, 0, key, point.x, point.z), 'Площадка сейчас недоступна');
  assert.equal(E.save(s), before);
});
