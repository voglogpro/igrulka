import * as E from '../game/index.js';
import { MAP, riverX } from '../game/index.js';
export function updateMinimap(canvas) {
  const ctx = canvas.getContext('2d'),
    w = canvas.width,
    h = canvas.height,
    sensors = E.sensorSources(this.state, 0),
    px = (x) => (x / MAP.width + 0.5) * w,
    pz = (z) => (z / MAP.depth + 0.5) * h;
  ctx.fillStyle = '#26382f';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#567b88';
  ctx.lineWidth = 9;
  ctx.beginPath();
  for (let i = 0; i <= 100; i++) ctx.lineTo(px(riverX((i / 100 - 0.5) * MAP.depth)), (i / 100) * h);
  ctx.stroke();
  for (const raw of this.state.roads) {
    const r = E.observedTarget(this.state, 0, raw.id, sensors);
    if (!r || r.removed) continue;
    ctx.strokeStyle = E.passable(r) ? (r.side === 0 ? '#a4bdab' : '#ba9e8b') : '#ff6549';
    ctx.lineWidth = r.connectorTo ? 0.5 : 1.2;
    ctx.beginPath();
    ctx.moveTo(px(r.ax), pz(r.az));
    ctx.lineTo(px(r.bx), pz(r.bz));
    ctx.stroke();
  }

  for (const raw of this.state.buildings) {
    const b = E.observedTarget(this.state, 0, raw.id, sensors);
    if (!b || b.hp <= 0) continue;
    ctx.fillStyle = b.side === 0 ? '#9addb5' : '#e69a80';
    ctx.fillRect(px(b.x) - 2, pz(b.z) - 2, b.key === 'hq' ? 6 : 3, b.key === 'hq' ? 6 : 3);
  }
  for (const p of sensors.filter((p) => p.kind === 'radar')) {
    ctx.strokeStyle = '#8dccd650';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.ellipse(
      px(p.x),
      pz(p.z),
      (p.air / MAP.width) * w,
      (p.air / MAP.depth) * h,
      0,
      0,
      Math.PI * 2,
    );
    ctx.stroke();
  }
  // Cells nobody observes are dimmed; a working radar clears the whole map.
  const vision = E.visionOf(this.state, 0);
  if (!vision.radar) {
    const g = E.VISION_GRID,
      cw = (g.cell / MAP.width) * w,
      ch = (g.cell / MAP.depth) * h;
    ctx.fillStyle = '#0a1418a8';
    for (let row = 0; row < g.rows; row++)
      for (let col = 0; col < g.cols; col++)
        if (!vision.grid[row * g.cols + col])
          ctx.fillRect(px(g.ox + col * g.cell), pz(g.oz + row * g.cell), cw + 0.6, ch + 0.6);
  }
  const frontline = this.frontlineView;
  if (frontline?.enabled && frontline.report) {
    const points = frontline.report.polyline;
    ctx.lineWidth = 1.3;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i],
        b = points[i + 1];
      const known = a.knowledge === 'observed' && b.knowledge === 'observed';
      const pressure = Math.max(
        frontline.report.sectors[i].pressure,
        frontline.report.sectors[i + 1].pressure,
      );
      ctx.strokeStyle = pressure >= 1.15 ? '#efa565' : known ? '#75d8b8' : '#91a4a9aa';
      ctx.setLineDash(known ? [] : [2, 3]);
      ctx.beginPath();
      ctx.moveTo(px(a.x), pz(a.z));
      ctx.lineTo(px(b.x), pz(b.z));
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  for (const u of this.state.groundUnits || []) {
    if (!E.groundVisible(this.state, 0, u)) continue;
    ctx.fillStyle = u.side === 0 ? '#a6d7ff' : '#ffa48a';
    ctx.fillRect(px(u.x) - 1.5, pz(u.z) - 1.5, 3, 3);
  }
  for (const z of E.BRIDGES) {
    ctx.strokeStyle = '#cfbf96';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px(E.riverX(z) - 110), pz(z));
    ctx.lineTo(px(E.riverX(z) + 110), pz(z));
    ctx.stroke();
  }
  for (const d of E.DISTRICTS) {
    const value = E.districtStatus(this.state, d.id);
    if (!value) continue;
    ctx.strokeStyle =
      value.contested || value.blocked
        ? '#f0bd80'
        : value.owner === 0
          ? '#b2e6bf'
          : value.owner === 1
            ? '#eea080'
            : '#b9c4af';
    ctx.fillStyle = value.hp > 0 ? '#293b34' : '#5f5145';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(px(d.x), pz(d.z) - 4);
    ctx.lineTo(px(d.x) + 4, pz(d.z));
    ctx.lineTo(px(d.x), pz(d.z) + 4);
    ctx.lineTo(px(d.x) - 4, pz(d.z));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  for (const u of this.state.units)
    if (E.unitVisible(this.state, 0, u, sensors)) {
      ctx.fillStyle = u.side === 0 ? '#c8f4db' : '#ffb5a0';
      ctx.beginPath();
      ctx.arc(px(u.x), pz(u.z), 1.7, 0, Math.PI * 2);
      ctx.fill();
    }
  if (this.orderPreview) {
    const origin = E.selectedLaunchSite(this.state, 0, this.orderPreview.siteId),
      aim = E.resolveAim(this.state, 0, this.orderPreview.aim);
    if (origin && aim) {
      ctx.strokeStyle = '#eabe99';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(px(origin.x), pz(origin.z));
      for (const p of E.flightRoute(origin, aim, this.orderPreview.key))
        ctx.lineTo(px(p.x), pz(p.z));
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  for (const c of this.state.contacts?.[0] || []) {
    ctx.strokeStyle = '#f0b78699';
    ctx.beginPath();
    ctx.ellipse(
      px(c.x),
      pz(c.z),
      (c.radius / MAP.width) * w,
      (c.radius / MAP.depth) * h,
      0,
      0,
      Math.PI * 2,
    );
    ctx.stroke();
  }
  const t = this.controls.target;
  ctx.strokeStyle = '#ffffff90';
  ctx.lineWidth = 1;
  const d = this.camera.position.distanceTo(t) * 0.4;
  ctx.strokeRect(
    px(t.x - d),
    pz(t.z - d * 0.6),
    ((d * 2) / MAP.width) * w,
    ((d * 1.2) / MAP.depth) * h,
  );
}
