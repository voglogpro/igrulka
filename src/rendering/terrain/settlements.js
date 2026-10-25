import * as T from '../../../vendor/three/three.module.js';
import { SETTLEMENTS } from '../../game/territory/settlements.js';
import {
  settlementLayout,
  settlementComponentEnabled,
} from '../../game/territory/settlements.config.js';
import { BUILDINGS } from '../../game/index.js';
import { groundHeight } from '../../game/map.js';
import { batchStatic, disposeTree } from '../mesh-utils.js';
import { factionHex } from '../team-colors.js';

function neutralCity(world, site, state) {
  const body = new T.Group(),
    layout = settlementLayout(site);
  for (const component of layout.components) {
    if (!settlementComponentEnabled(state, site, component.slot)) continue;
    const d = BUILDINGS[component.key];
    const model = world.model({
      ...component,
      id: `neutral-${site.id}-${component.slot}`,
      side: null,
      hp: d.hp,
      maxHp: d.hp,
      level: 0,
      progress: 1,
    });
    model.root.removeFromParent();
    delete model.root.userData.buildingId;
    model.root.position.x -= site.x;
    model.root.position.z -= site.z;
    model.root.position.y -= groundHeight(site.x, site.z);
    model.scaffold.visible = false;
    body.add(model.root);
  }
  for (const road of layout.roads) {
    if (road.slot != null && !settlementComponentEnabled(state, site, road.slot)) continue;
    const mesh = world.box(
      body,
      (road.ax + road.bx) / 2 - site.x,
      0.56,
      (road.az + road.bz) / 2 - site.z,
      7,
      0.12,
      Math.hypot(road.bx - road.ax, road.bz - road.az),
      '#626b65',
    );
    mesh.rotation.y = Math.atan2(road.bx - road.ax, road.bz - road.az);
  }
  batchStatic(body);
  return body;
}

// Neutral previews disappear on claim; normal building/road models own the city.
export class SettlementView {
  constructor(world) {
    this.world = world;
    this.sites = new Map();
    const signGeometry = new T.BoxGeometry(6, 3, 0.5);
    world.sharedGeometries.add(signGeometry);
    for (const site of SETTLEMENTS) {
      const root = new T.Group(),
        layout = settlementLayout(site);
      root.userData.settlementId = site.id;
      root.position.set(site.x, groundHeight(site.x, site.z), site.z);
      const sign = new T.Mesh(
        signGeometry,
        new T.MeshStandardMaterial({ color: factionHex(null), roughness: 0.9 }),
      );
      sign.position.set(layout.entrance.x - site.x + 10, 4.5, layout.entrance.z - site.z);
      sign.castShadow = true;
      root.add(sign);
      const entry = new T.Mesh(
        new T.RingGeometry(6, 7.2, 24),
        new T.MeshBasicMaterial({
          color: '#d5bc83',
          side: T.DoubleSide,
          transparent: true,
          opacity: 0.8,
          depthWrite: false,
        }),
      );
      entry.rotation.x = -Math.PI / 2;
      entry.position.set(layout.entrance.x - site.x, 0.75, layout.entrance.z - site.z);
      root.add(entry);
      world.scene.add(root);
      this.sites.set(site.id, {
        root,
        sign,
        entry,
        body: null,
        layoutSignature: null,
        config: site,
      });
    }
  }
  pick(ray) {
    for (const hit of ray.intersectObjects(
      [...this.sites.values()].filter((m) => m.root.visible).map((m) => m.root),
      true,
    ))
      for (let object = hit.object; object; object = object.parent)
        if (object.userData.settlementId) return object.userData.settlementId;
    return null;
  }
  sync(state) {
    for (const [id, model] of this.sites) {
      const value = state.settlements?.find((site) => site.id === id);
      model.root.visible = !!value;
      if (!value) continue;
      const site = { ...model.config, ...value };
      const signature = `${site.materialized}:${settlementLayout(site)
        .components.map((c) => Number(settlementComponentEnabled(state, site, c.slot)))
        .join('')}`;
      if (signature !== model.layoutSignature) {
        if (model.body)
          disposeTree(model.body, this.world.sharedGeometries, this.world.sharedMaterials);
        model.body = site.materialized ? null : neutralCity(this.world, site, state);
        if (model.body) model.root.add(model.body);
        model.layoutSignature = signature;
        if (this.world.renderer) this.world.renderer.shadowMap.needsUpdate = true;
      }
      const color = site.contested || site.blocked ? '#dec083' : factionHex(site.owner);
      model.sign.material.color.set(color);
      model.entry.material.color.set(site.owner == null ? '#d5bc83' : color);
    }
  }
}
