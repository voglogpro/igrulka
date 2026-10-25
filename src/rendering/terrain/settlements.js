import * as T from '../../../vendor/three/three.module.js';
import { SETTLEMENTS, settlementStatus } from '../../game/territory/settlements.js';
import { settlementHouseOffsets } from '../../game/territory/settlements.config.js';
import { groundHeight } from '../../game/map.js';
import { batchStatic } from '../mesh-utils.js';
import { factionHex } from '../team-colors.js';

function villageBody(world, d, houseMask) {
  const body = new T.Group();
  const paint = d.variant ? '#a79a7e' : '#939c8a';
  const roofs = d.variant ? '#686458' : '#6d7971';
  for (const [index, { x, z }] of settlementHouseOffsets(d).entries()) {
    if (!(houseMask & (1 << index))) continue;
    const height = 7 + (d.seed % 2);
    world.box(body, x, 0, z, 15, height, 14, paint);
    world.box(body, x, height, z, 17, 1.4, 16, roofs);
    world.box(body, x - 4, height + 1.4, z - 3, 1.5, 2, 1.5, '#585e55');
    world.box(body, x, 0.1, z + 7.2, 2.4, 4, 0.3, '#4b554c');
    for (const dx of [-5, 5]) world.box(body, x + dx, 3.2, z + 7.15, 2, 2.3, 0.25, '#596f72');
    for (const dx of [-7, 7]) world.box(body, x + dx, 0, z + 13, 1, 1.8, 1, '#7c8272');
    world.box(body, x, 0.7, z + 13, 14, 0.6, 0.4, '#7c8272');
  }
  world.box(body, 0, 0, 0, 7, 1, 6, '#818b79');
  world.cyl(body, 0, 1, 0, 1.3, 2, '#727a6e');
  world.cyl(body, 0, 0, 19, 0.35, 6, '#909783');
  batchStatic(body);
  return body;
}
function removeBody(body) {
  body.traverse((object) => {
    if (object.geometry?.userData.owned) {
      object.geometry.dispose();
      for (const material of Array.isArray(object.material) ? object.material : [object.material])
        material?.dispose();
    }
  });
  body.removeFromParent();
}

// Eight small abandoned villages, with static batched houses. They are map sites,
// not neutral buildings in the combat/economy registries.
export class SettlementView {
  constructor(world) {
    this.world = world;
    this.sites = new Map();
    const signGeometry = new T.BoxGeometry(6, 3, 0.5);
    for (const [index, d] of SETTLEMENTS.entries()) {
      const root = new T.Group(),
        body = villageBody(world, d, 3);
      root.userData.settlementId = d.id;
      root.position.set(d.x, groundHeight(d.x, d.z), d.z);
      root.add(body);
      const sign = new T.Mesh(
        signGeometry,
        new T.MeshStandardMaterial({ color: factionHex(null), roughness: 0.9 }),
      );
      sign.position.set(0, 4.5, 19);
      sign.castShadow = true;
      root.add(sign);
      world.scene.add(root);
      world.clearTrees(d.x, d.z, 48);
      this.sites.set(d.id, { root, body, sign, index, houseMask: 3, signature: null });
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
      const d = settlementStatus(state, id);
      model.root.visible = !!d;
      if (!d) continue;
      const houseMask = ((state.settlementHouseMask ?? 65535) >>> (model.index * 2)) & 3;
      if (houseMask !== model.houseMask) {
        removeBody(model.body);
        model.body = villageBody(this.world, d, houseMask);
        model.root.add(model.body);
        model.houseMask = houseMask;
      }
      const signature = `${d.owner}:${d.active}:${d.contested}:${d.blocked}`;
      if (signature === model.signature) continue;
      model.signature = signature;
      model.sign.material.color.set(d.contested || d.blocked ? '#dec083' : factionHex(d.owner));
      model.sign.material.emissive.set(d.active ? factionHex(d.owner) : '#000000');
      model.sign.material.emissiveIntensity = d.active ? 0.18 : 0;
    }
  }
}
