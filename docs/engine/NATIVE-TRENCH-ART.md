# Native trench presentation

The adapter reads the original `FortificationView.models`, `links.records` and `trenchRenderPieces`. It does not write to cover, navigation, unit positions, damage, ammo or saves. It replaces the first three section pools and the exact source link pools. Original covered dugouts and concrete forts remain visible. Connector endpoints, width and graph come from the original renderer; ramps meet the section rim without a height step.

## Integration

Create a `TrenchPresentation` node beside `BrowserSceneView`. Call `Apply(frame.visualBindings)` after source objects have been applied, hide the exact UUIDs in `HiddenPoolIds`, and call `Reset()` on scene reset. Absent metadata means no update; an explicit empty `trenches` array removes the excavations.

Set the shared excavation material once with `SetEarthMaterial(terrain.CreateExcavationMaterial())`. When `MaskRevision` changes, call `terrain.SetTrenchMask(IndexTexture, MaskTexture, AtlasSize, tilePixels: TilePixels)` if `HasCutouts`; otherwise call `ClearTrenchMask()`. The excavation material must have its cutout disabled so the new floor does not discard itself. Section and link snapshots have independent revisions; an absent snapshot retains its previous geometry, while an explicit empty array removes that part.

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

Meshes are cached by level, section/connector role, ramp flags and width. Shared MultiMesh groups use 512-unit sectors and explicit bounds. Unchanged groups retain their buffers. A section-only progress update does not rebuild connector groups or resend static link metadata, including when network snapshots replace the source object identities. Connector templates contain 792–888 triangles; further art LOD work remains possible.

Sparse 32-unit virtual tiles use adaptive 128/64/32-pixel density (.25/.5/1 unit per texel). A 512×512 RG8 index addresses XZ in [-8192,8192); the R8 signed-distance atlas stays at most 4096×4096, or 16 MiB plus .5 MiB for the index. Sampling has constant cost per fragment. Dirty tile caches avoid recalculating the whole field when a shape changes. Mask packing and GPU upload still have a cost; ordinary progress does not rebuild the mask. Density reduction is an art fallback, never a new gameplay cap.

## Validation

Run `dotnet run --project tools/native-trench-checks/NativeTrenchChecks.csproj` and `node scripts/native-connector-check.mjs`. Current results are 3940 geometry/atlas checks and 37 presentation plus 67 connector checks. They cover slopes, winding, floor and ramp continuity, source widths, spatial lookup, snapshot identity churn, dirty masks, group reuse and save purity. A deliberately conservative maximum graph took about .5–.66 s for a full initial CPU build, with local shape changes around40–65 ms. This is not proof of a freeze-free maximum campaign; full GPU upload at that bound has not been benchmarked.

Standalone Native0.3 compilation passed with no warnings/errors. The enhanced GPU scenario passed119 checks and the identical baseline scenario104, both exit0 with empty stderr. Four phase PNGs cover clear linked trenches, real slopes at night and wet ground; root viewed the clear section and connector captures. See `GRAPHICS-03-STATUS.md` for scope and performance limits.

Prepare the explicitly unpaid visual fixture with `node scripts/prepare-native-terrain-qa.mjs`, then use the generated `artifacts/native/terrain-qa/native-terrain-qa.generated.js` through `--qa-script` and a PNG path through `--capture`. It contains five sections, sixteen groups, two original links and twenty-five source-emitted link pieces. Four phases cover a clear connector close-up, day, genuine slopes at night and wet ground. The independent expected floor uses original section poses and emitted link instance matrices, rather than the production presentation helper. Original File/DataTransfer import, source ray selection, received native identities and exact restored save equality are checked. `--baseline-graphics` uses the same cameras/weather and original heights. These are art/integration checks, not paid-production or combat benchmarks; phase PNGs contain only the owned Godot viewport.
