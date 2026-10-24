const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
export const RAIN = Object.freeze({
  count: 2800,
  width: 1080,
  depth: 860,
  height: 240,
  minSpeed: 92,
  speedRange: 42,
});

export function weatherStyle(weather) {
  const amount = clamp01(weather?.amount);
  const kind = weather?.kind || 'clear';
  return {
    rain: amount * (kind === 'storm' ? 0.48 : kind === 'rain' ? 0.3 : 0),
    groundFog:
      amount * (kind === 'fog' ? 0.27 : kind === 'storm' ? 0.075 : kind === 'rain' ? 0.04 : 0),
    haze:
      amount *
      (kind === 'fog' ? 0.0001 : kind === 'storm' ? 0.00008 : kind === 'rain' ? 0.00004 : 0),
    wind: kind === 'storm' ? 6 : 3.2,
  };
}

export function rainWind(time, strength = 3.2) {
  return {
    x: strength + Math.sin(time * 0.17) * strength * 0.25,
    z: 1.4 + Math.sin(time * 0.11) * 0.6,
  };
}

// Matches the uniform density selection in the rain shader, independent of x/z position.
export function rainSeeds(count = RAIN.count) {
  const values = new Float32Array(count * 4);
  let seed = 1234567;
  for (let i = 0; i < values.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    values[i] = seed / 4294967296;
  }
  return values;
}
