import * as E from '../game/index.js';
import { escape, deliveryText, price } from './format.js';

const percent = (value) => Math.round(value * 100) + '%';
const rendered = new WeakMap();
export function updateEquipmentDetails(host, state, entity) {
  if (!host.querySelector('[data-equipment-content]'))
    host.innerHTML = '<div data-supply-content></div><div data-equipment-content></div>';
  for (const [selector, html] of [
    ['[data-supply-content]', entity ? supplyHTML(state, entity) : ''],
    ['[data-equipment-content]', entity ? equipmentHTML(state, entity) : ''],
  ]) {
    const target = host.querySelector(selector);
    if (rendered.get(target) === html) continue;
    rendered.set(target, html);
    target.innerHTML = html;
  }
}
export function supplyHTML(state, entity) {
  if (entity.side !== 0 || entity.hp <= 0) return '';
  const logistics = ['factory', 'launcher', 'silo', 'electronics'].includes(entity.key)
    ? null
    : E.ammoLogisticsStatus?.(state, entity.side, entity.id);
  let content = '';
  if (entity.key === 'electronics' && E.electronicsFactoryStatus) {
    const report = E.electronicsFactoryStatus(state, entity.side, entity.id);
    content = `<b>Электроника ${report.stock} / ${report.capacity}</b><p class="small-muted">Сборка ${percent(report.progress)} · ${report.seconds} с/ед.<br>${price({ ...report.recipe, components: 0 })} → 1 эл.</p><p class="status-note">${escape(report.reason)}</p>`;
  } else if (entity.key === 'ammofactory' && E.ammoFactoryStatus) {
    const report = E.ammoFactoryStatus(state, entity.side, entity.id),
      labels = { small: 'Патроны', shell: 'Снаряды', rocket: 'Ракеты', sam: 'ЗУР' };
    content = `<b>Склад боеприпасов</b>${Object.entries(labels)
      .map(
        ([key, label]) =>
          `<div class="stat"><span>${label}</span><b>${report.stock[key]} / ${report.capacity[key]}</b></div>`,
      )
      .join(
        '',
      )}<p class="small-muted">Машины: ${report.fleet.busy} заняты / ${report.fleet.total} · выпуск ${percent(report.production)}</p><p class="status-note">${escape(report.reason)}</p>`;
  } else if (entity.key === 'factory') {
    const report = E.factoryWarehouseStatus?.(state, entity);
    const stock = report?.stock || entity.launchStore || {};
    content = `<b>Склад завода: ${report?.total ?? Object.values(stock).reduce((n, v) => n + v, 0)} / ${report?.capacity ?? E.launchStoreCapacity(entity)}</b><p class="small-muted">${Object.entries(
      E.WEAPONS,
    )
      .map(([key, d]) => `${escape(d.name)}: ${stock[key] || 0}`)
      .join(
        ' · ',
      )}</p><p class="status-note">${escape(report?.reason || 'Производство и склад; отправка к пусковым машинами снабжения')}</p>`;
  } else if (['launcher', 'silo'].includes(entity.key)) {
    const tempo = E.launchTempo(entity);
    content = `<b>Запас на площадке ${E.launchStoreTotal(entity)} / ${E.launchStoreCapacity(entity)}</b><p class="small-muted">${Object.entries(
      E.WEAPONS,
    )
      .filter(([key]) => E.launchSiteAllows(entity, key))
      .map(([key, d]) => {
        const delivery = E.weaponDeliveryStatus?.(state, entity, key);
        return `${escape(d.name)}: ${E.availableLaunchStock(entity, key)}${delivery ? ` · ${escape(deliveryText(delivery))}` : ''}`;
      })
      .join(
        '<br>',
      )}<br>Пуск ${tempo.count} за ${tempo.interval} с · очередь ${E.queuedLaunches(state, entity)}</p>`;
  } else if (E.ammunitionStatus) {
    const ammo = E.ammunitionStatus(state, entity);
    if (ammo.kind)
      content = `<b>Боеприпасы ${ammo.loaded} / ${ammo.capacity}</b><p class="small-muted">Местный резерв: ${ammo.reserve} / ${ammo.capacity} · ${escape(ammo.reason)}</p>`;
    else if (ammo.cargo) {
      const labels = { small: 'Патроны', shell: 'Снаряды', rocket: 'Ракеты', sam: 'ЗУР' },
        cargo = Object.entries(labels)
          .filter(([key]) => ammo.cargo[key] > 0)
          .map(([key, label]) => `${label}: ${ammo.cargo[key]}`)
          .join(' · ');
      content = `<p class="small-muted">Груз снабжения: ${cargo || 'пусто'}</p>`;
    }
  }
  if (!content) return '';
  return `<section class="supply-detail" aria-label="Снабжение">${content}${logistics ? `<p class="status-note">${escape(logistics.reason || (logistics.inTransit ? 'Машина в пути' : 'Подвоз по потребности'))}</p>` : ''}</section>`;
}
export function equipmentHTML(state, entity) {
  const base = E.BUILDINGS[entity.key] || E.GROUND_UNITS[entity.key];
  if (
    entity.side !== 0 ||
    entity.hp <= 0 ||
    !base ||
    !(
      base.range ||
      base.groundRange ||
      ['launcher', 'silo', 'factory', 'ammofactory'].includes(entity.key)
    )
  )
    return '';
  const status = E.upgradeStatus(state, entity.side, entity.id),
    current = status.modifiers,
    next = status.nextModifiers,
    production = ['ammofactory', 'factory'].includes(entity.key),
    launcher = ['launcher', 'silo'].includes(entity.key),
    tempo = launcher ? E.launchTempo(entity) : null,
    nextTempo = launcher ? E.launchTempo({ ...entity, level: status.nextLevel }) : null,
    rows = production
      ? [
          ['Выпуск', percent(current.production), percent(next.production)],
          ['Машины', current.fleet, next.fleet],
        ]
      : launcher
        ? [
            [
              'Темп пуска',
              `${tempo.count} / ${tempo.interval} с`,
              `${nextTempo.count} / ${nextTempo.interval} с`,
            ],
          ]
        : [
            ['Дальность', percent(current.range), percent(next.range)],
            ['Темп огня', percent(current.rate), percent(next.rate)],
            ['Разброс', percent(current.spread), percent(next.spread)],
          ];
  if (entity.key === 'gun' || entity.key === 'mog')
    rows.push([
      'Охлаждение / нагрев',
      `${percent(current.cooling)} / ${percent(current.heat)}`,
      `${percent(next.cooling)} / ${percent(next.heat)}`,
    ]);
  return `<section class="equipment-detail" aria-label="Оснащение"><div class="inspect-line"><b>Оснащение ${status.level + 1} / 3</b><span>${status.level === 2 ? 'Максимум' : 'Следующий уровень →'}</span></div>${rows.map(([label, value, future]) => `<div class="stat"><span>${label}</span><b>${value}${status.level < 2 ? ` → ${future}` : ''}</b></div>`).join('')}${status.level < 2 ? `<button data-upgrade="${entity.id}"${status.ok ? '' : ' disabled'} title="${escape(status.reason || 'Оплата только деньгами')}">Улучшить · ${status.cost} ₡</button>${status.reason ? `<p class="small-muted">${escape(status.reason)}</p>` : ''}` : ''}${!production && !launcher ? '<p class="small-muted">Урон и прочность не меняются.</p>' : ''}</section>`;
}
