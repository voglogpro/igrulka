import * as E from '../game/index.js';
import { $ } from './format.js';
import { icon } from './icons.js';
import { UNIT_PROFILES, unitIllustration } from './unit-profiles.js';

export const ARMY_CATEGORIES = {
  infantry: {
    name: 'Пехота',
    keys: [
      'infantry',
      'machinegunner',
      'sniper',
      'assault',
      'atrifle',
      'atgm',
      'engineer',
      'operator',
    ],
  },
  vehicles: {
    name: 'Техника',
    keys: ['armoredcar', 'apc', 'lighttank', 'ifv', 'leopard', 'heavytank', 'tankdestroyer'],
  },
  artillery: { name: 'Артиллерия', keys: ['howitzer', 'mlrs'] },
  rear: { name: 'Тыл', keys: ['medic', 'supplytruck'] },
  defense: { name: 'ПВО', keys: ['mog', 'shilka', 'gepard'] },
};

export function availableRecruitment(state, keys) {
  const facility = state.buildings.some(
    (b) => b.side === 0 && b.key === 'barracks' && b.hp > 0 && !b.demolished && b.progress >= 1,
  );
  if (!facility) return [];
  return keys.filter((key) => {
    const d = E.GROUND_UNITS[key];
    return d && !d.civil && (!d.tech || state.sides[0].tech.includes(d.tech));
  });
}

const recruitPrice = (quote) =>
  `${quote.cost} ₡ · ${quote.metal} спл.${quote.oil ? ` · ${quote.oil} нефти` : ''}`;

function recruitCardsHTML(state, category, count) {
  return (
    availableRecruitment(state, category.keys)
      .map((key) => {
        const d = E.GROUND_UNITS[key],
          profile = UNIT_PROFILES[key];
        return `<button class="recruit-card" data-recruit="${key}" title="${d.role}"><span class="recruit-card-visual">${unitIllustration(key)}<span class="recruit-role">${profile?.[0] || category.name}</span></span><b>${d.name}</b><span class="recruit-specialty">${profile?.[1] || d.role}</span><small class="recruit-cost">${recruitPrice(E.purchaseQuote(state, 0, 'ground', key, count))} · ${d.time} с</small><span class="recruit-readiness" data-recruit-state="${key}">Выбрать роль ↗</span></button>`;
      })
      .join('') ||
    '<div class="recruit-empty"><b>Нет доступных ролей</b><p>Постройте казармы и изучите технологии этого направления.</p><button data-panel="research">Исследования ↗</button></div>'
  );
}

// Refresh only changing catalogues. Keep the user's target, task and selector focus intact.
export function refreshRecruitmentChoices(state, count = 1) {
  const grid = $('.army-recruit');
  if (!grid) return;
  const category = ARMY_CATEGORIES[grid.dataset.recruitCategory] || ARMY_CATEGORIES.infantry;
  const signature = availableRecruitment(state, category.keys).join(',');
  if (grid.dataset.available !== signature) {
    grid.dataset.available = signature;
    grid.innerHTML = recruitCardsHTML(state, category, count);
  }
  for (const [key, d] of Object.entries(ARMY_CATEGORIES)) {
    const label = $(`[data-army-category="${key}"] span`);
    if (label) label.textContent = availableRecruitment(state, d.keys).length;
  }
  const sites = state.buildings.filter(
    (b) => b.side === 0 && b.key === 'barracks' && b.hp > 0 && !b.demolished && b.progress >= 1,
  );
  const choices = [
    [$('#repeat-site'), sites.map((b) => [String(b.id), `Казармы #${b.id}`])],
    [
      $('#repeat-key'),
      availableRecruitment(state, Object.keys(E.GROUND_UNITS)).map((key) => [
        key,
        E.GROUND_UNITS[key].name,
      ]),
    ],
  ];
  for (const [select, options] of choices) {
    if (!select || document.activeElement === select) continue;
    const next = options.map(([value]) => value).join(',');
    if (select.dataset.available === next) continue;
    const selected = select.value;
    select.innerHTML = options
      .map(([value, name]) => `<option value="${value}">${name}</option>`)
      .join('');
    if (options.some(([value]) => value === selected)) select.value = selected;
    select.dataset.available = next;
  }
}

export function recruitmentHTML({
  state,
  armyCategory = 'infantry',
  recruitCount = 1,
  armyAutomation,
  recruitMode = 'point',
  recruitPost = 'auto',
}) {
  const category = ARMY_CATEGORIES[armyCategory] || ARMY_CATEGORIES.infantry;
  return `<div class="muster-overview"><div><h2>Соберите свой отряд</h2><p>Выберите роль и назначение пополнения.</p></div><div class="muster-capacity"><b id="army-capacity"></b><span>состав / лимит</span></div></div><nav class="army-category-tabs" aria-label="Роды войск">${Object.entries(
    ARMY_CATEGORIES,
  )
    .map(
      ([key, d]) =>
        `<button data-army-category="${key}" aria-pressed="${key === armyCategory}" class="${key === armyCategory ? 'active' : ''}">${d.name}<span>${availableRecruitment(state, d.keys).length}</span></button>`,
    )
    .join(
      '',
    )}</nav><div class="muster-orders"><div class="recruit-batch"><span>Партия</span><button data-recruit-count="1" aria-pressed="${recruitCount === 1}" class="${recruitCount === 1 ? 'active' : ''}">×1</button><button data-recruit-count="5" aria-pressed="${recruitCount === 5}" class="${recruitCount === 5 ? 'active' : ''}">×5</button></div><div class="recruit-mode"><span>Задача</span><div class="stance-switch" role="group" aria-label="Куда отправлять новых бойцов"><button data-recruit-mode="point" class="${recruitMode === 'point' ? 'active' : ''}" title="Выбрать точку на карте">${icon('hand')}В точку</button><button data-recruit-mode="attack" class="${recruitMode === 'attack' ? 'active' : ''}" title="Сразу идти на штаб противника">${icon('sword')}В атаку</button><button data-recruit-mode="defend" class="${recruitMode === 'defend' ? 'active' : ''}" title="Занять оборону">${icon('shield')}Оборона</button></div><select id="recruit-post" aria-label="Пост для обороны" ${recruitMode === 'defend' ? '' : 'hidden'}><option value="auto" ${recruitPost === 'auto' ? 'selected' : ''}>Пост: авто</option><option value="north" ${recruitPost === 'north' ? 'selected' : ''}>Северный</option><option value="south" ${recruitPost === 'south' ? 'selected' : ''}>Южный</option></select></div></div><p class="muster-destination" id="recruit-destination-note"></p><div class="army-recruit" data-recruit-category="${armyCategory}" aria-label="Выбор роли бойцов">${recruitCardsHTML(state, category, recruitCount)}</div><div class="muster-logistics"><details class="army-queue-details"><summary>Подготовка <span id="army-queue-count"></span></summary><div id="army-queue" class="status-note"></div></details>${autoRecruitmentHTML(state, armyAutomation)}<details class="army-roster"><summary id="army-roster-label">На поле</summary><div id="army-list"></div></details><label class="rear-toggle" title="Санитары поднимают раненых, грузовики чинят технику и пополняют боезапас."><input type="checkbox" id="rear-auto"><span>Автоматическая тыловая помощь<small>Санитары и грузовики снабжения</small></span></label></div><div class="quick-build"><button data-build="barracks">+ Казармы</button><button data-rally="auto" title="Назначить точку сбора новых бойцов">Точка сбора ↗</button><button data-action="army-all">Выбрать армию</button></div><p class="army-panel-hint">Рамка — выбрать · ПКМ — приказ · L — линия обороны</p>`;
}

function autoRecruitmentHTML(state, choice = { siteId: null, key: 'infantry' }) {
  const sites = state.buildings.filter((b) => b.side === 0 && b.key === 'barracks' && b.hp > 0);
  const keys = availableRecruitment(state, Object.keys(E.GROUND_UNITS));
  const currentTarget = choice.target || 12;
  return `<section class="army-automation" aria-label="Пополнение гарнизона"><div class="garrison-heading"><b>Поддерживать гарнизон</b><span id="repeat-summary"></span></div><div class="auto-recruit-fields"><label>Казармы<select id="repeat-site" aria-label="Казармы для пополнения">${sites.map((b) => `<option value="${b.id}" ${b.id === choice.siteId ? 'selected' : ''}>Казармы #${b.id}</option>`).join('')}</select></label><label>Тип бойца<select id="repeat-key" aria-label="Тип пополнения">${keys.map((key) => `<option value="${key}" ${key === choice.key ? 'selected' : ''}>${E.GROUND_UNITS[key].name}</option>`).join('')}</select></label><label>Численность<select id="repeat-target" aria-label="Поддерживать численность">${[6, 12, 24].map((target) => `<option value="${target}" ${currentTarget === target ? 'selected' : ''}>${target} бойцов</option>`).join('')}</select></label><button data-action="repeat-toggle" id="repeat-toggle">Включить</button></div><p class="status-note" id="repeat-status"></p><p class="army-panel-hint">Численность этого типа во всей армии. Потери пополняются в автооборону. Резерв: 250 ₡ и 5 сплавов; для техники — ещё 5 нефти.</p></section>`;
}

export function updateArmyRecruitment({ state, recruitCount, recruitMode = 'point' }) {
  refreshRecruitmentChoices(state, recruitCount);
  const faction = state.sides[0];
  const sites = state.buildings.filter((b) => b.side === 0 && b.key === 'barracks' && b.hp > 0);
  const ready = sites.filter((b) => b.progress >= 1 && !b.demolished);
  const units = state.groundUnits.filter((u) => u.side === 0 && u.hp > 0 && !u.civil);
  const queue = sites.reduce((n, b) => n + (b.armyQueue?.length || 0), 0);
  const rearToggle = $('#rear-auto');
  if (rearToggle && document.activeElement !== rearToggle)
    rearToggle.checked = faction.rearAuto !== false;
  $('#army-capacity').textContent = `${units.length + queue} / ${E.GROUND_LIMIT}`;
  $('#army-queue-count').textContent = queue ? `${queue} в очереди` : 'свободно';
  $('#recruit-destination-note').textContent =
    recruitMode === 'attack'
      ? 'Пополнение сразу выдвинется в атаку на штаб противника.'
      : recruitMode === 'defend'
        ? $('#recruit-post').value === 'auto'
          ? 'Сам выбирает коридор и выделяет ограниченный резерв для усиления прорыва.'
          : 'Пополнение закрепится за выбранным коридором и будет держать свой участок.'
        : 'После выбора роли укажите точку назначения на карте.';
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
  const same =
    repeat?.enabled &&
    repeat.key === $('#repeat-key').value &&
    (repeat.target ?? 12) === Number($('#repeat-target').value);
  $('#repeat-toggle').disabled = !repeat;
  $('#repeat-toggle').textContent = same
    ? 'Отключить'
    : repeat?.enabled
      ? 'Сменить выпуск'
      : 'Включить';
  $('#repeat-status').textContent = repeat
    ? {
        off: 'Выключен',
        'target-met': 'Гарнизон укомплектован',
        reserve: 'Сохраняем резерв ресурсов для города',
        oil: 'Ожидание нефти',
        ready: 'Готов к следующему отряду',
        queued: 'Выполняется оплаченная очередь',
        resources: 'Ожидание ресурсов',
        'unit-limit': 'Ожидание свободного места в армии',
        research: 'Нужно исследование',
        'site-unavailable': 'Казармы недоступны',
        finished: 'Кампания завершена',
      }[repeat.status] +
      (repeat.enabled
        ? ` · ${repeat.present ?? 0} / ${repeat.target ?? 12} · ${E.GROUND_UNITS[repeat.key]?.name || ''}`
        : '')
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
    const quote = E.purchaseQuote(state, 0, 'ground', key, recruitCount);
    button.querySelector('.recruit-cost').textContent = `${recruitPrice(quote)} · ${d.time} с/ед.`;
    const locked = d.tech && !faction.tech.includes(d.tech),
      resources =
        faction.credits < quote.cost ||
        faction.materials < quote.metal ||
        (faction.oil || 0) < quote.oil;
    const full =
      units.length + queue + recruitCount > E.GROUND_LIMIT ||
      ready.reduce((n, b) => n + 8 - (b.armyQueue?.length || 0), 0) < recruitCount;
    button.hidden = !!locked || !ready.length;
    button.disabled = !!locked || !ready.length || resources || full;
    button.classList.toggle('recruit-locked', !!locked);
    button.classList.toggle('recruit-ready', !button.disabled);
    button.setAttribute('aria-label', `${d.name}. ${d.role}`);
    $(`[data-recruit-state="${key}"]`).textContent = locked
      ? `Нужно: ${E.TECH[d.tech].name}`
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
