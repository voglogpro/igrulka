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
  active: 'Связано с городом · доход поступает',
  neutral: 'Проведите дорогу от своего штаба',
  road: 'Доход остановлен · нет пути к штабу владельца',
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
  return `<div class="panel-head"><b>${escape(d.name)}</b><button data-action="deselect" aria-label="Закрыть">×</button></div><p class="status-note">${ownerLabel(state, d.owner)}<br>${reasons[d.reason] || ''}</p><div class="stat"><span>Поступления / мин</span><b>${rate(d.income)} ₡ · ${rate(d.materials)} спл.</b></div><p class="small-muted">Подключите поселение к своему штабу дорогой. Пехота может занять чужое поселение; присутствие противника останавливает доход. У союзника отдельный бюджет.</p>`;
}

export function settlementListHTML(state) {
  return (
    '<h3>Поселения и дороги</h3>' +
    E.SETTLEMENTS.map((site) => {
      const d = E.settlementStatus(state, site.id);
      return `<button class="econ-building" data-settlement-focus="${site.id}"><span>${escape(site.name)}<small>${ownerLabel(state, d.owner)} · ${reasons[d.reason] || ''}</small></span><b>${rate(d.income)} ₡</b></button>`;
    }).join('')
  );
}
