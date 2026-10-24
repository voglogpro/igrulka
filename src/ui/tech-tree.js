import * as E from '../game/index.js';
import { icon } from './icons.js';
import { escape } from './format.js';

const BRANCHES = [
  ['defense', 'Оборона', 'radar', ['Оборона']],
  ['army', 'Армия', 'barracks', ['Армия', 'Пехота']],
  ['city', 'Город', 'industry', ['Город']],
  ['aviation', 'Авиация', 'launcher', ['Авиация']],
];
const sessions = new WeakMap();
const W = 238,
  H = 210,
  DX = 314,
  DY = 234;

export function researchGraph(branchId, tech = E.TECH) {
  const branch = BRANCHES.find(([id]) => id === branchId) || BRANCHES[0];
  const own = Object.keys(tech).filter((key) => branch[3].includes(tech[key].branch));
  const keys = new Set(own);
  function include(key) {
    const parent = tech[key]?.requires;
    if (parent && tech[parent] && !keys.has(parent)) {
      keys.add(parent);
      include(parent);
    }
  }
  own.forEach(include);
  const children = (key) => [...keys].filter((child) => tech[child].requires === key);
  const roots = [...keys].filter((key) => !keys.has(tech[key].requires));
  const nodes = [];
  let row = 0;
  function place(key, column) {
    const next = children(key).map((child) => place(child, column + 1));
    const at = next.length ? (next[0] + next.at(-1)) / 2 : row++;
    nodes.push({ key, column, row: at, external: !own.includes(key) });
    return at;
  }
  roots.forEach((key) => place(key, 0));
  return {
    nodes,
    edges: [...keys]
      .filter((key) => keys.has(tech[key].requires))
      .map((key) => [tech[key].requires, key]),
    rows: row,
    columns: Math.max(0, ...nodes.map((n) => n.column)) + 1,
  };
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
    d = E.TECH[key],
    status = E.researchStatus(state, 0);
  if (f.tech.includes(key)) return { kind: 'done', text: 'Изучено', disabled: true };
  const index = status.projects.findIndex((p) => p.key === key),
    project = status.projects[index];
  if (project)
    return {
      kind: 'running',
      text:
        index < status.slots
          ? `В работе · ${Math.floor(project.progress * 100)}%`
          : 'Пауза · нужна рабочая лаборатория',
      disabled: true,
    };
  if (state.result) return { kind: 'locked', text: 'Кампания завершена', disabled: true };
  if (d.requires && !f.tech.includes(d.requires))
    return { kind: 'locked', text: `Сначала: ${E.TECH[d.requires].name}`, disabled: true };
  if (!status.slots)
    return { kind: 'unavailable', text: 'Нужна готовая лаборатория', disabled: true };
  if (status.projects.length >= status.slots)
    return { kind: 'unavailable', text: 'Лаборатории заняты · постройте ещё одну', disabled: true };
  const missing = [];
  if (f.science < d.science) missing.push(`${Math.ceil(d.science - f.science)} науки`);
  if (f.credits < d.cost) missing.push(`${Math.ceil(d.cost - f.credits)} ₡`);
  return missing.length
    ? { kind: 'unavailable', text: `Не хватает: ${missing.join(' · ')}`, disabled: true }
    : { kind: 'ready', text: 'Начать исследование ↗', disabled: false };
}

export function techTreeHTML() {
  return `<section class="research-console" aria-label="Развитие технологий"><div class="research-overview"><div><h2>Технологическое преимущество</h2><p>Каждая рабочая лаборатория ведёт один проект. Связи показывают обязательные исследования.</p></div><div class="research-budget"><b id="research-science">0</b><span>науки в резерве</span></div></div><div class="research-projects"><div class="research-active"><b id="research-project"></b><span id="research-progress"></span></div><div id="research-project-list" aria-label="Текущие проекты"></div></div><nav class="research-filters" aria-label="Направления исследований">${BRANCHES.map(([id, name, glyph]) => `<button data-research-filter="${id}" aria-pressed="${id === 'defense'}">${icon(glyph)}<span>${name}</span><small data-branch-count="${id}"></small></button>`).join('')}<span class="research-pan-hint">Тяните свободное поле · прокрутка по двум осям</span></nav><div class="tree-scroll" tabindex="0" aria-label="Дерево исследований. Стрелки прокручивают поле."><div class="tree-grid">${BRANCHES.map(
    ([id, name]) => {
      const graph = researchGraph(id),
        width = (graph.columns - 1) * DX + W,
        height = Math.max(1, graph.rows) * DY - 24;
      return `<section class="tree-branch" data-research-branch="${id}" aria-label="${name}" ${id === 'defense' ? '' : 'hidden'}><div class="tree-lanes" style="width:${width}px;height:${height}px"><svg class="tree-links" width="${width}" height="${height}" aria-hidden="true"></svg>${graph.nodes
        .map(({ key, column, row, external }) => {
          const d = E.TECH[key],
            opens = researchUnlocks(key);
          return `<button class="tree-node${external ? ' tree-gateway' : ''}" data-research="${key}" style="left:${column * DX}px;top:${row * DY}px" aria-label="${escape(d.name)}"><span class="tree-node-top"><i data-tech="${key}">◇</i><b>${escape(d.name)}</b></span><em>${escape(d.description)}</em><span class="tree-opens">${opens.length ? `Открывает: ${escape(opens.join(', '))}` : 'Улучшает действующие системы'}</span>${external ? `<span class="tree-cross">Предпосылка · ${escape(d.branch)}</span>` : ''}<span class="tree-cost">${d.science} науки · ${d.cost} ₡ · ${d.time} с</span><span class="tree-reason" data-research-reason="${key}"></span><span class="tree-bar"><span></span></span></button>`;
        })
        .join('')}</div></section>`;
    },
  ).join(
    '',
  )}</div></div><div class="research-legend"><span><i class="ready"></i>Доступно</span><span><i class="running"></i>В работе</span><span><i class="done"></i>Изучено</span><span>E / Esc — закрыть</span></div></section>`;
}

function bindWorkspace(state, root) {
  if (!sessions.has(root)) {
    sessions.set(root, { state });
    root.addEventListener('click', (event) => {
      const button = event.target.closest('[data-research-filter]');
      if (!button || !root.contains(button)) return;
      root.dataset.researchView = button.dataset.researchFilter;
      applyFilter(root, button.dataset.researchFilter);
    });
    let drag = null;
    root.addEventListener('pointerdown', (event) => {
      const area = event.target.closest('.tree-scroll');
      if (!area || event.button !== 0 || event.target.closest('button')) return;
      drag = {
        area,
        x: event.clientX,
        y: event.clientY,
        left: area.scrollLeft,
        top: area.scrollTop,
      };
      area.setPointerCapture(event.pointerId);
      area.classList.add('panning');
    });
    root.addEventListener('pointermove', (event) => {
      if (!drag) return;
      drag.area.scrollLeft = drag.left + drag.x - event.clientX;
      drag.area.scrollTop = drag.top + drag.y - event.clientY;
    });
    const stop = () => {
      drag?.area.classList.remove('panning');
      drag = null;
    };
    root.addEventListener('pointerup', stop);
    root.addEventListener('pointercancel', stop);
  }
  sessions.get(root).state = state;
  applyFilter(root, root.dataset.researchView || 'defense', false);
}

function applyFilter(root, branch, reset = true) {
  if (!BRANCHES.some(([id]) => id === branch)) branch = 'defense';
  for (const section of root.querySelectorAll('[data-research-branch]'))
    section.hidden = section.dataset.researchBranch !== branch;
  for (const button of root.querySelectorAll('[data-research-filter]'))
    button.setAttribute('aria-pressed', String(button.dataset.researchFilter === branch));
  const area = root.querySelector('.tree-scroll');
  if (reset && area) {
    area.scrollLeft = 0;
    area.scrollTop = 0;
  }
}

export function updateTechTree(state, root) {
  const f = state.sides[0],
    status = E.researchStatus(state, 0);
  bindWorkspace(state, root);
  root.querySelector('#research-project').textContent =
    `Лаборатории: ${status.activeCount} / ${status.slots} занято`;
  root.querySelector('#research-progress').textContent = status.slots
    ? `${Math.max(0, status.slots - status.projects.length)} свободно · оплата при запуске`
    : 'Постройте лабораторию и подключите снабжение';
  const list = root.querySelector('#research-project-list'),
    signature = status.projects
      .map((p, i) => `${p.key}:${Math.floor(p.progress * 100)}:${i < status.slots}`)
      .join('|');
  if (list.dataset.signature !== signature) {
    list.dataset.signature = signature;
    list.innerHTML = status.projects
      .map(
        (p, i) =>
          `<div class="research-project-chip${i >= status.slots ? ' paused' : ''}"><b>${escape(E.TECH[p.key].name)}</b><span>${Math.floor(p.progress * 100)}%${i >= status.slots ? ' · пауза' : ` · ~${Math.ceil((1 - p.progress) * E.TECH[p.key].time)} с`}</span><progress max="1" value="${p.progress}" aria-label="${escape(E.TECH[p.key].name)}"></progress></div>`,
      )
      .join('');
  }
  root.querySelector('#research-science').textContent = Math.floor(f.science).toLocaleString(
    'ru-RU',
  );
  for (const [id, , , branches] of BRANCHES) {
    const keys = Object.keys(E.TECH).filter((key) => branches.includes(E.TECH[key].branch));
    root.querySelector(`[data-branch-count="${id}"]`).textContent =
      `${keys.filter((key) => f.tech.includes(key)).length}/${keys.length}`;
  }
  for (const [key, d] of Object.entries(E.TECH)) {
    const availability = researchAvailability(state, key),
      active = status.projects.find((p) => p.key === key);
    for (const node of root.querySelectorAll(`[data-research="${key}"]`)) {
      for (const kind of ['done', 'locked', 'running', 'ready', 'unavailable'])
        node.classList.toggle(kind, availability.kind === kind);
      node.disabled = availability.disabled;
      node.setAttribute('aria-label', `${d.name}. ${availability.text}`);
      node.title = `${d.description}\n${availability.text}`;
      node.style.setProperty(
        '--progress',
        active ? active.progress : availability.kind === 'done' ? 1 : 0,
      );
      node.querySelector('.tree-reason').textContent = availability.text;
      node.querySelector('[data-tech]').textContent =
        availability.kind === 'done'
          ? '✓'
          : availability.kind === 'running'
            ? '◷'
            : availability.kind === 'ready'
              ? '↗'
              : '◇';
    }
  }
  const session = sessions.get(root),
    canvas = root.querySelector('.tree-grid'),
    links = f.tech.join(',');
  if (session.canvas === canvas && session.links === links) return;
  session.canvas = canvas;
  session.links = links;
  for (const section of root.querySelectorAll('.tree-branch')) {
    const graph = researchGraph(section.dataset.researchBranch),
      lookup = new Map(graph.nodes.map((node) => [node.key, node]));
    section.querySelector('.tree-links').innerHTML = graph.edges
      .map(([from, to]) => {
        const a = lookup.get(from),
          b = lookup.get(to),
          x1 = a.column * DX + W,
          y1 = a.row * DY + H / 2,
          x2 = b.column * DX,
          y2 = b.row * DY + H / 2,
          mid = (x1 + x2) / 2;
        return `<path class="${f.tech.includes(from) ? 'lit' : ''}" d="M${x1} ${y1} H${mid} V${y2} H${x2}"/><circle cx="${x2}" cy="${y2}" r="3"/>`;
      })
      .join('');
  }
}
