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
  return keys.filter((key) => {
    const facility = E.recruitmentFacility(key);
    return (
      facility &&
      state.buildings.some(
        (b) => b.side === 0 && b.key === facility && b.hp > 0 && !b.demolished && b.progress >= 1,
      )
    );
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
    `<div class="recruit-empty"><b>Нет доступных ролей</b><p>${category.keys.every((key) => E.recruitmentFacility(key) === 'vehiclebase') ? 'Постройте бронезавод для техники.' : category.keys.every((key) => E.recruitmentFacility(key) === 'barracks') ? 'Постройте казармы для пехоты.' : 'Постройте казармы для пехоты или бронезавод для техники.'}</p></div>`
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
}

export function recruitmentHTML({
  state,
  armyCategory = 'infantry',
  recruitCount = 1,
  recruitMode = 'point',
}) {
  const category = ARMY_CATEGORIES[armyCategory] || ARMY_CATEGORIES.infantry;
  return `<div class="muster-overview"><div><h2>Состав и развёртывание</h2><p>Постоянная оборона и ручные приказы.</p></div><div class="muster-capacity"><b id="army-capacity"></b><span>Войска и подготовка</span></div></div><nav class="army-category-tabs" aria-label="Роды войск">${Object.entries(
    ARMY_CATEGORIES,
  )
    .map(
      ([key, d]) =>
        `<button data-army-category="${key}" aria-pressed="${key === armyCategory}" class="${key === armyCategory ? 'active' : ''}">${d.name}<span>${availableRecruitment(state, d.keys).length}</span></button>`,
    )
    .join(
      '',
    )}</nav>${compositionHTML(state, category)}<div class="manual-recruit-heading"><b>Быстрый заказ</b><span>В точку / атаку — разово; оборона — увеличить цель</span></div><div class="muster-orders"><div class="recruit-batch"><span>Партия</span><button data-recruit-count="1" aria-pressed="${recruitCount === 1}" class="${recruitCount === 1 ? 'active' : ''}">×1</button><button data-recruit-count="5" aria-pressed="${recruitCount === 5}" class="${recruitCount === 5 ? 'active' : ''}">×5</button></div><div class="recruit-mode"><span>Задача</span><div class="stance-switch" role="group" aria-label="Куда отправлять новых бойцов"><button data-recruit-mode="point" class="${recruitMode === 'point' ? 'active' : ''}" title="Выбрать точку на карте">${icon('hand')}В точку</button><button data-recruit-mode="attack" class="${recruitMode === 'attack' ? 'active' : ''}" title="Сразу идти на штаб противника">${icon('sword')}В атаку</button><button data-recruit-mode="defend" class="${recruitMode === 'defend' ? 'active' : ''}" title="Занять оборону">${icon('shield')}Оборона</button></div></div></div><p class="muster-destination" id="recruit-destination-note"></p><div class="army-recruit" data-recruit-category="${armyCategory}" aria-label="Выбор роли бойцов">${recruitCardsHTML(state, category, recruitCount)}</div><div class="muster-logistics"><details class="army-queue-details"><summary>Подготовка <span id="army-queue-count"></span></summary><div id="army-queue" class="status-note"></div></details><details class="army-roster"><summary id="army-roster-label">На поле</summary><div id="army-list"></div></details><label class="rear-toggle" title="Санитары поднимают раненых, грузовики чинят технику и пополняют боезапас."><input type="checkbox" id="rear-auto"><span>Автоматическая тыловая помощь<small>Санитары и грузовики снабжения</small></span></label></div><div class="quick-build"><button data-build="barracks">+ Казармы</button><button data-build="vehiclebase">+ Бронезавод</button><button data-rally="auto" title="Назначить точку сбора новых бойцов">Точка сбора ↗</button><button data-action="army-all">Выбрать армию</button></div><p class="army-panel-hint">Рамка — выбрать · ПКМ — приказ · L — линия обороны</p>`;
}

export function armyTargetRequest(key, value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const count = Number(value);
  if (typeof value === 'string' && !value.trim()) return null;
  return E.recruitmentFacility(key) &&
    Number.isInteger(count) &&
    count >= 0 &&
    count <= E.ARMY_TARGET_MAX
    ? { key, count }
    : null;
}

function compositionHTML(state, category) {
  const report = E.armyCompositionStatus(state, 0);
  return `<section class="composition-panel" aria-label="Постоянный состав обороны"><div class="composition-heading"><div><h3>Состав обороны</h3><p>Задайте цель по типам. Казармы и бронезаводы сами восполняют потери.</p></div><div class="composition-actions"><b id="composition-total"></b><button data-action="defense-attack" disabled title="Отправить 30% готовых защитников в атаку без покупки новых бойцов">В атаку · 30%</button></div></div><div class="composition-columns"><span>Тип / состояние</span><span>В строю + очередь</span><span>Цель</span></div><div class="composition-rows">${category.keys
    .filter((key) => E.recruitmentFacility(key))
    .map((key) => {
      const row = report.types.find((t) => t.key === key);
      return `<label class="composition-row"><span><b>${E.GROUND_UNITS[key].name}</b><small data-composition-status="${key}"></small></span><span data-composition-count="${key}"></span><input type="number" inputmode="numeric" min="0" max="${E.ARMY_TARGET_MAX}" title="Цель пополнения; 0 — выключить. Общего лимита армии нет." step="1" value="${row?.target || 0}" data-army-target="${key}" aria-label="Цель обороны: ${E.GROUND_UNITS[key].name}"></label>`;
    })
    .join(
      '',
    )}</div><p class="composition-note">0 — не пополнять. Цель учитывает всех живых бойцов этого типа и оплаченные заказы, включая ручную атаку. Новое пополнение само занимает фронт. Резерв: 250 ₡ и 5 сплавов; для техники — ещё 5 нефти.</p><p id="composition-message" role="status" aria-live="polite"></p></section>`;
}

function updateComposition(report) {
  $('#composition-total').textContent = `Цель: ${report.totals.desired}`;
  for (const row of report.types) {
    const input = $(`[data-army-target="${row.key}"]`);
    if (!input) continue;
    if (document.activeElement !== input && !input.dataset.pending) input.value = row.target;
    $(`[data-composition-count="${row.key}"]`).textContent = `${row.alive} + ${row.queued}`;
    $(`[data-composition-status="${row.key}"]`).textContent =
      row.reason ||
      {
        disabled: 'Цель не задана',
        met: 'Состав укомплектован',
        queued: 'Пополнение в очереди',
        facility: `Нужна база: ${E.BUILDINGS[E.recruitmentFacility(row.key)].name}`,
        credits: 'Ожидание денег',
        materials: 'Ожидание сплавов',
        oil: 'Ожидание нефти',
        reserve: 'Сохраняем резерв ресурсов',
        active: 'Пополняем потери',
      }[row.status] ||
      '';
  }
}

export function updateArmyRecruitment({
  state,
  recruitCount,
  recruitMode = 'point',
  defenseAttackPending = false,
}) {
  refreshRecruitmentChoices(state, recruitCount);
  const faction = state.sides[0],
    composition = E.armyCompositionStatus(state, 0);
  const sites = state.buildings.filter(
    (b) => b.side === 0 && ['barracks', 'vehiclebase'].includes(b.key) && b.hp > 0 && !b.demolished,
  );
  const ready = sites.filter((b) => b.progress >= 1 && !b.demolished);
  const units = state.groundUnits.filter((u) => u.side === 0 && u.hp > 0 && !u.civil);
  const queue = sites.reduce((n, b) => n + (b.armyQueue?.length || 0), 0);
  const rearToggle = $('#rear-auto');
  if (rearToggle && document.activeElement !== rearToggle)
    rearToggle.checked = faction.rearAuto !== false;
  $('#army-capacity').textContent = `${units.length} в строю · ${queue} в очереди`;
  $('#army-queue-count').textContent = queue ? `${queue} в очереди` : 'свободно';
  $('#recruit-destination-note').textContent =
    recruitMode === 'attack'
      ? 'Пополнение сразу выдвинется в атаку на штаб противника.'
      : recruitMode === 'defend'
        ? 'Карточка увеличит постоянную цель состава. Пополнение само займёт фронт.'
        : 'После выбора роли укажите точку назначения на карте.';
  $('#army-queue').textContent =
    sites
      .map((b) =>
        b.progress < 1
          ? `${E.BUILDINGS[b.key].name} строится`
          : b.armyQueue?.length
            ? `${E.GROUND_UNITS[b.armyQueue[0].key].name} ${Math.floor(b.armyQueue[0].progress * 100)}% · очередь ${b.armyQueue.length}/8`
            : `${E.BUILDINGS[b.key].name}: очередь свободна`,
      )
      .join(' · ') || 'Постройте казармы или бронезавод у дороги';
  updateComposition(composition);
  const attack = E.defenseAttackStatus(state, 0),
    attackButton = $('[data-action="defense-attack"]');
  const attackPending = defenseAttackPending || !!attackButton.dataset.pending;
  attackButton.disabled = attackPending || !attack.ok;
  attackButton.textContent = `В атаку · 30% (${attack.count})`;
  attackButton.title = attackPending
    ? 'Отдаём приказ'
    : attack.reason ||
      `Отправить ${attack.count} из ${attack.eligible} готовых защитников. Без доплаты; остальные держат оборону.`;
  attackButton.setAttribute('aria-label', `Отправить 30% обороны в атаку: ${attack.count} бойцов`);
  $('#army-roster-label').textContent = `На поле: ${units.length} · выбрать по типу`;
  const counts = new Map();
  for (const unit of units) counts.set(unit.key, (counts.get(unit.key) || 0) + 1);
  const types = Object.entries(E.GROUND_UNITS)
    .map(([key, d]) => ({ key, d, count: counts.get(key) || 0 }))
    .filter((g) => g.count);
  const signature = types.map((g) => g.key + ':' + g.count).join(',');
  if ($('#army-list').dataset.signature !== signature) {
    $('#army-list').dataset.signature = signature;
    $('#army-list').innerHTML =
      types
        .map(
          (g) =>
            `<button class="army-role" data-army-role="${g.key}"><span>${g.d.name}</span><b>${g.count}</b></button>`,
        )
        .join('') || '<span class="small-muted">Войска ещё не подготовлены</span>';
  }
  for (const [key, d] of Object.entries(E.GROUND_UNITS)) {
    const button = $(`[data-recruit="${key}"]`);
    if (!button) continue;
    const quote = E.purchaseQuote(state, 0, 'ground', key, recruitCount);
    button.querySelector('.recruit-cost').textContent = `${recruitPrice(quote)} · ${d.time} с/ед.`;
    const resources =
      faction.credits < quote.cost ||
      faction.materials < quote.metal ||
      (faction.oil || 0) < quote.oil;
    const full =
      ready
        .filter((b) => b.key === E.recruitmentFacility(key))
        .reduce((n, b) => n + 8 - (b.armyQueue?.length || 0), 0) < recruitCount;
    const facilityReady = ready.some((b) => b.key === E.recruitmentFacility(key));
    button.hidden = !facilityReady;
    button.disabled =
      recruitMode === 'defend'
        ? (composition.targets[key] || 0) + recruitCount > E.ARMY_TARGET_MAX
        : !facilityReady || resources || full;
    button.classList.toggle('recruit-ready', !button.disabled);
    button.setAttribute('aria-label', `${d.name}. ${d.role}`);
    $(`[data-recruit-state="${key}"]`).textContent =
      recruitMode === 'defend'
        ? `Цель обороны +${recruitCount}`
        : !facilityReady
          ? `Нужна база: ${E.BUILDINGS[E.recruitmentFacility(key)].name}`
          : resources
            ? 'Не хватает ресурсов'
            : full
              ? 'Очередь заполнена'
              : recruitMode === 'attack'
                ? `В атаку ×${recruitCount}`
                : `Указать точку ×${recruitCount} ↗`;
  }
}
