import * as E from '../game/index.js';
import { $ } from './format.js';
export function renderDefenseDetail(state, b) {
  const host = $('#defense-detail'),
    base = E.BUILDINGS[b.key] || E.GROUND_UNITS[b.key];
  if (!host || !base?.range) return;
  const d = E.defenseStats(state.sides[b.side], b),
    live =
      state.buildings.find((x) => x.id === b.id) || state.groundUnits.find((x) => x.id === b.id),
    sig = b.id + ':' + (b.level || 0) + ':' + (b.hp > 0);
  if (host.dataset.unit !== sig) {
    host.dataset.unit = sig;
    host.innerHTML = `<div class="defense-meter"><span id="heat-label"></span><meter id="heat-meter" min="0" max="1.5" value="0"></meter></div><div id="ammo-label" class="status-note"></div><div class="small-muted">${b.key === 'sam' ? 'Перехват дронов и ракет' : 'Только дроны · ракеты не перехватывает'}</div>`;
  }
  $('#heat-label').textContent = 'Нагрев ' + Math.round((live.heat || 0) * 100) + '%';
  $('#heat-meter').value = live.heat || 0;
  $('#ammo-label').textContent =
    (live.groundReload || live.reloadLeft) > 0
      ? 'Перезарядка ' + (live.groundReload || live.reloadLeft).toFixed(1) + ' с'
      : 'Боезапас ' +
        (E.isInfantry(b.key) || b.key === 'gun'
          ? (live.groundAmmo ?? d.magazine)
          : (live.ammo ?? d.magazine)) +
        ' / ' +
        d.magazine;
}
