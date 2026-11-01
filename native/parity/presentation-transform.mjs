// Targeted native-only presentation patches; the checked-in browser game is
// unchanged. Exact match assertions stop a future source update silently drifting.
export function nativePresentationTransform(name, source) {
  const helpers = new Set();
  const replace = (before, after, expected = 1) => {
    const found = source.split(before).length - 1;
    if (found !== expected)
      throw Error(
        `Native presentation ${name}: expected ${expected} matches, got ${found}: ${before}`,
      );
    source = source.replaceAll(before, after);
  };
  if (name.endsWith('/models/infantry/soldiers.js')) {
    helpers.add('presentationUnitY');
    helpers.add('presentationCorpseY');
    helpers.add('presentationEnabled');
    helpers.add('presentationCorpseTrench');
    replace('(u.y || 1)', 'presentationUnitY(this.world, u)', 5);
    replace(
      'presentationUnitY(this.world, u) + Math.abs(stride)',
      'presentationUnitY(this.world, u, wx, wz) + Math.abs(stride)',
    );
    replace(
      'presentationUnitY(this.world, u) + 0.62 * height',
      'presentationUnitY(this.world, u, wx, wz) + 0.62 * height',
    );
    replace(
      'this.corpses.push({',
      'this.corpses.push({\n      nativeTrenchId: presentationCorpseTrench(this.world, e),',
    );
    replace(
      '0.55 + 0.1 * (1 - t) - sink * 0.9',
      'presentationCorpseY(this.world, c, 0.55 + 0.1 * (1 - t) - sink * 0.9, c.x + off * cs, c.z - off * sn)',
    );
    replace(
      '0.35 - sink * 0.9',
      'presentationCorpseY(this.world, c, 0.35 - sink * 0.9, c.x + off * cs, c.z - off * sn)',
    );
    replace('u.trenchId ||', '(u.trenchId && !presentationEnabled()) ||');
    replace(
      'temp.position.set(wx, 0.55 + breath, wz)',
      'temp.position.set(wx, presentationCorpseY(this.world, u, 0.55 + breath, wx, wz), wz)',
    );
    replace(
      '              0.35,',
      '              presentationCorpseY(this.world, u, 0.35, wx, wz),',
    );
  } else if (name.endsWith('/input/build-tools.js')) {
    helpers.add('presentationUnitY');
    helpers.add('presentationGroundPoint');
    replace('u.y + 1, u.z', 'presentationUnitY(this, u) + 1, u.z');
    replace(
      'return this.ray.ray.intersectPlane(this.plane, new T.Vector3());',
      'return presentationGroundPoint(this, this.ray.ray, this.ray.ray.intersectPlane(this.plane, new T.Vector3()));',
    );
  } else if (name.endsWith('/rendering/sync.js')) {
    helpers.add('presentationMuzzleEvent');
    replace(
      "e.type === 'shot' ? muzzleEvent(this, e) : e",
      "e.type === 'shot' ? presentationMuzzleEvent(this, muzzleEvent(this, e)) : e",
    );
  } else if (name.endsWith('/effects/tracer-path.js')) {
    helpers.add('presentationProjectilePoint');
    replace('    return out;', '    return presentationProjectilePoint(p, ahead, out);');
    replace('  return out;', '  return presentationProjectilePoint(p, ahead, out);');
  } else if (name.endsWith('/performance/contact-shadows.js')) {
    helpers.add('presentationShadowY');
    replace(
      'groundHeight(u.x, u.z) + 0.66',
      'presentationShadowY(u, groundHeight(u.x, u.z) + 0.66)',
    );
  } else if (name.endsWith('/models/ground.js')) {
    helpers.add('presentationModelY');
    replace(
      'model.position.set(u.x, u.y || 1, u.z);',
      'model.position.set(u.x, presentationModelY(u), u.z);',
    );
  } else return source;
  return `import { ${[...helpers].join(', ')} } from 'skyfront-native-presentation';\n` + source;
}
