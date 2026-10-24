import { renderArmyControls, setArmyContextVisible } from './army-controls.js';
import { renderDefenseDetail } from './defense-inspector.js';
import { updateEquipmentDetails } from './equipment-detail.js';
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
    sig = String(b.id) + ':' + ruin + ':' + (b.level || 0);
  if (host.dataset.id !== sig) {
    host.dataset.id = sig;
    host.innerHTML = `<div class="panel-head"><b>${E.targetName(b)}${ruin ? ' · руины' : ''}</b><button data-action="deselect" aria-label="Закрыть">×</button></div><div class="health"><i id="inspect-health"></i></div><div class="inspect-line"><span id="inspect-hp"></span><span id="inspect-status"></span></div><div class="inspect-buttons"><button id="repair-button" data-repair="${b.id}">Ремонт</button>${!ruin && ['factory', 'launcher', 'silo'].includes(b.key) ? '<button data-panel="attack">Арсенал →</button>' : ''}${['barracks', 'vehiclebase'].includes(b.key) && b.side === 0 && !ruin ? `<button data-panel="army">Отряды →</button><button data-rally="${b.id}">Сбор ↗</button>` : ''}${b.key === 'gun' && b.side === 0 && !ruin ? `<button data-redeploy="${b.id}">Свернуть МОГ</button>` : ''}${b.side === 0 && (b.key !== 'hq' || ruin) ? `<button data-demolish="${b.id}">${ruin ? 'Разобрать руины' : 'Снести'}</button>` : ''}</div><div id="building-detail"></div><div id="defense-detail"></div>`;
  }
  if (['barracks', 'vehiclebase'].includes(b.key) && b.side === 0 && !ruin) {
    if (!$('#rally-mode'))
      host.insertAdjacentHTML(
        'beforeend',
        '<label class="barracks-rally-mode">Новобранцы<select id="rally-mode" aria-label="Приказы новым бойцам"><option value="guard">Охранять точку сбора</option><option value="wait">Ждать приказа у базы</option><option value="attackmove">С боем к точке сбора</option><option value="attack">В атаку на штаб врага</option><option value="defend">Оборонять коридор</option></select></label>',
      );
    $('#rally-mode').value = E.defaultRallyMode(state, b);
  }
  const serviceReport = b.key === 'service' ? E.serviceStatus(state, b.side, b.id) : null;
  const supply = ruin
    ? 'Разберите, чтобы освободить участок'
    : b.key === 'road'
      ? E.passable(b)
        ? 'Проезд открыт'
        : 'Проезд перекрыт'
      : b.key === 'service'
        ? serviceReport.status === 'road'
          ? 'Нет подъездной дороги'
          : serviceReport.status === 'disabled'
            ? 'Служба отключена'
            : 'Подъезд открыт'
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
    ruin ||
      supply.includes('20%') ||
      supply.includes('перекрыт') ||
      serviceReport?.status === 'road',
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
  if (o && $('#building-detail') && b.key !== 'service')
    $('#building-detail').innerHTML =
      `<div class="status-note">Выпуск ${Math.round(o.factor * 100)}% · дорога ${Math.round(o.road * 100)}% · мощность ${Math.round(o.power * 100)}%<br>${o.income ? rate(o.income) + ' ₡/мин · ' : ''}${o.materials ? rate(o.materials) + ' спл./мин · ' : ''}содержание ${Math.round(o.upkeep * 60)} ₡/мин</div>`;
  if (b.key === 'service' && b.side === 0 && !ruin) {
    if (!$('#service-detail'))
      $('#building-detail').insertAdjacentHTML(
        'afterend',
        '<section id="service-detail" aria-label="Городская ремонтная служба"><span class="eyebrow">ГОРОДСКОЙ РЕМОНТ</span><p class="small-muted">Две бригады чинят здания и дороги. Оплата деньгами и сплавами по мере работы.</p><div class="stat"><span>Машины / в работе</span><b id="service-fleet"></b></div><p id="service-status" class="status-note" role="status"></p><button id="service-toggle" data-service-enabled="' +
          b.id +
          '" class="service-toggle"></button></section>',
      );
    const report = serviceReport;
    const messages = {
      building: 'Развёртывание службы',
      disabled: 'Служба отключена',
      road: 'Нет подъездной дороги',
      credits: 'Ремонт ждёт пополнения бюджета',
      materials: 'Для ремонта нужны сплавы',
      active: report.repairing
        ? `Ремонтируют: ${report.repairing}`
        : 'Бригады следуют к повреждениям',
      idle: 'Бригады готовы к выезду',
      blocked: 'Проезд к повреждениям перекрыт',
    };
    $('#service-fleet').textContent = `${report.vehicles} / ${report.busy}`;
    $('#service-status').textContent = messages[report.status] || 'Служба готова';
    $('#service-status').classList.toggle(
      'warning',
      ['road', 'credits', 'materials', 'blocked'].includes(report.status),
    );
    const toggle = $('#service-toggle');
    toggle.dataset.enabled = String(!report.enabled);
    toggle.setAttribute('aria-pressed', String(report.enabled));
    toggle.textContent = report.enabled ? 'Отключить службу' : 'Включить службу';
    toggle.disabled = b.progress < 1;
  }
  let equipment = host.querySelector('#equipment-detail');
  if (!equipment) {
    equipment = document.createElement('div');
    equipment.id = 'equipment-detail';
    host.append(equipment);
  }
  updateEquipmentDetails(equipment, state, b);
  if (!ruin) renderDefenseDetail(state, b);
}
