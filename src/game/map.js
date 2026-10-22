export const VERSION = 10;
export const MAP = { width: 1760, depth: 1200, riverWidth: 44 };
export const riverX = (z) => Math.sin(z / 190) * 42 + Math.sin(z / 470) * 25;
export const riverDistance = (x, z) => Math.abs(x - riverX(z));
