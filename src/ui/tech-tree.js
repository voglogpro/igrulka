import * as E from '../game/index.js';
import { icon } from './icons.js';

const BRANCHES = [
  ['army', 'Армия', 'barracks'],
  ['infantry', 'Пехота', 'shield'],
  ['defense', 'Оборона', 'radar'],
  ['aviation', 'Авиация', 'launcher'],
  ['city', 'Город', 'industry'],
];
const sessions = new WeakMap();

function depth(key) {
  const d = E.TECH[key];
  return d.requires && E.TECH[d.requires]?.branch === d.branch ? depth(d.requires) + 1 : 0;
}

export function researchUnlocks(key) {
  return [
    ...Object.values(E.GROUND_UNITS),
    ...Object.values(E.WEAPONS),
    ...Object.values(E.BUILDINGS),
  ]
    .filter((d) => d.tech === key)
    .map((d) => d.name);
}

export function researchAvailability(state, key) {
  const f = state.sides[0],
    d = E.TECH[key];
  if (f.tech.includes(key)) return { kind: 'done', text: 'Изучено', disabled: true };
  if (f.research?.key === key)
    return {
      kind: 'running',
      text: `В работе · ${Math.floor(f.research.progress * 100)}%`,
      disabled: true,
    };
  if (state.result) return { kind: 'locked', text: 'Кампания завершена', disabled: true };
  if (d.requires && !f.tech.includes(d.requires))
    return { kind: 'locked', text: `Сначала: ${E.TECH[d.requires].name}`, disabled: true };
  if (!state.buildings.some((b) => b.side === 0 && b.key === 'lab' && b.hp > 0 && b.progress >= 1))
    return { kind: 'unavailable', text: 'Нужна готовая лаборатория', disabled: true };
  if (f.research)
    return { kind: 'unavailable', text: 'Дождитесь текущего проекта', disabled: true };
  const missing = [];
  if (f.science < d.science) missing.push(`${Math.ceil(d.science - f.science)} науки`);
  if (f.credits < d.cost) missing.push(`${Math.ceil(d.cost - f.credits)} ₡`);
  return missing.length
    ? { kind: 'unavailable', text: `Не хватает: ${missing.join(' · ')}`, disabled: true }
    : { kind: 'ready', text: 'Начать исследование ↗', disabled: false };
}

export function techTreeHTML() {
  return `<section class="research-console" aria-label="Развитие технологий"><div class="research-overview"><div><h2>Следующее преимущество</h2><p>Выберите направление развития. Один проект за раз.</p></div><div class="research-budget"><b id="research-science">0</b><span>науки в резерве</span></div></div><div class="research-active"><span class="research-active-mark">${icon('lab')}</span><div><b id="research-project">Лаборатория готова</b><span id="research-progress"></span></div><div class="research-active-track" aria-hidden="true"><i id="research-active-fill"></i></div></div><nav class="research-filters" aria-label="Направления исследований">${BRANCHES.map(([id, name, glyph]) => `<button data-research-filter="${id}" aria-pressed="${id === 'army'}">${icon(glyph)}<span>${name}</span><small data-branch-count="${id}"></small></button>`).join('')}<button data-research-filter="all" aria-pressed="false"><span>Все</span></button></nav><div class="tree-scroll" tabindex="0" aria-label="Технологии выбранного направления"><div class="tree-grid">${BRANCHES.map(
    ([id, branch]) => {
      const tiers = [];
      for (const [key, d] of Object.entries(E.TECH))
        if (d.branch === branch) (tiers[depth(key)] ||= []).push(key);
      for (const keys of tiers)
        keys.sort(
          (a, b) =>
            Number(!!E.TECH[a].requires && E.TECH[E.TECH[a].requires].branch !== branch) -
            Number(!!E.TECH[b].requires && E.TECH[E.TECH[b].requires].branch !== branch),
        );
      return `<section class="tree-branch" data-research-branch="${id}" ${id === 'army' ? '' : 'hidden'}><div class="tree-branch-heading"><h3>${branch}</h3><span>От базовых решений к новым возможностям</span></div><div class="tree-lanes"><svg class="tree-links" aria-hidden="true"></svg>${tiers
        .map(
          (keys, level) =>
            `<div class="tree-tier"><span class="tree-tier-label">Этап ${level + 1}</span>${keys
              .map((key) => {
                const d = E.TECH[key],
                  opens = researchUnlocks(key),
                  cross = d.requires && E.TECH[d.requires].branch !== branch;
                return `<button class="tree-node" data-research="${key}" aria-label="${d.name}"><span class="tree-node-top"><i data-tech="${key}">◇</i><b>${d.name}</b></span><em>${d.description}</em>${opens.length ? `<span class="tree-opens">Открывает: ${opens.join(', ')}</span>` : ''}${cross ? `<span class="tree-cross">Из ветки «${E.TECH[d.requires].branch}»</span>` : ''}<span class="tree-cost">${d.science} науки <i>·</i> ${d.cost} ₡ <i>·</i> ${d.time} с</span><span class="tree-reason" data-research-reason="${key}"></span><span class="tree-bar"><span></span></span></button>`;
              })
              .join('')}</div>`,
        )
        .join('')}</div></section>`;
    },
  ).join(
    '',
  )}</div></div><div class="research-legend"><span><i class="ready"></i>Доступно</span><span><i class="running"></i>В работе</span><span><i class="done"></i>Изучено</span><span>E — закрыть</span></div></section>`;
}

function bindFilters(state, root) {
  if (!sessions.has(root)) {
    sessions.set(root, { state, signature: '' });
    root.addEventListener('click', (event) => {
      const button = event.target.closest('[data-research-filter]');
      if (!button || !root.contains(button)) return;
      const branch = button.dataset.researchFilter;
      root.dataset.researchView = branch;
      applyFilter(root, branch);
      drawLinks(sessions.get(root).state, root, true);
    });
  }
  sessions.get(root).state = state;
  applyFilter(root, root.dataset.researchView || 'army');
}

function applyFilter(root, branch) {
  for (const section of root.querySelectorAll('[data-research-branch]'))
    section.hidden = branch !== 'all' && section.dataset.researchBranch !== branch;
  for (const button of root.querySelectorAll('[data-research-filter]'))
    button.setAttribute('aria-pressed', String(button.dataset.researchFilter === branch));
}

export function updateTechTree(state, root) {
  const f = state.sides[0],
    active = f.research;
  bindFilters(state, root);
  const project = root.querySelector('#research-project'),
    progress = root.querySelector('#research-progress');
  if (project) project.textContent = active ? E.TECH[active.key].name : 'Выберите следующий проект';
  if (progress)
    progress.textContent = active
      ? `${Math.floor(active.progress * 100)}% · осталось около ${Math.ceil((1 - active.progress) * E.TECH[active.key].time)} с`
      : 'Наука и бюджет списываются при запуске';
  const science = root.querySelector('#research-science'),
    fill = root.querySelector('#research-active-fill');
  if (science) science.textContent = Math.floor(f.science).toLocaleString('ru-RU');
  if (fill) fill.style.width = `${active ? active.progress * 100 : 0}%`;
  for (const [id, branch] of BRANCHES) {
    const keys = Object.keys(E.TECH).filter((key) => E.TECH[key].branch === branch),
      count = root.querySelector(`[data-branch-count="${id}"]`);
    if (count)
      count.textContent = `${keys.filter((key) => f.tech.includes(key)).length}/${keys.length}`;
  }
  for (const [key, d] of Object.entries(E.TECH)) {
    const node = root.querySelector(`[data-research="${key}"]`);
    if (!node) continue;
    const availability = researchAvailability(state, key);
    for (const kind of ['done', 'locked', 'running', 'ready', 'unavailable'])
      node.classList.toggle(kind, availability.kind === kind);
    node.disabled = availability.disabled;
    node.setAttribute('aria-label', `${d.name}. ${availability.text}`);
    node.title = `${d.description}\n${availability.text}`;
    node.style.setProperty(
      '--progress',
      active?.key === key ? active.progress : availability.kind === 'done' ? 1 : 0,
    );
    node.querySelector(`[data-research-reason="${key}"]`).textContent = availability.text;
    node.querySelector(`[data-tech="${key}"]`).textContent =
      availability.kind === 'done'
        ? '✓'
        : availability.kind === 'running'
          ? '◷'
          : availability.kind === 'ready'
            ? '↗'
            : '◇';
  }
  drawLinks(state, root);
}

function drawLinks(state, root, force = false) {
  const session = sessions.get(root),
    grid = root.querySelector('.tree-grid');
  if (!session || !grid) return;
  if (session.grid !== grid) {
    session.grid = grid;
    session.signature = '';
  }
  const signature = [
    grid.clientWidth,
    grid.scrollHeight,
    root.dataset.researchView,
    state.sides[0].tech.join(','),
  ].join('/');
  if (!force && session.signature === signature) return;
  session.signature = signature;
  for (const section of root.querySelectorAll('.tree-branch')) {
    const svg = section.querySelector('.tree-links'),
      lanes = section.querySelector('.tree-lanes');
    if (section.hidden) {
      svg.innerHTML = '';
      continue;
    }
    const bounds = lanes.getBoundingClientRect();
    svg.setAttribute('width', lanes.scrollWidth);
    svg.setAttribute('height', lanes.scrollHeight);
    let paths = '';
    for (const [key, d] of Object.entries(E.TECH)) {
      if (!d.requires || E.TECH[d.requires].branch !== d.branch) continue;
      const from = section.querySelector(`[data-research="${d.requires}"]`),
        to = section.querySelector(`[data-research="${key}"]`);
      if (!from || !to) continue;
      const a = from.getBoundingClientRect(),
        b = to.getBoundingClientRect(),
        x1 = a.right - bounds.left,
        y1 = a.top + a.height / 2 - bounds.top,
        x2 = b.left - bounds.left,
        y2 = b.top + b.height / 2 - bounds.top,
        mid = (x1 + x2) / 2;
      paths += `<path class="${state.sides[0].tech.includes(d.requires) ? 'lit' : ''}" d="M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}"/>`;
    }
    svg.innerHTML = paths;
  }
}
