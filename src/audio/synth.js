// Offline synthesis of every sound the battle uses. Buffers are rendered once on unlock,
// so a burst of fire costs one buffer source per round instead of a node graph of oscillators.

function onePole(cutoff, sampleRate) {
  return 1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate);
}

function finish(data, drive = 1.4) {
  let peak = 0;
  for (let i = 0; i < data.length; i++) {
    data[i] = Math.tanh(data[i] * drive);
    peak = Math.max(peak, Math.abs(data[i]));
  }
  const scale = peak ? 0.95 / peak : 1;
  for (let i = 0; i < data.length; i++) data[i] *= scale;
  // Short fade-out so the end of a buffer never clicks.
  const fade = Math.min(data.length, 256);
  for (let i = 0; i < fade; i++) data[data.length - 1 - i] *= i / fade;
  return data;
}

// Supersonic crack, propellant boom, a pitched-down thump and a rumbling gas tail.
export function gunshot(sampleRate, p) {
  const data = new Float32Array(Math.ceil(sampleRate * p.length));
  const bodyA = onePole(p.bodyCutoff, sampleRate),
    tailA = onePole(p.tailCutoff, sampleRate);
  let previous = 0,
    body1 = 0,
    body2 = 0,
    tail1 = 0,
    tail2 = 0,
    phase = 0;
  for (let i = 0; i < data.length; i++) {
    const t = i / sampleRate,
      white = Math.random() * 2 - 1,
      attack = Math.min(1, t / 0.0007);
    const crack = (white - previous) * p.crack * Math.exp(-t / p.crackDecay);
    previous = white;
    body1 += bodyA * (white - body1);
    body2 += bodyA * (body1 - body2);
    const body = body2 * p.body * 4 * Math.exp(-t / p.bodyDecay);
    const frequency = p.thumpTo + (p.thumpFrom - p.thumpTo) * Math.exp(-t / 0.035);
    phase += (2 * Math.PI * frequency) / sampleRate;
    const thump = Math.sin(phase) * p.thump * Math.exp(-t / p.thumpDecay);
    tail1 += tailA * (white - tail1);
    tail2 += tailA * (tail1 - tail2);
    const tail = tail2 * p.tail * 6 * Math.exp(-t / p.tailDecay) * (1 - Math.exp(-t / 0.012));
    const action = p.action && t > 0.03 && t < 0.034 ? white * p.action : 0;
    data[i] = attack * (crack + body + thump) + tail + action;
  }
  return finish(data, p.drive ?? 1.6);
}

export const GUNS = {
  rifle: {
    length: 0.45,
    crack: 0.9,
    crackDecay: 0.003,
    body: 0.7,
    bodyCutoff: 900,
    bodyDecay: 0.025,
    thump: 0.55,
    thumpFrom: 160,
    thumpTo: 70,
    thumpDecay: 0.03,
    tail: 0.35,
    tailCutoff: 260,
    tailDecay: 0.09,
  },
  mg: {
    length: 0.5,
    crack: 0.85,
    crackDecay: 0.0035,
    body: 0.8,
    bodyCutoff: 760,
    bodyDecay: 0.032,
    thump: 0.7,
    thumpFrom: 140,
    thumpTo: 58,
    thumpDecay: 0.038,
    tail: 0.4,
    tailCutoff: 230,
    tailDecay: 0.11,
    action: 0.25,
  },
  sniper: {
    length: 0.9,
    crack: 1,
    crackDecay: 0.004,
    body: 0.9,
    bodyCutoff: 700,
    bodyDecay: 0.05,
    thump: 0.8,
    thumpFrom: 120,
    thumpTo: 45,
    thumpDecay: 0.06,
    tail: 0.55,
    tailCutoff: 200,
    tailDecay: 0.22,
  },
  hmg: {
    length: 0.7,
    crack: 0.8,
    crackDecay: 0.004,
    body: 1,
    bodyCutoff: 600,
    bodyDecay: 0.05,
    thump: 0.95,
    thumpFrom: 115,
    thumpTo: 44,
    thumpDecay: 0.06,
    tail: 0.55,
    tailCutoff: 190,
    tailDecay: 0.16,
    action: 0.3,
  },
  shilka: {
    length: 0.75,
    crack: 0.7,
    crackDecay: 0.004,
    body: 1,
    bodyCutoff: 560,
    bodyDecay: 0.055,
    thump: 1,
    thumpFrom: 100,
    thumpTo: 40,
    thumpDecay: 0.07,
    tail: 0.6,
    tailCutoff: 170,
    tailDecay: 0.18,
  },
  autocannon: {
    length: 1,
    crack: 0.7,
    crackDecay: 0.005,
    body: 1.1,
    bodyCutoff: 480,
    bodyDecay: 0.07,
    thump: 1.1,
    thumpFrom: 85,
    thumpTo: 34,
    thumpDecay: 0.1,
    tail: 0.7,
    tailCutoff: 150,
    tailDecay: 0.26,
  },
  tank: {
    length: 2,
    crack: 0.8,
    crackDecay: 0.006,
    body: 1.2,
    bodyCutoff: 380,
    bodyDecay: 0.14,
    thump: 1.3,
    thumpFrom: 62,
    thumpTo: 24,
    thumpDecay: 0.26,
    tail: 0.9,
    tailCutoff: 120,
    tailDecay: 0.55,
    drive: 1.9,
  },
  artillery: {
    length: 2.6,
    crack: 0.7,
    crackDecay: 0.007,
    body: 1.3,
    bodyCutoff: 320,
    bodyDecay: 0.2,
    thump: 1.4,
    thumpFrom: 52,
    thumpTo: 19,
    thumpDecay: 0.36,
    tail: 1,
    tailCutoff: 100,
    tailDecay: 0.8,
    drive: 2,
  },
};

// Explosion: blast front, a deep falling boom, then crackling debris.
export function explosion(sampleRate, size) {
  const length = 1.8 + size * 0.9,
    data = new Float32Array(Math.ceil(sampleRate * length)),
    a = onePole(220 + 160 / size, sampleRate),
    b = onePole(1800, sampleRate);
  let low1 = 0,
    low2 = 0,
    mid = 0,
    phase = 0;
  for (let i = 0; i < data.length; i++) {
    const t = i / sampleRate,
      white = Math.random() * 2 - 1;
    low1 += a * (white - low1);
    low2 += a * (low1 - low2);
    mid += b * (white - mid);
    const frequency = 18 + 42 * Math.exp(-t / (0.08 * size));
    phase += (2 * Math.PI * frequency) / sampleRate;
    const boom =
      low2 * 5 * Math.exp(-t / (0.35 * size)) + Math.sin(phase) * 1.2 * Math.exp(-t / (0.3 * size));
    const front = mid * 1.4 * Math.exp(-t / 0.03);
    const debris =
      t > 0.15 && Math.random() < 0.0009 * size
        ? (Math.random() - 0.5) * 1.5 * Math.exp(-t / length)
        : 0;
    data[i] = Math.min(1, t / 0.002) * (boom + front) + debris;
  }
  return finish(data, 2.1);
}

// Missile or rocket motor ignition: a pop followed by a rushing roar.
export function whoosh(sampleRate, length = 1.4) {
  const data = new Float32Array(Math.ceil(sampleRate * length));
  let low = 0,
    band = 0;
  for (let i = 0; i < data.length; i++) {
    const t = i / sampleRate,
      white = Math.random() * 2 - 1,
      cutoff = 600 + 2200 * Math.min(1, t / 0.4);
    low += onePole(cutoff, sampleRate) * (white - low);
    band += onePole(140, sampleRate) * (white - band);
    const envelope = Math.min(1, t / 0.06) * Math.exp(-t / (length * 0.45));
    data[i] = low * envelope * 1.5 + band * 3 * Math.exp(-t / 0.2) + white * Math.exp(-t / 0.01);
  }
  return finish(data, 1.3);
}

// Falling shell: a descending whistle that grows louder until the impact.
export function whistle(sampleRate, length = 1.3) {
  const data = new Float32Array(Math.ceil(sampleRate * length));
  let phase = 0,
    air = 0;
  for (let i = 0; i < data.length; i++) {
    const t = i / sampleRate,
      k = t / length,
      frequency = 1250 - 700 * k + Math.sin(t * 38) * 12;
    phase += (2 * Math.PI * frequency) / sampleRate;
    air += onePole(2500, sampleRate) * (Math.random() * 2 - 1 - air);
    data[i] = (Math.sin(phase) * 0.7 + air * 0.6) * Math.pow(k, 1.6) * Math.min(1, (1 - k) * 40);
  }
  return finish(data, 1.1);
}

// Magazine change: two dry mechanical clicks.
export function clicks(sampleRate) {
  const data = new Float32Array(Math.ceil(sampleRate * 0.3));
  for (const start of [0, 0.14]) {
    const from = Math.floor(start * sampleRate);
    for (let i = 0; i < sampleRate * 0.012; i++)
      data[from + i] += (Math.random() * 2 - 1) * Math.exp(-i / (sampleRate * 0.002));
  }
  return finish(data, 1);
}

// Loops for engines. Each loop length holds a whole number of cycles so it repeats seamlessly.
export function dieselLoop(sampleRate) {
  const length = 2,
    data = new Float32Array(sampleRate * length),
    firing = 30,
    a = onePole(110, sampleRate),
    c = onePole(420, sampleRate);
  let rumble = 0,
    knock = 0;
  for (let i = 0; i < data.length; i++) {
    const t = i / sampleRate,
      white = Math.random() * 2 - 1,
      cycle = (t * firing) % 1;
    rumble += a * (white - rumble);
    knock += c * (white - knock);
    data[i] =
      rumble * 6 + knock * 1.4 * Math.exp(-cycle * 9) + Math.sin(2 * Math.PI * firing * t) * 0.25;
  }
  return finish(data, 1.2);
}

export function rotorLoop(sampleRate) {
  const length = 1,
    data = new Float32Array(sampleRate),
    blade = 90,
    a = onePole(900, sampleRate);
  let air = 0;
  for (let i = 0; i < data.length; i++) {
    const t = i / sampleRate;
    air += a * (Math.random() * 2 - 1 - air);
    let tone = 0;
    for (let n = 1; n <= 4; n++) tone += Math.sin(2 * Math.PI * blade * n * t) / (n * n);
    const chop = 0.6 + 0.4 * Math.sin(2 * Math.PI * 12 * t);
    data[i] = (tone * 0.35 + air * 1.2) * chop;
  }
  return finish(data, 1);
}

export function jetLoop(sampleRate) {
  const data = new Float32Array(sampleRate),
    a = onePole(1400, sampleRate),
    b = onePole(160, sampleRate);
  let hiss = 0,
    roar = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    hiss += a * (white - hiss);
    roar += b * (white - roar);
    data[i] = hiss * 0.8 + roar * 4;
  }
  return finish(data, 1);
}

// Outdoor impulse response: a few early reflections and a long darkening tail.
export function impulseResponse(sampleRate, seconds = 2.6) {
  const length = Math.ceil(sampleRate * seconds),
    channels = [new Float32Array(length), new Float32Array(length)];
  for (const data of channels) {
    let low = 0;
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate,
        cutoff = 5000 * Math.exp(-t * 1.6) + 250;
      low += onePole(cutoff, sampleRate) * (Math.random() * 2 - 1 - low);
      data[i] = low * Math.exp(-t * 2.4) * 1.6;
    }
    for (const [time, gain] of [
      [0.045, 0.5],
      [0.11, 0.35],
      [0.19, 0.25],
      [0.31, 0.18],
    ]) {
      const at = Math.floor((time + Math.random() * 0.015) * sampleRate);
      for (let i = 0; i < 40; i++) data[at + i] += (Math.random() - 0.5) * gain;
    }
  }
  return channels;
}

// Air-raid siren: one slow rise and fall per loop with two slightly detuned rotors.
export function sirenLoop(sampleRate, period = 8) {
  const data = new Float32Array(sampleRate * period);
  let a = 0,
    b = 0;
  for (let i = 0; i < data.length; i++) {
    const t = i / sampleRate,
      sweep = 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / period),
      frequency = 280 + 420 * sweep;
    a += (2 * Math.PI * frequency) / sampleRate;
    b += (2 * Math.PI * frequency * 1.006) / sampleRate;
    let tone = 0;
    for (let n = 1; n <= 5; n++) tone += (Math.sin(a * n) + Math.sin(b * n)) / (n * 1.6);
    data[i] = tone * (0.55 + 0.45 * sweep);
  }
  return finish(data, 1.2);
}

// Strike drones: the rasping two-stroke buzz of a small piston engine with a pusher prop.
export function mopedLoop(sampleRate) {
  const data = new Float32Array(sampleRate),
    firing = 104,
    a = onePole(2400, sampleRate);
  let rasp = 0;
  for (let i = 0; i < data.length; i++) {
    const t = i / sampleRate,
      cycle = (t * firing) % 1;
    rasp += a * (Math.random() * 2 - 1 - rasp);
    const pulse = Math.exp(-cycle * 6) - 0.25,
      prop = Math.sin(2 * Math.PI * firing * 2 * t) * 0.25;
    data[i] =
      (pulse + prop + rasp * 0.5 * Math.exp(-cycle * 3)) *
      (0.85 + 0.15 * Math.sin(2 * Math.PI * 7 * t));
  }
  return finish(data, 1.4);
}
