const COLORS = ['#7baf8d', '#d08b75', '#78aee0', '#d7ae67'];
export const factionHex = (side) => COLORS[side] || '#a2a6a3';
export const factionColor = (side) => Number.parseInt(factionHex(side).slice(1), 16);
