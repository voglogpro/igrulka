import * as T from '../../../vendor/three/three.module.js';
import * as E from '../../game/index.js';
import { BUILDINGS } from '../../game/index.js';
export function setBuild(key) {
  this.buildKey = key;
  this.roadAnchor = null;
  this.disposeContents(this.ghost);
  this.coverage.visible = false;
  this.rotation = 0;
  if (!key) {
    this.ghost.visible = false;
    return;
  }
  if (key === 'road') {
    const m = new T.Mesh(
      this.boxGeo,
      new T.MeshBasicMaterial({
        color: '#9ee3bd',
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
      }),
    );
    m.scale.set(10, 0.16, 1);
    this.ghost.add(m);
  } else {
    const size = BUILDINGS[key].size;
    const outline = new T.LineSegments(
      new T.EdgesGeometry(new T.BoxGeometry(size + 4, 8, size + 4)),
      new T.LineBasicMaterial({ color: '#a4ecc3' }),
    );
    outline.position.y = 4;
    this.ghost.add(outline);
    const pad = new T.Mesh(
      new T.PlaneGeometry(size + 4, size + 4),
      new T.MeshBasicMaterial({
        color: '#a4ecc3',
        transparent: true,
        opacity: 0.13,
        depthWrite: false,
        side: T.DoubleSide,
      }),
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = 0.85;
    this.ghost.add(pad);
  }
  this.updateGhost(this.lastPointer);
}

export function cancelRoad() {
  if (this.roadAnchor) {
    this.roadAnchor = null;
    this.updateGhost(this.lastPointer);
    this.callbacks.onRoadPreview?.(null);
    return true;
  }
  return false;
}

export async function pointerUp(e) {
  if (e.button !== 0) return;
  this.selectionBox.hidden = true;
  this.keys.MouseLeft = false;
  const down = this.down;
  this.down = null;
  if (this.callbacks.isModal?.()) return;
  if (!down || this.controls.rotating) return;
  const p = this.groundPoint(e);
  if (!p) return;
  const dragged = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 7;
  if (this.groundTargeting) {
    if (this.groundTargeting === 'defendline') this.callbacks.onGroundLine?.(down.ground, p);
    else if (!dragged) this.callbacks.onGroundTarget?.(p);
    return;
  }
  if (this.aiming) {
    if (!dragged) this.callbacks.onAimPoint?.(p, { shift: e.shiftKey });
    return;
  }
  if (this.buildKey === 'road') {
    const end = E.snapRoadPoint(this.state, 0, p.x, p.z, this.roadAnchor, e.shiftKey);
    if (dragged && down.ground && !this.roadAnchor)
      this.roadAnchor = E.snapRoadPoint(this.state, 0, down.ground.x, down.ground.z);
    if (!this.roadAnchor) {
      this.roadAnchor = end;
      this.updateGhost(e);
      return;
    }
    const start = this.roadAnchor;
    if (Math.hypot(start.x - end.x, start.z - end.z) < 8) return;
    const result = await this.callbacks.onRoad?.(start, end);
    if (this.buildKey !== 'road' || this.roadAnchor !== start) return;
    if (result) this.roadAnchor = end;
    this.updateGhost(e);
    return;
  }
  if (dragged) {
    const left = Math.min(down.x, e.clientX),
      right = Math.max(down.x, e.clientX),
      top = Math.min(down.y, e.clientY),
      bottom = Math.max(down.y, e.clientY),
      r = this.renderer.domElement.getBoundingClientRect(),
      ids = this.state.groundUnits
        .filter((u) => {
          if (u.side !== 0 || u.hp <= 0 || u.carrierId) return false;
          const v = new T.Vector3(u.x, u.y + 1, u.z).project(this.camera),
            x = r.left + ((v.x + 1) * r.width) / 2,
            y = r.top + ((1 - v.y) * r.height) / 2;
          return v.z < 1 && x >= left && x <= right && y >= top && y <= bottom;
        })
        .map((u) => u.id);
    this.callbacks.onBoxSelect?.(ids, e.shiftKey);
    return;
  }
  if (this.buildKey) {
    this.callbacks.onBuild?.(this.buildKey, p.x, p.z, this.rotation);
    this.updateGhost(e);
    return;
  }
  const clicked = pickTarget.call(this),
    chosen = E.targetById(this.state, this.selected);
  if (clicked) {
    if (chosen?.ground && chosen.side === 0) {
      if (E.isInfantry(chosen.key) && clicked.key === 'apc' && clicked.side === 0 && !e.shiftKey) {
        this.callbacks.onGroundOrder?.({ x: clicked.x, z: clicked.z, boardId: clicked.id });
        return;
      }
      if (clicked.side === 1) {
        this.callbacks.onGroundOrder?.({ x: clicked.x, z: clicked.z, targetId: clicked.id });
        return;
      }
    }
    this.callbacks.onSelect?.(clicked.id, e.shiftKey);
    return;
  }
  const road = this.state.roads
    .filter((r) => !r.removed && E.observedTarget(this.state, 0, r.id))
    .map((r) => ({ r, d: E.segmentDistance(p.x, p.z, r.ax, r.az, r.bx, r.bz) }))
    .filter((v) => v.d < 7)
    .sort((a, b) => a.d - b.d)[0];
  if (chosen?.ground && chosen.side === 0) {
    this.callbacks.onGroundOrder?.({ x: p.x, z: p.z });
    return;
  }
  this.callbacks.onSelect?.(road?.r.id ?? null);
}

function pickTarget() {
  this.ray.setFromCamera(this.pointer, this.camera);
  const roots = [...this.models.values()]
    .map((m) => m.root)
    .concat([...this.groundModels.values()], this.infantry.meshes)
    .filter((root) => root.visible);
  for (const hit of this.ray.intersectObjects(roots, true)) {
    let id;
    if (hit.object.userData.infantryBatch) id = hit.object.userData.unitIds[hit.instanceId];
    else {
      let obj = hit.object;
      while (obj && !obj.userData.buildingId && !obj.userData.groundId) obj = obj.parent;
      id = obj?.userData.buildingId || obj?.userData.groundId;
    }
    if (id) {
      const target = E.observedTarget(this.state, 0, id);
      if (target) return target;
    }
  }
  return null;
}

// Short right-click gives an order. A dragged right button is reserved for the camera.
export function groundCommandAt(e) {
  const p = this.groundPoint(e);
  if (!p) return;
  const target = pickTarget.call(this);
  const canBoard =
    target?.side === 0 &&
    target.key === 'apc' &&
    this.armySelection.some((id) => {
      const unit = E.targetById(this.state, id);
      return unit && E.isInfantry(unit.key);
    });
  this.callbacks.onGroundOrder?.(
    target?.side === 1
      ? { x: target.x, z: target.z, targetId: target.id }
      : canBoard
        ? { x: target.x, z: target.z, boardId: target.id }
        : { x: p.x, z: p.z },
  );
}

export function groundPoint(e) {
  if (!e) return null;
  const r = this.renderer.domElement.getBoundingClientRect();
  this.pointer.set(
    ((e.clientX - r.left) / r.width) * 2 - 1,
    (-(e.clientY - r.top) / r.height) * 2 + 1,
  );
  this.ray.setFromCamera(this.pointer, this.camera);
  return this.ray.ray.intersectPlane(this.plane, new T.Vector3());
}

export function updateGhost(e) {
  if (!this.buildKey) return;
  const p = this.groundPoint(e);
  if (!p) return;
  this.ghost.visible = true;
  if (this.buildKey === 'road') {
    const point = E.snapRoadPoint(this.state, 0, p.x, p.z, this.roadAnchor, e?.shiftKey);
    let start = this.roadAnchor;
    if (!start && this.down?.button === 0 && this.keys.MouseLeft && this.down.ground)
      start = E.snapRoadPoint(this.state, 0, this.down.ground.x, this.down.ground.z);
    if (start) {
      const length = Math.hypot(point.x - start.x, point.z - start.z),
        check = E.roadPreview(this.state, 0, start.x, start.z, point.x, point.z);
      this.ghost.position.set((point.x + start.x) / 2, 0.95, (point.z + start.z) / 2);
      this.ghost.rotation.y = Math.atan2(point.x - start.x, point.z - start.z);
      this.ghost.children[0].scale.set(10, 0.16, Math.max(1, length));
      this.ghost.children[0].material.color.set(check.error ? '#f0967c' : '#a4ecc3');
      this.callbacks.onRoadPreview?.(check);
    } else {
      this.ghost.position.set(point.x, 0.95, point.z);
      this.ghost.children[0].scale.set(11, 0.16, 11);
    }
    return;
  }
  this.ghost.position.set(p.x, 0, p.z);
  const plan = E.placementPlan(this.state, 0, this.buildKey, p.x, p.z);
  this.ghost.rotation.y = (plan.rotation || 0) + this.rotation;
  const color = plan.error ? '#f3967c' : '#a4ecc3';
  for (const m of this.ghost.children) m.material.color.set(color);
  this.callbacks.onPlacementPreview?.(plan);
}
