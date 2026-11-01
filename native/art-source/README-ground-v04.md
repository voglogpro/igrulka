# Ground art pack 0.4

`ground_pack_v04.py` authors the fourteen existing non-infantry ground types plus the existing MOG emplacement. There are fourteen assets total: `shilka`, `gepard`, `leopard`, `apc`, `mog`, `tankdestroyer`, `howitzer`, `armoredcar`, `lighttank`, `ifv`, `heavytank`, `mlrs`, `supplytruck`, and `tradetruck`. It adds no game types, crew, rules, stats, research levels or save fields. All meshes and textures are original procedural project art, using `armor_v03.py` primitives and its articulated Leopard study. No downloaded or third-party assets are included.

The pack is ready for native loader integration and visual review. CPU export and structural verification passed; this does **not** mean GPU silhouettes, lighting, LOD transitions, performance or final art have been accepted. The manifest explicitly records `visual_acceptance: false`. These are authored game assets rather than engineering replicas or a claim of photorealism.

## Reproduce

Run from the repository root. This exports on the CPU, without rendering a preview:

```powershell
& 'C:/Users/Аня/Documents/Codex/igrulka-89/.tools/blender/blender-4.5.14-windows-x64/blender.exe' --background --factory-startup --python-exit-code 1 --python native/art-source/ground_pack_v04.py -- --output artifacts/native/ground-pack-v04 --strict-budgets
```

Blender 4.5.14 LTS was used for the measured export. `--keys leopard mog` can export a subset; `--lods 0 1 2` is the default. The manifest describes only the requested subset, so run the complete default command before compiling a release. `--save-blend` retains optional authoring scenes, and `--texture-size` accepts 256, 512 (default), or 1024. Generated GLBs, PNGs, raw textures, logs and reports stay in the ignored output folder. The script does not install runtime files or modify the original browser source.

The native offline compiler consumes the manifest:

```powershell
node native/art-source/compile_pack_v04.mjs artifacts/native/ground-pack-v04/manifest.json native/art-assets/ground-v04.json
```

Confirm the compiler's current CLI before use; loader and release integration are separate from this authoring source.

## Pose and drive contract

Game coordinates remain Y-up, +Z-forward, +X-right. Authoring converts `(x,y,z)` to Blender `(x,-z,y)` and exports ordinary Y-up glTF. Every asset root is neutral, at unit scale. Original `lighttank` 0.8, `ifv` 0.9 and `heavytank` 1.14 root scales remain the source scene's responsibility and must be applied exactly once.

`manifest.models[].contract` contains the audited original `rootScale`, source bounds and exact joint positions/muzzle arrays. The canonical scalar contract is embedded in the Python file, so regeneration does not depend on an ignored audit artifact. The manifest also hashes the original config, source ground factory, generated-browser vehicle factory, and reused armor authoring source.

Stable joints retain their original names: `turret`, `pitch`, `recoil`, `dish`, and `field-position` where the original type has them. Each original muzzle is an empty `muzzle_00`, `muzzle_01`, etc. Its rest world position matches the original source hierarchy. Models whose source has no muzzle array do not receive an invented gameplay muzzle anchor. In particular APC, tankdestroyer and heavytank keep the source fallback convention. MOG keeps its backwards turret and the original negative-Z muzzle `(0,0.1,-5.8)`. MLRS preserves all twelve original launch anchors, four columns by three rows. The source factory's picking, ground height, aiming, recoil and firing logic remain authoritative.

Each model includes a non-rendering `collisionProxy` with original bounds metadata. This is descriptive, not new gameplay collision. There are no static crew figures in the GLBs: runtime infantry rendering supplies crew separately.

Road wheel pivots use stable `road_wheel_left_00`/`road_wheel_right_00` or `wheel_left_00`/`wheel_right_00` names. Their extras include `wheel_axis: "game +X"`, `wheel_radius`, `drive_role: "wheel"`, and `drive_source: "original drivePhase"`. Wheel rotation belongs on that pivot, not an additional rotation of its child surface. Leopard retains its existing v03 wheel mesh pivots with the same `wheel_axis` convention. Track banks are `track_left` and `track_right`, with `drive_role: "track_uv"` in the new family builders; this declares a source phase hook, not a claim that track UV animation is installed. Original `road-wheels`, `drive-spokes` and `track-links` instance proxies must not be replaced by plain groups if the original drive animator still requires them. A native authored-wheel animator can instead explicitly replace that source animation path.

Static pieces join only when both their pose parent and final atlas material match. Turrets, pitch groups, recoil, radar and wheel pivots remain separate. Every final mesh has `dynamic: true` so the original `batchStatic` path cannot flatten articulation. Deterministic `PARENT__surface` and `PARENT__accent` names are stable across LODs; omitted distant detail receives an empty named placeholder. The `min_level` extra hides existing upgraded AA optics at level 0 and MOG fortification rows until level 1/2. These are visual variants of existing levels, with no stat changes.

## Materials and outputs

One shared 512×512 atlas has eight semantic regions: olive paint, steel, rubber, opaque optics, canvas/sandbags, neutral team stripe, lamp, and bare metal. Small deterministic grain and paint wear are intentionally restrained. All geometry uses at most two materials: `ground_v04_atlas` and `ground_v04_team_accent`. Native code supplies the faction tint for the second material. Opaque surfaces avoid alpha sorting and transmission.

Three maps are exported as both PNG and raw RGBA8: `ground_v04_albedo` (sRGB), `ground_v04_orm` (linear; R=AO, G=roughness, B=metalness), and `ground_v04_normal` (linear OpenGL tangent normal). The raw byte rows are **top to bottom**, exactly matching the emitted PNG rows; dimensions, file paths and SHA-256 hashes are in `manifest.textures`. The compiler can create shared DataTextures without decoding PNGs. glTF's V conversion matches these maps, so an extra runtime vertical flip would be incorrect. All GLBs carry UV0, normals, triangulated geometry and tangent attributes. Texture samplers use one consistent trilinear setup; Blender's repeated-image-node sampler warning was inspected and the maps remain shared by name with one valid sampler.

`manifest.json` lists the three GLB paths, exact source contract, and measured stats for each type. `report.json` records triangle caps, byte sizes, SHA hashes and per-part topology. The shared raw maps use 3 MiB total at the default resolution. GLBs embed PNGs for independent inspection, while the offline runtime pack should deduplicate those images and geometry rather than load all three GLBs independently per unit.

## Measured budgets and CPU checks

Caps are upper bounds rather than triangle targets; additional topology is not added merely to fill them. Distant LOD2 stays below 1,000 triangles for every type. The measured complete export is:

| Type          | LOD0 triangles | LOD1 triangles | LOD2 triangles |
| ------------- | -------------: | -------------: | -------------: |
| shilka        |          6,684 |          2,774 |            830 |
| gepard        |          6,236 |          2,534 |            726 |
| leopard       |         13,372 |          4,700 |            796 |
| apc           |          3,100 |          1,124 |            252 |
| mog           |          1,440 |            480 |            296 |
| tankdestroyer |          2,528 |            912 |            288 |
| howitzer      |          6,896 |          2,644 |            680 |
| armoredcar    |          1,984 |            712 |            172 |
| lighttank     |          6,296 |          2,460 |            644 |
| ifv           |          6,968 |          2,652 |            692 |
| heavytank     |          7,220 |          2,712 |            728 |
| mlrs          |          4,188 |          1,908 |            656 |
| supplytruck   |          3,220 |          1,156 |            276 |
| tradetruck    |          2,796 |          1,052 |            248 |

The generated `check-pack.mjs` CPU audit checks all 42 files against the original manifest contract: stable unique node sets, neutral scale and rest rotations, exact source joint/muzzle world poses, no invented muzzle anchors or crew meshes, finite attributes, matching normals/UV counts, triangle counts and caps, dynamic flags, shared texture names and raw-map/file hashes. It passed 4,312 assertions; its machine-readable results are in `cpu-check.json`. No GPU preview or performance claim is made by this check. The next acceptance step is an integrated native daytime/nighttime camera pass with aiming, wheel motion, crew, LOD transitions and a large army, followed by the weak-laptop performance budget.
