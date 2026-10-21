export const dayPhase = (time) => {
  const hour = (18.5 + time / 50) % 24,
    angle = ((hour - 6) / 24) * Math.PI * 2,
    daylight = Math.max(0, (Math.sin(angle) + 0.18) / 1.18);
  return { hour, daylight, night: 1 - daylight, angle };
};
