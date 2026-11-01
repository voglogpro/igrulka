// Only the native bundle gains a notification beside the existing exact producer write.
// A changed source producer stops this optimization being wired silently.
export function nativeStaticSceneryTransform(name, source) {
  if (!name.replaceAll('\\', '/').endsWith('/terrain/environment.js')) return source;
  const before = '        mesh.instanceMatrix.needsUpdate = true;';
  const found = source.split(before).length - 1;
  if (found !== 1)
    throw Error(`Native static scenery producer: expected 1 clearTrees buffer write, got ${found}`);
  return (
    "import { notifyStaticTreeInstancesChanged } from 'skyfront-native-static-scenery';\n" +
    source.replace(before, before + '\n        notifyStaticTreeInstancesChanged(this, mesh);')
  );
}
