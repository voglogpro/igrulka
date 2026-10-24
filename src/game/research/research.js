import { TECH } from '../config.js';
import { supplyFactor } from '../city/economy.js';
import { event } from '../shared/events.js';

export function researchProjects(s, owner) {
  const f = s.sides[owner];
  return f ? [...(f.research ? [f.research] : []), ...(f.researchQueue || [])] : [];
}

const laboratories = (s, owner) =>
  s.buildings.filter(
    (b) => b.side === owner && b.key === 'lab' && b.hp > 0 && b.progress >= 1 && !b.demolished,
  );

export function researchStatus(s, owner) {
  const projects = researchProjects(s, owner);
  const slots = laboratories(s, owner).length;
  return { slots, projects, activeCount: Math.min(slots, projects.length) };
}

function storeProjects(f, projects) {
  f.research = projects[0] || null;
  f.researchQueue = projects.slice(1);
}

export function updateResearch(s, owner, economy, dt) {
  const f = s.sides[owner],
    projects = researchProjects(s, owner);
  if (!projects.length) return;
  const labs = laboratories(s, owner);
  const active = Math.min(labs.length, projects.length);
  if (!active) return;
  // Each project receives one slot, sharing available road/power efficiency fairly.
  // A second idle laboratory never doubles the speed of a single project.
  const roads = labs
    .map((b) => supplyFactor(s, b))
    .sort((a, b) => b - a)
    .slice(0, active);
  const rate = (economy.productivity * roads.reduce((sum, road) => sum + road, 0)) / active;
  const completed = new Set();
  for (const project of projects.slice(0, active)) {
    project.progress = Math.min(1, project.progress + (dt * rate) / TECH[project.key].time);
    if (project.progress >= 1) {
      if (!f.tech.includes(project.key)) {
        f.tech.push(project.key);
        event(s, 'research', { side: owner, key: project.key });
      }
      completed.add(project);
    }
  }
  storeProjects(
    f,
    projects.filter((project) => !completed.has(project)),
  );
}

export function research(s, owner, key) {
  if (s.result) return 'Кампания завершена';
  const f = s.sides[owner],
    d = TECH[key];
  if (!f || typeof key !== 'string' || !Object.hasOwn(TECH, key) || f.tech.includes(key))
    return 'Уже изучено';
  const { slots, projects } = researchStatus(s, owner);
  if (projects.some((project) => project.key === key)) return 'Уже идёт исследование';
  if (!slots) return 'Постройте лабораторию';
  if (projects.length >= slots) return 'Все лаборатории заняты';
  if (d.requires && !f.tech.includes(d.requires)) return 'Нужно предыдущее исследование';
  if (f.science < d.science || f.credits < d.cost) return 'Не хватает науки или денег';
  f.science -= d.science;
  f.credits -= d.cost;
  storeProjects(f, [...projects, { key, progress: 0 }]);
  return true;
}
