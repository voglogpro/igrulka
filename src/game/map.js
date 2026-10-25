export const VERSION = 19;
// A wide valley split by an inland sea. Two narrow land corridors at the northern and southern
// ends are the only ground routes between the opposing banks; aircraft cross the water.
export const MAP = { width: 4000, depth: 3200, riverWidth: 44 };
// The playable field inside the map edge: orders, routes and saved points must stay inside it.
export const FIELD = { x: MAP.width / 2 - 16, z: MAP.depth / 2 - 16 };
export const inField = (x, z, margin = 0) =>
  Math.abs(x) <= FIELD.x - margin && Math.abs(z) <= FIELD.z - margin;
export const SEA = { halfX: 600, halfZ: 1120, round: 120 };
// Ground routes around the sea: the centre line of each corridor.
export const CORRIDORS = [-(SEA.halfZ + MAP.depth / 2) / 2, (SEA.halfZ + MAP.depth / 2) / 2];
// Keep city centres unchanged while stretching the sea and the two land corridors.
// This same map transform preserves old wells and campaign positions on import.
export function expandLegacyZ(z) {
  const value = Math.abs(z),
    anchors = [
      [0, 0],
      [400, 400],
      [820, 1120],
      [1010, 1360],
      [1184, 1584],
    ];
  for (let i = 1; i < anchors.length; i++) {
    const [a, x] = anchors[i - 1],
      [b, y] = anchors[i];
    if (value <= b) return Math.sign(z) * (x + ((value - a) / (b - a)) * (y - x));
  }
  return Math.sign(z) * (1584 + value - 1184);
}
// Version 15 widens the sea across the two cities. Translate the town landmass
// intact, while interpolating the central corridors and neutral sites.
export function expandLegacyX(x) {
  const value = Math.abs(x);
  const anchors = [
    [0, 0],
    [170, 460],
    [240, 640],
  ];
  for (let i = 1; i < anchors.length; i++) {
    const [a, left] = anchors[i - 1],
      [b, right] = anchors[i];
    if (value <= b) return Math.sign(x) * (left + ((value - a) / (b - a)) * (right - left));
  }
  return Math.sign(x) * (value + 400);
}
export const HQ_X = 1015;
export const DISTRICT_X = 460;
// The neutral trading island in the middle of the sea. In the rules it is open water: armies
// cannot walk or build there, but merchant ships of both cities tie up at its quays.
export const ISLAND = { x: 0, z: 0, r: 62, quay: 94 };
// Oil fields: wells can only be sunk here. Every western field has a mirrored eastern twin; the
// two corridor fields lie on the frontier and belong to whoever holds them.
export const LEGACY_OIL_FIELDS = [
  [-880, -250],
  [-830, 330],
  [-450, -640],
  [-1260, -60],
  [-1080, 760],
  [-90, -1010],
].flatMap(([x, z], i) => [
  { id: i * 2 + 1, x, z, r: 22 },
  { id: i * 2 + 2, x: -x, z: -z, r: 22 },
]);
export const OIL_FIELDS = LEGACY_OIL_FIELDS.map(({ id, x, z, r }) => ({
  id,
  x: expandLegacyX(x),
  z: expandLegacyZ(z),
  r,
}));
// Identical nearby wells for each of the four co-op city positions. Legacy sites keep their IDs.
for (const x of [-1280, 1280])
  for (const z of [-HQ_X, HQ_X]) OIL_FIELDS.push({ id: OIL_FIELDS.length + 1, x, z, r: 22 });

// Gentle meander of the sea's long axis.
export const riverX = (z) => (Math.sin(z / 190) * 42 + Math.sin(z / 470) * 25) * 0.5;

// Signed distance to the shoreline: negative over water, positive on land.
export function seaDistance(x, z) {
  const px = Math.abs(x - riverX(z)),
    pz = Math.abs(z),
    qx = px - (SEA.halfX - SEA.round),
    qz = pz - (SEA.halfZ - SEA.round),
    outside = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)),
    inside = Math.min(Math.max(qx, qz), 0),
    coast = Math.sin(x * 0.031 + z * 0.017) * 9 + Math.sin(z * 0.043 + x * 0.006) * 6;
  return outside + inside - SEA.round + coast;
}

// Compatibility measure used by placement and movement rules since the river map: values below
// MAP.riverWidth mean water, and every metre further from the shore adds one.
export const riverDistance = (x, z) => Math.max(0, seaDistance(x, z) + MAP.riverWidth);
export const isWater = (x, z) => seaDistance(x, z) < 0;

function lcg(seed) {
  let s = seed;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
// City cores stay flat so streets and buildings never sit on a slope.
const coreDistance = (x, z) =>
  Math.min(Math.hypot(Math.abs(x) - HQ_X, z), Math.hypot(Math.abs(x) - HQ_X, Math.abs(z) - HQ_X));
// Keep the seeded legacy hills/woods stable; extra city plains are flattened below.
const flatCore = (x, z, r) => Math.hypot(Math.abs(x) - HQ_X, z) < r;

// Hills are part of the rules: they block lines of sight, so the same heights drive the picture.
export const HILLS = [];
{
  const rnd = lcg(5113);
  for (let i = 0; i < 400 && HILLS.length < 58; i++) {
    const x = (rnd() - 0.5) * (MAP.width - 120),
      z = (rnd() - 0.5) * (MAP.depth - 120),
      r = 40 + rnd() * 75,
      h = 5 + rnd() * 12;
    if (seaDistance(x, z) < r * 0.7 + 30 || flatCore(x, z, 380 + r)) continue;
    // Mirror every hill so both sides get the same ground.
    HILLS.push({ x, z, r, h }, { x: -x, z: -z, r, h });
  }
}

const H_CELL = 8,
  H_COLS = MAP.width / H_CELL + 1,
  H_ROWS = MAP.depth / H_CELL + 1,
  H_OX = -MAP.width / 2,
  H_OZ = -MAP.depth / 2,
  heights = new Float32Array(H_COLS * H_ROWS);
for (const hill of HILLS) {
  const reach = hill.r * 2.4,
    c0 = Math.max(0, Math.floor((hill.x - reach - H_OX) / H_CELL)),
    c1 = Math.min(H_COLS - 1, Math.ceil((hill.x + reach - H_OX) / H_CELL)),
    r0 = Math.max(0, Math.floor((hill.z - reach - H_OZ) / H_CELL)),
    r1 = Math.min(H_ROWS - 1, Math.ceil((hill.z + reach - H_OZ) / H_CELL));
  for (let row = r0; row <= r1; row++)
    for (let col = c0; col <= c1; col++) {
      const x = H_OX + col * H_CELL,
        z = H_OZ + row * H_CELL,
        d2 = ((x - hill.x) ** 2 + (z - hill.z) ** 2) / (hill.r * hill.r);
      heights[row * H_COLS + col] += hill.h * Math.exp(-d2 * 1.6);
    }
}
for (let row = 0; row < H_ROWS; row++)
  for (let col = 0; col < H_COLS; col++) {
    const x = H_OX + col * H_CELL,
      z = H_OZ + row * H_CELL,
      i = row * H_COLS + col,
      shore = Math.min(1, Math.max(0, seaDistance(x, z) / 60)),
      core = Math.min(1, Math.max(0, (coreDistance(x, z) - 330) / 80)),
      // District sites and oil fields sit on level ground.
      site = Math.min(
        1,
        Math.max(0, (Math.hypot(x, Math.abs(z) - CORRIDORS[1]) - 80) / 50),
        Math.max(0, (Math.hypot(Math.abs(x) - DISTRICT_X, Math.abs(z) - CORRIDORS[1]) - 70) / 50),
      );
    let village = 1;
    for (const sx of [-1515, -515, 515, 1515])
      village = Math.min(village, Math.max(0, (Math.hypot(x - sx, Math.abs(z) - 1415) - 130) / 70));
    let oil = 1;
    for (const f of OIL_FIELDS)
      oil = Math.min(oil, Math.max(0, (Math.hypot(x - f.x, z - f.z) - 50) / 50));
    heights[i] *= shore * core * site * oil * village;
  }

// Height of dry ground (0 on the plain, metres above it on hills). Water and the map edge are 0;
// the picture adds the sea bed and the distant mountains.
export function groundHeight(x, z) {
  const fx = (x - H_OX) / H_CELL,
    fz = (z - H_OZ) / H_CELL;
  if (fx < 0 || fz < 0 || fx >= H_COLS - 1 || fz >= H_ROWS - 1) return 0;
  const c = Math.floor(fx),
    r = Math.floor(fz),
    tx = fx - c,
    tz = fz - r,
    i = r * H_COLS + c;
  return (
    (heights[i] * (1 - tx) + heights[i + 1] * tx) * (1 - tz) +
    (heights[i + H_COLS] * (1 - tx) + heights[i + H_COLS + 1] * tx) * tz
  );
}

// True when the ground between two eyes stays below the sight line. Hills hide units behind them.
export function terrainClear(ax, az, ay, bx, bz, by) {
  const length = Math.hypot(bx - ax, bz - az),
    steps = Math.floor(length / 12);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (groundHeight(ax + (bx - ax) * t, az + (bz - az) * t) > ay + (by - ay) * t) return false;
  }
  return true;
}

// Forests and thickets: concealment and soft cover for infantry, mirrored like the hills.
export const COVER_PATCHES = [];
{
  const rnd = lcg(81273);
  for (let i = 0; i < 900 && COVER_PATCHES.length < 190; i++) {
    const onHill = i % 3 === 0 && HILLS.length,
      hill = onHill ? HILLS[Math.floor(rnd() * HILLS.length)] : null,
      x = hill ? hill.x + (rnd() - 0.5) * hill.r * 1.6 : (rnd() - 0.5) * (MAP.width - 140),
      z = hill ? hill.z + (rnd() - 0.5) * hill.r * 1.6 : (rnd() - 0.5) * (MAP.depth - 140),
      forest = rnd() < 0.68,
      r = forest ? 22 + rnd() * 32 : 12 + rnd() * 14;
    if (
      seaDistance(x, z) < r + 50 ||
      flatCore(x, z, 400 + r) ||
      !inField(x, z, r + 10) ||
      OIL_FIELDS.slice(0, LEGACY_OIL_FIELDS.length).some(
        (f) => Math.hypot(x - f.x, z - f.z) < r + 50 || Math.hypot(x + f.x, z + f.z) < r + 50,
      )
    )
      continue;
    COVER_PATCHES.push({ x, z, r, forest }, { x: -x, z: -z, r, forest });
  }
}
