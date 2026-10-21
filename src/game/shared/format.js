export const formatRate = (n) => `${n >= 0 ? '+' : ''}${Math.round(n * 60)}`;
