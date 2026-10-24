// Bot difficulty. Prices and starting resources stay equal; only the bot's resource income bonus
// and the pace of its army, raids and research change. "hard" matches earlier versions.
export const DIFFICULTY = {
  easy: {
    name: 'Лёгкий',
    description: 'Без бонуса дохода, редкие налёты и медленный набор армии.',
    bonus: 1,
    armyFrom: 380,
    armyEvery: 28,
    attackEvery: 46,
    attackJitter: 26,
    researchEvery: 22,
  },
  normal: {
    name: 'Средний',
    description: 'Доход бота +10%, умеренный темп.',
    bonus: 1.1,
    armyFrom: 300,
    armyEvery: 21,
    attackEvery: 36,
    attackJitter: 22,
    researchEvery: 16,
  },
  hard: {
    name: 'Сложный',
    description: 'Доход бота +25%, частые налёты и постоянный набор.',
    bonus: 1.25,
    armyFrom: 230,
    armyEvery: 17,
    attackEvery: 28,
    attackJitter: 18,
    researchEvery: 13,
  },
  ultra: {
    name: 'Ультра',
    description: 'Доход бота +45%, волны каждые полминуты, быстрые исследования.',
    bonus: 1.45,
    armyFrom: 180,
    armyEvery: 12,
    attackEvery: 21,
    attackJitter: 13,
    researchEvery: 9,
  },
};
export const DEFAULT_DIFFICULTY = 'hard';
export const difficultyOf = (s) => DIFFICULTY[s?.difficulty] || DIFFICULTY[DEFAULT_DIFFICULTY];
