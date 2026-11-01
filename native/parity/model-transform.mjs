export function nativeModelTransform(name, source) {
  const helpers = new Set();
  const replace = (before, after, count = 1) => {
    const found = source.split(before).length - 1;
    if (found !== count)
      throw Error(`Native art ${name}: expected ${count}, got ${found}: ${before}`);
    source = source.replaceAll(before, after);
  };
  if (name.endsWith('/models/ground.js')) {
    helpers.add('buildNativeVehicle');
    helpers.add('animateNativeVehicleDrive');
    replace(
      'if (buildBlenderVehicle(world, u, root, paint, accent, dynamic))',
      'if (buildNativeVehicle(world, u, root, paint, accent, dynamic) || buildBlenderVehicle(world, u, root, paint, accent, dynamic))',
    );
    replace(
      'animateVehicleDrive(model, model.userData.drivePhase);',
      'if (!animateNativeVehicleDrive(model, model.userData.drivePhase)) animateVehicleDrive(model, model.userData.drivePhase);',
    );
    replace(
      "if (['gepard', 'shilka'].includes(u.key) && u.level > 0) {",
      "if (['gepard', 'shilka'].includes(u.key) && u.level > 0 && !root.userData.nativeArt) {",
    );
  } else if (name.endsWith('/models/infantry/soldiers.js')) {
    for (const h of [
      'nativeInfantryGeometry',
      'nativeLegGeometry',
      'nativeInfantryMaterial',
      'syncNativeInfantryPose',
      'nativeLegMatrix',
    ])
      helpers.add(h);
    replace(
      'function bodyGeometry(w, key, side) {',
      'function bodyGeometry(w, key, side) {\n  const authored=nativeInfantryGeometry(key,side); if(authored)return authored;',
    );
    replace(
      'bodyGeometry(this.world, key, side), this.material, 512',
      'bodyGeometry(this.world, key, side), nativeInfantryMaterial(key,side) || this.material, 512',
    );
    replace('          this.world.boxGeo,', '          nativeLegGeometry() || this.world.boxGeo,');
    replace(
      "this.world.mat(['#3c4d3f', '#52483b', '#3e5162', '#5d513c'][side])",
      "nativeInfantryMaterial(key,side,true) || this.world.mat(['#3c4d3f', '#52483b', '#3e5162', '#5d513c'][side])",
    );
    replace(
      'temp.scale.set(0.31, 1.22, 0.37);',
      'temp.scale.set(nativeLegGeometry()?1:.31,1.22,nativeLegGeometry()?1:.37);',
      2,
    );
    replace(
      'temp.scale.set(0.31, 1.22 * height, 0.37);',
      'temp.scale.set(nativeLegGeometry()?1:.31,1.22*height,nativeLegGeometry()?1:.37);',
    );
    replace(' + 0.62 * height', ' + (nativeLegGeometry()?1.22:.62) * height');
    const write = 'writeInstanceMatrix(pool.legs, index * 2 + leg, temp.matrix);';
    const writes = source.split(write);
    if (writes.length !== 4) throw Error('Infantry leg pose count changed');
    source =
      writes[0] +
      write.replace('temp.matrix', 'nativeLegMatrix(temp)') +
      writes[1] +
      write +
      writes[2] +
      write.replace('temp.matrix', 'nativeLegMatrix(temp)') +
      writes[3];
    replace(
      '    uploadInstances(this.selected);',
      '    uploadInstances(this.selected);\n    syncNativeInfantryPose(this,units,time);',
    );
  } else return source;
  return (
    `import { ${[...helpers].join(', ')} } from '${name.endsWith('/models/ground.js') ? 'skyfront-native-vehicles' : 'skyfront-native-infantry'}';\n` +
    source
  );
}
