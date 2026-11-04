// Ship classes bought at a shipyard. A patrol post builds the cheap boat; a naval base builds
// either the missile ship or the big destroyer. Every ship is paid for when it is ordered.
export const SHIPS = Object.freeze({
  patrol: Object.freeze({
    name: 'Сторожевой катер',
    base: 'patrolbase',
    cost: 1600,
    metal: 60,
    hp: 320,
    speed: 22,
    gun: Object.freeze({ range: 420, damage: 22, cooldown: 1.2 }),
    aa: null,
    magazine: 0,
    description: 'Быстрый и дешёвый: охотится на корабли и обстреливает берег.',
  }),
  missile: Object.freeze({
    name: 'Ракетный корабль',
    base: 'navalbase',
    cost: 4800,
    metal: 180,
    hp: 600,
    speed: 13,
    gun: null,
    // One machine-gun mount against drones.
    aa: Object.freeze({ mounts: 1, range: 240, damage: 9, cooldown: 0.4 }),
    magazine: 4,
    families: Object.freeze(['cruise']),
    description: 'Берёт до 4 крылатых ракет у причала и пускает их с огневой позиции в море.',
  }),
  destroyer: Object.freeze({
    name: 'Эсминец',
    base: 'navalbase',
    cost: 8500,
    metal: 320,
    hp: 1300,
    speed: 11,
    gun: Object.freeze({ range: 560, damage: 46, cooldown: 2.2 }),
    // Three machine-gun mounts shoot down drones around the ship.
    aa: Object.freeze({ mounts: 3, range: 280, damage: 10, cooldown: 0.35 }),
    // A vertical launch shaft for cruise missiles and strike drones.
    magazine: 8,
    families: Object.freeze(['cruise', 'drone']),
    description:
      'Большой корабль: орудие против кораблей и берега, три пулемётные точки против дронов и пусковая шахта на 8 ракет или дронов.',
  }),
});
export const SHIP_CLASSES = Object.freeze(Object.keys(SHIPS));
export const shipClassesFor = (baseKey) =>
  SHIP_CLASSES.filter((key) => SHIPS[key].base === baseKey);
