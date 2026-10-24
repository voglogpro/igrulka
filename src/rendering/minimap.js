import * as E from '../game/index.js';
import { MAP } from '../game/index.js';

// The land, the sea, hills and woods never change: paint them once per minimap size.
const backgrounds = new Map();
function background(w, h) {
  const key = w + 'x' + h;
  if (backgrounds.has(key)) return backgrounds.get(key);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d'),
    image = g.createImageData(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const wx = (x / w - 0.5) * MAP.width,
        wz = (y / h - 0.5) * MAP.depth,
        sea = E.seaDistance(wx, wz),
        hill = E.groundHeight(wx, wz),
        i = (y * w + x) * 4;
      const rgb =
        sea < 0
          ? [42 + Math.max(-40, sea) * 0.2, 76 + Math.max(-40, sea) * 0.3, 92]
          : sea < 14
            ? [120, 116, 88]
            : [38 + hill * 2.2, 56 + hill * 2.6, 45 + hill * 1.2];
      image.data.set([...rgb, 255], i);
    }
  g.putImageData(image, 0, 0);
  g.fillStyle = '#1f3524c0';
  for (const p of E.COVER_PATCHES) {
    if (!p.forest) continue;
    g.beginPath();
    g.ellipse(
      (p.x / MAP.width + 0.5) * w,
      (p.z / MAP.depth + 0.5) * h,
      (p.r / MAP.width) * w,
      (p.r / MAP.depth) * h,
      0,
      0,
      Math.PI * 2,
    );
    g.fill();
  }
  backgrounds.set(key, c);
  return c;
}
export function updateMinimap(canvas) {
  const ctx = canvas.getContext('2d'),
    w = canvas.width,
    h = canvas.height,
    sensors = E.sensorSources(this.state, 0),
    px = (x) => (x / MAP.width + 0.5) * w,
    pz = (z) => (z / MAP.depth + 0.5) * h;
  ctx.drawImage(background(w, h), 0, 0);
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
  // Border posts of the two land corridors.
  for (const z of E.CORRIDORS) {
    ctx.strokeStyle = '#cfbf96';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(px(0), pz(z) - 14);
    ctx.lineTo(px(0), pz(z) + 14);
    ctx.stroke();
    ctx.setLineDash([]);
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
