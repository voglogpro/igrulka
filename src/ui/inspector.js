import { renderArmyControls, setArmyContextVisible } from './army-controls.js';
import { renderDefenseDetail } from './defense-inspector.js';
import * as E from '../game/index.js';
import { $, rate } from './format.js';
export function renderInspector(context) {
  const { state, selected, armySelection } = context;
  const b = E.observedTarget(state, 0, selected),
    host = $('#inspector');
  if (!b) {
    host.hidden = true;
    host.innerHTML = '';
    delete host.dataset.id;
    setArmyContextVisible(false);
    return;
  }
  if (b.ground && b.side === 0) {
    host.hidden = true;
    host.innerHTML = '';
    delete host.dataset.id;
    renderArmyControls(context, b);
    return;
  }
  setArmyContextVisible(false);
  host.hidden = false;
  if (b.ground) {
    host.innerHTML = `<div class="panel-head"><b>${E.targetName(b)}</b><button data-action="deselect" aria-label="Закрыть">×</button></div><div class="health"><i style="width:${Math.max(0, b.hp / b.maxHp) * 100}%"></i></div><p class="status-note">Противник · ${Math.ceil(b.hp)} / ${b.maxHp}<br>${E.GROUND_UNITS[b.key].role}</p>`;
    delete host.dataset.id;
    return;
  }
  const ruin = b.hp <= 0 && b.key !== 'road',
    sig = String(b.id) + ':' + ruin;
  if (host.dataset.id !== sig) {
    host.dataset.id = sig;
    host.innerHTML = `<div class="panel-head"><b>${E.targetName(b)}${ruin ? ' · руины' : ''}</b><button data-action="deselect" aria-label="Закрыть">×</button></div><div class="health"><i id="inspect-health"></i></div><div class="inspect-line"><span id="inspect-hp"></span><span id="inspect-status"></span></div><div class="inspect-buttons"><button id="repair-button" data-repair="${b.id}">Ремонт</button>${!ruin && (b.key === 'factory' || b.key === 'launcher') ? '<button data-panel="attack">Арсенал →</button>' : ''}${b.key === 'barracks' && b.side === 0 && !ruin ? `<button data-panel="army">Отряды →</button><button data-rally="${b.id}">Сбор ↗</button>` : ''}${b.key === 'gun' && b.side === 0 && !ruin ? `<button data-redeploy="${b.id}">Свернуть МОГ</button>` : ''}${b.side === 0 && (b.key !== 'hq' || ruin) ? `<button data-demolish="${b.id}">${ruin ? 'Разобрать руины' : 'Снести'}</button>` : ''}</div><div id="building-detail"></div><div id="defense-detail"></div>`;
  }
  if (b.key === 'barracks' && b.side === 0 && !ruin) {
    if (!$('#rally-mode'))
      host.insertAdjacentHTML(
        'beforeend',
        '<label class="barracks-rally-mode">Новобранцы<select id="rally-mode" aria-label="Приказы новым бойцам"><option value="guard">Охранять точку сбора</option><option value="wait">Ждать приказа у казарм</option><option value="attackmove">С боем к точке сбора</option></select></label>',
      );
    $('#rally-mode').value = E.defaultRallyMode(state, b);
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
