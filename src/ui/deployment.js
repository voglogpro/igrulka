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

export function renderSquadRoster(state, selection) {
  const host = $('#groups-bar');
  const squads = E.squadRoster(state, 0);
  const legacy = new Map();
  for (const u of state.groundUnits)
    if (u.side === 0 && u.hp > 0 && !u.squadId) {
      if (!legacy.has(u.key)) legacy.set(u.key, []);
      legacy.get(u.key).push(u.id);
    }
  const cards = [
    ...squads,
    ...[...legacy].map(([key, ids]) => ({ id: 'role-' + key, key, ids, queued: 0 })),
  ];
  host.hidden = !cards.length;
  const signature = JSON.stringify(
    cards.map((c) => [c.id, c.key, c.ids, c.queued, c.ids.some((id) => selection.includes(id))]),
  );
  if (host.dataset.signature === signature) return;
  host.dataset.signature = signature;
  host.innerHTML =
    '<span>ОТРЯДЫ</span><div class="squad-cards">' +
    cards
      .map(
        (c) =>
          `<button data-squad="${c.id}" class="${c.ids.some((id) => selection.includes(id)) ? 'active' : ''}" ${c.ids.length ? '' : 'disabled'} title="${E.GROUND_UNITS[c.key]?.name || 'Отряд'} · выбрать; ПКМ по карте — приказ"><b>${E.GROUND_UNITS[c.key]?.name || 'Отряд'}</b><small>${c.ids.length ? c.ids.length + ' в строю' : 'Подготовка'}${c.queued ? ' · +' + c.queued + ' в очереди' : ''}</small></button>`,
      )
      .join('') +
    '</div>';
}
