import * as E from '../game/index.js';
import { $ } from './format.js';

export function updateDeploymentHUD(state, key, count, plan) {
  let host = $('#deployment-hud');
  if (!host) {
    host = document.createElement('aside');
    host.id = 'deployment-hud';
    host.className = 'glass';
    host.setAttribute('aria-label', 'Отправка пополнений');
    $('#game').append(host);
  }
  host.hidden = !key;
  if (!key) return;
  const d = E.GROUND_UNITS[key];
  const signature = key + ':' + count + ':' + state.sides[0].tech.join(',');
  if (host.dataset.signature !== signature) {
    host.dataset.signature = signature;
    host.innerHTML = `<div class="deployment-top"><span>ПОПОЛНЕНИЕ</span><button data-action="cancel-deploy" aria-label="Отменить отправку">×</button></div><select id="deployment-key" aria-label="Тип пополнения">${Object.entries(
      E.GROUND_UNITS,
    )
      .map(
        ([k, t]) =>
          `<option value="${k}" ${key === k ? 'selected' : ''} ${t.tech && !state.sides[0].tech.includes(t.tech) ? 'disabled' : ''}>${t.name}</option>`,
      )
      .join(
        '',
      )}</select><div class="deployment-count"><button data-deploy-count="1" class="${count === 1 ? 'active' : ''}">×1</button><button data-deploy-count="5" class="${count === 5 ? 'active' : ''}">×5</button><span>${d.cost * count} ₡ · ${d.metal * count} спл.</span></div><p id="deployment-note"></p><small>ЛКМ — назначить точку · ПКМ — отменить</small>`;
  }
  $('#deployment-note').textContent = plan
    ? plan.ok
      ? `Казармы #${plan.siteId} → точка. Бойцы выйдут после подготовки.`
      : plan.reason
    : 'Наведите на место назначения. Оплата после клика.';
  $('#deployment-note').classList.toggle('warning', plan?.ok === false);
}

// Short labels keep the roster to a couple of rows even with a large army.
const SHORT = {
  infantry: 'Стрелки',
  machinegunner: 'Пулемёт',
  sniper: 'Снайпер',
  assault: 'Штурм',
  engineer: 'Сапёр',
  operator: 'FPV',
  mog: 'МОГ',
  atgm: 'ПТРК',
  apc: 'БТР',
  leopard: 'Танк',
  tankdestroyer: 'ПТ-САУ',
  howitzer: 'САУ',
  armoredcar: 'Броневик',
  lighttank: 'Лёгк. танк',
  ifv: 'БМП',
  heavytank: 'Тяж. танк',
  mlrs: 'РСЗО',
  medic: 'Санитар',
  supplytruck: 'Снабжение',
  shilka: 'Шилка',
  gepard: 'Gepard',
};
export const shortUnitName = (key) => SHORT[key] || E.GROUND_UNITS[key]?.name || key;

let collapsed = false;
try {
  collapsed = localStorage.getItem('skyfront-roster-collapsed') === '1';
} catch {
  collapsed = false;
}
export function toggleSquadRoster() {
  collapsed = !collapsed;
  try {
    localStorage.setItem('skyfront-roster-collapsed', collapsed ? '1' : '0');
  } catch {
    // Remembering the panel state is only a convenience.
  }
  const host = $('#groups-bar');
  if (host) host.dataset.signature = '';
}

// One chip per unit type, chips only for reinforcement waves and saved groups.
export function renderSquadRoster(state, selection) {
  const host = $('#groups-bar');
  const chosen = new Set(selection);
  const field = state.groundUnits.filter((u) => u.side === 0 && u.hp > 0);
  const squads = E.squadRoster(state, 0);
  const roles = new Map();
  for (const u of field) {
    if (!roles.has(u.key)) roles.set(u.key, { key: u.key, count: 0, active: 0, queued: 0 });
    const role = roles.get(u.key);
    role.count++;
    if (chosen.has(u.id)) role.active++;
  }
  for (const b of state.buildings)
    if (b.side === 0 && b.key === 'barracks' && b.hp > 0 && !b.demolished)
      for (const q of b.armyQueue || []) {
        if (!roles.has(q.key)) roles.set(q.key, { key: q.key, count: 0, active: 0, queued: 0 });
        roles.get(q.key).queued++;
      }
  // Waves keep their own chip while they are larger than one unit or still arriving.
  const waves = squads.filter((g) => g.ids.length + g.queued > 1);
  const groups = [];
  for (let n = 1; n <= 9; n++) {
    const ids = E.getGroup(state, 0, n);
    if (ids.length) groups.push({ n, ids });
  }
  const order = Object.keys(E.GROUND_UNITS);
  const chips = [...roles.values()].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  host.hidden = !chips.length;
  const signature = JSON.stringify([
    collapsed,
    chips,
    waves.map((g) => [g.id, g.key, g.ids.length, g.queued, g.ids.some((id) => chosen.has(id))]),
    groups.map((g) => [g.n, g.ids.length, g.ids.some((id) => chosen.has(id))]),
    selection.length,
  ]);
  if (host.dataset.signature === signature) return;
  host.dataset.signature = signature;
  host.classList.toggle('collapsed', collapsed);
  const total = field.length;
  const head = `<div class="roster-head"><span>АРМИЯ <b>${total}</b>${selection.length ? ` · выбрано ${selection.length}` : ''}</span><button data-action="roster-toggle" title="${collapsed ? 'Развернуть' : 'Свернуть'} панель армии" aria-label="${collapsed ? 'Развернуть' : 'Свернуть'} панель армии">${collapsed ? '▸' : '▾'}</button></div>`;
  if (collapsed) {
    host.innerHTML = head;
    return;
  }
  const roleChips = chips
    .map(
      (r) =>
        `<button data-army-role="${r.key}" class="roster-chip${r.active ? ' active' : ''}" ${r.count ? '' : 'disabled'} title="${E.GROUND_UNITS[r.key]?.name || r.key}: выбрать всех · Shift — добавить · двойной клик — камера"><span>${shortUnitName(r.key)}</span><b>${r.count}</b>${r.queued ? `<i>+${r.queued}</i>` : ''}</button>`,
    )
    .join('');
  const waveChips = waves
    .map(
      (g) =>
        `<button data-squad="${g.id}" class="roster-chip wave${g.ids.some((id) => chosen.has(id)) ? ' active' : ''}" ${g.ids.length ? '' : 'disabled'} title="Волна пополнения: ${E.GROUND_UNITS[g.key]?.name || 'отряд'}"><span>${shortUnitName(g.key)}</span><b>${g.ids.length || '…'}</b>${g.queued ? `<i>+${g.queued}</i>` : ''}</button>`,
    )
    .join('');
  const groupChips = groups
    .map(
      (g) =>
        `<button data-group="${g.n}" class="roster-chip group${g.ids.some((id) => chosen.has(id)) ? ' active' : ''}" title="Группа ${g.n} · клавиша ${g.n}, дважды — камера"><span>${g.n}</span><b>${g.ids.length}</b></button>`,
    )
    .join('');
  host.innerHTML =
    head +
    `<div class="roster-row">${roleChips}</div>` +
    (waveChips ? `<div class="roster-row"><small>Волны</small>${waveChips}</div>` : '') +
    (groupChips ? `<div class="roster-row"><small>Группы</small>${groupChips}</div>` : '');
}
