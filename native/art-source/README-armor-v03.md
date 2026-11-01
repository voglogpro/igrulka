# Articulated armor source study

`armor_v03.py` authors original procedural dark-olive tank art. It uses no downloaded mesh, texture or third-party art. The intended silhouette is inspired by armor; this remains a game asset study rather than an engineering replica or a claim of photorealism. Headless export, CPU validation and an isolated Godot GPU preview have run successfully. Runtime installation and final silhouette acceptance remain separate work.

Its GLBs preserve `ArmorV03/hull/turret/gun/recoil/muzzle`, seven shared-geometry road wheels per side, track banks, and a non-rendering `collisionProxy` bounds node. The original game's `pitch` joint maps to `gun`; the turret, pitch and muzzle bind positions match the current original Leopard. Game coordinates are Y-up and +Z-forward. Mesh vertices and pivot translations are converted to Blender Z-up as `(x,-z,y)` before normal Y-up glTF export, so named pivots should retain canonical game coordinates. Validate exported GLB world transforms before integration.

Only static pieces sharing the same pose parent and material are joined. No full-vehicle mesh join destroys aiming. Three shared materials use deterministic CPU-authored paint maps, rough dark steel and opaque optics. The small maps add restrained grain, chips and scratches. They do not bake high-poly detail or replace proper art review. Track banks carry a `drive_source` metadata field for later per-instance animation from the original drive phase. The authoring wheel nodes should be compiled into shared native MultiMeshes, rather than duplicating the full scene hierarchy for every distant tank.

Run headless only after the current GPU checks have finished:

```powershell
& 'C:/Users/Аня/Documents/Codex/igrulka-89/.tools/blender/blender-4.5.14-windows-x64/blender.exe' --background --factory-startup --python native/art-source/armor_v03.py -- --output artifacts/native/armor-v03 --lods 0 1 2
```

The default output is ignored `artifacts/native/armor-v03/`; current game assets are not overwritten. Optional `--save-blend` preserves each authoring LOD separately. Optional `--texture-size 1024` increases the default 512 texture size. Optional `--strict-budgets` fails after writing the measured report if an LOD falls outside its provisional band. The proposed bands are LOD0 12–18k triangles, LOD1 5–7k, LOD2 below 2k; source settings are estimates, and actual evaluated counts will be reported rather than asserted as already achieved.

Each export writes GLB byte count, SHA-256, topology per part and budget status to `report.json`. Before runtime integration, check named pivot and muzzle transforms, actual world bounds, normals, winding, UVs, texture color spaces, silhouettes from the existing camera, LOD transition stability and frame cost on Vega8. Changing this source or exporting these files alone does not install them into the active `Parity` renderer. A semantic actor binding and atomic replacement of the matching original art are still required. Source mechanics, CPU picking, muzzle/tracer origin and saved state must remain consistent.

Validate the files without a renderer using `node native/art-source/validate_armor_v03.mjs`. The current measured exports are:

| LOD | Assembled triangles | GLB bytes | Shared material count |
| --- | ------------------- | --------- | --------------------- |
| 0   | 13,360              | 1,064,580 | 3                     |
| 1   | 5,328               | 590,284   | 3                     |
| 2   | 784                 | 327,540   | 2                     |

All three match their provisional bands. The validator checks finite geometry and UVs, unit normals, nondegenerate triangles, correct indices, embedded maps, shared wheel geometry, canonical Y-up/+Z joint bases, rest and articulated muzzle coordinates, hierarchy and non-rendering proxy. Each GLB embeds its paint maps; a later runtime asset cache should share identical maps across loaded LODs. Blender's repeated-image-node sampler warning was checked: exported PNG maps remain present with one valid trilinear sampler.

An isolated preview project is prepared at ignored `artifacts/native/armor-v03-preview`. It uses runtime `GLTFDocument` loading, a neutral floor/light and three own-viewport PNG captures, then exits. Root ran the GPU preview, confirmed `ARMOR_PREVIEW_COMPLETE passed=true` and empty stderr, and viewed the front-quarter and side PNGs. The model is still a source-compatible procedural prototype; its proportions and material art need further review before replacing the original game tank. This is separate authoring output, not a replacement already visible in the game.
