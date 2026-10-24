// Strike owns its bounded targeting model. No application globals are captured:
// simulation/world reads, commands and cross-tool transitions are named ports.
export function createStrikeController({
  game,
  getState,
  getWorld,
  getStarted,
  getRevision,
  execute,
  interaction,
  home,
  persist,
  updateHUD,
  toast,
  document,
  query,
}) {
  const model = {
    weapon: 'drone',
    aimPoint: { x: 615, z: 0 },
    launcherId: null,
    count: 1,
    aiming: false,
    waypoints: [],
    routeEditing: false,
  };
  function attackAim() {
    return { ...model.aimPoint, waypoints: model.weapon === 'ballistic' ? [] : model.waypoints };
  }
  function refreshOrderPreview() {
    getWorld().setOrderPreview(
      model.aiming ? { key: model.weapon, siteId: model.launcherId, aim: attackAim() } : null,
    );
  }
  function previewAimPoint(p) {
    if (!model.aiming) return;
    model.aimPoint = { x: p.x, z: p.z };
    refreshOrderPreview();
  }
  function updateSiteSelect(select) {
    const sites = getState().buildings.filter(
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
        `#${b.id} · ${Math.round(b.x)}, ${Math.round(b.z)} · ${b.progress < 1 ? 'строится' : `в очереди ${game.queuedLaunches(getState(), b)}/${game.COMBAT.queueLimit}`}`;
    select.value = model.launcherId == null ? 'auto' : String(model.launcherId);
  }
  function updateStrikeHUD() {
    const d = game.WEAPONS[model.weapon],
      site = game.selectedLaunchSite(getState(), 0, model.launcherId),
      available = getState().sides[0].inventory[model.weapon],
      error = game.launchStatus(getState(), 0, model.weapon, attackAim(), model.launcherId);
    query('#strike-name').textContent = d.name;
    query('#strike-stock').textContent = `На складе: ${available}`;
    for (const b of document.querySelectorAll('[data-salvo]'))
      b.classList.toggle('active', Number(b.dataset.salvo) === model.count);
    updateSiteSelect(query('#strike-site'));
    const distance = site ? game.flightRoute(site, attackAim(), model.weapon).at(-1).d : 0;
    const quickSignature =
      model.weapon +
      JSON.stringify(getState().sides[0].inventory) +
      getState().sides[0].tech.join(',');
    if (query('#quick-weapons').dataset.signature !== quickSignature) {
      query('#quick-weapons').dataset.signature = quickSignature;
      query('#quick-weapons').innerHTML = Object.entries(game.WEAPONS)
        .map(
          ([key, w], i) =>
            `<button data-weapon="${key}" class="${key === model.weapon ? 'active' : ''}" ${w.tech && !getState().sides[0].tech.includes(w.tech) ? 'disabled' : ''} title="${w.name} · ${['Z', 'X', 'C', 'V'][i]}">${['Лёгкие', 'Тяжёлые', 'Крылатые', 'Баллист.'][i]}<b>${getState().sides[0].inventory[key]}</b></button>`,
        )
        .join('');
    }
    query('#route-toggle').textContent = model.routeEditing
      ? 'Готово · наводить'
      : 'Задать маршрут';
    query('#route-toggle').disabled = model.weapon === 'ballistic';
    query('#waypoint-status').textContent =
      model.weapon === 'ballistic'
        ? 'Баллистическая ракета летит по прямой дуге'
        : model.routeEditing
          ? `Кликайте точки пути: ${model.waypoints.length}/10. Затем «Готово» и цель.`
          : `Точек: ${model.waypoints.length}/10 · Shift + ЛКМ — добавить точку`;
    query('#strike-note').textContent =
      error ||
      `Радиус ${d.blast} · полёт ≈ ${Math.ceil(distance / d.speed)} с · за клик ×${Math.min(model.count, available, game.COMBAT.queueLimit - game.queuedLaunches(getState(), site))}`;
    query('#strike-note').classList.toggle('warning', !!error);
  }
  function armStrike(key = model.weapon) {
    interaction.clearTroopTarget();
    interaction.clearArmySelection();
    const d = game.WEAPONS[key];
    if (!d) return;
    if (d.tech && !getState().sides[0].tech.includes(d.tech)) {
      interaction.openPanel('research', true);
      return;
    }
    const wasAiming = model.aiming;
    const tool = interaction.getBuildTool();
    if (tool) interaction.chooseBuild(tool);
    model.weapon = key;
    if (key === 'ballistic') model.routeEditing = false;
    interaction.clearInspection();
    model.aiming = true;
    getWorld().setAiming(true);
    query('#strike-controls').hidden = false;
    query('#world').classList.add('aiming');
    query('#mode-status').textContent = 'ЛКМ — отправить · ПКМ — убрать · зажать ПКМ — ракурс';
    if (!wasAiming) {
      const enemy = home(1);
      getWorld().focus(enemy.x, enemy.z);
    }
    refreshOrderPreview();
    updateStrikeHUD();
  }
  async function chooseAimPoint(p, modifiers = {}) {
    if (!getStarted() || !model.aiming) return;
    const revision = getRevision();
    if ((model.routeEditing || modifiers.shift) && model.weapon !== 'ballistic') {
      if (model.waypoints.length >= 10) {
        toast('До 10 точек маршрута', true);
        return;
      }
      if (Math.abs(p.x) > game.MAP.width / 2 || Math.abs(p.z) > game.MAP.depth / 2) {
        toast('Точка за картой', true);
        return;
      }
      model.waypoints.push({ x: p.x, z: p.z });
      refreshOrderPreview();
      updateStrikeHUD();
      return;
    }
    model.aimPoint = { x: p.x, z: p.z };
    const site = game.selectedLaunchSite(getState(), 0, model.launcherId),
      result = await execute('launch', {
        key: model.weapon,
        aim: attackAim(),
        count: model.count,
        siteId: model.launcherId,
      });
    if (revision !== getRevision()) return;
    if (typeof result === 'string') {
      toast(result, true);
      updateStrikeHUD();
      return;
    }
    toast(
      `Площадка #${site?.id ?? '…'}: в очередь ×${result} → ${Math.round(p.x)}, ${Math.round(p.z)}`,
    );
    persist();
    updateHUD();
    updateStrikeHUD();
    refreshOrderPreview();
  }

  function finishRoute() {
    model.routeEditing = false;
    updateStrikeHUD();
  }
  function undoWaypoint() {
    model.waypoints.pop();
    refreshOrderPreview();
    updateStrikeHUD();
  }

  return {
    model,
    attackAim,
    refreshOrderPreview,
    previewAimPoint,
    updateSiteSelect,
    updateStrikeHUD,
    armStrike,
    chooseAimPoint,
    finishRoute,
    undoWaypoint,
    actions: {
      route: () => {
        model.routeEditing = !model.routeEditing;
        updateStrikeHUD();
      },
      'route-undo': undoWaypoint,
      'route-clear': () => {
        model.waypoints = [];
        refreshOrderPreview();
        updateStrikeHUD();
      },
      launch: () => armStrike(model.weapon),
      aim: () => armStrike(model.weapon),
    },
  };
}
