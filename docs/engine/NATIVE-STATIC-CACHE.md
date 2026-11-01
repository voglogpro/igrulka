# Native tree capture cache

The native bridge retains the original frozen tree objects as resident scene records. It changes transport work; it does not reduce tree counts, simulation updates, source picking or visual quality. Native0.3 ready packages remain unchanged until a later build is accepted.

`static-scenery-cache.mjs` registers only the exact tile meshes referenced by `world.trees[*].meshes`. The current map has 2,544 such drawable leaves. Other owners retain normal capture. Scene/owner replacement, reparented or unfrozen trees, unsupported children, nonidentity scene roots and hidden scenes use the complete path. A lightweight identity/flags sanity scan remains; matrices are trusted frozen under this specific producer contract.

`static-scenery-transform.mjs` adds a native-only notification beside the original `clearTrees` instance-buffer write, with an exact source match guard. Roads and buildings still clear trees through the original producer. Instance attribute identity/version/count checks remain as a conservative fallback, and notifications persist across pending frame coalescing. Scene child events invalidate a returned/reparented tree before it re-enters the resident path. Shared geometry/material/texture snapshots remain live each frame; material version alone is deliberately insufficient for colors, uniforms, opacity and texture transforms.

`SceneExporter` keeps logical resident IDs, captures other roots normally and skips repeated static world-matrix traversal. It reports `staticResidents` and `staticSkipped`. Full capture remains available internally via `new SceneExporter({ useStaticScenery: false })` for regression comparisons. This is a development reference path, not a user graphics-quality toggle.

Related native art metadata uses the existing attribute encoder:

- `geometry.userData.nativeLods = [{ distance, index: BufferAttribute }]` becomes `nativeLods` in a geometry descriptor. Distance is the Godot LOD dictionary key, not a guaranteed physical metre measurement. Index identity, version, count and key changes invalidate it; removing the list emits `[]`.
- `mesh.userData.nativePose` is a vec4 BufferAttribute covering active instance count. It becomes optional `instances.pose`; identity/version/active-count changes are encoded, and removal emits `null`.
- `material.userData.nativeFamily = 'infantry'` selects the native infantry shader family while retaining ordinary uniform serialization.

Run `node --test tests/unit/native-static-scenery.test.mjs` for full-vs-resident logical receiver comparisons, live resources, clearing, visibility, lifecycle fallback, LOD/pose metadata and actual transport coalescing. Run `node scripts/benchmark-native-static-capture.mjs` for the bounded CPU comparison. Its output is ignored `artifacts/native/static-capture-benchmark.json`.

The initial synthetic Node comparison used 2,814 leaves, 87 geometries, 88 materials and 500 batched ground instances. Sixty interleaved samples after twenty warmups measured mean complete capture 3.019 ms versus resident 1.834 ms, and p95 3.783 versus 2.484 ms. These are exporter CPU measurements in Node; they do not establish game, browser, GPU or combat frame rates. Actual native runtime acceptance is still required.
