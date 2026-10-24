import * as E from '../game/index.js';
import { $ } from './format.js';
import { icon } from './icons.js';

export const ARMY_CATEGORIES = {
  infantry: {
    name: 'Пехота',
    keys: ['infantry', 'machinegunner', 'sniper', 'assault', 'atgm', 'engineer', 'operator'],
  },
  vehicles: {
    name: 'Техника',
    keys: ['armoredcar', 'apc', 'lighttank', 'ifv', 'leopard', 'heavytank', 'tankdestroyer'],
  },
  artillery: { name: 'Артиллерия', keys: ['howitzer', 'mlrs'] },
  rear: { name: 'Тыл', keys: ['medic', 'supplytruck'] },
  defense: { name: 'ПВО', keys: ['mog', 'shilka', 'gepard'] },
};

export function recruitmentHTML({
  state,
  armyCategory = 'infantry',
  recruitCount = 1,
  armyAutomation,
  recruitMode = 'point',
  recruitPost = 'auto',
}) {
  const category = ARMY_CATEGORIES[armyCategory] || ARMY_CATEGORIES.infantry;
  return `<div class="army-category-tabs">${Object.entries(ARMY_CATEGORIES)
    .map(
      ([key, d]) =>
        `<button data-army-category="${key}" class="${key === armyCategory ? 'active' : ''}">${d.name}</button>`,
    )
    .join(
      '',
    )}</div><div class="recruit-batch"><span>За клик</span><button data-recruit-count="1" class="${recruitCount === 1 ? 'active' : ''}">×1</button><button data-recruit-count="5" class="${recruitCount === 5 ? 'active' : ''}">×5</button><span id="army-capacity"></span></div><div class="recruit-mode"><span>Куда</span><div class="stance-switch" role="group" aria-label="Куда отправлять новых бойцов"><button data-recruit-mode="point" class="${recruitMode === 'point' ? 'active' : ''}" title="Выбрать точку на карте">${icon('hand')}В точку</button><button data-recruit-mode="attack" class="${recruitMode === 'attack' ? 'active' : ''}" title="Сразу идти на штаб противника">${icon('sword')}В атаку</button><button data-recruit-mode="defend" class="${recruitMode === 'defend' ? 'active' : ''}" title="Занять мост и окопаться">${icon('shield')}Оборона</button></div><select id="recruit-post" aria-label="Мост для обороны" ${recruitMode === 'defend' ? '' : 'hidden'}><option value="auto" ${recruitPost === 'auto' ? 'selected' : ''}>Мост: авто</option><option value="north" ${recruitPost === 'north' ? 'selected' : ''}>Северный</option><option value="south" ${recruitPost === 'south' ? 'selected' : ''}>Южный</option></select></div><div class="army-recruit">${category.keys
    .map((key) => {
      const d = E.GROUND_UNITS[key],
        locked = d.tech && !state.sides[0].tech.includes(d.tech);
      return `<button data-recruit="${key}" title="${d.role}${locked ? ' Требуется: ' + E.TECH[d.tech].name : ''}"><b>${d.name}</b><small>${d.cost} ₡ · ${d.metal} спл. · ${d.time} с</small><span data-recruit-state="${key}">${locked ? 'Исследование' : 'Нанять +'}</span></button>`;
    })
    .join(
      '',
    )}</div><label class="rear-toggle" title="Санитары поднимают раненых, грузовики чинят технику и пополняют боезапас. Всё делается само, пока в армии есть кого лечить и чинить."><input type="checkbox" id="rear-auto"> Тыловая служба: авто · санитары и грузовики</label><div id="army-queue" class="status-note"></div>${autoRecruitmentHTML(state, armyAutomation)}<details class="army-roster"><summary id="army-roster-label">На поле</summary><div id="army-list"></div></details><div class="quick-build"><button data-build="barracks">+ Казармы</button><button data-rally="auto" title="Назначить точку сбора новых бойцов">Точка сбора ↗</button><button data-action="army-all">Выбрать армию</button></div><p class="army-panel-hint">Рамка — выбрать · ПКМ — приказ · L — линия обороны</p>`;
}

function autoRecruitmentHTML(state, choice = { siteId: null, key: 'infantry' }) {
  const sites = state.buildings.filter((b) => b.side === 0 && b.key === 'barracks' && b.hp > 0);
  return `<details class="army-automation"><summary>Автонабор <span id="repeat-summary"></span></summary><div class="auto-recruit-fields"><label>Казармы<select id="repeat-site" aria-label="Казармы для автоматического набора">${sites.map((b) => `<option value="${b.id}" ${b.id === choice.siteId ? 'selected' : ''}>Казармы #${b.id}</option>`).join('')}</select></label><label>Выпуск<select id="repeat-key" aria-label="Тип автоматического набора">${Object.entries(
    E.GROUND_UNITS,
  )
    .map(
      ([key, d]) =>
        `<option value="${key}" ${key === choice.key ? 'selected' : ''} ${d.tech && !state.sides[0].tech.includes(d.tech) ? 'disabled' : ''}>${d.name} · ${d.cost} ₡</option>`,
    )
    .join(
      '',
    )}</select></label></div><button data-action="repeat-toggle" id="repeat-toggle">Включить</button><p class="status-note" id="repeat-status"></p><p class="army-panel-hint">Новый отряд оплачивается после завершения очереди. Отключение сохраняет уже оплаченную очередь.</p></details>`;
}

export function updateArmyRecruitment({ state, recruitCount, recruitMode = 'point' }) {
  const faction = state.sides[0];
  const sites = state.buildings.filter((b) => b.side === 0 && b.key === 'barracks' && b.hp > 0);
  const ready = sites.filter((b) => b.progress >= 1);
  const units = state.groundUnits.filter((u) => u.side === 0 && u.hp > 0);
  const queue = sites.reduce((n, b) => n + (b.armyQueue?.length || 0), 0);
  const rearToggle = $('#rear-auto');
  if (rearToggle && document.activeElement !== rearToggle)
    rearToggle.checked = faction.rearAuto !== false;
  $('#army-capacity').textContent = `${units.length + queue} / ${E.GROUND_LIMIT}`;
  $('#army-queue').textContent =
    sites
      .map((b) =>
        b.progress < 1
          ? 'Казармы строятся'
          : b.armyQueue?.length
            ? `${E.GROUND_UNITS[b.armyQueue[0].key].name} ${Math.floor(b.armyQueue[0].progress * 100)}% · очередь ${b.armyQueue.length}/8`
            : 'Казармы свободны',
      )
      .join(' · ') || 'Сначала постройте казармы у дороги';
  const automatic = sites.filter((b) => b.recruitRepeat?.enabled);
  $('#repeat-summary').textContent = automatic.length ? `· вкл. ${automatic.length}` : '· выкл.';
  const siteId = Number($('#repeat-site').value),
    repeat = E.recruitRepeatStatus(state, 0, siteId);
  const same = repeat?.enabled && repeat.key === $('#repeat-key').value;
  $('#repeat-toggle').disabled = !repeat;
  $('#repeat-toggle').textContent = same
    ? 'Отключить'
    : repeat?.enabled
      ? 'Сменить выпуск'
      : 'Включить';
  $('#repeat-status').textContent = repeat
    ? {
        off: 'Выключен',
        ready: 'Готов к следующему отряду',
        queued: 'Выполняется оплаченная очередь',
        resources: 'Ожидание ресурсов',
        'unit-limit': 'Ожидание свободного места в армии',
        research: 'Нужно исследование',
        'site-unavailable': 'Казармы недоступны',
        finished: 'Кампания завершена',
      }[repeat.status] + (repeat.enabled ? ` · ${E.GROUND_UNITS[repeat.key]?.name || ''}` : '')
    : 'Сначала постройте казармы';
  $('#army-roster-label').textContent = `На поле: ${units.length} · выбрать по типу`;
  const types = Object.entries(E.GROUND_UNITS)
    .map(([key, d]) => ({ key, d, units: units.filter((u) => u.key === key) }))
    .filter((g) => g.units.length);
  const signature = types.map((g) => g.key + ':' + g.units.length).join(',');
  if ($('#army-list').dataset.signature !== signature) {
    $('#army-list').dataset.signature = signature;
    $('#army-list').innerHTML =
      types
        .map(
          (g) =>
            `<button class="army-role" data-army-role="${g.key}"><span>${g.d.name}</span><b>${g.units.length}</b></button>`,
        )
        .join('') || '<span class="small-muted">Войска ещё не подготовлены</span>';
  }
  for (const [key, d] of Object.entries(E.GROUND_UNITS)) {
    const button = $(`[data-recruit="${key}"]`);
    if (!button) continue;
    button.querySelector('small').textContent =
      `${d.cost * recruitCount} ₡ · ${d.metal * recruitCount} спл. · ${d.time} с/ед.`;
    const locked = d.tech && !faction.tech.includes(d.tech),
      resources =
        faction.credits < d.cost * recruitCount || faction.materials < d.metal * recruitCount;
    const full =
      units.length + queue + recruitCount > E.GROUND_LIMIT ||
      ready.reduce((n, b) => n + 8 - (b.armyQueue?.length || 0), 0) < recruitCount;
    button.disabled = !!locked || !ready.length || resources || full;
    $(`[data-recruit-state="${key}"]`).textContent = locked
      ? 'Исследование'
      : !ready.length
        ? 'Нужны казармы'
        : resources
          ? 'Не хватает ресурсов'
          : full
            ? 'Очередь заполнена'
            : recruitMode === 'attack'
              ? `В атаку ×${recruitCount}`
              : recruitMode === 'defend'
                ? `На оборону ×${recruitCount}`
                : `Указать точку ×${recruitCount} ↗`;
  }
}
