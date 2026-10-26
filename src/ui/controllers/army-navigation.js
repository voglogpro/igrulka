// Army navigation only: filtering/order of selection stops and camera focus.
// Orders, targeting modes and DOM views stay with their own controllers.
export function createArmyNavigation({
  game,
  getState,
  getSelection,
  getWorld,
  selectArmy,
  toast,
}) {
  // Quick unit switching: every field squad is one stop, units without a squad are their own stop.
  function armyStops() {
    const field = getState().groundUnits.filter(
        (u) => u.side === 0 && u.hp > 0 && !u.carrierId && !u.civil,
      ),
      present = new Set(field.map((u) => u.id)),
      stops = game
        .squadRoster(getState(), 0)
        .map((g) => g.ids.filter((id) => present.has(id)))
        .filter((ids) => ids.length);
    const squadded = new Set(stops.flat());
    for (const u of field) if (!squadded.has(u.id)) stops.push([u.id]);
    return stops.sort((a, b) => a[0] - b[0]);
  }
  function focusUnits(ids, distance = null) {
    const selected = new Set(ids),
      units = getState().groundUnits.filter((u) => selected.has(u.id) && u.hp > 0);
    if (!units.length) return;
    getWorld().focus(
      units.reduce((n, u) => n + u.x, 0) / units.length,
      units.reduce((n, u) => n + u.z, 0) / units.length,
      distance ?? Math.min(getWorld().controls.zoomDistance, 320),
    );
  }
  function cycleArmy(step) {
    const stops = armyStops();
    if (!stops.length) return toast('Нет войск на поле', true);
    const current = stops.findIndex((ids) => ids.includes(getSelection()[0]));
    const next = stops[(current + step + stops.length) % stops.length];
    selectArmy(next);
    focusUnits(next);
  }
  let idleCursor = 0;
  function nextIdleUnit() {
    const idle = getState()
      .groundUnits.filter(
        (u) =>
          u.side === 0 &&
          u.hp > 0 &&
          !u.carrierId &&
          !u.path?.length &&
          !u.guard &&
          !u.digging &&
          !u.delivery &&
          !u.routeState &&
          !['attack', 'attackmove', 'deliver'].includes(u.order?.mode),
      )
      .sort((a, b) => a.id - b.id);
    if (!idle.length) return toast('Все войска заняты');
    const u = idle.find((v) => v.id > idleCursor) || idle[0];
    idleCursor = u.id;
    selectArmy([u.id]);
    focusUnits([u.id], 220);
    toast(`Без приказа: ${idle.length}`);
  }
  function selectSimilar(id, extend = false) {
    const t = getState().groundUnits.find((u) => u.id === id && u.side === 0 && u.hp > 0);
    if (!t) return;
    const ids = getWorld().unitsOnScreen((u) => u.key === t.key);
    selectArmy(ids.length ? ids : [id], extend);
    toast(`${game.GROUND_UNITS[t.key].name}: ${ids.length || 1} на экране`);
  }

  function focusSelected() {
    const selected = new Set(getSelection()),
      units = getState().groundUnits.filter((u) => selected.has(u.id));
    if (units.length)
      getWorld().focus(
        units.reduce((n, u) => n + u.x, 0) / units.length,
        units.reduce((n, u) => n + u.z, 0) / units.length,
        220,
      );
  }
  function selectAll(notifyEmpty = false) {
    const units = getState().groundUnits.filter((u) => u.side === 0 && u.hp > 0 && !u.civil);
    if (units.length || !notifyEmpty)
      selectArmy(units.filter((u) => !u.carrierId).map((u) => u.id));
    else toast('Подготовьте отряды в казармах');
  }

  return {
    armyStops,
    focusUnits,
    cycleArmy,
    nextIdleUnit,
    selectSimilar,
    selectAll,
    actions: {
      'army-focus': focusSelected,
      'army-all': () => selectAll(true),
    },
  };
}
