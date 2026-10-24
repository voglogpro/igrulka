import { frontlineReport } from '../game/index.js';

export class FrontlineHUD {
  constructor({ onFocus, onVisibility }) {
    this.onFocus = onFocus;
    this.onVisibility = onVisibility;
    this.lineVisible = false;
    this.report = null;
    this.host = document.createElement('aside');
    this.host.id = 'frontline-hud';
    this.host.hidden = true;
    this.host.innerHTML =
      '<button class="frontline-summary" aria-pressed="false" title="Показать фронт на карте и поле боя">Фронт</button><button class="frontline-open" aria-expanded="false" hidden>Обстановка</button><div class="frontline-detail" hidden><div class="frontline-heading"><b class="frontline-state"></b><button class="frontline-close" aria-label="Закрыть обстановку">×</button></div><div class="frontline-sectors"></div><p class="frontline-reserve"></p><small>Оценка по наблюдениям, а не точное положение скрытых сил. Автооборона выделяет ограниченный резерв для помощи своему коридору.</small></div>';
    document.querySelector('#game .map').append(this.host);
    this.host.querySelector('.frontline-summary').addEventListener('click', () => {
      this.lineVisible = !this.lineVisible;
      this.host
        .querySelector('.frontline-summary')
        .setAttribute('aria-pressed', String(this.lineVisible));
      this.host.querySelector('.frontline-open').hidden = !this.lineVisible;
      if (!this.lineVisible) this.setExpanded(false);
      this.onVisibility(this.lineVisible);
      if (this.state) this.update(this.state);
    });
    this.host
      .querySelector('.frontline-open')
      .addEventListener('click', () =>
        this.setExpanded(this.host.querySelector('.frontline-detail').hidden),
      );
    this.host
      .querySelector('.frontline-close')
      .addEventListener('click', () => this.setExpanded(false));
    this.host.querySelector('.frontline-sectors').addEventListener('click', (e) => {
      const id = e.target.closest('[data-front-sector]')?.dataset.frontSector;
      const sector = this.report?.sectors.find((s) => s.id === id);
      if (sector) this.onFocus(sector);
    });
    this.onVisibility(false);
  }
  setExpanded(expanded) {
    this.host.parentElement.classList.toggle('front-detail-open', expanded);
    this.host.querySelector('.frontline-detail').hidden = !expanded;
    this.host.querySelector('.frontline-open').setAttribute('aria-expanded', String(expanded));
  }
  update(state, { visible = true } = {}) {
    this.state = state;
    this.host.hidden = !visible;
    this.host.parentElement.classList.toggle(
      'front-detail-open',
      visible && !this.host.querySelector('.frontline-detail').hidden,
    );
    if (!visible || !this.lineVisible) return;
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
    this.host.parentElement.classList.remove('front-detail-open');
    this.host.remove();
  }
}
