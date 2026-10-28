import * as E from '../game/index.js';
import { $ } from './format.js';

const sites = (state) =>
  state.buildings.filter((b) => b.side === 0 && b.key === 'factory' && b.hp > 0);
const labels = {
  disabled: 'План выключен',
  stock: 'Целевой запас собран — ожидание расхода',
  queue: 'Выполняется оплаченная очередь',
  credits: 'Ожидание денег с учётом резерва',
  materials: 'Ожидание сплавов с учётом резерва',
  components: 'Ожидание электроники',
  warehouse: 'Склад завода заполнен',
  locked: 'Вооружение недоступно',
  ruined: 'Завод разрушен',
  building: 'Завод строится',
  active: 'Готов к следующему заказу',
  finished: 'Кампания завершена',
};

export function factoryPlansHTML() {
  return `<details class="factory-automation"><summary>План боезапаса <span id="factory-plan-summary"></span></summary><div class="factory-plan-fields"><label>База дронов<select id="factory-plan-site" aria-label="База дронов для плана"></select></label><label>Выпуск<select id="factory-plan-key" aria-label="Вооружение для плана"></select></label><label>Держать на складе<input id="factory-plan-target" aria-label="Целевой запас" type="number" min="1" max="30" step="1" value="5"></label><label>Резерв денег<input id="factory-plan-credits" aria-label="Денежный резерв" type="number" min="0" max="10000" step="any" value="500"></label><label>Резерв сплавов<input id="factory-plan-materials" aria-label="Резерв сплавов" type="number" min="0" max="1000" step="any" value="20"></label></div><div class="factory-plan-actions"><button data-action="factory-plan-save" id="factory-plan-save">Включить план</button><button data-action="factory-plan-stop" id="factory-plan-stop">Остановить</button></div><p class="status-note" id="factory-plan-status"></p><p class="status-note">План учитывает общий склад и оплаченные заказы всех баз дронов. После покупки сохраняет заданный резерв. Остановка оставляет оплаченную очередь.</p></details>`;
}

export function loadFactoryPlanFields(state) {
  const b = sites(state).find((b) => b.id === Number($('#factory-plan-site').value));
  const plan = b?.productionPlan;
  $('#factory-plan-key').value = plan?.key || 'drone';
  $('#factory-plan-target').value = plan?.target ?? 5;
  $('#factory-plan-credits').value = plan?.reserveCredits ?? 500;
  $('#factory-plan-materials').value = plan?.reserveMaterials ?? 20;
}

export function updateFactoryPlansPanel(state) {
  const select = $('#factory-plan-site');
  if (!select) return;
  const factories = sites(state),
    signature = factories.map((b) => b.id).join(',');
  if (select.dataset.signature !== signature) {
    const previous = select.value;
    select.innerHTML = factories
      .map((b) => `<option value="${b.id}">База дронов #${b.id}</option>`)
      .join('');
    if (factories.some((b) => String(b.id) === previous)) select.value = previous;
    select.dataset.signature = signature;
    if (select.value !== previous) select.dataset.loaded = '';
  }
  const weapons = $('#factory-plan-key');
  if (!weapons.dataset.signature) {
    const previous = weapons.value;
    weapons.innerHTML = Object.entries(E.WEAPONS)
      .map(([key, d]) => `<option value="${key}">${d.name}</option>`)
      .join('');
    if (Object.hasOwn(E.WEAPONS, previous)) weapons.value = previous;
    weapons.dataset.signature = 'all-weapons';
  }
  if (select.dataset.loaded !== select.value) {
    loadFactoryPlanFields(state);
    select.dataset.loaded = select.value;
  }
  const current = E.factoryPlanStatus(state, 0, Number(select.value));
  $('#factory-plan-summary').textContent =
    `· вкл. ${factories.filter((b) => b.productionPlan?.enabled).length}`;
  $('#factory-plan-save').disabled = !current || current.status === 'building';
  $('#factory-plan-save').textContent = current?.enabled ? 'Применить изменения' : 'Включить план';
  $('#factory-plan-stop').disabled = !current?.enabled;
  $('#factory-plan-status').textContent = current
    ? `${labels[current.status] || 'Ожидание'}${current.key ? ` · ${E.WEAPONS[current.key].name}: ${current.inventory} на складе + ${current.queued} в очередях / цель ${current.target}` : ''}`
    : 'Сначала постройте сборочный завод у дороги';
}

export function factoryPlanRequest(state, enabled) {
  const id = Number($('#factory-plan-site').value);
  const b = sites(state).find((b) => b.id === id);
  if (!enabled && b?.productionPlan) return { id, plan: { ...b.productionPlan, enabled: false } };
  for (const input of document.querySelectorAll('.factory-plan-fields input'))
    if (!input.reportValidity()) return null;
  return {
    id,
    plan: {
      key: $('#factory-plan-key').value,
      target: Number($('#factory-plan-target').value),
      reserveCredits: Number($('#factory-plan-credits').value),
      reserveMaterials: Number($('#factory-plan-materials').value),
      enabled,
    },
  };
}
