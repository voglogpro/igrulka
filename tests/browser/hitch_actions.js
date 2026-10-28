// Endowed performance fixture, not economy/balance acceptance. HP, finite
// magazines, launch rates, roads and player command handlers remain ordinary.
window.hitchActions = (count = 90) => {
  const E = skyfront.engine,
    w = skyfront.getWorld(),
    s = E.createGame(813, { mode: 'multiplayer' });
  s.rules.rear = false;
  s.weather.kind = 'clear';
  s.weather.amount = 0;
  for (const f of s.sides)
    Object.assign(f, { credits: 100000, materials: 10000, oil: 200, components: 120 });
  for (let i = 0; i < count; i++) {
    const x = -1250 + (i % 25) * 18,
      z = 180 + Math.floor(i / 25) * 13;
    const u = E.makeGround(s, 0, i % 5 ? 'infantry' : 'machinegunner', x, z);
    u.autoDefense = false;
    u.holdFire = true;
    u.guard = { x, z };
    u.order = { mode: 'guard', x, z };
    s.groundUnits.push(u);
  }
  for (let i = 0; i < 150; i++) {
    const ax = -1970 + (i % 15) * 65,
      az = -950 + Math.floor(i / 15) * 65;
    s.roads.push({ id: s.nextId++, side: 0, ax, az, bx: ax + 50, bz: az, hp: 120, maxHp: 120 });
  }
  const sites = {};
  for (const [key, z] of [
    ['drone', 180],
    ['heavy', 250],
    ['cruise', 320],
    ['ballistic', 390],
  ]) {
    const b = E.build(s, 1, ['drone', 'heavy'].includes(key) ? 'launcher' : 'silo', 1015, z);
    if (typeof b === 'string') throw Error(b);
    b.progress = 1;
    b.hp = b.maxHp;
    if (E.acceptLaunchDelivery(b, key, 1) !== 1) throw Error('No finite launcher stock');
    sites[key] = b.id;
  }
  const gun = E.build(s, 0, 'gun', -1080, 100);
  if (typeof gun === 'string') throw Error(gun);
  gun.progress = 1;
  gun.hp = gun.maxHp;
  s.networkRevision++;
  Object.assign(w.state, s);
  w.previousSimTime = 0;
  w.focus(-1015, 220, 620, { instant: true });
  w.controls.update(3);
  w.sync();
  return { count: s.groundUnits.length, roads: s.roads.length, gun: gun.id, sites };
};
