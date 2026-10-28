import { createAttackRecallAction } from './controllers/attack-recall.js';
import { createCommandExecutor } from './session/command-executor.js';
import { resolveArmySelection } from './selection.js';
import { advanceSimulationFrame } from './session/simulation-budget.js';
import { createFrameTasks } from './session/frame-tasks.js';
import { createAutosave } from './session/autosave.js';
import { bindStartupReadiness, prepareStartupAudio } from './session/startup-readiness.js';
import { openMultiplayerEntry } from './session/multiplayer-entry.js';
import { createStrikeController } from './controllers/strike-controller.js';
import { createActionRouter } from './controllers/action-router.js';
import { createCampaignActions, browserCampaignFiles } from './session/campaign-actions.js';
import { createArmyNavigation } from './controllers/army-navigation.js';
import { bindPointerActivity, bindMinimap, bindPageLifecycle } from './input/browser-events.js';
import { createKeyboardController, bindKeyboard } from './input/keyboard.js';
import { loadCampaign, loadSettings, createCampaignStore } from './session/campaign-store.js';
import { setArmyContextVisible } from './army-controls.js';
import { armyTargetRequest, updateArmyRecruitment } from './army-recruitment.js';
import { updateDeploymentHUD, renderSquadRoster, toggleSquadRoster } from './deployment.js';
import {
  factoryPlanRequest,
  loadFactoryPlanFields,
  updateFactoryPlansPanel,
} from './factory-plans.js';
import { MultiplayerUI } from './multiplayer.js';
import { DistrictHUD } from './districts.js';
import { updateSettlementList } from './settlements.js';
import { FrontlineHUD } from './frontline.js';
import { executeCommand } from '../network/commands.js';
import { $, num, time, rate, escape, price, deliveryText } from './format.js';
import { icon, short } from './icons.js';
import { gameLayout } from './layout.js';
import { panelHTML } from './panels.js';
import { renderInspector as renderInspectorView } from './inspector.js';
import * as E from '../game/index.js';
import { RTSWorld } from '../rendering/world.js';
import { GameAudio } from '../audio/game-audio.js';
// Access storage lazily: disabled browser storage must still reach the load fallback.
const storage = {
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
};
let { state, resumed, loadNotice } = loadCampaign(storage, E);
const settings = loadSettings(storage);
let world,
  lobby,
  started = false,
  paused = true,
  tab = 'city',
  tool = null,
  selected = null,
  panel = null,
  target = 'point',
  acc = 0,
  saveTimer = 0,
  uiTimer = 0,
  pointerBusy = false,
  defenseAttackPending = false,
  lastResult = null,
  toastTimer,
  lastRaid = -10,
  armySelection = [],
  troopMode = null,
  rallyId = null,
  recruitCount = 1,
  deployKey = null,
  deployPlan = null,
  deployPoint = null,
  deployHoverAt = 0,
  armyCategory = 'infantry',
  network = null,
  soloBackup = null,
  networkApplied = false,
  soloStarted = false,
  soloPaused = true,
  interactionRevision = 0,
  campaignEpoch = 0;
const audio = new GameAudio();
const uiRefresh = createFrameTasks();
const campaignStore = createCampaignStore({
  storage,
  game: E,
  notify: toast,
  reload: () => location.reload(),
});
const autosave = createAutosave({
  getState: () => state,
  getEpoch: () => campaignEpoch,
  getSession: () => network,
  isBlocked: () => campaignStore.replacing,
  persist: (current) => campaignStore.persist(current),
});
audio.set(settings.sound, settings.volume);
const armyNavigation = createArmyNavigation({
  game: E,
  getState: () => state,
  getSelection: () => armySelection,
  getWorld: () => world,
  selectArmy,
  toast,
});

const commandExecutor = createCommandExecutor({
  getState: () => state,
  getSession: () => network,
  getEpoch: () => campaignEpoch,
  executeLocal: executeCommand,
});
const strike = createStrikeController({
  game: E,
  getState: () => state,
  getWorld: () => world,
  getStarted: () => started,
  getRevision: () => interactionRevision,
  getEpoch: () => campaignEpoch,
  execute,
  home,
  persist,
  updateHUD,
  toast,
  document,
  query: $,
  interaction: {
    clearTroopTarget,
    clearArmySelection,
    openPanel,
    chooseBuild,
    getBuildTool: () => tool,
    clearInspection: () => {
      panel = null;
      selected = null;
      world.select(null);
      $('#panel').hidden = $('#inspector').hidden = true;
    },
  },
});
$('#app').innerHTML = gameLayout(resumed);
try {
  world = new RTSWorld($('#world'), state, {
    onFrame: frame,
    onAmbient: ambientAudio,
    onSelect: select,
    onSettlementSelect: select,
    onBoxSelect: selectArmy,
    onSelectSimilar: selectSimilar,
    onGroundOrder: commandGround,
    onGroundTarget: troopTarget,
    onGroundHover: previewDeployment,
    onGroundLine: defendLine,
    onAimPoint: chooseAimPoint,
    onAimHover: previewAimPoint,
    onBuild: place,
    onRoad: placeRoad,
    onCancelTool: cancelTool,
    onRoadPreview: previewRoad,
    onPlacementPreview: previewBuilding,
    onEvent: handleEvent,
    isNetwork: () => !!network,
    isModal: () => !started || panel === 'settings' || lobby?.host.hidden === false,
  });
} catch (e) {
  $('#welcome').innerHTML =
    `<h2>Не удалось включить 3D</h2><p>Откройте игру в Chrome или Edge с аппаратным ускорением.</p><small>${escape(e.message)}</small>`;
  throw e;
}
world.shakeStrength = settings.shake;
const startupStatus = document.createElement('div');
startupStatus.className = 'startup-status glass';
startupStatus.setAttribute('role', 'status');
startupStatus.innerHTML =
  '<span>Подготовка города…</span><progress aria-label="Подготовка города"></progress>';
$('#game').append(startupStatus);
const startup = bindStartupReadiness({
  button: $('#welcome [data-action="start"]'),
  status: startupStatus,
  warmup: Promise.allSettled([world.shaderWarmup, prepareStartupAudio(() => audio.prepare())]),
});
lobby = new MultiplayerUI({
  onEnter: enterNetwork,
  onState: applyNetworkState,
  onRoom: networkRoom,
  onLeave: leaveNetwork,
  pauseLocal: () => {
    if (!network) pause(true);
  },
});
const networkStatus = document.createElement('div');
const districtHUD = new DistrictHUD({
  canInteract: () =>
    started && !panel && !strike.model.aiming && !troopMode && !tool && lobby.host.hidden,
  onFocus: (id) => {
    const d = E.DISTRICT_BY_ID[id];
    if (d) {
      world.focus(d.x, d.z, 260);
      world.controls.focusInput();
    }
  },
  onCapture: orderDistrict,
  onRepair: repairDistrict,
});
const frontlineHUD = new FrontlineHUD({
  onFocus: (sector) => {
    world.focus(sector.x, sector.z, 300);
    world.controls.focusInput();
  },
  onVisibility: (visible) => world.setFrontlineVisible(visible),
});
networkStatus.id = 'network-status';
networkStatus.hidden = true;
$('#game').append(networkStatus);
// Start screen: game mode and bot difficulty. A running campaign keeps its own difficulty;
// the choice then applies to "new game".
let recruitMode = ['point', 'attack', 'defend'].includes(settings.recruitMode)
    ? settings.recruitMode
    : 'point',
  recruitPost = ['auto', 'north', 'south'].includes(settings.recruitPost)
    ? settings.recruitPost
    : 'auto';
let chosenDifficulty = E.DIFFICULTY[settings.difficulty] ? settings.difficulty : 'normal';
function renderWelcomeSetup() {
  const current = E.difficultyOf(state);
  $('#welcome-setup').innerHTML =
    `<div class="welcome-modes"><button class="active" data-welcome-mode="solo"><b>Одиночная игра</b><small>против бота</small></button><button data-action="network"><b>Сетевая игра</b><small>дуэль или команда</small></button></div>` +
    `<span class="welcome-label">${resumed ? 'Сложность новой игры' : 'Сложность бота'}</span><div class="difficulty-picker">${Object.entries(
      E.DIFFICULTY,
    )
      .map(
        ([key, d]) =>
          `<button data-difficulty="${key}" class="${key === chosenDifficulty ? 'active' : ''}" title="${d.description}">${d.name}<small>${d.bonus > 1 ? '+' + Math.round((d.bonus - 1) * 100) + '%' : '0%'}</small></button>`,
      )
      .join(
        '',
      )}</div><p class="small-muted">${E.DIFFICULTY[chosenDifficulty].description}${resumed ? `<br>Текущая кампания: ${current.name}.` : ''}<br>Одинаковый старт, реальное время.</p>`;
}
renderWelcomeSetup();
document.querySelector('.topline > span:last-child').id = 'opponent-rule';
renderOpponentRule();
renderGroups();
function execute(type, args) {
  return commandExecutor(type, args);
}
function home(side = 0) {
  return (
    state.buildings.find((b) => b.side === side && b.key === 'hq') || {
      x: side ? E.HQ_X : -E.HQ_X,
      z: 0,
    }
  );
}
function enterNetwork(session) {
  if (autosave.pending) flushPersistence();
  campaignEpoch++;
  defenseAttackPending = false;
  uiRefresh.clear();
  if (!soloBackup) {
    soloBackup = E.save(state);
    soloStarted = started;
    soloPaused = paused;
  }
  network = session;
  networkApplied = false;
  started = false;
  paused = true;
  acc = 0;
  cancelTool(true);
  $('#welcome').hidden = true;
  $('#result').hidden = true;
  lastResult = null;
  $('#pause').disabled = true;
  $('#opponent-rule').textContent = 'СЕТЕВАЯ СЕССИЯ';
}
function applyNetworkState(next, room) {
  if (!network) return;
  const firstSnapshot = !networkApplied;
  state = next;
  world.state = state;
  if (!networkApplied) {
    world.previousSimTime = state.time;
    world.battleTime = state.time;
    world.eventId = Math.max(0, ...state.events.map((e) => e.id));
    const own = home(),
      enemy = home(1);
    world.focus(own.x, own.z);
    strike.model.aimPoint = { x: enemy.x, z: enemy.z };
    networkApplied = true;
    started = true;
    renderOpponentRule();
    buildList();
  }
  networkRoom(room);
  // The render loop already synchronizes every visible frame. Network arrivals must not
  // trigger additional complete world passes between frames during a busy air battle.
  if (firstSnapshot) world.sync();
}
function networkRoom(room) {
  if (!network) return;
  paused = room.phase !== 'playing';
  $('#phase').textContent =
    {
      playing: 'СЕТЕВОЙ МАТЧ',
      waiting: 'КОМНАТА',
      disconnected: 'ОЖИДАНИЕ СВЯЗИ',
      finished: 'МАТЧ ЗАВЕРШЁН',
    }[room.phase] || 'СЕТЕВАЯ СЕССИЯ';
  $('#paused').hidden = room.phase !== 'disconnected';
  $('#paused').innerHTML = 'СВЯЗЬ ПОТЕРЯНА<small>Сервер ждёт возвращения игрока</small>';
  networkStatus.hidden = room.phase === 'waiting';
  networkStatus.textContent =
    room.phase === 'disconnected'
      ? 'Матч приостановлен · ожидаем подключение'
      : `Комната ${room.code} · ${network.latency == null ? 'подключено' : Math.round(network.latency) + ' мс'}`;
}
function leaveNetwork(message) {
  if (!soloBackup) {
    if (message) toast(message);
    return;
  }
  autosave.cancel();
  campaignEpoch++;
  defenseAttackPending = false;
  uiRefresh.clear();
  network = null;
  state = E.load(soloBackup);
  world.state = state;
  soloBackup = null;
  networkApplied = false;
  started = soloStarted;
  paused = soloPaused;
  acc = 0;
  lastResult = null;
  cancelTool(true);
  $('#result').hidden = true;
  $('#welcome').hidden = started;
  $('#pause').disabled = false;
  renderOpponentRule();
  $('#paused').innerHTML = 'ПАУЗА <small>пробел — продолжить</small>';
  networkStatus.hidden = true;
  world.previousSimTime = state.time;
  world.battleTime = state.time;
  world.eventId = Math.max(0, ...state.events.map((e) => e.id));
  const own = home();
  world.focus(own.x, own.z);
  pause(paused);
  buildList();
  updateHUD();
  world.sync();
  if (message) toast(message);
}
function ambientAudio() {
  if (!world) return;
  // A network view is always oriented so that the player's own side is 0.
  audio.update?.(state, world.camera, paused || !started, 0);
}
function toast(text, danger = false) {
  clearTimeout(toastTimer);
  $('#notice').hidden = false;
  $('#notice').classList.toggle('danger', danger);
  $('#notice').textContent = text;
  toastTimer = setTimeout(() => ($('#notice').hidden = true), 3600);
}
function persist() {
  autosave.request();
}
function flushPersistence() {
  autosave.flush();
}
function replaceCampaign(next) {
  campaignStore.replace(next, state, network, () => {
    autosave.cancel();
    uiRefresh.clear();
    started = false;
    paused = true;
    acc = 0;
  });
}
function saveSettings() {
  campaignStore.saveSettings(settings, audio);
}
function pause(value) {
  if (network) return;
  paused = value;
  $('#pause').textContent = value ? '▶' : 'Ⅱ';
  $('#paused').hidden = !value || !started;
  $('#phase').textContent = value ? 'ПАУЗА' : 'В РЕАЛЬНОМ ВРЕМЕНИ';
  acc = 0;
}
function renderOpponentRule() {
  const d =
    !started && !resumed && !network ? E.DIFFICULTY[chosenDifficulty] : E.difficultyOf(state);
  $('#opponent-rule').innerHTML =
    `${state.mode === 'multiplayer' ? 'ДУЭЛЬ · БЕЗ БОТОВ' : (state.sides.length === 4 ? 'ДВА БОТА: ' : 'БОТ: ') + d.name.toUpperCase()} <i>${state.mode !== 'multiplayer' && d.bonus > 1 ? 'ДОХОД +' + Math.round((d.bonus - 1) * 100) + '%' : 'БЕЗ БОНУСА'}</i>`;
}
function begin() {
  if (!startup.ready) return;
  // A fresh, untouched campaign takes the difficulty chosen on the start screen.
  if (!resumed && !network && state.time === 0) state.difficulty = chosenDifficulty;
  started = true;
  renderOpponentRule();
  $('#welcome').hidden = true;
  audio.unlock();
  pause(false);
  world.controls.focusInput();
  if (loadNotice) toast(loadNotice);
}
function frame(dt) {
  if (!world || campaignStore.replacing) return;
  if (network) {
    network.renderInto(state);
    world.simLead = 0;
  }
  if (!network && started && !paused && !state.result) {
    acc = advanceSimulationFrame(state, acc, dt, E.step).remainder;
    // Time already passed since the last step: effects draw moving rounds this far ahead.
    world.simLead = Math.min(acc, 0.05);
    saveTimer += dt;
    if (saveTimer >= 10) {
      persist();
      saveTimer = 0;
    }
  }
  uiTimer += dt;
  if (uiTimer > 0.35) {
    uiTimer = 0;
    // Do not stack every periodic DOM/minimap pass on one expensive army tick.
    // Closures read the current campaign/selection when executed, never a stale snapshot.
    uiRefresh.request({
      hud: updateHUD,
      panel: updateLivePanel,
      targeting: () => {
        if (strike.model.aiming) updateStrikeHUD();
        if (troopMode === 'deploy') previewDeployment(deployPoint, true);
      },
      inspection: () => {
        if (pointerBusy) return;
        if (armySelection.length) {
          const unitsById = new Map(state.groundUnits.map((u) => [u.id, u]));
          if (
            armySelection.some((id) => {
              const u = unitsById.get(id);
              return !u || u.hp <= 0 || u.carrierId;
            })
          )
            selectArmy(armySelection.filter((id) => unitsById.get(id)?.hp > 0));
        }
        if (selected) renderInspector();
      },
      minimap: () => world.updateMinimap($('#minimap')),
      groups: renderGroups,
    });
  }
  uiRefresh.runNext();
  if (state.result && !lastResult) {
    lastResult = state.result;
    persist();
    $('#result').hidden = false;
    $('#result').innerHTML =
      `<span class="eyebrow">${network ? 'МАТЧ ЗАВЕРШЁН' : 'КАМПАНИЯ ЗАВЕРШЕНА'}</span><h2>${state.result === 'victory' ? (state.sides.length === 4 ? 'Оба вражеских штаба уничтожены' : 'Командный пункт врага уничтожен') : state.sides.length === 4 ? 'Оба союзных штаба потеряны' : 'Ваш командный пункт потерян'}</h2><p>${time(state.time)} · Перехватов: ${state.sides[0].kills} · Дорог выведено из строя: ${state.stats.roadsCut}</p><button class="primary" data-action="${network ? 'network-leave' : 'new'}">${network ? 'Закрыть матч' : 'Новая кампания'}</button>`;
  }
}
function handleEvent(e) {
  const t = world?.controls.target;
  audio.play(
    e,
    t ? Math.hypot((e.x || 0) - t.x, (e.z || 0) - t.z) : 0,
    t
      ? (((e.x || 0) - t.x) * world.controls.right.x +
          ((e.z || 0) - t.z) * world.controls.right.z) /
          500
      : 0,
  );
  if (e.type === 'districtCaptured')
    toast(
      `${e.side === 0 ? 'Район захвачен' : 'Противник занял район'}: ${E.DISTRICT_BY_ID[e.districtId]?.name || ''}`,
      E.hostile(state, 0, e.side),
    );
  if (e.type === 'districtLost' && e.side === 0)
    toast('Контроль района потерян. Его доход остановлен.', true);
  if (e.type === 'districtDestroyed' && e.side === 0)
    toast('Инфраструктура района разрушена. Для дохода нужно восстановление.', true);
  if (e.type === 'roadCut' && e.side === 0)
    toast('Дорога перебита. Проверьте снабжение и начните ремонт.', true);
  if (e.type === 'salvo' && E.hostile(state, 0, e.side) && state.time - lastRaid > 10) {
    lastRaid = state.time;
    toast(`Налёт противника: ${e.count} целей`, true);
  }
}
function updateWeatherChip() {
  const chip = $('#weather-chip'),
    f = E.forecast(state),
    w = state.weather;
  if (!f || !w) return;
  const info = E.WEATHER[f.now],
    percent = Math.round((1 - w.visibility) * 100);
  chip.textContent =
    f.now === 'clear'
      ? `${info.name}${f.next && f.next !== 'clear' ? ' · далее: ' + E.WEATHER[f.next].name.toLowerCase() : ''}`
      : `${info.name} ${Math.round(f.amount * 100)}% · обзор −${percent}%`;
  chip.title = `Погода меняет обзор (−${percent}%), разброс (${w.spread.toFixed(2)}×) и скорость техники (${w.speed.toFixed(2)}×). Радар не страдает.`;
  chip.classList.toggle('online', f.now === 'clear');
}
function updateHUD() {
  updateBuildingPrices();
  updateWeatherChip();
  frontlineHUD.update(state, {
    visible: started && !panel && !strike.model.aiming && !troopMode && !tool && lobby.host.hidden,
  });
  districtHUD.update(
    state,
    armySelection,
    started && !panel && !strike.model.aiming && !troopMode && !tool && lobby.host.hidden,
  );
  const f = state.sides[0],
    e = E.economy(state, 0);
  $('#money').textContent = num(f.credits);
  $('#money-rate').textContent = rate(e.net) + '/мин';
  $('#metal').textContent = num(f.materials);
  $('#metal-rate').textContent = rate(e.materials) + '/мин';
  $('#oil').textContent = `${num(f.oil ?? 0)} / ${num(E.oilStorage(state, 0))}`;
  $('#oil-rate').textContent = rate(f.oilRate || 0) + '/мин';
  $('#components').textContent = num(f.components || 0) + ' эл.';
  $('#oil').parentElement.classList.toggle('low', (f.oil ?? 0) < 30);
  $('#power').textContent = `${Math.round(e.power)} / ${e.demand}`;
  $('#supply-status').textContent = e.isolated
    ? `Без снабжения: ${e.isolated}`
    : e.supply < 1
      ? `Нехватка мощности: ${Math.round(e.productivity * 100)}%`
      : 'Снабжение в норме';
  $('#supply-status').classList.toggle('warning', e.isolated > 0 || e.supply < 1);
  const day = E.dayPhase(state.time);
  $('#clock').textContent =
    `${String(Math.floor(day.hour)).padStart(2, '0')}:${String(Math.floor((day.hour % 1) * 60)).padStart(2, '0')}`;
  $('#clock').title = 'Время кампании ' + time(state.time);
  if (!paused)
    $('#phase').textContent =
      day.daylight > 0.4 ? 'ДЕНЬ' : day.daylight > 0.05 ? 'СУМЕРКИ' : 'НОЧЬ';
  $('#stock').textContent = Object.keys(E.WEAPONS).reduce(
    (total, key) => total + E.weaponStock(state, 0, key),
    0,
  );
  $('#sound').style.opacity = settings.sound ? '1' : '.4';
  const warning = E.radarAirWarning?.(state, 0);
  const inbound = Math.max(
    warning?.targets || 0,
    state.units.filter((u) => E.hostile(state, 0, u.side) && E.unitVisible(state, 0, u)).length,
  );
  if (inbound && state.time - lastRaid > 12) {
    lastRaid = state.time;
    toast(`Обнаружены воздушные цели: ${inbound}`, true);
  }
  $('#mission').textContent = inbound
    ? `Воздушная тревога: ${inbound}${warning?.bearing ? ` · ${warning.bearing}` : ''}${warning?.eta != null ? ` · подход ≈${Math.ceil(warning.eta)} с` : ''}${warning?.rangeBonus > 0 ? ` · Радар: ПВО +${Math.round((warning.rangeBonus || 0) * 100)}% дальности` : ''}`
    : `${state.sides.length === 4 ? 'Два союзных города против двух ботов. Уничтожьте оба вражеских штаба.' : 'Уничтожьте штаб врага.'} Склады: ${e.districts.owned}/${E.DISTRICTS.length} · работают ${e.districts.active}.`;
}
function updateBuildingPrices() {
  for (const button of document.querySelectorAll('[data-build]')) {
    const key = button.dataset.build,
      d = E.BUILDINGS[key];
    if (!d) continue;
    const quote = E.purchaseQuote(state, 0, 'building', key);
    let label = button.querySelector('small');
    if (!label) {
      label = document.createElement('small');
      button.append(label);
    }
    label.textContent = price(quote);
    button.dataset.priceFactor = quote.factor;
    button.title = `${d.description || d.name} Цена ${Math.round(quote.factor * 100)}% базовой; растёт только у этого типа зданий, максимум 150%.`;
  }
}
function buildList() {
  const keys =
    tab === 'city'
      ? ['road', 'housing', 'industry', 'power', 'market', 'service']
      : tab === 'oil'
        ? ['oilwell', 'oiltank', 'port', 'electronics']
        : tab === 'army'
          ? ['barracks', 'vehiclebase', 'training', 'ammofactory']
          : ['factory', 'launcher', 'silo', 'gun', 'sam', 'radar'];
  $('#build-list').innerHTML =
    keys
      .map((key) => {
        const d = E.BUILDINGS[key];
        return `<button data-build="${key}" class="build-card ${tool === key ? 'selected' : ''}" title="${escape(d?.description || 'Связанная дорожная сеть снабжает город. Кликните начало и конец или протяните мышью.')}" aria-label="${d?.name || 'Дорога'}">${icon(key)}<span>${short[key] || d?.name}<small>${d ? `${price(d)}` : '0,8 ₡ / м'}</small></span></button>`;
      })
      .join('') +
    (tab === 'army'
      ? '<button class="build-card" data-panel="army"><span>Набор войск →<small>Пехота · техника · ПВО</small></span></button><button class="build-card" data-action="army-all"><span>Выбрать армию<small>Ctrl+A · все войска</small></span></button>'
      : '');
  updateBuildingPrices();
}
function clearArmySelection() {
  interactionRevision++;
  armySelection = [];
  world.setArmySelection([]);
  setArmyContextVisible(false);
}
function clearTroopTarget() {
  interactionRevision++;
  troopMode = null;
  deployKey = null;
  deployPlan = null;
  updateDeploymentHUD(state, null);
  world.setGroundTargeting(null);
  $('#mode-status').textContent = 'ПКМ — приказ · зажать ПКМ — ракурс · Esc — отмена';
}
function setTroopTarget(mode) {
  interactionRevision++;
  troopMode = mode;
  districtHUD.host.hidden = true;
  world.setGroundTargeting(mode);
  $('#mode-status').textContent =
    ({
      defendline: 'Линия обороны · проведите ЛКМ',
      attackmove: 'Наступление · ЛКМ по карте',
      board: 'Посадка · ЛКМ по своему БТР',
      fpv: 'FPV · ЛКМ по цели',
      rally: 'Точка сбора · ЛКМ по карте',
      deliver: 'Доставка пехоты · ЛКМ по точке высадки',
      deploy: 'Пополнение · ЛКМ — место назначения',
    }[mode] || '') + ' · ПКМ / Esc — отмена';
}
function chooseBuild(key) {
  const d = E.BUILDINGS[key];
  clearTroopTarget();
  clearArmySelection();
  $('#tool-note').classList.remove('warning');
  tool = tool === key ? null : key;
  if (tool) districtHUD.host.hidden = true;
  strike.model.aiming = false;
  $('#strike-controls').hidden = true;
  world.setAiming(false);
  world.setOrderPreview(null);
  selected = null;
  panel = null;
  $('#panel').hidden = $('#inspector').hidden = true;
  world.select(null);
  world.setBuild(tool);
  $('#world').classList.remove('aiming');
  $('#mode-status').textContent =
    tool === 'road'
      ? 'Дорога: клики или протягивание · Shift — ровно · Esc — закончить'
      : tool
        ? `${d.name}: ЛКМ — построить · R — повернуть · Esc — отменить`
        : 'WASD · ПКМ — ракурс · колесо — масштаб';
  $('#tool-note').textContent =
    tool === 'road'
      ? 'Начните от существующей улицы. После постройки можно продолжить следующий участок.'
      : tool
        ? d.description
        : 'Экономика работает на 100% при подключении к штабу дорогой.';
  buildList();
}
function cancelTool(all = false) {
  clearTroopTarget();
  if (tool) {
    if (!all && world?.cancelRoad()) return;
    const old = tool;
    chooseBuild(old);
  }
  strike.model.aiming = false;
  world.setAiming(false);
  world.setOrderPreview(null);
  $('#strike-controls').hidden = true;
  $('#world').classList.remove('aiming');
  $('#mode-status').textContent = 'WASD · ПКМ — убрать / вращать · колесо — масштаб';
  if (all) {
    clearArmySelection();
    strike.model.routeEditing = false;
    panel = null;
    selected = null;
    world.select(null);
    $('#panel').hidden = $('#inspector').hidden = true;
  }
}
function previewRoad(p) {
  if (!p) {
    $('#tool-note').textContent = 'Выберите начало улицы';
    return;
  }
  const snap =
    p.snap === 'guide'
      ? ' · параллельно улице'
      : p.snap === 'angle'
        ? ' · угол ' + Math.round(p.angle) + '°'
        : p.snap === 'junction' || p.snap === 'end'
          ? ' · примыкание'
          : '';
  $('#tool-note').textContent =
    p.error ||
    `Длина ${Math.round(p.length)} м${snap} · стоимость ${p.cost} ₡ · ЛКМ — продолжить улицу · Shift — строго по сетке`;
  $('#tool-note').classList.toggle('warning', !!p.error);
}
function previewBuilding(plan) {
  if (!tool || tool === 'road') return;
  const d = E.BUILDINGS[tool];
  const quote = E.purchaseQuote(state, 0, 'building', tool);
  $('#tool-note').textContent =
    plan.error ||
    `${d.name} · ${price({ ...quote, cost: quote.cost + (plan.driveCost || 0) })} · ${d.time} сек.${plan.near ? ' · подъезд подключится автоматически' : ''}`;
  $('#tool-note').classList.toggle('warning', !!plan.error);
}
async function place(key, x, z, rotation) {
  if (!started) return;
  const b = await execute('build', { key, x, z, rotation });
  if (typeof b === 'string') {
    toast(b, true);
    return;
  }
  persist();
  updateHUD();
}
async function placeRoad(a, b) {
  if (!started) return false;
  const r = await execute('road', { a, b });
  if (typeof r === 'string') {
    toast(r, true);
    return false;
  }
  persist();
  return true;
}
function attackAim() {
  return strike.attackAim();
}
function refreshOrderPreview() {
  return strike.refreshOrderPreview();
}
function previewAimPoint(point) {
  return strike.previewAimPoint(point);
}
function updateSiteSelect(select) {
  return strike.updateSiteSelect(select);
}
function updateStrikeHUD() {
  return strike.updateStrikeHUD();
}
function armStrike(key = strike.model.weapon) {
  return strike.armStrike(key);
}
function chooseAimPoint(point, modifiers = {}) {
  return strike.chooseAimPoint(point, modifiers);
}
function selectArmy(ids, extend = false) {
  clearTroopTarget();
  const valid = resolveArmySelection(state, ids);
  armySelection = extend ? [...new Set([...armySelection, ...valid])] : valid;
  if (tool) {
    const old = tool;
    chooseBuild(old);
    armySelection = valid;
  }
  strike.model.aiming = false;
  world.setAiming(false);
  $('#strike-controls').hidden = true;
  world.setOrderPreview(null);
  selected = armySelection[0] ?? null;
  world.setArmySelection(armySelection);
  world.select(selected);
  panel = null;
  $('#panel').hidden = true;
  if (selected) renderInspector();
  else {
    $('#inspector').hidden = true;
    setArmyContextVisible(false);
  }
  renderGroups();
  $('#mode-status').textContent = 'Рамка / карточка — выбрать отряд · ПКМ — приказ';
}
function renderGroups() {
  renderSquadRoster(state, armySelection);
}
function focusUnits(ids, distance = null) {
  return armyNavigation.focusUnits(ids, distance);
}
function cycleArmy(step) {
  return armyNavigation.cycleArmy(step);
}
function nextIdleUnit() {
  return armyNavigation.nextIdleUnit();
}
function selectSimilar(id, extend = false) {
  return armyNavigation.selectSimilar(id, extend);
}
function beginDeployment(key) {
  if (!E.GROUND_UNITS[key]) return;
  cancelTool(true);
  deployKey = key;
  deployPoint = null;
  setTroopTarget('deploy');
  updateDeploymentHUD(state, deployKey, recruitCount, null);
  world.controls.focusInput();
}
function previewDeployment(point, force = false) {
  if (troopMode !== 'deploy' || !deployKey) return;
  if (point) deployPoint = { x: point.x, z: point.z };
  const now = performance.now();
  if (!force && now - deployHoverAt < 100) return;
  deployHoverAt = now;
  deployPlan = deployPoint
    ? E.deploymentPlan(state, 0, deployKey, deployPoint, recruitCount)
    : null;
  world.deploymentPreview.set(deployPlan);
  updateDeploymentHUD(state, deployKey, recruitCount, deployPlan);
}
async function deployAt(point) {
  const revision = interactionRevision;
  const key = deployKey;
  const plan = E.deploymentPlan(state, 0, key, point, recruitCount);
  if (!plan.ok) {
    toast(plan.reason, true);
    previewDeployment(point, true);
    return;
  }
  const result = await execute('deploy', { key, point: plan.point, count: recruitCount });
  if (revision !== interactionRevision) return;
  if (!result || typeof result === 'string')
    toast(typeof result === 'string' ? result : 'Не удалось назначить пополнение', true);
  else {
    toast(`${E.GROUND_UNITS[key].name} ×${result.count}: подготовка → выбранная точка`);
    persist();
    renderGroups();
    updateHUD();
  }
  previewDeployment(point, true);
}
async function commandGround(p) {
  if (!started || !armySelection.length) return;
  const revision = interactionRevision,
    issuedMode = troopMode;
  const r = p.append
    ? await execute('route-add', {
        ids: [...armySelection],
        aim: { x: p.x, z: p.z, mode: p.targetId ? 'attackmove' : 'move' },
      })
    : p.districtId
      ? await execute('district', { ids: [...armySelection], id: p.districtId })
      : p.boardId
        ? await execute('board', { ids: [...armySelection], id: p.boardId })
        : await execute('order', {
            ids: [...armySelection],
            aim: {
              ...p,
              mode: issuedMode === 'attackmove' ? 'attackmove' : p.targetId ? 'attack' : 'move',
            },
          });
  if (revision !== interactionRevision) return;
  if (typeof r === 'string') toast(r, true);
  else {
    toast(
      p.append
        ? `Точка добавлена в маршрут: ${r} ед. · Shift+ПКМ — следующая`
        : p.districtId
          ? 'Войска направлены захватывать и охранять район'
          : p.boardId
            ? 'Бойцы направляются к транспорту'
            : `Приказ: ${r} ед. → ${Math.round(p.x)}, ${Math.round(p.z)}${r >= 16 ? ' · маршруты готовятся по очереди' : ''}`,
    );
    if (issuedMode === 'attackmove') clearTroopTarget();
    persist();
    renderInspector();
  }
}
async function troopTarget(p) {
  const revision = interactionRevision,
    issuedMode = troopMode;
  let result;
  if (troopMode === 'deploy') {
    await deployAt(p);
    return;
  }
  if (troopMode === 'rally') result = await execute('rally', { id: rallyId, point: p });
  else if (troopMode === 'fpv')
    result = await execute('fpv', { ids: [...armySelection], point: p });
  else if (troopMode === 'board') {
    const vehicle = state.groundUnits.filter(
      (u) =>
        u.side === 0 && E.GROUND_UNITS[u.key]?.capacity && Math.hypot(u.x - p.x, u.z - p.z) < 18,
    )[0];
    result = vehicle
      ? await execute('board', { ids: [...armySelection], id: vehicle.id })
      : 'Нажмите рядом со своим бронетранспортёром';
  } else if (troopMode === 'deliver') {
    const carrier = state.groundUnits.find(
      (u) => armySelection.includes(u.id) && u.side === 0 && E.GROUND_UNITS[u.key].capacity,
    );
    result = carrier
      ? await execute('deliver', { id: carrier.id, point: p })
      : 'Выберите свой БТР с пассажирами';
  } else if (troopMode === 'attackmove') {
    commandGround(p);
    return;
  }
  if (revision !== interactionRevision) return;
  if (typeof result === 'string') {
    toast(result, true);
    return;
  }
  toast(
    issuedMode === 'rally'
      ? 'Точка сбора установлена'
      : issuedMode === 'fpv'
        ? 'FPV запущен'
        : issuedMode === 'deliver'
          ? 'Доставка назначена. БТР высадит бойцов по прибытии.'
          : 'Приказ посадки принят',
  );
  clearTroopTarget();
  persist();
  renderInspector();
}
function stanceFor(mode, post) {
  return mode === 'attack' ? { mode: 'attack' } : { mode: 'defend', post };
}
async function recruitWithStance(key) {
  if (recruitMode === 'defend') {
    const target = E.armyCompositionStatus(state, 0).targets[key] || 0;
    const epoch = campaignEpoch;
    const result = await execute('army-target', { key, count: target + recruitCount });
    if (epoch !== campaignEpoch) return;
    if (typeof result === 'string') toast(result, true);
    else {
      persist();
      updateLivePanel();
      toast(`${E.GROUND_UNITS[key].name}: цель обороны ${target + recruitCount}`);
    }
    return;
  }
  const revision = interactionRevision,
    stance = stanceFor(recruitMode, recruitPost),
    result = await execute('recruit', { key, count: recruitCount, stance });
  if (revision !== interactionRevision) return;
  if (result !== true) toast(typeof result === 'string' ? result : 'Не удалось нанять', true);
  else {
    toast(
      `${E.GROUND_UNITS[key].name} ×${recruitCount}: ${
        recruitMode === 'attack'
          ? 'пойдут в атаку'
          : 'займут ' + (E.POST_NAMES[recruitPost] || 'коридор')
      } после подготовки`,
    );
    persist();
    renderGroups();
    updateHUD();
  }
}
async function setStance(mode) {
  if (!armySelection.length) return;
  const revision = interactionRevision,
    select = $('#stance-post'),
    stance = stanceFor(mode, select?.value || 'auto'),
    result = await execute('set-stance', { ids: [...armySelection], stance });
  if (revision !== interactionRevision) return;
  if (typeof result === 'string') toast(result, true);
  else {
    toast(
      mode === 'attack'
        ? `Атака: ${result} ед. идут на штаб противника`
        : `Оборона: ${result} ед. занимают коридор`,
    );
    persist();
    renderInspector();
  }
}
async function troopCommand(command) {
  clearTroopTarget();
  const revision = interactionRevision;
  if (command === 'defendline') {
    setTroopTarget(command);
    toast('Зажмите ЛКМ и проведите линию обороны. ПКМ — отмена.');
    return;
  }
  if (command === 'guard') {
    const result = await execute('guard', { ids: [...armySelection], here: true });
    if (revision !== interactionRevision) return;
    const assigned = typeof result === 'number' ? result : 0;
    toast(assigned ? `Охрана позиций: ${assigned} ед.` : 'Нет доступных бойцов', !assigned);
    persist();
    renderInspector();
    return;
  }
  if (
    command === 'fpv' ||
    command === 'board' ||
    command === 'attackmove' ||
    command === 'deliver'
  ) {
    setTroopTarget(command);
    toast(
      command === 'fpv'
        ? 'ЛКМ — точка удара FPV в радиусе 320'
        : command === 'board'
          ? 'ЛКМ по своему бронетранспортёру'
          : command === 'deliver'
            ? 'ЛКМ — точка доставки и автоматической высадки'
            : 'ЛКМ — наступать, останавливаясь для боя',
    );
    return;
  }
  const r = await execute('stance', { ids: [...armySelection], command });
  if (revision !== interactionRevision) return;
  if (typeof r === 'string') toast(r, true);
  else {
    persist();
    renderInspector();
  }
}

async function orderDistrict(id) {
  if (!started || !armySelection.length) return;
  clearTroopTarget();
  const revision = interactionRevision;
  const result = await execute('district', { id, ids: [...armySelection] });
  if (typeof result !== 'string') persist();
  if (revision !== interactionRevision) return;
  toast(
    typeof result === 'string' ? result : `К району направлено ${result} ед. · захватывает пехота`,
    typeof result === 'string',
  );
  renderInspector();
}
async function repairDistrict(id) {
  const epoch = campaignEpoch,
    d = E.districtStatus(state, id);
  if (!d) return;
  const result = await execute('district-repair', { id, enabled: !d.repairing });
  if (epoch !== campaignEpoch) return;
  if (typeof result === 'string') toast(result, true);
  else {
    persist();
    updateHUD();
  }
}

async function defendLine(a, b) {
  if (troopMode !== 'defendline' || !a || !b) return;
  if (Math.hypot(a.x - b.x, a.z - b.z) < 8) {
    toast('Проведите линию, удерживая ЛКМ');
    return;
  }
  const revision = interactionRevision;
  const result = await execute('defend-line', { ids: [...armySelection], a, b });
  if (revision !== interactionRevision) return;
  if (typeof result === 'string') {
    toast(result, true);
    return;
  }
  toast(`Линия обороны: ${result} из ${armySelection.length} ед. · недоступные места пропущены`);
  clearTroopTarget();
  persist();
  renderInspector();
}

function select(id, extend = false) {
  const settlement = E.settlementStatus(state, id);
  if (settlement) {
    if (strike.model.aiming) {
      chooseAimPoint({ x: settlement.x, z: settlement.z });
      return;
    }
    clearArmySelection();
    selected = selected === id ? null : id;
    world.select(null);
    panel = null;
    $('#panel').hidden = true;
    renderInspector();
    return;
  }
  const passenger = state.groundUnits.find((u) => u.id === id && u.side === 0 && u.carrierId);
  if (passenger) id = passenger.carrierId;
  const t = E.observedTarget(state, 0, id);
  if (strike.model.aiming) {
    if (t) chooseAimPoint(t);
    return;
  }
  if (tool) chooseBuild(tool);
  if (t?.ground && t.side === 0) {
    const ids =
      !extend && t.squadId
        ? E.squadRoster(state, 0).find((g) => g.id === t.squadId)?.ids || [id]
        : [id];
    selectArmy(ids, extend);
    return;
  }
  clearArmySelection();
  if (selected === id) {
    id = null;
    selected = null;
    world.select(null);
    $('#inspector').hidden = true;
    return;
  }
  selected = id;
  world.select(id);
  if (!t) {
    $('#inspector').hidden = true;
    return;
  }
  if (E.hostile(state, 0, t.side) && t.hp > 0 && !t.fieldCrate) {
    strike.model.aimPoint = { x: t.x, z: t.z };
    openPanel('attack', true);
    return;
  }
  panel = null;
  world.setOrderPreview(null);
  $('#panel').hidden = true;
  renderInspector();
}
function renderInspector() {
  renderInspectorView({ state, selected, armySelection });
}

function openPanel(name, force = false) {
  clearTroopTarget();
  clearArmySelection();
  if (tool) chooseBuild(tool);
  strike.model.aiming = false;
  $('#strike-controls').hidden = true;
  world.setAiming(false);
  world.setOrderPreview(null);
  $('#world').classList.remove('aiming');
  selected = null;
  world.select(null);
  $('#inspector').hidden = true;
  panel = !force && panel === name ? null : name;
  $('#panel').hidden = !panel;
  if (panel) renderPanel();
  else world.controls.focusInput();
}
function renderPanel() {
  if (!panel) return;
  $('#panel').classList.toggle('army-panel', panel === 'army');
  $('#panel').innerHTML = panelHTML({
    panel,
    weapon: strike.model.weapon,
    count: strike.model.count,
    settings,
    state,
    armyCategory,
    recruitCount,
    recruitMode,
    recruitPost,
  });
  if (panel === 'settings') {
    $('#panel .settings-list').insertAdjacentHTML(
      'afterbegin',
      '<button data-action="network">Сетевая дуэль / комната</button>' +
        (network ? '<button data-action="network-leave">Завершить сетевую сессию</button>' : ''),
    );
    if (network) {
      for (const button of $('#panel').querySelectorAll(
        '[data-action="export"],[data-action="import"],[data-action="new-confirm"]',
      ))
        button.disabled = true;
      $('#panel .small-muted').textContent =
        'Сетевой матч продолжается при скрытии вкладки. При разрыве связи сервер приостанавливает бой. Локальная кампания сохранена отдельно.';
    }
  }
  if (panel === 'attack') updateTargets();
  updateLivePanel();
}
function updateTargets() {
  const select = $('#attack-target');
  if (!select) return;
  const options = E.knownTargets(state, 0),
    sig = options.map((t) => t.id).join(',');
  if (select.dataset.signature !== sig) {
    select.innerHTML =
      '<option value="point">Свободная точка на карте</option>' +
      options.map((t) => `<option value="${t.id}">${E.targetName(t)} #${t.id}</option>`).join('');
    select.dataset.signature = sig;
  }
  select.value = 'point';
  updateSiteSelect($('#launch-site'));
}
function updateLivePanel() {
  if (!panel || pointerBusy) return;
  const f = state.sides[0];
  if (panel === 'attack') {
    updateTargets();
    const factories = state.buildings.filter(
      (b) => b.side === 0 && b.key === 'factory' && b.hp > 0 && !b.demolished,
    );
    const facility = factories.some((b) => b.progress >= 1);
    const factoryQueue = factories.reduce((n, b) => n + (b.queue?.length || 0), 0);
    for (const key of Object.keys(E.WEAPONS)) {
      const stock = $(`[data-stock="${key}"]`);
      if (stock) {
        stock.textContent = E.weaponStock(state, 0, key);
        stock.title = `Общий склад: ${f.inventory[key] || 0}. Всего включает площадки и груз в пути. Для пуска нужен местный запас.`;
      }
      const row = $(`[data-row="${key}"]`);
      row?.classList.toggle('chosen', strike.model.weapon === key);
      const quote = E.purchaseQuote(state, 0, 'weapon', key);
      $(`[data-produce="${key}"]`).disabled =
        !!state.result ||
        !facility ||
        factoryQueue >= 24 ||
        f.credits < quote.cost ||
        f.materials < quote.metal ||
        (f.oil || 0) < quote.oil ||
        (f.components || 0) < (quote.components || 0);
      $(`[data-weapon="${key}"] small`).textContent = `${price(quote)} · ${E.WEAPONS[key].time} с`;
      $(`[data-weapon="${key}"]`).disabled = false;
    }
    $('#queue-status').textContent = factories.length
      ? factories
          .map((b) =>
            b.progress < 1
              ? 'База дронов строится'
              : b.queue?.length
                ? `${E.WEAPONS[b.queue[0].key].name}: ${Math.floor(b.queue[0].progress * 100)}% · в очереди ${b.queue.length}`
                : 'База дронов свободна',
          )
          .join(' · ')
      : 'Для производства нужна база дронов';
    const error = E.launchStatus(
      state,
      0,
      strike.model.weapon,
      attackAim(),
      strike.model.launcherId,
    );
    $('#launch-button').textContent =
      'Наводить: ' + E.WEAPONS[strike.model.weapon].name.toLowerCase();
    $('#launch-button').disabled = false;
    $('#route-status').textContent =
      `Радиус ${E.WEAPONS[strike.model.weapon].blast} · ${strike.model.count} за клик · очередь площадки до 12`;
    const launchSite = E.selectedLaunchSite(state, 0, strike.model.launcherId, strike.model.weapon);
    const delivery = launchSite && E.weaponDeliveryStatus?.(state, launchSite, strike.model.weapon);
    $('#launch-status').textContent = delivery
      ? deliveryText(delivery) + (error ? ` · ${error}` : '')
      : error || 'Выберите вооружение — затем цель на карте.';
    $('#launch-status').classList.toggle('warning', !!error);
    updateFactoryPlansPanel(state);
  }
  if (panel === 'army') {
    updateArmyRecruitment({
      state,
      recruitCount,
      recruitMode,
      defenseAttackPending: !!defenseAttackPending,
    });
  }
  if (panel === 'economy') {
    const e = E.economy(state, 0);
    $('#economy-values').innerHTML = [
      ['Доход до содержания', rate(e.gross) + ' ₡/мин'],
      ['Содержание', '−' + Math.round(e.upkeep * 60) + ' ₡/мин'],
      ['Чистый баланс', rate(e.net) + ' ₡/мин'],
      ['В том числе армия', '−' + Math.round(e.armyUpkeep * 60) + ' ₡/мин'],
      ['Население', e.population],
      ['Сплавы', rate(e.materials) + '/мин'],
      ['Электроника на складе', num(f.components || 0) + ' эл.'],
      [
        'Жители / рабочие места',
        `${e.commute.homes} / ${e.commute.jobs} · на работу ездят ${e.commute.employed}`,
      ],
      ['Доход от поездок на работу', '+' + rate(e.commute.income) + ' ₡/мин'],
      [
        'Торговля',
        (() => {
          const t = E.tradeReport(state, 0);
          return !t.markets
            ? 'нет рынка'
            : !t.partners
              ? 'ждём рынок партнёра'
              : `рынков ${t.markets} · караванов ${t.trips} · рейсов ${state.stats.trades || 0}`;
        })(),
      ],
      ['Районы под контролем / работают', `${e.districts.owned} / ${e.districts.active}`],
      [
        'Доход районов',
        `${rate(e.districts.income)} ₡ · ${rate(e.districts.materials)} спл. / мин`,
      ],
      ['Связаны со штабом', e.connected],
      ['Нет снабжения', e.isolated],
      ['Производство боеприпасов', num(f.ammoProductionSpent || 0) + ' ₡'],
    ]
      .map(([a, b]) => `<div class="stat"><span>${a}</span><b>${b}</b></div>`)
      .join('');
    const buildings = state.buildings.filter(
        (b) => b.side === 0 && b.hp > 0 && b.progress >= 1 && E.BUILDINGS[b.key],
      ),
      signature = buildings.map((b) => b.id).join(',');
    if ($('#economy-buildings').dataset.signature !== signature) {
      $('#economy-buildings').dataset.signature = signature;
      $('#economy-buildings').innerHTML =
        '<h3>Вклад работающих зданий / мин</h3>' +
        buildings
          .map(
            (b) =>
              `<button class="econ-building" data-unit="${b.id}"><span>${E.BUILDINGS[b.key].name} #${b.id}<small data-econ-status="${b.id}"></small></span><b data-econ-value="${b.id}"></b></button>`,
          )
          .join('');
    }
    for (const b of buildings) {
      const o = E.buildingOutput(state, b);
      $(`[data-econ-status="${b.id}"]`).textContent =
        `Выпуск ${Math.round(o.factor * 100)}% · дорога ${Math.round(o.road * 100)}%`;
      $(`[data-econ-value="${b.id}"]`).textContent = o.income
        ? rate(o.income) + ' ₡'
        : o.materials
          ? rate(o.materials) + ' спл.'
          : o.powerUse < 0
            ? Math.round(-o.powerUse * o.road * o.health) + ' МВт'
            : '−' + Math.round(o.upkeep * 60) + ' ₡';
    }
    updateSettlementList($('#economy-settlements'), state);
  }
}
const campaignActions = createCampaignActions({
  game: E,
  getState: () => state,
  isNetwork: () => !!network,
  getDifficulty: () => chosenDifficulty,
  persist: flushPersistence,
  replaceCampaign,
  toast,
  files: browserCampaignFiles({ document, input: $('#import-file') }),
});
// Add new data-action commands here; modules receive only their named ports.
const actionRouter = createActionRouter({
  ...campaignActions.actions,
  ...strike.actions,
  ...armyNavigation.actions,
  'army-stop': () => {
    troopCommand('stop');
  },
  'attack-recall': createAttackRecallAction({
    getEpoch: () => campaignEpoch,
    execute,
    persist,
    refresh: updateLivePanel,
    toast,
  }),
  'defense-attack': async (button) => {
    if (defenseAttackPending) return;
    const epoch = campaignEpoch;
    const pending = { epoch };
    defenseAttackPending = pending;
    button.disabled = true;
    button.dataset.pending = 'true';
    try {
      const result = await execute('defense-attack', {});
      if (epoch !== campaignEpoch) return;
      if (typeof result === 'string') toast(result, true);
      else {
        persist();
        toast(`В атаку выдвигаются ${result} бойцов. Остальные держат оборону.`);
      }
    } catch {
      if (epoch === campaignEpoch)
        toast('Не удалось отдать приказ. Повторите после восстановления связи.', true);
    } finally {
      if (defenseAttackPending === pending) defenseAttackPending = false;
      delete button.dataset.pending;
      if (epoch === campaignEpoch) updateLivePanel();
    }
  },
  network: () => {
    lobby.open();
  },
  'network-leave': () => {
    lobby.leave();
  },
  start: () => {
    begin();
  },
  pause: () => {
    if (started) {
      pause(!paused);
    }
  },
  sound: () => {
    settings.sound = !settings.sound;
    saveSettings();
    updateHUD();
  },
  home: () => {
    const own = home();
    world.focus(own.x, own.z);
  },
  enemy: () => {
    const enemy = home(1);
    world.focus(enemy.x, enemy.z);
  },
  'close-panel': () => {
    panel = null;
    world.setOrderPreview(null);
    $('#panel').hidden = true;
    world.controls.focusInput();
  },
  deselect: () => {
    clearTroopTarget();
    clearArmySelection();
    selected = null;
    world.select(null);
    $('#inspector').hidden = true;
  },
  'cancel-strike': () => {
    cancelTool(true);
  },
});

bindPointerActivity({
  document,
  window,
  setBusy: (value) => {
    pointerBusy = value;
  },
  unlockAudio: () => {
    if (startup.ready) audio.unlock();
  },
});
document.addEventListener('click', async (ev) => {
  const b = ev.target.closest('button');
  if (!b || b.disabled) return;
  const d = b.dataset;
  if (d.settlementFocus) {
    const site = E.settlementStatus(state, d.settlementFocus);
    if (site) {
      world.focus(site.x, site.z, 220);
      select(site.id);
    }
    return;
  }
  if (d.tab) {
    clearArmySelection();
    selected = null;
    world.select(null);
    $('#inspector').hidden = true;
    tab = d.tab;
    document.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('active', x === b));
    buildList();
  }
  if (d.build) chooseBuild(d.build);
  if (d.panel) {
    const b = E.targetById(state, selected);
    if (d.panel === 'attack' && b?.side === 0 && b.key === 'launcher')
      strike.model.launcherId = b.id;
    openPanel(d.panel);
  }
  if (d.difficulty && E.DIFFICULTY[d.difficulty]) {
    chosenDifficulty = d.difficulty;
    settings.difficulty = chosenDifficulty;
    saveSettings();
    renderWelcomeSetup();
    renderOpponentRule();
  }
  if (d.armyCategory) {
    armyCategory = d.armyCategory;
    renderPanel();
  }
  if (d.armyRole) {
    const ids = state.groundUnits
      .filter((u) => u.side === 0 && u.hp > 0 && u.key === d.armyRole)
      .map((u) => u.id);
    selectArmy(ids, ev.shiftKey);
    if (ev.detail === 2) focusUnits(ids);
  }
  if (d.action === 'roster-toggle') {
    toggleSquadRoster();
    renderGroups();
  }
  if (d.squad) {
    const ids = d.squad.startsWith('role-')
      ? state.groundUnits
          .filter((u) => u.side === 0 && u.hp > 0 && !u.squadId && u.key === d.squad.slice(5))
          .map((u) => u.id)
      : E.squadRoster(state, 0).find((g) => g.id === Number(d.squad))?.ids || [];
    if (ids.length) selectArmy(ids, ev.shiftKey);
    if (ids.length && ev.detail === 2) focusUnits(ids);
  }
  if (d.deployCount) {
    recruitCount = Number(d.deployCount);
    previewDeployment(deployPoint, true);
  }
  if (d.action === 'cancel-deploy') cancelTool(true);
  if (d.weapon) armStrike(d.weapon);
  if (d.unit) {
    select(Number(d.unit), ev.shiftKey);
    const t = E.targetById(state, Number(d.unit));
    if (t) world.focus(t.x, t.z, 300);
  }
  if (d.group) {
    const ids = E.getGroup(state, 0, Number(d.group));
    if (ids.length) selectArmy(ids, ev.shiftKey);
    else toast('Выделите бойцов и нажмите Ctrl+' + d.group);
    if (ids.length && ev.detail === 2) focusUnits(ids);
  }
  if (d.recruitCount) {
    recruitCount = Number(d.recruitCount);
    document
      .querySelectorAll('[data-recruit-count]')
      .forEach((b) =>
        b.classList.toggle('active', Number(b.dataset.recruitCount) === recruitCount),
      );
    updateLivePanel();
  }

  if (d.troop) troopCommand(d.troop);
  if (d.rally) {
    const site =
      d.rally === 'auto'
        ? state.buildings.find(
            (b) => b.side === 0 && b.key === 'barracks' && b.hp > 0 && b.progress >= 1,
          )
        : E.targetById(state, Number(d.rally));
    if (site) {
      rallyId = site.id;
      panel = null;
      $('#panel').hidden = true;
      setTroopTarget('rally');
      toast('ЛКМ — точка сбора новых бойцов, например в лесу');
    } else toast('Сначала постройте казармы', true);
  }
  if (d.redeploy) {
    const revision = interactionRevision;
    const id = await execute('redeploy', { id: Number(d.redeploy) });
    if (typeof id === 'number') {
      if (revision === interactionRevision) selectArmy([id]);
      persist();
    } else toast(id, true);
  }
  if (d.recruitMode) {
    recruitMode = d.recruitMode;
    settings.recruitMode = recruitMode;
    saveSettings();
    renderPanel();
  }
  if (d.stance) setStance(d.stance);
  if (d.recruit && recruitMode !== 'point') recruitWithStance(d.recruit);
  else if (d.recruit) {
    beginDeployment(d.recruit);
  }
  if (d.salvo) {
    strike.model.count = Number(d.salvo);
    updateStrikeHUD();
    void strike.requestSupply();
  }
  if (d.produce) {
    const r = await execute('produce', { key: d.produce });
    if (typeof r === 'string') toast(r, true);
    else {
      toast('Добавлено в очередь завода');
      persist();
      updateLivePanel();
    }
  }
  if (d.action === 'factory-plan-save' || d.action === 'factory-plan-stop') {
    const request = factoryPlanRequest(state, d.action === 'factory-plan-save');
    if (!request) return;
    const epoch = campaignEpoch;
    const result = await execute('factory-plan', request);
    if (epoch !== campaignEpoch) return;
    if (typeof result === 'string') toast(result, true);
    else {
      persist();
      updateLivePanel();
      toast(
        request.plan.enabled
          ? 'План пополнения боезапаса включён'
          : 'План остановлен; оплаченные заказы сохраняются',
      );
    }
  }

  if (d.serviceEnabled) {
    const epoch = campaignEpoch,
      revision = interactionRevision,
      enabled = d.enabled === 'true';
    const result = await execute('service-enabled', { id: Number(d.serviceEnabled), enabled });
    if (epoch !== campaignEpoch) return;
    if (typeof result === 'string') toast(result, true);
    else {
      persist();
      if (revision === interactionRevision) renderInspector();
    }
  }
  if (d.upgrade) {
    const epoch = campaignEpoch,
      revision = interactionRevision;
    b.disabled = true;
    const result = await execute('upgrade', { id: Number(d.upgrade) });
    if (epoch !== campaignEpoch) return;
    if (typeof result === 'string') toast(result, true);
    else persist();
    if (revision === interactionRevision) renderInspector();
  }
  if (d.action === 'support-auto') {
    const epoch = campaignEpoch,
      revision = interactionRevision;
    const result = await execute('support-auto', {
      ids: [...armySelection],
      enabled: d.enabled === 'true',
    });
    if (epoch !== campaignEpoch) return;
    if (typeof result === 'string') toast(result, true);
    else persist();
    if (revision === interactionRevision) renderInspector();
  }
  if (d.repair) {
    const r = await execute('repair', { id: Number(d.repair) });
    if (typeof r === 'string') toast(r, true);
    else {
      persist();
      renderInspector();
    }
  }
  if (d.demolish) {
    const result = await execute('demolish', { id: Number(d.demolish) });
    if (typeof result === 'string') {
      toast(result, true);
      return;
    }
    if (selected === Number(d.demolish)) {
      selected = null;
      world.select(null);
      $('#inspector').hidden = true;
    }
    persist();
  }
  const a = d.action;
  await actionRouter.dispatch(a, b, ev);
});
document.addEventListener('input', (ev) => {
  if (ev.target.id === 'shake') {
    settings.shake = Number(ev.target.value) / 100;
    world.shakeStrength = settings.shake;
    renderGroups();
    saveSettings();
  }
  if (ev.target.id === 'volume') {
    settings.volume = Number(ev.target.value) / 100;
    settings.sound = settings.volume > 0;
    saveSettings();
  }
  if (ev.target.id === 'salvo-count') {
    strike.model.count = Math.max(1, Math.min(6, Number(ev.target.value) || 1));
    updateLivePanel();
  }
});
document.addEventListener('change', async (ev) => {
  if (ev.target.dataset.armyTarget) {
    const input = ev.target,
      key = input.dataset.armyTarget;
    const request = armyTargetRequest(key, input.value);
    if (!request) {
      toast(`Цель состава — целое число от 0 до ${E.ARMY_TARGET_MAX}`, true);
      input.value = E.armyCompositionStatus(state, 0).targets[key] || 0;
      return;
    }
    const epoch = campaignEpoch,
      revision = interactionRevision;
    const requestId = String((Number(input.dataset.requestId) || 0) + 1);
    input.dataset.requestId = requestId;
    input.dataset.pending = 'true';
    const result = await execute('army-target', request);
    if (input.dataset.requestId !== requestId) return;
    delete input.dataset.pending;
    if (epoch !== campaignEpoch) return;
    if (typeof result !== 'string') persist();
    if (revision !== interactionRevision || !input.isConnected) return;
    const message = $('#composition-message');
    if (typeof result === 'string') {
      input.value = E.armyCompositionStatus(state, 0).targets[key] || 0;
      if (message) message.textContent = result;
      toast(result, true);
    } else if (message)
      message.textContent = `${E.GROUND_UNITS[key].name}: цель ${request.count}. Состав обновлён.`;
    updateLivePanel();
  }
  if (ev.target.id === 'factory-plan-site') {
    loadFactoryPlanFields(state);
    ev.target.dataset.loaded = ev.target.value;
    updateLivePanel();
  }
  if (ev.target.id === 'rally-mode') {
    const result = await execute('rally-mode', { id: selected, mode: ev.target.value });
    if (typeof result === 'string') toast(result, true);
    else persist();
  }
  if (ev.target.id === 'deployment-key') beginDeployment(ev.target.value);
  if (ev.target.id === 'rear-auto') {
    const result = await execute('rear-auto', { enabled: ev.target.checked });
    if (typeof result === 'string') toast(result, true);
    else {
      persist();
      toast(ev.target.checked ? 'Тыловая служба включена' : 'Тыловая служба выключена');
    }
  }
  if (ev.target.id === 'recruit-post') {
    recruitPost = ev.target.value;
    settings.recruitPost = recruitPost;
    saveSettings();
  }
  if (ev.target.id === 'stance-post' && armySelection.length) setStance('defend');

  if (ev.target.id === 'formation') {
    const result = await execute('formation', { value: ev.target.value });
    if (typeof result === 'string') toast(result, true);
    persist();
  }
  if (ev.target.id === 'strike-site') {
    strike.model.launcherId = ev.target.value === 'auto' ? null : Number(ev.target.value);
    updateStrikeHUD();
    refreshOrderPreview();
    void strike.requestSupply();
  }
  if (ev.target.id === 'launch-site') {
    strike.model.launcherId = ev.target.value === 'auto' ? null : Number(ev.target.value);
    updateLivePanel();
    void strike.requestSupply();
  }
  if (ev.target.id === 'attack-target') {
    const t = E.targetById(state, Number(ev.target.value));
    if (t) strike.model.aimPoint = { x: t.x, z: t.z };
    armStrike(strike.model.weapon);
  }
  if (ev.target.matches('select') && panel !== 'settings') world.controls.focusInput();
});
$('#import-file').addEventListener('change', campaignActions.importFile);
bindMinimap($('#minimap'), {
  focusInput: () => world.controls.focusInput(),
  // A map click changes viewpoint directly; flying across the entire map
  // repeatedly rendered high-resolution shadows for intermediate locations.
  focus: (x, z) => world.focus(x, z, undefined, { instant: true }),
  map: E.MAP,
});
const keyboard = createKeyboardController({
  getMode: () => ({
    started,
    panel,
    lobbyOpen: lobby?.host.hidden === false,
    tool,
    aiming: strike.model.aiming,
    armySelection,
    paused,
  }),
  focusInput: () => world.controls.focusInput(),
  army: {
    getGroup: (n) => E.getGroup(state, 0, n),
    saveGroup: (index, ids) =>
      execute('group', { index, ids }).then((result) => {
        if (typeof result === 'string') toast(result, true);
        else {
          persist();
          renderGroups();
          toast('Группа ' + index + ' сохранена');
        }
      }),
    clearArmySelection,
    clearTroopTarget,
    cycleArmy,
    nextIdleUnit,
    focusUnits,
    selectArmy,
    troopCommand,
    selectAll: () => armyNavigation.selectAll(),
  },
  tools: {
    cancelTool,
    pause,
    openPanel,
    chooseBuild,
    clearInspection: () => {
      panel = null;
      selected = null;
      world.setOrderPreview(null);
      world.select(null);
      $('#panel').hidden = $('#inspector').hidden = true;
    },
  },
  strike: {
    armStrike,
    finishRoute: strike.finishRoute,
    undoWaypoint: strike.undoWaypoint,
  },
});
bindKeyboard(window, keyboard);
bindPageLifecycle({
  document,
  window,
  resetAccumulator: () => {
    acc = 0;
  },
  focusAudio: (visible) => audio.focus(visible),
  hasStarted: () => started,
  persist: flushPersistence,
});
buildList();
updateHUD();
world.updateMinimap($('#minimap'));
window.skyfront = {
  command: execute,
  network: () =>
    network
      ? { side: network.side, room: structuredClone(network.room), latency: network.latency }
      : null,
  engine: E,
  getState: () => structuredClone(state),
  getWorld: () => world,
  diagnostics: () => world.diagnostics(),
  chooseBuild,
  select,
  openPanel,
  save: flushPersistence,
  isPaused: () => paused,
  getAudio: () => audio.diagnostics(),
  armStrike,
  commandGround,
  selectArmy,
  cycleArmy,
  nextIdleUnit,
  troopCommand,
  getOrder: () => ({
    troopMode,
    weapon: strike.model.weapon,
    waypoints: structuredClone(strike.model.waypoints),
    routeEditing: strike.model.routeEditing,
    armySelection: [...armySelection],
  }),
};
openMultiplayerEntry({ pageURL: location.href, lobby, onError: (message) => toast(message, true) });
