import * as E from '../game/index.js';

// Branch columns from the front line back to the economy.
const BRANCHES = ['Армия', 'Пехота', 'Оборона', 'Авиация', 'Город'];

// Depth inside the node's own branch; a prerequisite from another branch starts a new root.
function depth(key) {
  const d = E.TECH[key];
  if (!d.requires || E.TECH[d.requires]?.branch !== d.branch) return 0;
  return depth(d.requires) + 1;
}

function unlocks(key) {
  return Object.values(E.GROUND_UNITS)
    .filter((u) => u.tech === key)
    .map((u) => u.name)
    .concat(
      Object.values(E.WEAPONS)
        .filter((w) => w.tech === key)
        .map((w) => w.name),
    );
}

export function techTreeHTML() {
  const columns = BRANCHES.map((branch) => {
    const tiers = [];
    for (const [key, d] of Object.entries(E.TECH)) {
      if (d.branch !== branch) continue;
      (tiers[depth(key)] ||= []).push(key);
    }
    const rows = tiers
      .map(
        (keys) =>
          `<div class="tree-tier">${keys
            .map((key) => {
              const d = E.TECH[key],
                opens = unlocks(key),
                cross =
                  d.requires && E.TECH[d.requires].branch !== branch
                    ? `<small class="tree-cross">после: ${E.TECH[d.requires].name}</small>`
                    : '';
              return `<button class="tree-node" data-research="${key}" title="${d.description}"><i data-tech="${key}"></i><b>${d.name}</b>${cross}<em>${d.description}</em>${opens.length ? `<small class="tree-opens">Открывает: ${opens.join(', ')}</small>` : ''}<span class="tree-cost">${d.science} науки · ${d.cost} ₡ · ${d.time} с</span><span class="tree-bar"><span></span></span></button>`;
            })
            .join('')}</div>`,
      )
      .join('');
    return `<section class="tree-branch"><h3>${branch}</h3>${rows}</section>`;
  }).join('');
  return `<div class="tree-head"><div id="research-progress" class="small-muted"></div><small>E — открыть / закрыть · клик по доступному узлу — начать</small></div><div class="tree-scroll"><div class="tree-grid"><svg class="tree-links" aria-hidden="true"></svg>${columns}</div></div>`;
}

// Live state of every node and the connecting lines between prerequisites.
export function updateTechTree(state, root) {
  const f = state.sides[0],
    active = f.research;
  const progress = root.querySelector('#research-progress');
  if (progress)
    progress.textContent = active
      ? `Идёт: ${E.TECH[active.key].name} · ${Math.floor(active.progress * 100)}%`
      : `Наука: ${Math.floor(f.science)} · один проект за раз, нужна работающая лаборатория.`;
  for (const [key, d] of Object.entries(E.TECH)) {
    const node = root.querySelector(`[data-research="${key}"]`);
    if (!node) continue;
    const done = f.tech.includes(key),
      locked = !!d.requires && !f.tech.includes(d.requires),
      running = active?.key === key,
      affordable = f.science >= d.science && f.credits >= d.cost;
    node.classList.toggle('done', done);
    node.classList.toggle('locked', locked && !done);
    node.classList.toggle('running', running);
    node.classList.toggle('ready', !done && !locked && !active && affordable);
    node.disabled = done || locked || !!active;
    node.style.setProperty('--progress', running ? active.progress : done ? 1 : 0);
    const mark = node.querySelector(`[data-tech="${key}"]`);
    if (mark) mark.textContent = done ? '✓' : running ? '…' : locked ? '◇' : '→';
  }
  drawLinks(state, root);
}

function drawLinks(state, root) {
  const grid = root.querySelector('.tree-grid'),
    svg = root.querySelector('.tree-links');
  if (!grid || !svg) return;
  const box = grid.getBoundingClientRect(),
    f = state.sides[0];
  svg.setAttribute('width', grid.scrollWidth);
  svg.setAttribute('height', grid.scrollHeight);
  let paths = '';
  for (const [key, d] of Object.entries(E.TECH)) {
    if (!d.requires) continue;
    const from = grid.querySelector(`[data-research="${d.requires}"]`),
      to = grid.querySelector(`[data-research="${key}"]`);
    if (!from || !to) continue;
    const a = from.getBoundingClientRect(),
      b = to.getBoundingClientRect(),
      x1 = a.left + a.width / 2 - box.left,
      y1 = a.bottom - box.top,
      x2 = b.left + b.width / 2 - box.left,
      y2 = b.top - box.top,
      cross = E.TECH[d.requires].branch !== d.branch,
      lit = f.tech.includes(d.requires);
    const mid = (y1 + y2) / 2;
    paths += `<path class="${lit ? 'lit' : ''}${cross ? ' cross' : ''}" d="M${x1} ${y1} C${x1} ${mid} ${x2} ${mid} ${x2} ${y2}"/>`;
  }
  svg.innerHTML = paths;
}
