import * as E from '../game/index.js';
import { $, rate } from './format.js';
export function renderInspector(context) {
  const { state, selected, armySelection } = context;
  const b = E.observedTarget(state, 0, selected),
    host = $('#inspector');
  if (!b) {
    host.hidden = true;
    return;
  }
  host.hidden = false;
  if (b.ground) {
    renderGroundInspector(context, b, host);
    return;
  }
  const ruin = b.hp <= 0 && b.key !== 'road',
    sig = String(b.id) + ':' + ruin;
  if (host.dataset.id !== sig) {
    host.dataset.id = sig;
    host.innerHTML = `<div class="panel-head"><b>${E.targetName(b)}${ruin ? ' · руины' : ''}</b><button data-action="deselect" aria-label="Закрыть">×</button></div><div class="health"><i id="inspect-health"></i></div><div class="inspect-line"><span id="inspect-hp"></span><span id="inspect-status"></span></div><div class="inspect-buttons"><button id="repair-button" data-repair="${b.id}">Ремонт</button>${!ruin && (b.key === 'factory' || b.key === 'launcher') ? '<button data-panel="attack">Арсенал →</button>' : ''}${b.key === 'barracks' && b.side === 0 && !ruin ? `<button data-panel="army">Отряды →</button><button data-rally="${b.id}">Сбор ↗</button>` : ''}${b.key === 'gun' && b.side === 0 && !ruin ? `<button data-redeploy="${b.id}">Свернуть МОГ</button>` : ''}${b.side === 0 && (b.key !== 'hq' || ruin) ? `<button data-demolish="${b.id}">${ruin ? 'Разобрать руины' : 'Снести'}</button>` : ''}</div><div id="building-detail"></div><div id="defense-detail"></div>`;
  }
  const supply = ruin
    ? 'Разберите, чтобы освободить участок'
    : b.key === 'road'
      ? E.passable(b)
        ? 'Проезд открыт'
        : 'Проезд перекрыт'
      : E.ROAD_REQUIRED.has(b.key)
        ? E.supplyFactor(state, b) === 1
          ? 'Снабжение 100%'
          : 'Снабжение 20% · нет пути'
        : 'Автономная позиция';
  $('#inspect-health').style.width = Math.max(0, b.hp / b.maxHp) * 100 + '%';
  $('#inspect-hp').textContent = Math.ceil(b.hp) + ' / ' + b.maxHp;
  $('#inspect-status').textContent =
    b.progress < 1 && !ruin ? 'Строится ' + Math.floor(b.progress * 100) + '%' : supply;
  $('#inspect-status').classList.toggle(
    'warning',
    ruin || supply.includes('20%') || supply.includes('перекрыт'),
  );
  const button = $('#repair-button');
  button.disabled =
    (b.hp <= 0 && b.key !== 'road') ||
    b.hp >= b.maxHp ||
    b.repairing ||
    b.progress < 1 ||
    b.side !== 0;
  button.textContent = ruin
    ? 'Разрушено'
    : b.repairing
      ? 'Ремонт…'
      : 'Ремонт ' + Math.ceil((b.maxHp - b.hp) * 0.55) + ' ₡';
  const o = E.buildingOutput(state, b);
  if (o && $('#building-detail'))
    $('#building-detail').innerHTML =
      `<div class="status-note">Выпуск ${Math.round(o.factor * 100)}% · дорога ${Math.round(o.road * 100)}% · мощность ${Math.round(o.power * 100)}%<br>${o.income ? rate(o.income) + ' ₡/мин · ' : ''}${o.materials ? rate(o.materials) + ' спл./мин · ' : ''}${o.science ? rate(o.science) + ' науки/мин · ' : ''}содержание ${Math.round(o.upkeep * 60)} ₡/мин</div>`;
  if (!ruin) renderDefenseDetail(state, b);
}
function renderGroundInspector(context, b, host) {
  const { state, armySelection } = context;
  const d = E.GROUND_UNITS[b.key],
    units = state.groundUnits.filter((u) => armySelection.includes(u.id)),
    sig = 'g' + b.id + ':' + armySelection.join(',');
  if (host.dataset.id !== sig) {
    host.dataset.id = sig;
    host.innerHTML = `<div class="panel-head"><b>${armySelection.length > 1 ? armySelection.length + ' единиц' : d.name}</b><button data-action="deselect">×</button></div><div class="health"><i id="inspect-health"></i></div><div id="ground-info" class="status-note"></div><div id="ground-state" class="small-muted"></div><div class="troop-commands"><button data-troop="stop" title="Прекратить движение">Стоять</button><button data-troop="attackmove">Наступать ↗</button><button data-troop="dig" title="H · Строит окоп на позиции">Окопаться</button><button data-troop="camo" title="K · Улучшает скрытность в укрытии">Маскировка</button><button data-troop="fire" title="F · Разрешить или запретить огонь">Держать огонь</button><button data-troop="retreat" title="T · Отойти к казармам и восстановиться">Отступить</button><button data-troop="board">В транспорт ↗</button><button data-troop="unload" title="U · Высадить на доступную землю">Высадить</button>${units.some((u) => u.key === 'operator') ? '<button data-troop="fpv" class="fpv-button">Запустить FPV ↗</button>' : ''}</div><label class="formation-label">Построение<select id="formation"><option value="line">Линия</option><option value="column">Колонна</option><option value="spread">Рассредоточиться</option></select></label><div id="defense-detail"></div><div class="inspect-buttons"><button data-action="army-all">Вся армия</button><button data-panel="army">Набор →</button></div>`;
    $('#formation').value = state.formations[0];
  }
  $('#inspect-health').style.width = (b.hp / b.maxHp) * 100 + '%';
  const cover = E.coverInfo(state, b),
    passengers = state.groundUnits.filter((u) => u.carrierId === b.id),
    occupied = passengers.reduce((n, u) => n + (E.GROUND_UNITS[u.key].members || 1), 0),
    reload =
      b.groundReload > 0
        ? 'перезарядка ' + b.groundReload.toFixed(1) + ' с'
        : 'патроны ' + (b.groundAmmo ?? d.groundMagazine ?? 30);
  $('#ground-info').textContent =
    `${Math.ceil(b.hp)} / ${b.maxHp} · ${b.carrierId ? 'В машине #' + b.carrierId : b.boardingId ? 'Идёт на посадку' : b.path?.length ? 'В пути' : 'На позиции'} · ${Math.round(d.upkeep * 60)} ₡/мин`;
  $('#ground-state').textContent =
    `${cover.kind} · защита ${Math.round(cover.cover * 100)}% · подавление ${Math.round((b.suppression || 0) * 100)}% · ${reload}${b.camouflaged ? ' · маскировка включена' : ''}${b.holdFire ? ' · огонь запрещён' : ''}${b.digging ? ' · роет окоп' : ''}${d.capacity ? ' · мест ' + occupied + '/' + d.capacity : ''}${b.key === 'operator' ? ' · FPV ' + (b.fpvAmmo ?? 3) + '/3 · готов через ' + Math.max(0, Math.ceil((b.fpvReady || 0) - state.time)) + ' с' : ''}`;
  const foot = units.some((u) => E.isInfantry(u.key) && !u.carrierId),
    allHeld = units.every((u) => u.holdFire),
    allCamo = units.filter((u) => E.isInfantry(u.key) && !u.carrierId).every((u) => u.camouflaged);
  host.querySelector('[data-troop="fire"]').textContent = allHeld
    ? 'Разрешить огонь'
    : 'Держать огонь';
  host.querySelector('[data-troop="camo"]').classList.toggle('active', foot && allCamo);
  for (const cmd of ['camo', 'dig', 'board'])
    host.querySelector('[data-troop="' + cmd + '"]').disabled = !foot;
  host.querySelector('[data-troop="unload"]').disabled = !units.some(
    (u) => E.GROUND_UNITS[u.key].capacity && state.groundUnits.some((p) => p.carrierId === u.id),
  );
  if (!E.isInfantry(b.key) || b.key === 'mog') renderDefenseDetail(state, b);
  else $('#defense-detail').innerHTML = '';
}
function renderDefenseDetail(state, b) {
  const host = $('#defense-detail'),
    base = E.BUILDINGS[b.key] || E.GROUND_UNITS[b.key];
  if (!host || !base?.range) return;
  const d = E.defenseStats(state.sides[b.side], b),
    live =
      state.buildings.find((x) => x.id === b.id) || state.groundUnits.find((x) => x.id === b.id),
    sig = b.id + ':' + (b.level || 0) + ':' + (b.hp > 0);
  if (host.dataset.unit !== sig) {
    host.dataset.unit = sig;
    host.innerHTML = `<div class="defense-meter"><span id="heat-label"></span><meter id="heat-meter" min="0" max="1.5" value="0"></meter></div><div id="ammo-label" class="status-note"></div><div class="small-muted">${b.key === 'sam' ? 'Перехват дронов и ракет' : 'Только дроны · ракеты не перехватывает'}</div>${b.side === 0 && b.hp > 0 && (b.level || 0) < 2 ? `<button class="upgrade-button" data-upgrade="${b.id}" title="Урон +15%, дальность +8%, разброс −18%. Нужна стабилизация огня.">Улучшить · ${220 * (1 + (b.level || 0))} ₡ · ${18 * (1 + (b.level || 0))} спл.</button>` : ''}`;
  }
  $('#heat-label').textContent = 'Нагрев ' + Math.round((live.heat || 0) * 100) + '%';
  $('#heat-meter').value = live.heat || 0;
  $('#ammo-label').textContent =
    ((live.groundReload || live.reloadLeft) > 0
      ? 'Перезарядка ' + (live.groundReload || live.reloadLeft).toFixed(1) + ' с'
      : 'Боезапас ' +
        (E.isInfantry(b.key) || b.key === 'gun'
          ? (live.groundAmmo ?? d.magazine)
          : (live.ammo ?? d.magazine)) +
        ' / ' +
        d.magazine) +
    ' · уровень ' +
    ((b.level || 0) + 1);
}
