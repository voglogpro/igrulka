import * as E from '../game/index.js';
import { escape, rate } from './format.js';
const listMarkup = new WeakMap();

// HUD polls must keep the same buttons alive while a user scrolls, focuses or clicks.
export function updateSettlementList(host, state) {
  if (!host) return;
  const html = settlementListHTML(state);
  if (listMarkup.get(host) === html) return;
  host.innerHTML = html;
  listMarkup.set(host, html);
}

const reasons = {
  active: 'Подключено · предприятия работают',
  neutral: 'Подведите дорогу к отмеченному въезду',
  road: 'Отключено · восстановите дорогу к штабу',
  hostile: 'Доход остановлен · вражеские войска рядом',
  contested: 'Поселение оспаривается',
};
const ownerLabel = (s, side) =>
  side == null
    ? 'Нейтральное'
    : side === 0
      ? 'Наше поселение'
      : E.allied(s, 0, side)
        ? 'Союзный город'
        : 'Противник';

export function settlementInspectorHTML(state, id) {
  const d = E.settlementStatus(state, id);
  if (!d) return '';
  const components = d.components || [],
    alive = components.filter((b) => b.hp > 0 && !b.demolished).length;
  const condition =
    d.materialized && components.length > 0 && alive === 0
      ? 'Разрушено · восстановите или постройте здания'
      : reasons[d.reason] || '';
  const composition = d.materialized
    ? `${alive} из ${components.length} зданий в строю`
    : 'Готовые жилые дома и промышленность';
  return `<div class="panel-head"><b>${escape(d.name)}</b><button data-action="deselect" aria-label="Закрыть">×</button></div><p class="status-note">${ownerLabel(state, d.owner)}<br>${condition}</p><div class="stat"><span>Поступления / мин</span><b>${rate(d.income)} ₡ · ${rate(d.materials)} спл.</b></div><div class="stat"><span>Городок</span><b>${composition}</b></div><p class="small-muted">Доведите связанную со штабом дорогу до отмеченного въезда. Дома и предприятия станут обычными зданиями: их можно ремонтировать, защищать и дополнять. Пехота занимает чужой городок; у союзника отдельный бюджет.</p>`;
}

export function settlementListHTML(state) {
  const economies = new Map();
  return (
    '<h3>Поселения и дороги</h3>' +
    E.SETTLEMENTS.map((site) => {
      const d = E.settlementStatus(state, site.id, economies);
      const destroyed =
        d.materialized &&
        d.components?.length > 0 &&
        d.components.every((b) => b.hp <= 0 || b.demolished);
      return `<button class="econ-building" data-settlement-focus="${site.id}"><span>${escape(site.name)}<small>${ownerLabel(state, d.owner)} · ${destroyed ? 'Здания разрушены' : reasons[d.reason] || ''}</small></span><b>${rate(d.income)} ₡</b></button>`;
    }).join('')
  );
}
