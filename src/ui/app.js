import { $, num, time, rate, escape } from './format.js';
import { icon, short } from './icons.js';
import { gameLayout } from './layout.js';
import { panelHTML } from './panels.js';
import { renderInspector as renderInspectorView } from './inspector.js';
import * as E from '../game/index.js';
import { RTSWorld } from '../rendering/world.js';
import { GameAudio } from '../audio/game-audio.js';
const SAVE = 'skyfront-realtime-v3',
  SETTINGS = 'skyfront-settings-v4';
let state,
  resumed = false,
  loadNotice = '';
try {
  const raw = localStorage.getItem(SAVE);
  if (raw) {
    state = E.load(raw);
    resumed = state.time > 0 || state.buildings.length > 2;
    if (JSON.parse(raw).version < 8) {
      localStorage.setItem(SAVE + '-before-infantry8', raw);
      loadNotice = 'Пехота и группы обновлены. Старые пушки заменены на МОГ с компенсацией.';
    }
    if (JSON.parse(raw).version === 6) {
      localStorage.setItem(SAVE + '-before-army7', raw);
      loadNotice = 'Кампания обновлена: армия, маршруты, перегрев ПВО и смена суток.';
    }
    if (JSON.parse(raw).version < 6) {
      localStorage.setItem(SAVE + '-before-combat6', raw);
      loadNotice =
        'Карта полностью открыта. Разведчики убраны, ресурсы возвращены. Сохранение обновлено.';
    }
    if (JSON.parse(raw).version === 4) {
      localStorage.setItem(SAVE + '-before-recon', raw);
    }
    if (JSON.parse(raw).version === 3) {
      localStorage.setItem(SAVE + '-before-roads', raw);
      loadNotice = 'Дорожная система обновлена. Подведите улицы к старым предприятиям.';
    }
  }
} catch {
  loadNotice = 'Не удалось прочитать кампанию. Предыдущее сохранение оставлено в браузере.';
}
state ||= E.createGame();
let settings = { sound: true, volume: 0.35, shake: 0.45 };
try {
  Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS) || '{}'));
} catch {}
let world,
  started = false,
  paused = true,
  replacingCampaign = false,
  tab = 'city',
  tool = null,
  selected = null,
  panel = null,
  weapon = 'drone',
  target = 'point',
  aimPoint = { x: 615, z: 0 },
  launcherId = null,
  count = 1,
  aiming = false,
  acc = 0,
  saveTimer = 0,
  uiTimer = 0,
  pointerBusy = false,
  lastResult = null,
  toastTimer,
  lastRaid = -10,
  waypoints = [],
  routeEditing = false,
  armySelection = [],
  troopMode = null,
  rallyId = null,
  recruitCount = 1;
const audio = new GameAudio();
audio.set(settings.sound, settings.volume);

$('#app').innerHTML = gameLayout(resumed);
try {
  world = new RTSWorld($('#world'), state, {
    onFrame: frame,
    onAmbient: ambientAudio,
    onSelect: select,
    onBoxSelect: selectArmy,
    onGroundOrder: commandGround,
    onGroundTarget: troopTarget,
    onAimPoint: chooseAimPoint,
    onAimHover: previewAimPoint,
    onBuild: place,
    onRoad: placeRoad,
    onCancelTool: cancelTool,
    onRoadPreview: previewRoad,
    onPlacementPreview: previewBuilding,
    onEvent: handleEvent,
    isModal: () => !started || panel === 'settings',
  });
} catch (e) {
  $('#welcome').innerHTML =
    `<h2>Не удалось включить 3D</h2><p>Откройте игру в Chrome или Edge с аппаратным ускорением.</p><small>${escape(e.message)}</small>`;
  throw e;
}
world.shakeStrength = settings.shake;
renderGroups();
function ambientAudio() {
  if (!world) return;
  audio.update?.(state, world.camera, paused || !started, world.controls.target);
}
function toast(text, danger = false) {
  clearTimeout(toastTimer);
  $('#notice').hidden = false;
  $('#notice').classList.toggle('danger', danger);
  $('#notice').textContent = text;
  toastTimer = setTimeout(() => ($('#notice').hidden = true), 3600);
}
function persist() {
  if (replacingCampaign) return;
  try {
    localStorage.setItem(SAVE, E.save(state));
  } catch {
    toast('Не удалось сохранить. Экспортируйте кампанию в настройках.', true);
  }
}
// Store the replacement before navigation. The old unload/autosave handlers must not restore the outgoing game.
function replaceCampaign(next) {
  if (replacingCampaign) return;
  try {
    const previous = E.save(state),
      replacement = E.save(next);
    localStorage.setItem(SAVE + '-backup', previous);
    localStorage.setItem(SAVE, replacement);
  } catch {
    toast(
      'Не удалось записать новую кампанию. Экспортируйте сохранение и проверьте доступ к хранилищу.',
      true,
    );
    return;
  }
  replacingCampaign = true;
  started = false;
  paused = true;
  acc = 0;
  location.reload();
}
function saveSettings() {
  localStorage.setItem(SETTINGS, JSON.stringify(settings));
  audio.set(settings.sound, settings.volume);
}
function pause(value) {
  paused = value;
  $('#pause').textContent = value ? '▶' : 'Ⅱ';
  $('#paused').hidden = !value || !started;
  $('#phase').textContent = value ? 'ПАУЗА' : 'В РЕАЛЬНОМ ВРЕМЕНИ';
  acc = 0;
}
function begin() {
  started = true;
  $('#welcome').hidden = true;
  audio.unlock();
  pause(false);
  world.controls.focusInput();
  if (loadNotice) toast(loadNotice);
}
function frame(dt) {
  if (!world || replacingCampaign) return;
  if (started && !paused && !state.result) {
    acc += dt;
    while (acc >= 0.05) {
      E.step(state, 0.05);
      acc -= 0.05;
    }
    saveTimer += dt;
    if (saveTimer >= 10) {
      persist();
      saveTimer = 0;
    }
  }
  uiTimer += dt;
  if (uiTimer > 0.35) {
    uiTimer = 0;
    updateHUD();
    updateLivePanel();
    if (aiming) updateStrikeHUD();
    if (selected && !pointerBusy) renderInspector();
    world.updateMinimap($('#minimap'));
    renderGroups();
    if (state.result && !lastResult) {
      lastResult = state.result;
      persist();
      $('#result').hidden = false;
      $('#result').innerHTML =
        `<span class="eyebrow">КАМПАНИЯ ЗАВЕРШЕНА</span><h2>${state.result === 'victory' ? 'Командный пункт врага уничтожен' : 'Ваш командный пункт потерян'}</h2><p>${time(state.time)} · Перехватов: ${state.sides[0].kills} · Дорог выведено из строя: ${state.stats.roadsCut}</p><button class="primary" data-action="new">Новая кампания</button>`;
    }
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
  if (e.type === 'roadCut' && e.side === 0)
    toast('Дорога перебита. Проверьте снабжение и начните ремонт.', true);
  if (e.type === 'salvo' && e.side === 1 && state.time - lastRaid > 10) {
    lastRaid = state.time;
    toast(`Налёт противника: ${e.count} целей`, true);
  }
  if (e.type === 'research' && e.side === 0) {
    toast(`Изучено: ${E.TECH[e.key].name}`);
    buildList();
    if (panel === 'research' && !pointerBusy) renderPanel();
  }
}
function updateHUD() {
  const f = state.sides[0],
    e = E.economy(state, 0);
  $('#money').textContent = num(f.credits);
  $('#money-rate').textContent = rate(e.net) + '/мин';
  $('#metal').textContent = num(f.materials);
  $('#metal-rate').textContent = rate(e.materials) + '/мин';
  $('#science').textContent = num(f.science);
  $('#science-rate').textContent = rate(e.science) + '/мин';
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
  $('#stock').textContent = Object.values(f.inventory).reduce((a, b) => a + b, 0);
  $('#sound').style.opacity = settings.sound ? '1' : '.4';
  const inbound = state.units.filter((u) => u.side === 1 && E.unitVisible(state, 0, u)).length;
  if (inbound && state.time - lastRaid > 12) {
    lastRaid = state.time;
    toast(`Обнаружены воздушные цели: ${inbound}`, true);
  }
  $('#mission').textContent = inbound
    ? `Воздушная тревога: ${inbound} целей. Прикройте снабжение и командный пункт.`
    : 'Уничтожьте командный пункт противника. Сохраните свой.';
}
function buildList() {
  const keys =
    tab === 'city'
      ? ['road', 'housing', 'industry', 'power', 'lab']
      : tab === 'army'
        ? ['barracks']
        : ['factory', 'launcher', 'gun', 'sam', 'radar'];
  $('#build-list').innerHTML =
    keys
      .map((key) => {
        const d = E.BUILDINGS[key],
          locked = d?.tech && !state.sides[0].tech.includes(d.tech);
        return `<button data-build="${key}" class="build-card ${tool === key ? 'selected' : ''} ${locked ? 'locked' : ''}" title="${escape(d?.description || 'Связанная дорожная сеть снабжает город. Кликните начало и конец или протяните мышью.')}" aria-label="${d?.name || 'Дорога'}">${icon(key)}<span>${short[key]}<small>${locked ? 'Исследование' : d ? `${d.cost} ₡ · ${d.metal} спл.` : '0,8 ₡ / м'}</small></span></button>`;
      })
      .join('') +
    (tab === 'army'
      ? Object.entries(E.GROUND_UNITS)
          .map(
            ([key, d]) =>
              `<button class="build-card" data-recruit="${key}" title="${d.role}"><span>${d.name}<small>${d.cost} ₡ · ${d.metal} спл.</small></span></button>`,
          )
          .join('') +
        '<button class="build-card" data-panel="army"><span>Отряды →<small>Приказы и очередь</small></span></button>'
      : '');
}
function clearTroopTarget() {
  troopMode = null;
  world.setGroundTargeting(null);
}
function chooseBuild(key) {
  clearTroopTarget();
  armySelection = [];
  world.setArmySelection([]);
  $('#tool-note').classList.remove('warning');
  const d = E.BUILDINGS[key];
  if (d?.tech && !state.sides[0].tech.includes(d.tech)) {
    openPanel('research');
    toast('Сначала изучите технологию');
    return;
  }
  tool = tool === key ? null : key;
  aiming = false;
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
  aiming = false;
  world.setAiming(false);
  world.setOrderPreview(null);
  $('#strike-controls').hidden = true;
  $('#world').classList.remove('aiming');
  $('#mode-status').textContent = 'WASD · ПКМ — убрать / вращать · колесо — масштаб';
  if (all) {
    armySelection = [];
    world.setArmySelection([]);
    routeEditing = false;
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
  $('#tool-note').textContent =
    p.error || `Длина ${Math.round(p.length)} · стоимость ${p.cost} ₡ · ЛКМ — продолжить улицу`;
  $('#tool-note').classList.toggle('warning', !!p.error);
}
function previewBuilding(plan) {
  if (!tool || tool === 'road') return;
  const d = E.BUILDINGS[tool];
  $('#tool-note').textContent =
    plan.error ||
    `${d.name} · ${d.cost + (plan.driveCost || 0)} ₡ · ${d.metal} спл. · ${d.time} сек.${plan.near ? ' · подъезд подключится автоматически' : ''}`;
  $('#tool-note').classList.toggle('warning', !!plan.error);
}
function place(key, x, z, rotation) {
  if (!started) return;
  const b = E.build(state, 0, key, x, z, rotation);
  if (typeof b === 'string') {
    toast(b, true);
    return;
  }
  persist();
  updateHUD();
}
function placeRoad(a, b) {
  if (!started) return false;
  const r = E.buildRoad(state, 0, a.x, a.z, b.x, b.z);
  if (typeof r === 'string') {
    toast(r, true);
    return false;
  }
  persist();
  return true;
}
function attackAim() {
  return { ...aimPoint, waypoints: weapon === 'ballistic' ? [] : waypoints };
}
function refreshOrderPreview() {
  world.setOrderPreview(aiming ? { key: weapon, siteId: launcherId, aim: attackAim() } : null);
}
function previewAimPoint(p) {
  if (!aiming) return;
  aimPoint = { x: p.x, z: p.z };
  refreshOrderPreview();
}
function updateSiteSelect(select) {
  const sites = state.buildings.filter(
      (b) => b.side === 0 && b.key === 'launcher' && b.hp > 0 && !b.demolished,
    ),
    sig = sites.map((b) => b.id).join(',');
  if (select.dataset.signature !== sig) {
    select.innerHTML =
      '<option value="auto">Автовыбор площадки</option>' +
      sites.map((b) => `<option value="${b.id}"></option>`).join('');
    select.dataset.signature = sig;
  }
  for (const b of sites)
    select.querySelector(`[value="${b.id}"]`).textContent =
      `#${b.id} · ${Math.round(b.x)}, ${Math.round(b.z)} · ${b.progress < 1 ? 'строится' : `в очереди ${E.queuedLaunches(state, b)}/${E.COMBAT.queueLimit}`}`;
  select.value = launcherId == null ? 'auto' : String(launcherId);
}
function updateStrikeHUD() {
  const d = E.WEAPONS[weapon],
    site = E.selectedLaunchSite(state, 0, launcherId),
    available = state.sides[0].inventory[weapon],
    error = E.launchStatus(state, 0, weapon, attackAim(), launcherId);
  $('#strike-name').textContent = d.name;
  $('#strike-stock').textContent = `На складе: ${available}`;
  for (const b of document.querySelectorAll('[data-salvo]'))
    b.classList.toggle('active', Number(b.dataset.salvo) === count);
  updateSiteSelect($('#strike-site'));
  const distance = site ? E.flightRoute(site, attackAim(), weapon).at(-1).d : 0;
  const quickSignature =
    weapon + JSON.stringify(state.sides[0].inventory) + state.sides[0].tech.join(',');
  if ($('#quick-weapons').dataset.signature !== quickSignature) {
    $('#quick-weapons').dataset.signature = quickSignature;
    $('#quick-weapons').innerHTML = Object.entries(E.WEAPONS)
      .map(
        ([key, w], i) =>
          `<button data-weapon="${key}" class="${key === weapon ? 'active' : ''}" ${w.tech && !state.sides[0].tech.includes(w.tech) ? 'disabled' : ''} title="${w.name} · ${['Z', 'X', 'C', 'V'][i]}">${['Лёгкие', 'Тяжёлые', 'Крылатые', 'Баллист.'][i]}<b>${state.sides[0].inventory[key]}</b></button>`,
      )
      .join('');
  }
  $('#route-toggle').textContent = routeEditing ? 'Готово · наводить' : 'Задать маршрут';
  $('#route-toggle').disabled = weapon === 'ballistic';
  $('#waypoint-status').textContent =
    weapon === 'ballistic'
      ? 'Баллистическая ракета летит по прямой дуге'
      : routeEditing
        ? `Кликайте точки пути: ${waypoints.length}/10. Затем «Готово» и цель.`
        : `Точек: ${waypoints.length}/10 · Shift + ЛКМ — добавить точку`;
  $('#strike-note').textContent =
    error ||
    `Радиус ${d.blast} · полёт ≈ ${Math.ceil(distance / d.speed)} с · за клик ×${Math.min(count, available, E.COMBAT.queueLimit - E.queuedLaunches(state, site))}`;
  $('#strike-note').classList.toggle('warning', !!error);
}
function armStrike(key = weapon) {
  clearTroopTarget();
  armySelection = [];
  world.setArmySelection([]);
  const d = E.WEAPONS[key];
  if (!d) return;
  if (d.tech && !state.sides[0].tech.includes(d.tech)) {
    openPanel('research', true);
    return;
  }
  const wasAiming = aiming;
  if (tool) chooseBuild(tool);
  weapon = key;
  if (key === 'ballistic') routeEditing = false;
  panel = null;
  selected = null;
  world.select(null);
  $('#panel').hidden = $('#inspector').hidden = true;
  aiming = true;
  world.setAiming(true);
  $('#strike-controls').hidden = false;
  $('#world').classList.add('aiming');
  $('#mode-status').textContent = 'ЛКМ — отправить · ПКМ — убрать · зажать ПКМ — ракурс';
  if (!wasAiming) world.focus(615, 0);
  refreshOrderPreview();
  updateStrikeHUD();
}
function chooseAimPoint(p, modifiers = {}) {
  if (!started || !aiming) return;
  if ((routeEditing || modifiers.shift) && weapon !== 'ballistic') {
    if (waypoints.length >= 10) {
      toast('До 10 точек маршрута', true);
      return;
    }
    if (Math.abs(p.x) > E.MAP.width / 2 || Math.abs(p.z) > E.MAP.depth / 2) {
      toast('Точка за картой', true);
      return;
    }
    waypoints.push({ x: p.x, z: p.z });
    refreshOrderPreview();
    updateStrikeHUD();
    return;
  }
  aimPoint = { x: p.x, z: p.z };
  const site = E.selectedLaunchSite(state, 0, launcherId),
    result = E.launch(state, 0, weapon, attackAim(), count, launcherId);
  if (typeof result === 'string') {
    toast(result, true);
    updateStrikeHUD();
    return;
  }
  toast(`Площадка #${site.id}: в очередь ×${result} → ${Math.round(p.x)}, ${Math.round(p.z)}`);
  persist();
  updateHUD();
  updateStrikeHUD();
  refreshOrderPreview();
}
function selectArmy(ids, extend = false) {
  const resolved = ids.map((id) => state.groundUnits.find((u) => u.id === id)?.carrierId || id),
    valid = [...new Set(resolved)].filter((id) =>
      state.groundUnits.some((u) => u.id === id && u.side === 0 && u.hp > 0),
    );
  armySelection = extend ? [...new Set([...armySelection, ...valid])] : valid;
  if (tool) {
    const old = tool;
    chooseBuild(old);
    armySelection = valid;
  }
  aiming = false;
  world.setAiming(false);
  $('#strike-controls').hidden = true;
  world.setOrderPreview(null);
  selected = armySelection[0] ?? null;
  world.select(selected);
  world.setArmySelection(armySelection);
  panel = null;
  $('#panel').hidden = true;
  if (selected) renderInspector();
  else $('#inspector').hidden = true;
  renderGroups();
  $('#mode-status').textContent = 'Рамка / Shift — выбор · Ctrl+цифра — группа · ЛКМ — приказ';
}
function renderGroups() {
  const host = $('#groups-bar');
  if (!host) return;
  const signature = Array.from({ length: 9 }, (_, i) => E.getGroup(state, 0, i + 1).length).join(
    ',',
  );
  if (host.dataset.signature !== signature) {
    host.dataset.signature = signature;
    host.innerHTML =
      '<span>ГРУППЫ</span>' +
      Array.from(
        { length: 9 },
        (_, i) =>
          `<button data-group="${i + 1}" title="${i + 1}: выбрать · Ctrl+${i + 1}: сохранить выделение">${i + 1}<small>${E.getGroup(state, 0, i + 1).length || '·'}</small></button>`,
      ).join('');
  }
}
function commandGround(p) {
  if (!started || !armySelection.length) return;
  const r = p.boardId
    ? E.boardGround(state, 0, armySelection, p.boardId)
    : E.orderGround(state, 0, armySelection, {
        ...p,
        mode: troopMode === 'attackmove' ? 'attackmove' : p.targetId ? 'attack' : 'move',
      });
  if (typeof r === 'string') toast(r, true);
  else {
    toast(
      p.boardId
        ? 'Бойцы направляются к транспорту'
        : `Приказ: ${r} ед. → ${Math.round(p.x)}, ${Math.round(p.z)}`,
    );
    if (troopMode === 'attackmove') clearTroopTarget();
    persist();
    renderInspector();
  }
}
function troopTarget(p) {
  let result;
  if (troopMode === 'rally') result = E.setRally(state, 0, rallyId, p);
  else if (troopMode === 'fpv') result = E.launchFPV(state, 0, armySelection, p);
  else if (troopMode === 'board') {
    const vehicle = state.groundUnits.filter(
      (u) => u.side === 0 && u.key === 'apc' && Math.hypot(u.x - p.x, u.z - p.z) < 18,
    )[0];
    result = vehicle
      ? E.boardGround(state, 0, armySelection, vehicle.id)
      : 'Нажмите рядом со своим бронетранспортёром';
  } else if (troopMode === 'attackmove') {
    commandGround(p);
    return;
  }
  if (typeof result === 'string') {
    toast(result, true);
    return;
  }
  toast(
    troopMode === 'rally'
      ? 'Точка сбора установлена'
      : troopMode === 'fpv'
        ? 'FPV запущен'
        : 'Приказ посадки принят',
  );
  clearTroopTarget();
  persist();
  renderInspector();
}
function troopCommand(command) {
  if (command === 'fpv' || command === 'board' || command === 'attackmove') {
    troopMode = command;
    world.setGroundTargeting(command);
    toast(
      command === 'fpv'
        ? 'ЛКМ — точка удара FPV в радиусе 320'
        : command === 'board'
          ? 'ЛКМ по своему бронетранспортёру'
          : 'ЛКМ — наступать, останавливаясь для боя',
    );
    return;
  }
  const r = E.commandUnits(state, 0, armySelection, command);
  if (typeof r === 'string') toast(r, true);
  else {
    persist();
    renderInspector();
  }
}

function select(id, extend = false) {
  const passenger = state.groundUnits.find((u) => u.id === id && u.side === 0 && u.carrierId);
  if (passenger) id = passenger.carrierId;
  const t = E.observedTarget(state, 0, id);
  if (aiming) {
    if (t) chooseAimPoint(t);
    return;
  }
  if (tool) chooseBuild(tool);
  if (t?.ground && t.side === 0) {
    selectArmy([id], extend);
    return;
  }
  armySelection = [];
  world.setArmySelection([]);
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
  if (t.side === 1 && t.hp > 0) {
    aimPoint = { x: t.x, z: t.z };
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
  armySelection = [];
  world.setArmySelection([]);
  if (tool) chooseBuild(tool);
  aiming = false;
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
  $('#panel').innerHTML = panelHTML({ panel, weapon, count, settings, state });
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
    for (const key of Object.keys(E.WEAPONS)) {
      const stock = $(`[data-stock="${key}"]`);
      if (stock) stock.textContent = f.inventory[key];
      const row = $(`[data-row="${key}"]`);
      row?.classList.toggle('chosen', weapon === key);
      const d = E.WEAPONS[key],
        locked = d.tech && !f.tech.includes(d.tech);
      $(`[data-produce="${key}"]`).disabled = !!locked;
      $(`[data-weapon="${key}"]`).disabled = !!locked;
    }
    const factories = state.buildings.filter(
      (b) => b.side === 0 && b.key === 'factory' && b.hp > 0,
    );
    $('#queue-status').textContent = factories.length
      ? factories
          .map((b) =>
            b.progress < 1
              ? 'Завод строится'
              : b.queue?.length
                ? `${E.WEAPONS[b.queue[0].key].name}: ${Math.floor(b.queue[0].progress * 100)}% · в очереди ${b.queue.length}`
                : 'Завод свободен',
          )
          .join(' · ')
      : 'Для производства нужен сборочный завод';
    const error = E.launchStatus(state, 0, weapon, attackAim(), launcherId);
    $('#launch-button').textContent = 'Наводить: ' + E.WEAPONS[weapon].name.toLowerCase();
    $('#launch-button').disabled = false;
    $('#route-status').textContent =
      `Радиус ${E.WEAPONS[weapon].blast} · ${count} за клик · очередь площадки до 12`;
    $('#launch-status').textContent =
      error || 'Выберите название вооружения — затем запускайте кликами по карте.';
    $('#launch-status').classList.toggle('warning', !!error);
  }
  if (panel === 'army') {
    const sites = state.buildings.filter((b) => b.side === 0 && b.key === 'barracks' && b.hp > 0);
    $('#army-queue').textContent =
      sites
        .map((b) =>
          b.progress < 1
            ? 'Казармы строятся'
            : b.armyQueue?.length
              ? `${E.GROUND_UNITS[b.armyQueue[0].key].name}: ${Math.floor(b.armyQueue[0].progress * 100)}% · в очереди ${b.armyQueue.length}`
              : 'Казармы свободны',
        )
        .join(' · ') || 'Сначала постройте казармы';
    const ownUnits = state.groundUnits.filter((u) => u.side === 0),
      armySignature = ownUnits.map((u) => u.id).join(',');
    if ($('#army-list').dataset.signature !== armySignature) {
      $('#army-list').dataset.signature = armySignature;
      $('#army-list').innerHTML =
        ownUnits
          .map(
            (u) =>
              `<button class="army-unit" data-unit="${u.id}"><span>${E.GROUND_UNITS[u.key].name} #${u.id}<small data-unit-status="${u.id}"></small></span><b>↗</b></button>`,
          )
          .join('') || '<p class="small-muted">Отрядов пока нет</p>';
    }
    for (const u of ownUnits)
      $(`[data-unit-status="${u.id}"]`).textContent =
        `${Math.ceil(u.hp)} / ${u.maxHp} · ${u.path?.length ? 'в пути' : 'на позиции'}`;
    for (const [key, d] of Object.entries(E.GROUND_UNITS)) {
      $(`[data-recruit="${key}"]`).disabled = !!(d.tech && !f.tech.includes(d.tech));
    }
  }
  if (panel === 'research') {
    const active = f.research;
    $('#research-progress').textContent = active
      ? `${E.TECH[active.key].name} · ${Math.floor(active.progress * 100)}%`
      : 'Один проект за раз. Нужна работающая лаборатория.';
    for (const [key, d] of Object.entries(E.TECH)) {
      const btn = $(`[data-research="${key}"]`),
        done = f.tech.includes(key),
        locked = d.requires && !f.tech.includes(d.requires);
      btn.disabled = done || !!locked || !!active;
      $(`[data-tech="${key}"]`).textContent = done ? '✓' : locked ? '◇' : '→';
    }
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
      ['Наука', rate(e.science) + '/мин'],
      ['Связаны со штабом', e.connected],
      ['Нет снабжения', e.isolated],
      ['Боеприпасы потрачены', num(f.spentAmmo) + ' ₡'],
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
          : o.science
            ? rate(o.science) + ' науки'
            : o.powerUse < 0
              ? Math.round(-o.powerUse * o.road * o.health) + ' МВт'
              : '−' + Math.round(o.upkeep * 60) + ' ₡';
    }
  }
}
function send() {
  armStrike(weapon);
}
document.addEventListener('pointerdown', () => {
  pointerBusy = true;
  audio.unlock();
});
document.addEventListener('pointerup', () => (pointerBusy = false));
document.addEventListener('pointercancel', () => (pointerBusy = false));
window.addEventListener('blur', () => (pointerBusy = false));
document.addEventListener('click', (ev) => {
  const b = ev.target.closest('button');
  if (!b || b.disabled) return;
  const d = b.dataset;
  if (d.tab) {
    tab = d.tab;
    document.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('active', x === b));
    buildList();
  }
  if (d.build) chooseBuild(d.build);
  if (d.panel) {
    const b = E.targetById(state, selected);
    if (d.panel === 'attack' && b?.side === 0 && b.key === 'launcher') launcherId = b.id;
    openPanel(d.panel);
  }
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
  }
  if (d.recruitCount) {
    recruitCount = Number(d.recruitCount);
    document
      .querySelectorAll('[data-recruit-count]')
      .forEach((b) =>
        b.classList.toggle('active', Number(b.dataset.recruitCount) === recruitCount),
      );
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
      troopMode = 'rally';
      panel = null;
      $('#panel').hidden = true;
      world.setGroundTargeting('rally');
      toast('ЛКМ — точка сбора новых бойцов, например в лесу');
    } else toast('Сначала постройте казармы', true);
  }
  if (d.redeploy) {
    const id = E.redeployMOG(state, 0, Number(d.redeploy));
    if (typeof id === 'number') {
      selectArmy([id]);
      persist();
    } else toast(id, true);
  }
  if (d.recruit) {
    const r = E.recruit(state, 0, d.recruit, null, recruitCount);
    if (typeof r === 'string') toast(r, true);
    else {
      toast('Отряд добавлен в очередь казарм');
      persist();
      updateLivePanel();
    }
  }
  if (d.upgrade) {
    const r = E.upgradeDefense(state, 0, Number(d.upgrade));
    if (typeof r === 'string') toast(r, true);
    else {
      persist();
      renderInspector();
      toast('Установка модернизирована');
    }
  }
  if (d.salvo) {
    count = Number(d.salvo);
    updateStrikeHUD();
  }
  if (d.produce) {
    const r = E.produce(state, 0, d.produce);
    if (typeof r === 'string') toast(r, true);
    else {
      toast('Добавлено в очередь завода');
      persist();
      updateLivePanel();
    }
  }
  if (d.research) {
    const r = E.research(state, 0, d.research);
    if (typeof r === 'string') toast(r, true);
    else {
      persist();
      updateLivePanel();
    }
  }
  if (d.repair) {
    const r = E.repair(state, Number(d.repair));
    if (typeof r === 'string') toast(r, true);
    else {
      persist();
      renderInspector();
    }
  }
  if (d.demolish) {
    E.demolish(state, Number(d.demolish));
    selected = null;
    world.select(null);
    $('#inspector').hidden = true;
    persist();
  }
  const a = d.action;
  if (a === 'route') {
    routeEditing = !routeEditing;
    updateStrikeHUD();
  }
  if (a === 'route-undo') {
    waypoints.pop();
    refreshOrderPreview();
    updateStrikeHUD();
  }
  if (a === 'route-clear') {
    waypoints = [];
    refreshOrderPreview();
    updateStrikeHUD();
  }
  if (a === 'army-stop') troopCommand('stop');
  if (a === 'army-all') {
    const units = state.groundUnits.filter((u) => u.side === 0 && u.hp > 0);
    if (units.length) {
      selectArmy(units.filter((u) => !u.carrierId).map((u) => u.id));
    } else toast('Подготовьте отряды в казармах');
  }
  if (a === 'start') begin();
  if (a === 'pause' && started) pause(!paused);
  if (a === 'sound') {
    settings.sound = !settings.sound;
    saveSettings();
    updateHUD();
  }
  if (a === 'home') world.focus(-615, 0);
  if (a === 'enemy') world.focus(615, 0);
  if (a === 'close-panel') {
    panel = null;
    world.setOrderPreview(null);
    $('#panel').hidden = true;
    world.controls.focusInput();
  }
  if (a === 'deselect') {
    clearTroopTarget();
    armySelection = [];
    world.setArmySelection([]);
    selected = null;
    world.select(null);
    $('#inspector').hidden = true;
  }
  if (a === 'launch') send();
  if (a === 'aim') armStrike(weapon);
  if (a === 'cancel-strike') cancelTool(true);
  if (a === 'save') {
    persist();
    toast('Сохранено');
  }
  if (a === 'export') {
    const url = URL.createObjectURL(new Blob([E.save(state)], { type: 'application/json' })),
      link = document.createElement('a');
    link.href = url;
    link.download = `skyfront-city-${Math.floor(state.time)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  if (a === 'import') $('#import-file').click();
  if (a === 'new-confirm') {
    b.dataset.action = 'new';
    b.textContent = 'Подтвердить новую игру';
  }
  if (a === 'new') replaceCampaign(E.createGame());
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
    count = Math.max(1, Math.min(6, Number(ev.target.value) || 1));
    updateLivePanel();
  }
});
document.addEventListener('change', (ev) => {
  if (ev.target.id === 'formation') {
    state.formations[0] = ev.target.value;
    persist();
  }
  if (ev.target.id === 'strike-site') {
    launcherId = ev.target.value === 'auto' ? null : Number(ev.target.value);
    updateStrikeHUD();
    refreshOrderPreview();
  }
  if (ev.target.id === 'launch-site') {
    launcherId = ev.target.value === 'auto' ? null : Number(ev.target.value);
    updateLivePanel();
  }
  if (ev.target.id === 'attack-target') {
    const t = E.targetById(state, Number(ev.target.value));
    if (t) aimPoint = { x: t.x, z: t.z };
    armStrike(weapon);
  }
  if (ev.target.matches('select') && panel !== 'settings') world.controls.focusInput();
});
$('#import-file').addEventListener('change', async (ev) => {
  const file = ev.target.files[0];
  if (!file) return;
  try {
    if (file.size > 5e6) throw Error('Файл слишком большой');
    const imported = E.load(await file.text());
    replaceCampaign(imported);
  } catch (e) {
    toast(e.message, true);
  }
  ev.target.value = '';
});
$('#minimap').addEventListener('click', (e) => {
  world.controls.focusInput();
  const r = e.currentTarget.getBoundingClientRect();
  world.focus(
    ((e.clientX - r.left) / r.width - 0.5) * E.MAP.width,
    ((e.clientY - r.top) / r.height - 0.5) * E.MAP.depth,
  );
});
window.addEventListener(
  'keydown',
  (e) => {
    if (!started || e.repeat) return;
    if (e.code === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (tool || aiming) cancelTool();
      else {
        panel = null;
        selected = null;
        world.setOrderPreview(null);
        world.select(null);
        $('#panel').hidden = $('#inspector').hidden = true;
      }
      armySelection = [];
      world.setArmySelection([]);
      clearTroopTarget();
      world.controls.focusInput();
      return;
    }
    if (
      e.target.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])')
    ) {
      if (e.code === 'Enter' && e.target.matches('input[type="number"]')) {
        e.preventDefault();
        e.target.dispatchEvent(new Event('change', { bubbles: true }));
        world.controls.focusInput();
      }
      return;
    }
    if (panel === 'settings') return;
    const digit = /^Digit([1-9])$/.exec(e.code);
    if (digit && (e.ctrlKey || E.getGroup(state, 0, Number(digit[1])).length)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      const n = Number(digit[1]);
      if (e.ctrlKey) {
        if (armySelection.length) {
          E.saveGroup(
            state,
            0,
            n,
            e.shiftKey ? [...E.getGroup(state, 0, n), ...armySelection] : armySelection,
          );
          persist();
          renderGroups();
          toast('Группа ' + n + ' сохранена');
        }
      } else selectArmy(E.getGroup(state, 0, n), e.shiftKey);
      return;
    }
    if (e.ctrlKey && e.code === 'KeyA') {
      e.preventDefault();
      e.stopImmediatePropagation();
      selectArmy(
        state.groundUnits.filter((u) => u.side === 0 && u.hp > 0 && !u.carrierId).map((u) => u.id),
      );
      return;
    }
    const command = {
      KeyH: 'dig',
      KeyK: 'camo',
      KeyF: 'fire',
      KeyT: 'retreat',
      KeyU: 'unload',
      KeyM: 'attackmove',
      KeyQ: 'fpv',
    }[e.code];
    if (command && armySelection.length && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      e.stopImmediatePropagation();
      troopCommand(command);
    }
  },
  true,
);
window.addEventListener('keydown', (e) => {
  if (
    e.ctrlKey ||
    e.metaKey ||
    e.altKey ||
    e.target.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])') ||
    e.repeat
  )
    return;
  if (e.code === 'Space') {
    e.preventDefault();
    if (started) pause(!paused);
  }
  if (aiming && e.code === 'Enter') {
    routeEditing = false;
    updateStrikeHUD();
  }
  if (aiming && e.code === 'Backspace') {
    e.preventDefault();
    waypoints.pop();
    refreshOrderPreview();
    updateStrikeHUD();
  }
  const quick = { KeyZ: 'drone', KeyX: 'heavy', KeyC: 'cruise', KeyV: 'ballistic' }[e.code];
  if (quick && started) armStrike(quick);
  if (e.code === 'KeyB' && started) openPanel('army');
  if (e.code === 'KeyE') openPanel('attack');
  const key = {
    KeyG: 'road',
    Digit1: 'housing',
    Digit2: 'industry',
    Digit3: 'power',
    Digit4: 'gun',
    Digit5: 'launcher',
  }[e.code];
  if (key && started) chooseBuild(key);
});
document.addEventListener('visibilitychange', () => {
  acc = 0;
  audio.focus(!document.hidden);
  if (document.hidden && started) persist();
});
window.addEventListener('beforeunload', () => {
  if (started) persist();
});
buildList();
updateHUD();
world.updateMinimap($('#minimap'));
window.skyfront = {
  engine: E,
  getState: () => structuredClone(state),
  getWorld: () => world,
  diagnostics: () => world.diagnostics(),
  chooseBuild,
  select,
  openPanel,
  save: persist,
  isPaused: () => paused,
  getAudio: () => audio.diagnostics(),
  armStrike,
  commandGround,
  selectArmy,
  troopCommand,
  getOrder: () => ({
    troopMode,
    weapon,
    waypoints: structuredClone(waypoints),
    routeEditing,
    armySelection: [...armySelection],
  }),
};
