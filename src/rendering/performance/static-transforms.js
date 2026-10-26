// A batched building still owns its original hierarchy for transparent details,
// scaffolding and picking. Freeze its matrices between actual transform changes
// so scene.updateMatrixWorld does not repeat the hidden proxy's math each frame.
function localState(object) {
  return {
    object,
    position: object.position.clone(),
    quaternion: object.quaternion.clone(),
    scale: object.scale.clone(),
    visible: object.visible,
    children: object.children.length,
  };
}

function changed(state, object) {
  if (!state || state.object !== object) return true;
  return (
    !state.position.equals(object.position) ||
    !state.quaternion.equals(object.quaternion) ||
    !state.scale.equals(object.scale) ||
    state.visible !== object.visible ||
    state.children !== object.children.length
  );
}

function remember(state, object) {
  if (!state || state.object !== object) return localState(object);
  state.position.copy(object.position);
  state.quaternion.copy(object.quaternion);
  state.scale.copy(object.scale);
  state.visible = object.visible;
  state.children = object.children.length;
  return state;
}

export class StaticTransforms {
  constructor() {
    this.records = new Map();
  }
  sync(model) {
    const { root, content, scaffold } = model;
    let record = this.records.get(root);
    if (
      record &&
      !changed(record.root, root) &&
      !changed(record.content, content) &&
      !changed(record.scaffold, scaffold)
    )
      return false;
    if (!record) {
      record = { flags: new Map() };
      this.records.set(root, record);
    }
    record.root = remember(record.root, root);
    record.content = remember(record.content, content);
    record.scaffold = remember(record.scaffold, scaffold);
    root.parent?.updateWorldMatrix(true, false);
    const seen = new Set();
    root.traverse((object) => {
      seen.add(object);
      let flags = record.flags.get(object);
      if (!flags) {
        flags = { local: object.matrixAutoUpdate, world: object.matrixWorldAutoUpdate };
        record.flags.set(object, flags);
      }
      if (flags.local) object.updateMatrix();
      if (flags.world) {
        if (object.parent)
          object.matrixWorld.multiplyMatrices(object.parent.matrixWorld, object.matrix);
        else object.matrixWorld.copy(object.matrix);
      }
      object.matrixWorldNeedsUpdate = false;
      object.matrixAutoUpdate = object.matrixWorldAutoUpdate = false;
    });
    for (const [object, flags] of record.flags)
      if (!seen.has(object)) {
        this.restoreObject(object, flags);
        record.flags.delete(object);
      }
    return true;
  }
  restoreObject(object, flags) {
    object.matrixAutoUpdate = flags.local;
    object.matrixWorldAutoUpdate = flags.world;
    object.matrixWorldNeedsUpdate = true;
  }
  release(root) {
    const record = this.records.get(root);
    if (!record) return;
    for (const [object, flags] of record.flags) this.restoreObject(object, flags);
    this.records.delete(root);
  }
  dispose() {
    for (const root of this.records.keys()) this.release(root);
  }
}
