import * as E from '../game/index.js';
import { $, num, time } from './format.js';

export function roadRecoveryHTML() {
  return `<section id="road-recovery" class="road-recovery" hidden aria-label="Восстановление дорог"><h3>Восстановить снабжение</h3><label>Утраченный участок<select id="road-recovery-site" aria-label="Дорога для восстановления"></select></label><progress id="road-recovery-progress" max="1" value="0" aria-label="Оплата восстановления дороги"></progress><p id="road-recovery-status" class="status-note" role="status"></p><div class="road-recovery-actions"><button data-action="road-recovery-start" id="road-recovery-start">Восстановить</button><button data-action="road-recovery-toggle" id="road-recovery-toggle" hidden>Приостановить</button><button data-action="road-recovery-cancel" id="road-recovery-cancel" title="Отменить подряд. Уже внесённая оплата не возвращается." hidden>Отменить</button></div><small>Штаб направляет ${E.HEADQUARTERS_INCOME * 60} ₡/мин своего дохода на дорогу. Деньги из общего бюджета не нужны. Отмена прекращает работы без возврата внесённой оплаты.</small></section>`;
}

export function updateRoadRecoveryPanel(state) {
  const host = $('#road-recovery');
  if (!host) return;
  const current = E.roadRecoveryStatus(state, 0);
  host.hidden = !current || (!current.id && current.candidates.length === 0);
  if (host.hidden) return;
  const select = $('#road-recovery-site');
  const signature = current.candidates.map((c) => `${c.id}:${c.cost}`).join(',');
  if (select.dataset.signature !== signature) {
    const previous = Number(select.value);
    select.replaceChildren(
      ...current.candidates.map((c) => {
        const option = document.createElement('option');
        option.value = String(c.id);
        option.textContent = `Участок #${c.id} · ${Math.round(Math.hypot(c.bx - c.ax, c.bz - c.az))} м · ${c.cost} ₡`;
        return option;
      }),
    );
    select.value = String(
      current.id ??
        (current.candidates.some((c) => c.id === previous) ? previous : current.recommendedId),
    );
    select.dataset.signature = signature;
  }
  if (current.id != null) select.value = String(current.id);
  select.disabled = current.id != null;
  const progress = $('#road-recovery-progress');
  progress.hidden = current.id == null;
  progress.max = Math.max(1, current.cost);
  progress.value = Math.min(current.paid, current.cost);
  $('#road-recovery-status').textContent = current.id
    ? `${current.reason} · оплачено ${num(current.paid)} / ${current.cost} ₡${current.eta != null ? ` · осталось ≈${time(Math.ceil(current.eta))}` : ''}`
    : 'Выберите прежний участок и запустите восстановление. Можно при нулевом бюджете.';
  const start = $('#road-recovery-start');
  start.hidden = current.id != null;
  start.disabled = !!state.result || !select.value;
  const toggle = $('#road-recovery-toggle');
  toggle.hidden = current.id == null;
  toggle.disabled = !!state.result;
  toggle.textContent = current.enabled ? 'Приостановить' : 'Продолжить';
  const cancel = $('#road-recovery-cancel');
  cancel.hidden = current.id == null;
  cancel.disabled = !!state.result;
}

export function createRoadRecoveryActions({
  getState,
  getEpoch,
  execute,
  persist,
  refresh,
  toast,
}) {
  let pending = false;
  const run = (type, request, message) => async () => {
    if (pending) return;
    pending = true;
    const epoch = getEpoch();
    try {
      const result = await execute(type, request());
      if (epoch !== getEpoch()) return;
      if (typeof result === 'string') toast(result, true);
      else {
        persist();
        refresh();
        toast(message);
      }
    } catch {
      if (epoch === getEpoch()) toast('Команда не выполнена. Проверьте подключение.', true);
    } finally {
      pending = false;
    }
  };
  return {
    'road-recovery-start': run(
      'road-recovery',
      () => ({ id: Number($('#road-recovery-site')?.value) }),
      'Штаб оплачивает восстановление выбранной дороги.',
    ),
    'road-recovery-toggle': run(
      'road-recovery-toggle',
      () => ({ enabled: !getState().sides[0].roadRecovery?.enabled }),
      'Режим работ обновлён.',
    ),
    'road-recovery-cancel': run(
      'road-recovery-cancel',
      () => ({}),
      'Подряд отменён. Внесённая оплата не возвращается.',
    ),
  };
}
