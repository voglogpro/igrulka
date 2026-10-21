import { disposeTree, batchStatic } from './mesh-utils.js';
import * as T from '../../vendor/three/three.module.js';
import * as E from '../game/index.js';
import { BUILDINGS } from '../game/index.js';
import { aircraftModel } from './models/aircraft.js';
import { groundModel, animateGround } from './models/ground.js';
export function sync() {
  for (const b of this.state.buildings) {
    let m = this.models.get(b.id);
    if (b.demolished) {
      if (m) {
        disposeTree(m.root, this.sharedGeometries, this.sharedMaterials);
        this.models.delete(b.id);
        this.renderer.shadowMap.needsUpdate = true;
      }
      continue;
    }
    if (!m) {
      m = this.model(b);
      this.models.set(b.id, m);
      this.renderer.shadowMap.needsUpdate = true;
    }
    if (b.hp <= 0) {
      if (!m.dead) {
        m.dead = true;
        m.collapseAt = m.wasAlive ? this.battleTime : -100;
        m.scaffold.visible = false;
        const rubble = new T.Group();
        for (let i = 0; i < 14; i++) {
          const a = i * 2.399,
            r = 3 + (i % 4) * 3,
            cube = this.box(
              rubble,
              Math.cos(a) * r,
              0.2,
              Math.sin(a) * r,
              3 + (i % 4),
              1 + (i % 3),
              3 + (i % 5),
              i % 2 ? '#4b4a42' : '#66685f',
            );
          cube.rotation.set(i * 0.23, i, 0.2);
        }
        const scorch = new T.Mesh(
          new T.CircleGeometry((BUILDINGS[b.key]?.size || 28) * 0.8, 24),
          new T.MeshBasicMaterial({
            color: '#242b29',
            transparent: true,
            opacity: 0.75,
            depthWrite: false,
          }),
        );
        scorch.rotation.x = -Math.PI / 2;
        scorch.position.y = 0.7;
        rubble.add(scorch);
        batchStatic(rubble);
        m.root.add(rubble);
        this.renderer.shadowMap.needsUpdate = true;
      }
      const t = Math.min(1, (this.battleTime - m.collapseAt) / 0.7);
      m.content.visible = t < 1;
      m.content.scale.y = Math.max(0.03, 1 - t);
      m.content.rotation.z = t * 0.13;
      continue;
    }
    m.wasAlive = true;
    m.content.scale.y = 0.08 + 0.92 * b.progress;
    m.scaffold.visible = b.progress < 1;
    if (m.progress !== Math.floor(b.progress * 8)) {
      m.progress = Math.floor(b.progress * 8);
      this.renderer.shadowMap.needsUpdate = true;
    }
    const turret = m.root.userData.turret;
    if (turret) {
      if (b.key === 'radar') turret.rotation.y = this.battleTime * 0.7;
      else if (Number.isFinite(b.targetX)) {
        const aim = Math.atan2(b.targetX - b.x, b.targetZ - b.z) - m.root.rotation.y + Math.PI,
          delta =
            T.MathUtils.euclideanModulo(aim - turret.rotation.y + Math.PI, Math.PI * 2) - Math.PI;
        turret.rotation.y += delta * 0.28;
      }
      if (m.root.userData.pitch) {
        const pitch = m.root.userData.pitch;
        pitch.rotation.x = Math.atan2(
          (b.targetY || 8) - 8,
          Math.hypot((b.targetX || b.x) - b.x, (b.targetZ || b.z) - b.z) || 1,
        );
        m.recoil = Math.max(0, (m.recoil || 0) - this.visualDt * 8);
        pitch.position.z = (m.recoil || 0) * (b.key === 'gun' ? 0.35 : 1.3);
      }
    }
  }
  const roads = this.state.roads.filter((r) => !r.removed),
    layout = roads.map((r) => r.id).join(',');
  if (layout !== this.roadLayout) {
    this.roadLayout = layout;
    this.streetLayout = roads.map((r) => ({
      a: { x: r.ax, z: r.az },
      b: { x: r.bx, z: r.bz },
      width: r.connectorTo ? 5 : 10,
      index: r.id,
    }));
    for (const root of this.roadModels.values())
      disposeTree(root, this.sharedGeometries, this.sharedMaterials);
    this.roadModels.clear();
    this.roadVisuals.clear();
  }
  for (const r of roads) {
    const visual = (E.passable(r) ? 1 : 0) + ':' + Math.ceil((r.hp / r.maxHp) * 3);
    if (this.roadVisuals.get(r.id) === visual) continue;
    const old = this.roadModels.get(r.id);
    if (old) disposeTree(old, this.sharedGeometries, this.sharedMaterials);
    const root = this.road(r, this.streetLayout);
    batchStatic(root);
    this.roadModels.set(r.id, root);
    this.roadVisuals.set(r.id, visual);
    this.renderer.shadowMap.needsUpdate = true;
  }
  const ids = new Set();
  for (const u of this.state.units) {
    ids.add(u.id);
    let m = this.unitModels.get(u.id);
    if (!m && u.delay > 0) continue;
    if (!m) {
      m = aircraftModel(this, u);
      this.scene.add(m);
      this.unitModels.set(u.id, m);
    }
    m.visible = u.delay <= 0;
    m.position.set(u.x, u.y, u.z);
    const yaw = Math.atan2(u.vx || u.tx - u.x, u.vz || u.tz - u.z),
      speed = Math.hypot(u.vx || 0, u.vz || 0) || 1,
      pitch = -Math.atan2(u.vy || 0, speed);
    let bank = Math.sin(u.phase + u.travelled * 0.018) * 0.07;
    if (u.hp / u.maxHp < 0.45) bank += Math.sin(this.battleTime * 12 + u.phase) * 0.12;
    if (u.status === 'falling') {
      bank = u.spin * u.fallAge;
      const wings = m.userData.wings;
      if (wings?.[u.missingWing < 0 ? 0 : 1]) wings[u.missingWing < 0 ? 0 : 1].visible = false;
    }
    m.rotation.set(pitch, yaw, bank, 'YXZ');
    for (const rotor of m.userData.props || [])
      if (u.status !== 'falling') {
        if (u.subtype === 'fpv') rotor.rotation.y = this.battleTime * 120;
        else rotor.rotation.z = this.battleTime * 120;
      }
    if (m.userData.details)
      m.userData.details.visible = this.camera.position.distanceTo(m.position) < 620;
  }
  for (const [id, m] of this.unitModels)
    if (!ids.has(id)) {
      m.removeFromParent();
      this.unitModels.delete(id);
    }
  const groundIds = new Set();
  for (const u of this.state.groundUnits || []) {
    groundIds.add(u.id);
    let m = this.groundModels.get(u.id);
    if (!m) {
      m = groundModel(this, u);
      this.scene.add(m);
      this.groundModels.set(u.id, m);
    }
    m.visible = !u.carrierId && E.groundVisible(this.state, 0, u);
    animateGround(m, u, this.battleTime);
  }
  for (const [id, m] of this.groundModels)
    if (!groundIds.has(id)) {
      m.traverse((o) => {
        if (o.isInstancedMesh) o.dispose();
      });
      m.removeFromParent();
      this.groundModels.delete(id);
    }
  if (this.selected) {
    const t = E.targetById(this.state, this.selected);
    if (t?.ground) {
      this.selection.position.set(t.x, 1.5, t.z);
      this.coverage.position.set(t.x, 1.4, t.z);
    } else if (!t) {
      this.selection.visible = this.coverage.visible = false;
    }
  }
  this.infantry.sync(this.state.groundUnits || [], this.battleTime);
  this.syncTrenches();
  this.tactical?.previewGround(this.state.groundUnits?.find((u) => u.id === this.selected));
  this.combatFX.updateTracers(this.state.projectiles);
  for (const e of this.state.events)
    if (e.id > this.eventId) {
      this.eventId = e.id;
      this.combatFX.handle(e);
      if (e.type === 'groundDestroyed') {
        if (E.isInfantry(e.key)) {
          for (let i = 0; i < 5; i++)
            this.combatFX.puff(e.x, 0.8, e.z, 0.6, 0.7, {
              opacity: 0.16,
              vy: 1,
              color: [0.3, 0.28, 0.22],
            });
        } else {
          this.combatFX.explode(e.x, 2, e.z, 1);
          this.addShake(e.x, e.z, 0.5);
        }
      }
      if (e.type === 'shot') {
        const model = this.models.get(e.buildingId);
        if (model) model.recoil = 1;
      }
      if (['impact', 'crash'].includes(e.type) || (e.type === 'intercept' && e.mode === 'burst'))
        this.addShake(e.x, e.z, e.key === 'ballistic' ? 2.5 : 1);
      this.callbacks.onEvent?.(e);
    }
}
