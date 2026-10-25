import * as E from '../game/index.js';

const perMinute = (n) => Math.round(n * 60);
export class DistrictHUD {
  constructor({ onFocus, onCapture, onRepair, canInteract }) {
    Object.assign(this, { onFocus, onCapture, onRepair, canInteract });
    this.host = document.createElement('aside');
    this.host.id = 'district-strip';
    this.host.hidden = true;
    this.host.setAttribute('aria-label', 'Стратегические районы');
    for (const d of E.DISTRICTS) {
      const card = document.createElement('div');
      card.className = 'district-card glass';
      card.dataset.district = d.id;
      card.innerHTML = `<button class="district-focus" data-district-focus="${d.id}"><b>${d.name}</b><small></small></button><button class="district-order" data-district-order="${d.id}" aria-label="Отправить выбранные войска: ${d.name}">↗</button><button class="district-repair" data-district-repair="${d.id}" aria-label="Восстановить район: ${d.name}" hidden>↻</button><i class="district-control"></i>`;
      this.host.append(card);
    }
    document.querySelector('#game').append(this.host);
    this.host.addEventListener('click', (event) => {
      if (!this.canInteract()) return;
      const b = event.target.closest('button');
      if (!b || b.disabled) return;
      if (b.dataset.districtFocus) this.onFocus(b.dataset.districtFocus);
      if (b.dataset.districtOrder) this.onCapture(b.dataset.districtOrder);
      if (b.dataset.districtRepair) this.onRepair(b.dataset.districtRepair);
    });
  }
  update(state, selection, visible) {
    this.host.hidden = !visible;
    if (!visible) return;
    const units = state.groundUnits.filter(
      (u) => selection.includes(u.id) && u.hp > 0 && !u.carrierId,
    );
    const foot = units.some((u) => E.isInfantry(u.key));
    for (const card of this.host.children) {
      const d = E.districtStatus(state, card.dataset.district);
      if (!d) {
        card.hidden = true;
        continue;
      }
      card.hidden = false;
      const focus = card.querySelector('.district-focus'),
        order = card.querySelector('.district-order'),
        repair = card.querySelector('.district-repair');
      card.dataset.owner =
        d.owner == null
          ? 'neutral'
          : d.owner === 0
            ? 'own'
            : E.allied(state, 0, d.owner)
              ? 'ally'
              : 'enemy';
      card.classList.toggle('contested', d.contested || d.blocked);
      const label =
        d.owner == null
          ? 'Нейтральный'
          : d.owner === 0
            ? 'Наш'
            : E.allied(state, 0, d.owner)
              ? 'Союзник'
              : 'Противник';
      const sign = E.teamOf(state, d.capturing) === 0 ? 1 : -1;
      const neutralizing = d.owner != null || d.control * sign < 0;
      const percent = Math.round(
        (neutralizing ? 1 - Math.abs(d.control) : Math.abs(d.control)) * 100,
      );
      focus.querySelector('small').textContent = d.contested
        ? 'Оспаривается'
        : d.capturing != null
          ? `${d.capturing === 0 ? (neutralizing ? 'Сброс' : 'Захват') : E.allied(state, 0, d.capturing) ? 'Союзник' : 'Враг'} ${percent}%`
          : d.repairing
            ? `Ремонт ${Math.round((d.hp / d.maxHp) * 100)}%`
            : d.hp <= 0
              ? `Разрушен · ${label.toLowerCase()}`
              : d.blocked
                ? 'Доход остановлен'
                : label;
      focus.title = `${E.DISTRICT_TYPES[d.type].name}. Полный доход: ${perMinute(d.income)} денег, ${perMinute(d.materials)} сплавов в минуту. Состояние ${Math.ceil(d.hp)}/${d.maxHp}. Пехота захватывает за 22 с; техника только оспаривает. Нажмите для перехода.`;
      const friendly = E.allied(state, 0, d.owner);
      order.disabled = !units.length || (!foot && !friendly);
      order.title = !units.length
        ? 'Сначала выделите пехоту или охрану района'
        : !foot && !friendly
          ? 'Для захвата нужна пехота вне БТР'
          : friendly
            ? 'Направить выбранные войска охранять район'
            : 'Направить выбранную пехоту захватить район';
      repair.hidden = d.owner !== 0 || d.hp >= d.maxHp;
      repair.textContent = d.repairing ? '■' : '↻';
      repair.title = d.repairing
        ? 'Остановить восстановление'
        : `Восстановить: до ${Math.ceil((d.maxHp - d.hp) * E.DISTRICT_RULES.repairCreditsPerHp)} денег и ${Math.ceil((d.maxHp - d.hp) * E.DISTRICT_RULES.repairMaterialsPerHp)} сплавов. Ресурсы расходуются постепенно; при блокаде ремонт ждёт.`;
      card.querySelector('.district-control').style.width = `${Math.abs(d.control) * 100}%`;
    }
  }
}
