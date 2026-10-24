import * as T from '../../../../vendor/three/three.module.js';

// Oil industry and the harbour. Static detail only, except the nodding beam of the pumpjack,
// which the building dispatcher keeps out of the static batch through root.userData.pump.

// Pumpjack on a concrete pad: samson post, walking beam with horse head, counterweights,
// a motor house, the wellhead and a small storage tank.
export function oilWellModel(w, content, root, accent) {
  const steel = '#3d4644',
    yellow = '#c49a3c',
    rust = '#7a5038';
  w.box(content, 0, 0.7, 0, 13, 0.5, 9, '#7f7e74');
  // Samson post: an A-frame of four legs.
  for (const [x, z] of [
    [-1.4, -1.2],
    [1.4, -1.2],
    [-1.4, 1.2],
    [1.4, 1.2],
  ]) {
    const leg = w.box(content, x * 0.6, 1.2, z * 0.6, 0.45, 8.6, 0.45, steel);
    leg.rotation.set(z * 0.08, 0, -x * 0.08);
  }
  w.box(content, 0, 9.6, 0, 1.6, 0.7, 1.6, steel);
  // Wellhead, flow line and a small separator tank.
  w.cyl(content, 0, 1.2, 5.6, 0.45, 2.4, '#8a8d84');
  w.box(content, 0, 2.6, 5.6, 1.6, 0.35, 0.35, '#8a8d84');
  w.box(content, 2.4, 1.5, 4.6, 4.4, 0.25, 0.25, '#565d58');
  w.cyl(content, 5, 1.2, 2.5, 1.5, 4, rust);
  w.cyl(content, 5, 5.2, 2.5, 1.6, 0.25, '#5c4433');
  // Motor house and gearbox behind the post.
  w.box(content, 0, 1.2, -4.2, 3.4, 2.6, 2.6, '#6b7268');
  w.box(content, 0, 3.8, -4.2, 3.8, 0.3, 3, '#4f5752');
  w.box(content, 0, 1.2, -2.2, 1.8, 2.4, 1.4, steel);
  // Walking beam pivots on top of the post.
  const pump = new T.Group();
  pump.position.set(0, 10, 0);
  root.userData.pump = pump;
  content.add(pump);
  w.box(pump, 0, -0.4, 0, 0.8, 0.8, 11, yellow);
  // Horse head over the well and the polished rod hanging from it.
  const head = w.box(pump, 0, -1.6, 5.6, 0.9, 3.2, 1.2, yellow);
  head.rotation.x = -0.25;
  w.box(pump, 0, -9, 6.1, 0.12, 8, 0.12, '#c2c6bd');
  // Counterweights and pitman arms on the motor side.
  for (const x of [-0.9, 0.9]) {
    w.box(pump, x, -3.6, -5.2, 0.35, 3, 2.6, '#2f3533');
    w.box(pump, x * 0.7, -6, -4.6, 0.25, 6, 0.25, steel);
  }
  w.box(content, 0, 0.75, 6.2, 12, 0.08, 0.6, accent, { emissive: accent, emissiveIntensity: 0.3 });
}

// Vertical storage tank with a floating roof, a spiral stair, a ring of pipes and a bund wall.
export function oilTankModel(w, content, accent) {
  const shell = '#c9cbc2';
  w.box(content, 0, 0.7, 0, 18, 1.4, 18, '#8a877c');
  w.box(content, 0, 0.7, 0, 15.6, 1.45, 15.6, '#4a4b46');
  w.cyl(content, 0, 1.4, 0, 6.8, 11, shell);
  w.cyl(content, 0, 12.4, 0, 6.9, 0.5, '#9fa19a');
  w.cyl(content, 0, 12.9, 0, 6.2, 0.35, '#7e817a');
  // Painted band and capacity marks.
  w.cyl(content, 0, 8.5, 0, 6.85, 1.1, accent);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    w.box(content, Math.cos(a) * 6.9, 2, Math.sin(a) * 6.9, 0.25, 8, 0.25, '#9fa19a');
  }
  // Stair winding up the shell.
  for (let i = 0; i < 12; i++) {
    const a = 0.4 + i * 0.28,
      y = 1.6 + i * 0.9,
      step = w.box(content, Math.cos(a) * 7.3, y, Math.sin(a) * 7.3, 1.4, 0.18, 0.7, '#5c605c');
    step.rotation.y = -a;
  }
  w.box(content, -7.6, 1.4, -5, 0.6, 0.6, 6, '#646a65');
  w.box(content, -4, 1.4, -7.6, 7, 0.6, 0.6, '#646a65');
  w.cyl(content, -7.6, 1.4, -8, 0.7, 1.2, '#b2453a');
}

// Harbour: quay wall reaching into the sea, two gantry cranes, containers, a warehouse,
// bollards and a harbour office with a light.
export function portModel(w, content, accent) {
  const concrete = '#7d7c72',
    crane = '#c9973b';
  // The front faces the road (+z); the quay reaches back over the water (−z).
  w.box(content, 0, 0.7, 2, 30, 0.5, 18, concrete);
  w.box(content, 0, -1.5, -14, 32, 2.8, 16, '#6c6a60');
  w.box(content, 0, 1.3, -21.8, 32, 0.4, 0.5, '#2f3532');
  for (let i = -3; i <= 3; i++) {
    w.cyl(content, i * 4.8, 1.3, -20.6, 0.35, 0.9, '#2a2e2c');
    w.box(content, i * 4.8, -2.2, -22.1, 1.4, 2.2, 0.4, '#232624');
  }
  // Warehouse and office.
  w.box(content, -8, 0.95, 6, 13, 7, 9, '#9a9585');
  w.box(content, -8, 7.95, 6, 13.8, 0.6, 9.8, '#5a5f59');
  w.box(content, -8, 1, 10.6, 5, 4.5, 0.2, '#3a4446');
  w.box(content, 9, 0.95, 7, 6, 5, 6, '#b7b4a4');
  w.box(content, 9, 5.95, 7, 6.6, 0.5, 6.6, '#596059');
  w.cyl(content, 11, 6.4, 9, 0.18, 6, '#a9b0a8');
  w.box(content, 11, 12.4, 9, 0.8, 0.8, 0.8, '#ffd896', {
    emissive: '#ffc970',
    emissiveIntensity: 2.4,
  });
  // Stacked containers.
  const colors = ['#9b3f35', '#3f6f8f', '#c58b3a', '#4f7a55', '#7b7f86'];
  for (let i = 0; i < 6; i++)
    for (let level = 0; level < (i % 3) + 1; level++)
      w.box(content, -12 + i * 2.8, 0.95 + level * 2.5, -4, 2.4, 2.4, 6, colors[(i + level) % 5]);
  // Two gantry cranes over the quay.
  for (const x of [-7, 7]) {
    for (const z of [-12, -19])
      for (const sx of [-2.4, 2.4]) w.box(content, x + sx, 0.95, z, 0.6, 15, 0.6, crane);
    w.box(content, x, 15.5, -15.5, 6, 1, 8.6, crane);
    const boom = w.box(content, x, 16.2, -22, 1.2, 1, 14, crane);
    boom.rotation.x = 0.06;
    w.box(content, x, 12, -26, 0.15, 4.4, 0.15, '#2d3230');
    w.box(content, x, 11.4, -26, 2.2, 0.6, 2.2, '#3f4643');
  }
  w.box(content, 0, 0.98, 10.5, 28, 0.06, 0.6, accent, {
    emissive: accent,
    emissiveIntensity: 0.35,
  });
}

// A coastal cargo ship: hull with a red boot top, deck containers, bridge house and funnel.
export function shipModel(w, root, accent) {
  const hull = '#2f3a40';
  w.box(root, 0, -1.6, 0, 7, 3.6, 30, hull);
  w.box(root, 0, -1.9, 0, 7.1, 0.9, 30.1, '#8c2f2a');
  // A square block turned 45° closes the hull into a pointed bow.
  const bow = w.box(root, 0, -1.6, 15, 4.9, 3.6, 4.9, hull);
  bow.rotation.y = Math.PI / 4;
  w.box(root, 0, 2, 0, 6.6, 0.25, 29, '#57605e');
  const colors = ['#9b3f35', '#3f6f8f', '#c58b3a', '#4f7a55'];
  for (let i = 0; i < 4; i++)
    for (const x of [-1.6, 1.6])
      w.box(root, x, 2.25, 6 - i * 4.4, 2.6, 2.4, 4, colors[(i + (x > 0)) % 4]);
  // Bridge house at the stern.
  w.box(root, 0, 2.25, -11, 6, 4.5, 4.5, '#d8d6cc');
  w.box(root, 0, 6.75, -10.4, 6.4, 1.6, 3.4, '#cfcdc2');
  w.box(root, 0, 7.1, -8.65, 5.6, 0.7, 0.1, '#2c4650');
  w.cyl(root, 0, 8.3, -12.2, 0.9, 3.4, '#3b3f3e');
  w.cyl(root, 0, 11, -12.2, 0.95, 0.8, accent);
  w.cyl(root, 0, 2.25, 13, 0.12, 6, '#a9ada6');
}

// Training range: a firing line with sandbags and pop-up targets, an obstacle course of walls
// and tyres, a watchtower and a small hut with a flag.
export function trainingModel(w, content, accent) {
  const sand = '#a89b74',
    wood = '#6f5a42';
  w.box(content, 0, 0.7, 0, 30, 0.2, 30, '#8a8a68');
  // Firing line and sandbag bunker.
  for (let i = 0; i < 6; i++) w.box(content, -12 + i * 4.8, 0.9, 8, 4.2, 1.2, 1.6, sand);
  for (let i = 0; i < 5; i++) {
    const x = -10 + i * 5;
    w.box(content, x, 0.9, -12, 0.2, 2.2, 0.2, wood);
    w.box(content, x, 2.4, -12, 1.4, 1.8, 0.12, i % 2 ? '#d8d4c4' : '#c45a3e');
    w.box(content, x, 2.9, -11.93, 0.5, 0.5, 0.05, '#2b2b2b');
  }
  w.box(content, 0, 0.9, -14, 28, 3, 0.8, '#7c6f55');
  // Obstacle course: low walls, a climbing frame and a row of tyres.
  for (const z of [-4, 0]) w.box(content, -11, 0.9, z, 5, 1.4, 0.5, '#8f8a7c');
  for (const x of [8, 11]) w.box(content, x, 0.9, -2, 0.3, 4, 0.3, wood);
  w.box(content, 9.5, 4.6, -2, 3.6, 0.25, 0.25, wood);
  for (let i = 0; i < 4; i++) w.cyl(content, 3 + i * 1.6, 0.9, 3, 0.7, 0.4, '#23282a');
  // Watchtower and hut.
  for (const [x, z] of [
    [12, 10],
    [14.5, 10],
    [12, 12.5],
    [14.5, 12.5],
  ])
    w.box(content, x, 0.9, z, 0.3, 7, 0.3, wood);
  w.box(content, 13.25, 7.9, 11.25, 3.6, 0.3, 3.6, wood);
  w.box(content, 13.25, 9.6, 11.25, 4, 0.3, 4, '#5a4c3a');
  w.box(content, -12, 0.9, 11.5, 6, 3.5, 4.5, '#77806a');
  w.box(content, -12, 4.4, 11.5, 6.6, 0.4, 5, '#4f5a4c');
  w.cyl(content, -15.5, 0.9, 9, 0.12, 9, '#aeb7af');
  w.box(content, -14.3, 8.2, 9, 2.4, 1.4, 0.1, accent, {
    emissive: accent,
    emissiveIntensity: 0.4,
  });
}
