# Native trench presentation

The native graphics adapter reads the original `FortificationView.models` poses. It does not write to cover, navigation, unit positions, damage, ammo or saves. `TrenchPresentation` replaces only the first three old art pools. The original covered dugout and concrete fort remain visible; linked trench pieces currently retain their original art.

## Integration

Create a `TrenchPresentation` node beside `BrowserSceneView`. Call `Apply(frame.visualBindings)` after source objects have been applied, hide the exact UUIDs in `HiddenPoolIds`, and call `Reset()` on scene reset. Absent metadata means no update; an explicit empty `trenches` array removes the excavations.

Set the shared excavation material once with `SetEarthMaterial(terrain.CreateExcavationMaterial())`. When `MaskRevision` changes, call `terrain.SetTrenchMask(IndexTexture, MaskTexture, AtlasSize)` if `HasCutouts`; otherwise call `ClearTrenchMask()`. The excavation material must have its terrain cutout disabled so the new floor does not discard itself.

The depth function is in `TrenchGeometry.Depth`. For local coordinates `along/across`, it is:

```text
capsuleDistance = hypot(max(0, abs(along) - 6.8), across)
depth = 1.55 * smoothstep(0, .75, progress)
             * smoothstep(0, 2.8, 9 - abs(along))
             * smoothstep(0, .65, 2.2 - capsuleDistance)
```

The central floor is 1.55 units below the rim. Its end ramps and side slopes return continuously to the rim. A quarter-unit outer collar covers raster and tessellation differences without enlarging the actual capsule cutout. Duckboard tops sit at floor + .05.

On inclined ground, inverse horizontal stretch is `stretch * cos(roll)`. The native affine basis keeps excavation depth vertical in world space: its X axis follows the original inclined trench, its Y axis is world-up multiplied by `cos(roll)` and construction depth, and its Z axis follows the original yaw. Therefore the world floor is `pose.y + alongHorizontal * tan(roll) - depth * cos(roll)`. This avoids a sideways depth shift that a plain rotated local-Y axis would introduce. The CPU presentation/picking/projectile adapter must use the same floor.

## Cost and lifetime

Meshes are cached by original upgrade level. All instances sharing a level and a 512-unit spatial sector share three MultiMesh surfaces: earth, timber, and sandbags. Explicit bounds allow sector culling without per-frame GPU bounds readback. Construction changes packed instance transforms rather than rebuilding mesh vertices.

The cutout uses sparse 32-unit virtual tiles at 128 pixels per tile (.25 units per texel). A 512×512 RG8 indirection texture addresses world XZ in [-8192,8192). The R8 atlas grows by powers of two to at most 4096×4096: 16 MiB for the mask plus .5 MiB for the index. The shader performs constant-cost indirection and mask sampling; it does not loop over the army or trenches per fragment. Shape changes rebuild the mask. Construction progress and upgrades do not re-upload it once a cut exists.

## Validation

Run `.tools/dotnet/10.0.403/dotnet.exe run --project tools/native-trench-checks/NativeTrenchChecks.csproj` from the repository root. The standalone .NET checks use no Godot runtime or GPU. They verify floor depth, ramps, slope stretch, complete channels, finite vertices, Godot clockwise winding, below-ground geometry, rotated and negative-coordinate mask addressing, all 240 dispersed source positions, explicit memory bounds, and removal of old holes. The current set passes 758 checks. A full 240-section CPU atlas rebuild was measured at 34–59 ms on the local machine; this is not a GPU, frame-rate or combat benchmark.

Native client compilation also passed with no warnings or errors. GPU material compilation, actual source-to-native integration, terrain seams, soldier entry/picking/fire alignment, and the visual/performance comparison remain the main agent's runtime checks. This document does not claim those checks have passed.

The paused visual runtime fixture is prepared with `node scripts/prepare-native-terrain-qa.mjs`. It writes `artifacts/native/terrain-qa/fixture.json`, `prepare-report.json`, and `native-terrain-qa.generated.js`. Pass the generated script to the native client's `--qa-script` option and a PNG path to `--capture`. This explicitly unpaid fixture uses the original defensive-position and unit factories, four trench stages/poses and thirteen ground groups. Two sections are near HQ; the other two use genuine source slopes because the original map intentionally levels the area around HQ. It observes actual outgoing semantic bindings, original File/DataTransfer import and reload, member instance IDs and floor positions, the first original CPU ray hit, native terrain/mask diagnostics, and exact save equality across sync/render and restored temporary lighting/weather overrides. Three capture phases hold for 6.5 seconds each. This is an art and integration check, not a battle, recruitment or frame-rate benchmark. The runtime-ready `enhancedGraphics` flag selects enhanced or baseline expectations automatically; passing `--baseline-graphics` to the client retains identical cameras/time/weather while checking original instance heights and no excavation mask. Every phase reports `graphicsMode` for the A/B captures.
