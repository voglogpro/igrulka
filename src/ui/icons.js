const paths = {
  housing: 'M4 21V8h7v13M11 21V3h9v18M7 11v1m0 3v1m8-10v2m3-2v2m-3 3v2m3-2v2m-3 3v2m3-2v2',
  industry: 'M3 21V10l6 4V8l6 4V3h4v18M3 21h19M7 17h2m4 0h2',
  power: 'M13 2 5 14h6l-1 8 9-13h-7Z',
  factory: 'M3 21V9l7 4V9l7 4V5h3v16ZM7 17h3m4 0h3',
  lab: 'M9 3h6m-5 0v7l-6 9q-1 2 2 2h12q3 0 2-2l-6-9V3M8 14h8',
  launcher: 'M3 21h18M6 20v-6h12v6M5 13 15 3l4 4L9 17M8 10l4 4',
  road: 'M7 2 3 22M17 2l4 20M12 3v3m0 4v4m0 4v3',
  gun: 'M3 21h18M12 21v-9M7 13l8-8 4 4-8 8M15 5l4-4',
  cannon: 'M4 21h16M8 21l4-9m4 9-4-9M7 12l12-8 2 3-12 8',
  sam: 'M3 21h18M5 19l9-15 3 2-9 15m5-3 7-12 3 2-7 12',
  radar: 'M12 21v-8M6 21h12M5 4a8 8 0 0 0 11 11L5 4Zm8-2a10 10 0 0 1 9 9m-8-5a5 5 0 0 1 4 4',
};
export const icon = (key) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[key] || paths.launcher}"/></svg>`;
export const short = {
  housing: 'Жильё',
  industry: 'Промышленность',
  power: 'Энергия',
  factory: 'Завод',
  lab: 'Лаборатория',
  launcher: 'Пусковая',
  gun: 'МОГ',
  sam: 'Ракетное ПВО',
  radar: 'Радар',
  road: 'Дорога',
  barracks: 'Казармы',
};
