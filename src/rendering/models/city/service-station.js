// Static detail only: the building dispatcher batches this subtree and owns its lifecycle.
export function serviceStationModel(w, content, accent) {
  const wall = '#818c85',
    steel = '#3c4c4c',
    orange = '#bd793f',
    dark = '#243235';
  w.box(content, 0, 0.7, -2, 23, 8.5, 17, wall);
  w.box(content, 0, 9.2, -2, 24.5, 0.8, 18.5, steel);
  w.box(content, 0, 7.3, 6.65, 23.2, 1.3, 0.35, orange);
  for (const x of [-6, 3]) {
    // Recessed roller doors, separate frames and the approach lanes in front of each bay.
    w.box(content, x, 0.8, 6.7, 7.4, 6.3, 0.3, dark);
    w.box(content, x, 1.1, 6.92, 6.3, 5.1, 0.2, '#596b69');
    for (let y = 1.6; y < 6.2; y += 0.8) w.box(content, x, y, 7.05, 6.2, 0.12, 0.12, '#384a4c');
    for (const side of [-1, 1]) {
      w.box(content, x + side * 3.65, 0.8, 7, 0.38, 6.4, 0.45, '#b3b8a7');
      w.box(content, x + side * 2.9, 0.74, 10.1, 0.18, 0.04, 5.7, '#c9b780');
    }
    w.box(content, x, 7.1, 7.1, 5.6, 0.22, 0.3, '#ffd39b', {
      emissive: '#ffd39b',
      emissiveIntensity: 1.4,
    });
    w.box(content, x, 0.76, 7.4, 7.4, 0.12, 0.7, '#c0a372');
  }
  // Side office, glazed entrance and a tool board identify a civilian workshop at camera height.
  w.box(content, 10, 0.7, 2.6, 3, 6, 8, '#a6ada0');
  w.box(content, 10, 1, 6.75, 1.5, 4.8, 0.2, '#304a50');
  w.box(content, 10.5, 2.7, 6.9, 0.15, 0.55, 0.2, '#c4c5af');
  w.box(content, 11.6, 3.3, 0, 0.18, 2, 3.2, '#314c51');
  w.box(content, -12, 0.8, -2, 1.1, 2.7, 6.5, orange);
  for (let i = 0; i < 4; i++) w.box(content, -12.6, 1.1 + i * 0.55, -2, 0.18, 0.12, 5.2, '#d4baa0');
  w.box(content, -12, 3.7, -5, 1.1, 2.3, 2, steel);
  w.cyl(content, 11, 0.75, -11, 0.8, 2.1, '#a68a5d');
  w.cyl(content, 8.7, 0.75, -11, 0.8, 2.1, '#536461');
  // Roof ventilation, spare beams and a low exhaust stack stay inside the 26 m lot.
  w.box(content, 5, 10, -5, 4, 0.8, 4, '#667976');
  w.cyl(content, 5, 10.8, -5, 1.2, 0.25, dark);
  w.box(content, -7, 10, -6, 4.8, 0.3, 2.2, '#a0a99c');
  w.cyl(content, -9, 10, -7, 0.35, 1.5, steel);
  // A large open-ended wrench, built from bars rather than a texture or per-station canvas.
  w.box(content, 0, 10, 3.9, 7.2, 0.35, 4.4, dark);
  const handle = w.box(content, -0.5, 10.4, 4, 4, 0.2, 0.65, '#d9bd83');
  handle.rotation.y = -0.55;
  w.box(content, 1.4, 10.4, 3.1, 1.1, 0.2, 0.6, '#d9bd83');
  w.box(content, 2.1, 10.4, 3.9, 0.6, 0.2, 1.7, '#d9bd83');
  w.box(content, 1.4, 10.4, 4.7, 1.1, 0.2, 0.6, '#d9bd83');
  w.box(content, -10.7, 8.8, 7, 1.1, 0.4, 0.3, accent);
}
