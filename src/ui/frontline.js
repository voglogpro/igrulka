import { frontlineReport } from '../game/index.js';

export class FrontlineHUD {
  constructor({ onFocus, onVisibility }) {
    this.onFocus = onFocus;
    this.onVisibility = onVisibility;
    this.lineVisible = true;
    this.report = null;
    this.host = document.createElement('aside');
    this.host.id = 'frontline-hud';
    this.host.hidden = true;
    this.host.innerHTML =
      '<button class="frontline-summary" aria-expanded="false"><span>ЛИНИЯ ФРОНТА</span><b class="frontline-state"></b><i>⌄</i></button><div class="frontline-detail" hidden><div class="frontline-sectors"></div><p class="frontline-reserve"></p><label><input type="checkbox" checked> Показывать линию на карте</label><small>Пунктир — оценка по наблюдениям. «Оборона: авто» выделяет резерв для усиления прорывов.</small></div>';
    document.querySelector('#game').append(this.host);
    this.host.querySelector('.frontline-summary').addEventListener('click', () => {
      const detail = this.host.querySelector('.frontline-detail');
      detail.hidden = !detail.hidden;
      this.host.querySelector('button').setAttribute('aria-expanded', String(!detail.hidden));
    });
    this.host.querySelector('input').addEventListener('change', (e) => {
      this.lineVisible = e.target.checked;
      this.onVisibility(this.lineVisible);
    });
    this.host.querySelector('.frontline-sectors').addEventListener('click', (e) => {
      const id = e.target.closest('[data-front-sector]')?.dataset.frontSector;
      const sector = this.report?.sectors.find((s) => s.id === id);
      if (sector) this.onFocus(sector);
    });
  }
  update(state, { visible = true } = {}) {
    this.host.hidden = !visible;
    if (!visible) return;
    const report = frontlineReport(state, 0);
    if (this.report === report) return;
    this.report = report;
    const dangerous = report.sectors.filter(
      (s) => s.pressure >= 1.15 && s.knowledge !== 'unknown',
    ).length;
    this.host.querySelector('.frontline-state').textContent = dangerous
      ? `Под давлением: ${dangerous}`
      : 'Без подтверждённых прорывов';
    this.host.classList.toggle('under-pressure', dangerous > 0);
    this.host.querySelector('.frontline-sectors').innerHTML = report.sectors
      .map((s) => {
        const status =
          s.knowledge === 'unknown'
            ? 'Нет наблюдений'
            : s.pressure >= 1.15
              ? 'Нужна поддержка'
              : s.knowledge === 'estimated'
                ? 'Оценка'
                : 'Под наблюдением';
        return `<button data-front-sector="${s.id}" class="${s.pressure >= 1.15 ? 'threat' : ''}"><span>${s.label}<small>${status}</small></span><b>${s.defenders}<small>защит.</small></b></button>`;
      })
      .join('');
    this.host.querySelector('.frontline-reserve').textContent =
      `Резерв: ${report.counts.reserves} · Усиливают: ${report.counts.reinforcing} · Укрепления: ${report.counts.fortified}`;
  }
  dispose() {
    this.host.remove();
  }
}
