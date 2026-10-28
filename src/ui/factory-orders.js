import * as E from '../game/index.js';

export function factoryOrderControlsHTML() {
  return '<div class="factory-order-controls"><label>Заказать <input id="factory-order-count" type="number" min="1" max="100" step="1" value="1" aria-label="Количество в конечном заказе"></label><button data-factory-order-quantity="10">10</button><button data-factory-order-quantity="20">20</button><small>Оплата по одной, когда хватает ресурсов</small></div>';
}

export function factoryOrderQuantity(input) {
  const count = Number(input?.value);
  return Number.isSafeInteger(count) && count >= 1 && count <= 100 ? count : null;
}

export function updateFactoryOrderRows(state, root = document) {
  const input = root.querySelector('#factory-order-count');
  const count = factoryOrderQuantity(input);
  const report = E.factoryOrderStatus(state, 0);
  for (const key of Object.keys(E.WEAPONS)) {
    const current = E.factoryOrderStatus(state, 0, null, key);
    const button = root.querySelector(`[data-produce="${key}"]`);
    if (!button) continue;
    button.textContent = count ? `+${count}` : '+';
    button.disabled =
      !!state.result || !current.canOrder || !count || report.sidePending + count > report.limit;
    button.title = 'Добавить конечный заказ без полной предоплаты';
    const pending = root.querySelector(`[data-production-pending="${key}"]`);
    if (pending) {
      pending.textContent = current.unpaid ? `ждёт ${current.unpaid}` : '';
      pending.title = current.orders
        .map((q) => `#${q.factoryId}: ${q.remaining} · ${q.reason}`)
        .join('\n');
    }
    const cancel = root.querySelector(`[data-cancel-production="${key}"]`);
    if (cancel) {
      cancel.hidden = !current.unpaid;
      cancel.disabled = !!state.result;
    }
  }
  return report;
}
