import { FIELD } from '../map.js';
const finite = (v, min = -Infinity, max = Infinity) => Number.isFinite(v) && v >= min && v <= max;
const point = (p) =>
  !!p && typeof p === 'object' && finite(p.x, -FIELD.x, FIELD.x) && finite(p.z, -FIELD.z, FIELD.z);

// Oil stocks, burning tanks and merchant ships (state version 12).
export function restoreOil(s) {
  for (const f of s.sides) {
    if (s.version < 12) f.oil ??= 150;
    if (!finite(f.oil, 0, 1e7)) throw Error('Повреждён запас нефти');
    if (f.oilRate != null && !finite(f.oilRate)) throw Error('Повреждён запас нефти');
  }
  for (const b of s.buildings)
    if (b.fire != null && !finite(b.fire, 0, 1000)) throw Error('Повреждён пожар хранилища');
  if (s.version < 12) s.ships ??= [];
  if (!Array.isArray(s.ships) || s.ships.length > 200) throw Error('Повреждён флот');
  const ports = new Map(s.buildings.filter((b) => b.key === 'port').map((b) => [b.id, b])),
    ids = new Set();
  for (const ship of s.ships) {
    const port = ports.get(ship?.portId);
    if (
      !point(ship) ||
      !Number.isSafeInteger(ship.id) ||
      ids.has(ship.id) ||
      !port ||
      port.side !== ship.side ||
      !finite(ship.yaw) ||
      !['docked', 'outbound', 'trading', 'returning'].includes(ship.state) ||
      !finite(ship.wait, 0, 1000) ||
      !Array.isArray(ship.path) ||
      ship.path.length > 4 ||
      !ship.path.every(point) ||
      (ship.cargo != null &&
        !['credits', 'materials', 'oil', 'sold'].every((k) => finite(ship.cargo[k], 0, 1e6)))
    )
      throw Error('Повреждён флот');
    ids.add(ship.id);
  }
  // Keep only the fields the rules use.
  s.ships = s.ships.map(({ id, side, portId, x, z, yaw, state, wait, path, cargo }) => ({
    id,
    side,
    portId,
    x,
    z,
    yaw,
    state,
    wait,
    path: path.map(({ x, z }) => ({ x, z })),
    cargo: cargo
      ? { credits: cargo.credits, materials: cargo.materials, oil: cargo.oil, sold: cargo.sold }
      : null,
  }));
}
