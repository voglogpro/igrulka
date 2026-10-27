import * as E from '../game/index.js';
import { $ } from './format.js';
import { renderDefenseDetail } from './defense-inspector.js';
import { icon } from './icons.js';
import { updateEquipmentDetails } from './equipment-detail.js';
import { depotLayerName } from '../game/defense/layers.js';
import {
  rememberInspectorCard,
  restoreInspectorCard,
  compactEquipmentAction,
} from './inspector-card.js';

export function setArmyContextVisible(visible) {
  const host = $('#army-controls');
  if (!host) return;
  rememberInspectorCard(host);
  host.hidden = !visible;
  $('#game').classList.toggle('army-selected', visible);
  if (!visible) {
    host.innerHTML = '';
    delete host.dataset.id;
  }
}

// A thin separator is drawn before these commands to group movement, positions and transport.
const GROUPS = new Set(['guard', 'fire', 'board']);
const commands = [
  ['stop', 'Стоять', 'Остановить движение и отменить приказ'],
  ['attackmove', 'Наступать', 'M · Двигаться с боем до указанной точки'],
  ['guard', 'Охрана', 'Охранять текущие позиции, помогать соседям и возвращаться на пост'],
  [
    'defendline',
    'Линия обороны',
    'L · Провести линию на карте, чтобы распределить выбранные войска',
  ],
  ['dig', 'Окоп', 'H · Окопаться на текущей позиции'],
  ['camo', 'Маскировка', 'K · Скрытность в лесу, кустах и окопе'],
  ['fire', 'Огонь', 'Y · Разрешить или запретить стрельбу'],
  ['retreat', 'Отход', 'T · Отступить к базе и восстановиться'],
  ['board', 'Посадка', 'Указать свой БТР для посадки бойцов'],
  ['deliver', 'Доставить ↗', 'Отвезти пассажиров и автоматически высадить в указанной точке'],
  ['unload', 'Высадка', 'U · Высадить бойцов из выбранного БТР'],
];

export function renderArmyControls({ state, armySelection }, primary) {
  const host = $('#army-controls');
  if (!host) return;
  const selection = new Set(armySelection);
  const units = state.groundUnits.filter((u) => selection.has(u.id) && u.hp > 0);
  if (!units.length) {
    setArmyContextVisible(false);
    return;
  }
  setArmyContextVisible(true);
  const signature = units.map((u) => `${u.id}:${u.key}`).join(',');
  const d = E.GROUND_UNITS[primary.key];
  if (host.dataset.id !== signature) {
    host.dataset.id = signature;
    host.innerHTML = `<div class="army-summary"><button class="army-name" data-action="army-focus" title="Показать выбранную группу"><b>${units.length > 1 ? `${units.length} единиц` : d.name}</b><small id="ground-info"></small></button><div class="health"><i id="inspect-health"></i></div><small id="ground-state"></small></div><div class="army-orders"><div class="stance-row"><span class="stance-label">РЕЖИМ</span><div class="stance-switch" role="group" aria-label="Режим выбранных бойцов"><button data-stance="attack" title="Сразу идти на штаб противника, останавливаясь для боя">${icon('sword')}Атака</button><button data-stance="defend" title="Занять коридор, окопаться и не подпускать врага">${icon('shield')}Оборона</button></div><select id="stance-post" aria-label="Какой коридор оборонять"><option value="auto">Коридор: авто</option><option value="north">Северный коридор</option><option value="south">Южный коридор</option></select><span id="stance-note" class="stance-note"></span></div><div class="army-primary-orders">${commands.map(([key, label, title], i) => `${i && GROUPS.has(key) ? '<i class="order-sep"></i>' : ''}<button data-troop="${key}" title="${title}">${label}</button>`).join('')}${units.some((u) => u.key === 'operator') ? '<button class="fpv-button" data-troop="fpv" title="Q · Навести FPV выбранного оператора">FPV ↗</button>' : ''}</div><div class="army-tools"><label>Строй <select id="formation" aria-label="Построение армии"><option value="line">Линия</option><option value="column">Колонна</option><option value="spread">Рассредоточить</option></select></label><button data-action="army-all" title="Ctrl+A · Все свои войска">Вся армия</button><button data-panel="army">Набор ↗</button><details class="army-details"><summary>Оснащение и состояние</summary><div><p id="army-detail-text"></p><p id="army-auto-defense-note"></p><div id="defense-detail"></div></div></details><button data-action="support-auto" data-enabled="true" hidden>Автопомощь</button><span class="army-mouse-hint">ПКМ — приказ · Esc — снять выбор</span></div></div><button class="army-close" data-action="deselect" aria-label="Снять выделение">×</button>`;
    $('#formation').value = state.formations[0];
  }
  const hp = units.reduce((n, u) => n + u.hp, 0),
    maxHp = units.reduce((n, u) => n + u.maxHp, 0);
  $('#inspect-health').style.width = `${(hp / maxHp) * 100}%`;
  const moving = units.filter((u) => u.path?.length).length;
  const candidates = units.filter(
    (u) => !E.GROUND_UNITS[u.key]?.support && !u.civil && !u.downed && !u.carrierId,
  );
  const volunteers = candidates.filter((u) => u.autoDefense);
  const reinforcing = volunteers.filter((u) => u.defenseTask && !u.defenseTask.returning).length;
  const returning = volunteers.filter((u) => u.defenseTask?.returning).length;
  const raids = volunteers.filter((u) => u.defenseMission).length;
  host.querySelector('#army-auto-defense-note').textContent = volunteers.length
    ? `Рубежи: ${volunteers.length - reinforcing - returning - raids} · Перехват: ${reinforcing} · Обход: ${raids} · Возврат: ${returning}. Прямой приказ отменяет задачу.`
    : 'Защитники сами формируют фронт. Прямые приказы управляют выбранной группой.';
  const reloading = units.filter((u) => (u.groundReload || u.reloadLeft) > 0).length;
  $('#ground-info').textContent =
    `${Math.ceil(hp)} / ${maxHp} · ${moving ? `${moving} в пути` : 'на позиции'}`;
  const cover = E.coverInfo(state, primary);
  const rank = E.veteranRank(primary);
  const magazineText = d.groundRange
    ? primary.groundReload > 0
      ? `Перезарядка ${primary.groundReload.toFixed(1)} с.`
      : `Патроны: ${primary.groundAmmo ?? d.groundMagazine ?? 30}.`
    : '';
  $('#ground-state').textContent =
    units.length > 1
      ? `${units.filter((u) => E.isInfantry(u.key)).length} пехота · ${units.filter((u) => !E.isInfantry(u.key)).length} техника${reloading ? ` · ${reloading} перезарядка` : ''}${units.some((u) => u.guard) ? ' · охрана' : ''}`
      : `${rank ? '★'.repeat(rank) + ' · ' : ''}${primary.autoDefense ? depotLayerName(primary) + ' · ' : primary.guard ? 'Охрана · ' : ''}${cover.kind} · ${Math.round((primary.suppression || 0) * 100)}% подавление${primary.digging ? ' · роет окоп' : ''}${primary.carrierId ? ' · в транспорте' : ''}`;
  $('#army-detail-text').textContent =
    `${d.role} Опыт ${Math.floor(primary.xp || 0)}/450 · ранг ${rank}. ${magazineText} ${primary.key === 'operator' ? `FPV ${primary.fpvAmmo ?? 3}/3, готов через ${Math.max(0, Math.ceil((primary.fpvReady || 0) - state.time))} с.` : ''}`;
  const position = state.trenches.find((t) => t.id === primary.trenchId && t.side === primary.side);
  if (position) {
    const status = E.fortificationStatus(position);
    $('#army-detail-text').textContent +=
      ` ${status.label}: ${status.level}/3${status.level < 3 ? ` · следующий этап ${Math.round(status.nextProgress * 100)}%` : ''}. Защита позиции ${Math.round(status.cover * 100)}%. Улучшение требует времени, денег и сплавов.`;
  }
  if (units.length === 1 && d.capacity) {
    const seats = (field) =>
      state.groundUnits
        .filter((p) => p[field] === primary.id && p.hp > 0)
        .reduce((n, p) => n + (E.GROUND_UNITS[p.key].members || 1), 0);
    $('#ground-state').textContent =
      `Места: ${seats('carrierId')}/${d.capacity}${seats('boardingId') ? ` · подходят ${seats('boardingId')}` : ''}`;
    const delivery = E.transportDeliveryStatus(state, 0, primary.id);
    if (delivery?.status !== 'idle')
      $('#ground-state').textContent +=
        delivery.status === 'blocked' ? ' · высадка/проезд заблокированы' : ' · доставка в пути';
    const button = host.querySelector('[data-troop="deliver"]');
    button.disabled = !delivery?.passengers || seats('boardingId') > 0;
    button.title =
      seats('boardingId') > 0
        ? 'Дождитесь посадки бойцов'
        : !delivery?.passengers
          ? 'Сначала посадите пехоту в БТР'
          : 'Указать точку доставки и автоматической высадки';
  }
  if (units.length === 1 && d.range) {
    const stats = E.defenseStats(state.sides[0], primary),
      shared = d.infantry;
    const rounds = shared ? primary.groundAmmo : primary.ammo,
      reload = shared ? primary.groundReload : primary.reloadLeft;
    $('#ground-state').textContent +=
      primary.key === 'mog' && (primary.setup || 0) < 1
        ? ` · развёртывание ${Math.round((primary.setup || 0) * 100)}%`
        : reload > 0
          ? ` · перезарядка ${reload.toFixed(1)} с`
          : ` · ${rounds ?? stats.magazine}/${stats.magazine} · нагрев ${Math.round((primary.heat || 0) * 100)}%`;
  }
  host.querySelector('[data-troop="deliver"]').hidden = units.length !== 1 || !d.capacity;
  const supportButton = host.querySelector('[data-action="support-auto"]'),
    supportOnly = units.every((u) => ['medic', 'supply'].includes(E.GROUND_UNITS[u.key]?.support)),
    automatic = units.filter((u) => !u.supportManual && state.sides[0].rearAuto !== false).length;
  supportButton.hidden = !supportOnly;
  if (supportOnly) {
    const enabled = automatic === units.length;
    supportButton.dataset.enabled = String(!enabled);
    supportButton.setAttribute('aria-pressed', enabled ? 'true' : automatic ? 'mixed' : 'false');
    supportButton.textContent = enabled ? 'Автопомощь: вкл' : 'Возобновить автопомощь';
    supportButton.title =
      state.sides[0].rearAuto === false
        ? 'Включает службу и ставит выбранных на автоматику; ручные приказы остальных сохраняются'
        : 'Санитары и снабжение сами помогают соседям. После «Стоять» или прямого приказа здесь можно вернуть автоматику.';
  }
  const routed = units.filter((u) => u.routeState);
  if (units.length === 1 && E.ammunitionStatus) {
    const ammo = E.ammunitionStatus(state, primary);
    if (ammo.kind) $('#ground-state').textContent += ` · резерв ${ammo.reserve}/${ammo.capacity}`;
  }
  if (routed.length) {
    $('#ground-state').textContent += routed.some((u) => u.routeState.status === 'blocked')
      ? ' · маршрут заблокирован'
      : ` · маршрут: ${routed.length} ед.`;
    const route = E.groundRouteStatus(state, 0, primary.id);
    $('#army-detail-text').textContent +=
      ` Маршрут: ${route.pending}/12 ожидающих точек. Shift+ПКМ добавляет, «Стоять» отменяет.`;
  }
  const foot = units.some((u) => E.isInfantry(u.key) && !u.carrierId);
  const held = units.every((u) => u.holdFire);
  const stances = new Set(units.map((u) => (u.stance ? u.stance.mode : 'manual')));
  const only = stances.size === 1 ? [...stances][0] : null;
  for (const button of host.querySelectorAll('[data-stance]'))
    button.classList.toggle('active', only === button.dataset.stance);
  const posts = new Set(units.filter((u) => u.stance?.mode === 'defend').map((u) => u.stance.post));
  const post = host.querySelector('#stance-post');
  if (posts.size === 1 && document.activeElement !== post) post.value = [...posts][0];
  host.querySelector('#stance-note').textContent =
    only === 'defend'
      ? posts.size === 1
        ? E.POST_NAMES[[...posts][0]]
        : 'разные коридоры'
      : only === 'attack'
        ? 'на штаб врага'
        : units.some((u) => u.stance)
          ? 'смешанные режимы'
          : 'приказы вручную';
  host.querySelector('[data-troop="fire"]').textContent = held ? 'Разрешить огонь' : 'Огонь';
  host.querySelector('[data-troop="fire"]').classList.toggle('held', held);
  host.querySelector('[data-troop="guard"]').classList.toggle(
    'active',
    units.every((u) => u.guard),
  );
  host
    .querySelector('[data-troop="camo"]')
    .classList.toggle(
      'active',
      foot && units.filter((u) => E.isInfantry(u.key) && !u.carrierId).every((u) => u.camouflaged),
    );
  for (const command of ['dig', 'camo', 'board'])
    host.querySelector(`[data-troop="${command}"]`).disabled = !foot;
  const selectedCarriers = new Set(
    units.filter((u) => E.GROUND_UNITS[u.key].capacity).map((u) => u.id),
  );
  host.querySelector('[data-troop="unload"]').disabled =
    !selectedCarriers.size ||
    !state.groundUnits.some((passenger) => selectedCarriers.has(passenger.carrierId));
  let equipment = host.querySelector('#army-equipment-detail');
  if (!equipment) {
    equipment = document.createElement('div');
    equipment.id = 'army-equipment-detail';
    $('#army-detail-text').parentElement.append(equipment);
  }
  updateEquipmentDetails(equipment, state, units.length === 1 ? primary : null);
  if (d.range && units.length === 1) renderDefenseDetail(state, primary);
  else $('#defense-detail').innerHTML = '';
  compactEquipmentAction(
    host,
    state,
    units.length === 1 ? primary : null,
    host.querySelector('.army-summary'),
  );
  restoreInspectorCard(host, state, signature);
}
