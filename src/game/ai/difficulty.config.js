// Bot difficulty. Prices and starting resources stay equal; difficulty changes only the bot's
// resource income bonus and the pace of its army recruitment. Air strikes and ground
// offensives follow the bot's budget, the enemy's defences and its force readiness the same
// way on every difficulty (ai/strike-ai.js), so a richer bot simply fields more.
export const DIFFICULTY = {
  easy: {
    name: 'Лёгкий',
    description: 'Без бонуса дохода, медленный набор армии. Удары — по бюджету.',
    bonus: 1,
    armyFrom: 380,
    armyEvery: 28,
  },
  normal: {
    name: 'Средний',
    description: 'Доход бота +10%, умеренный набор армии. Удары — по бюджету.',
    bonus: 1.1,
    armyFrom: 300,
    armyEvery: 21,
  },
  hard: {
    name: 'Сложный',
    description: 'Доход бота +25%, постоянный набор армии. Удары — по бюджету.',
    bonus: 1.25,
    armyFrom: 230,
    armyEvery: 17,
  },
  ultra: {
    name: 'Ультра',
    description: 'Доход бота +45%, быстрый набор армии. Удары — по бюджету.',
    bonus: 1.45,
    armyFrom: 180,
    armyEvery: 12,
  },
};
export const DEFAULT_DIFFICULTY = 'hard';
export const difficultyOf = (s) => DIFFICULTY[s?.difficulty] || DIFFICULTY[DEFAULT_DIFFICULTY];
