import * as E from '../game/index.js';

const histories = new WeakMap(),
  mounted = new WeakMap();
function history(host) {
  if (!histories.has(host)) histories.set(host, new Map());
  return histories.get(host);
}
export function rememberInspectorCard(host) {
  const previous = mounted.get(host),
    details = host.querySelector('.inspector-more, .army-details');
  if (!previous || !details) return;
  const records = history(host);
  records.set(previous.id, {
    open: details.open,
    scroll: details.querySelector(':scope > div')?.scrollTop || 0,
  });
  if (records.size > 96) records.delete(records.keys().next().value);
}
export function restoreInspectorCard(host, state, id) {
  const previous = mounted.get(host),
    details = host.querySelector('.inspector-more, .army-details'),
    campaign = `${state.seed}:${state.mode || 'solo'}:${state.sides.length}`;
  const boundary =
    previous && (previous.campaign !== campaign || state.time < previous.time - 1e-6);
  if (boundary) histories.delete(host);
  mounted.set(host, { campaign, time: state.time, id, details });
  if (!boundary && previous?.id === id && previous.details === details) return;
  if (!details) return;
  const saved = history(host).get(id);
  details.open = saved?.open || false;
  const body = details.querySelector(':scope > div');
  if (body) body.scrollTop = saved?.scroll || 0;
}

export function compactEquipmentAction(host, state, entity, destination) {
  const base = E.BUILDINGS[entity?.key] || E.GROUND_UNITS[entity?.key];
  const eligible =
    entity?.side === 0 &&
    entity.hp > 0 &&
    base &&
    (base.range ||
      base.groundRange ||
      ['launcher', 'silo', 'factory', 'ammofactory'].includes(entity.key));
  let row = host.querySelector('.inspect-upgrade-row');
  if (!eligible) {
    row?.remove();
    return;
  }
  if (!row) {
    row = document.createElement('div');
    row.className = 'inspect-upgrade-row';
    row.innerHTML = '<span></span><button type="button"></button>';
    destination.append(row);
  }
  const status = E.upgradeStatus(state, 0, entity.id),
    button = row.querySelector('button');
  row.querySelector('span').textContent = `Оснащение ${status.level + 1}/3`;
  button.dataset.upgrade = String(entity.id);
  button.disabled = !status.ok;
  button.textContent = status.level === 2 ? 'Максимум' : `Улучшить · ${status.cost} ₡`;
  button.title = status.reason || 'Точность, темп или оснащение; оплата только деньгами';
  // The essential action lives outside the refreshable read-only equipment tables.
  for (const duplicate of host.querySelectorAll('[data-upgrade]'))
    if (duplicate !== button) duplicate.remove();
}

export function compactInspectorStatus(host, state, b) {
  const status = host.querySelector('.inspect-key-status');
  if (!status) return;
  if (['factory', 'launcher', 'silo'].includes(b.key)) {
    const tempo = E.launchTempo(b);
    status.textContent = `Готово ${E.launchStoreTotal(b)}/${E.launchStoreCapacity(b)} · пуск ${tempo.count}/${tempo.interval} с · очередь ${E.queuedLaunches(state, b)}`;
  } else if (b.key === 'ammofactory') {
    const report = E.ammoFactoryStatus(state, b.side, b.id);
    status.textContent = `Выпуск ${Math.round(report.production * 100)}% · машины ${report.fleet.busy}/${report.fleet.total}`;
  } else {
    const output = E.buildingOutput(state, b);
    status.textContent = output
      ? `Выпуск ${Math.round(output.factor * 100)}% · содержание ${Math.round(output.upkeep * 60)} ₡/мин`
      : '';
  }
  status.hidden = !status.textContent;
}
