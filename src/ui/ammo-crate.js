import * as E from '../game/index.js';
import { escape } from './format.js';

export function ammoCrateDetailHTML(state, crate) {
  const owner = crate.side === 0;
  const affiliation = owner
    ? 'Наш полевой запас'
    : E.allied(state, 0, crate.side)
      ? 'Союзный запас'
      : 'Запас противника';
  let detail = '<p class="status-note">Состав чужого запаса не раскрывается.</p>';
  if (owner) {
    const report = E.fieldCrateStatus(state, 0, crate.id);
    detail = report
      ? Object.entries({ small: 'Патроны', shell: 'Снаряды', rocket: 'Ракеты', sam: 'ЗУР' })
          .map(
            ([key, label]) =>
              `<div class="stat"><span>${label}</span><b>${report.stock[key]} / ${report.capacity[key]}</b></div>`,
          )
          .join('') +
        `<p class="status-note">Рядом ${report.nearby} ед.${report.incoming ? ' · машина в пути' : ''}</p><p class="small-muted">Оплаченный запас привозит машина. Бойцы пополняются рядом; защитники могут ненадолго подойти и вернуться на пост. Уничтожение ящика теряет его содержимое.</p>`
      : '<p class="status-note">Ящик разрушен.</p>';
  }
  return `<p class="status-note">${escape(affiliation)} · ${Math.ceil(crate.hp)} / ${crate.maxHp}</p><div class="health"><i style="width:${Math.max(0, crate.hp / crate.maxHp) * 100}%"></i></div>${detail}`;
}

export function ammoCrateInspectorHTML(state, crate, detail = ammoCrateDetailHTML(state, crate)) {
  return `<div class="panel-head"><b>Полевые боеприпасы</b><button data-action="deselect" aria-label="Закрыть">×</button></div><div data-crate-detail>${detail}</div>`;
}
