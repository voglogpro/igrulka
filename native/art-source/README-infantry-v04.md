# Shared rigid infantry kit

`infantry_v04.py` authors an original procedural infantry kit. It is game art,
not a claim of photorealism or an engineering replica. The source creates no
gameplay state and does not install a replacement into the renderer. Output
defaults to ignored `artifacts/native/infantry-v04/`.

The catalogue is read from the original `GROUND_UNITS`/`isInfantry` and checked
against ten explicit roles. Existing squad member counts remain game rules:

| Key           | Members | Recognisable equipment                                    |
| ------------- | ------: | --------------------------------------------------------- |
| infantry      |       1 | Rifle, plate carrier, magazine pouches                    |
| atrifle       |       2 | Long heavy rifle, optic, bipod, ammunition pack           |
| machinegunner |       1 | Machine gun, ammunition box, large pack                   |
| sniper        |       1 | Scoped rifle and a low-detail camouflage hood             |
| assault       |       3 | Short weapon, reinforced carrier, carried grenades        |
| engineer      |       1 | Short rifle and a stowed shovel                           |
| operator      |       1 | FPV console/radio and the original role's short carbine   |
| mog           |       3 | Mobile group crew with machine gun and ammunition pack    |
| atgm          |       2 | Shoulder launcher and optic                               |
| medic         |       1 | Unarmed, medical pack, helmet/arm markers and carried bag |

## Export and verification

Run CPU headless, with a nonzero exit code for Python exceptions:

```powershell
& 'C:/Users/Аня/Documents/Codex/igrulka-89/.tools/blender/blender-4.5.14-windows-x64/blender.exe' --background --factory-startup --python-exit-code 1 --python native/art-source/infantry_v04.py -- --strict-budgets
```

For a small first integration use `--roles infantry --lods 0 1 2`. The complete
export writes thirty role/LOD GLBs, three shared leg GLBs, `manifest.json`,
`report.json`, three common PNG maps and their raw RGBA8 counterparts. Optional
`--save-blend` retains the role authoring files. `--output` selects another
explicit authoring directory; the current runtime assets are not overwritten.

The CPU validator checks GLB structure, finite positions/normals/UVs, unit
normals, triangle indices and degeneracy, integer rigid IDs, named Y-up pivots,
absence of skins/animation clips and the normalized leg height. Budget failures
are reported from measured exported topology rather than hidden by a claim.
No GPU render or final visual acceptance is performed by this exporter.

## Coordinates and shared shader contract

Authoring values use game **Y-up, +Z-forward**. They are converted to Blender
Z-up as `(x,-z,y)` before its normal Y-up glTF export. The body root is at the
feet; the hip is Y=1.22, the neck/head pivot Y=2.38 and helmet centre about
Y=2.74. Rest arm lengths are balanced around a forward firing grip.

The seven stable rigid node names and `TEXCOORD_1.x` IDs are:

|  ID | Node       |
| --: | ---------- |
|   0 | torso      |
|   1 | head       |
|   2 | upperarm.L |
|   3 | forearm.L  |
|   4 | upperarm.R |
|   5 | forearm.R  |
|   6 | weapon     |

`contract.pivots` contains world-rest game coordinates plus `shoulder.L/R` and
`elbow.L/R` aliases. `parentRigidParts` preserves the hierarchy. After flattening
for a shared instanced shader, children still need their parent's transform:
the held weapon must follow the right elbow and shoulder before its own recoil.
`contract.anchors` supplies hip, head, grip, handguard, backpack and weapon muzzle.
The medic retains an empty weapon node and has no triangles with ID 6.

The separate `infantry-leg` model is authored with a hip origin and local
**Y in [-1,0]**, knee at -.5 and boot toe along +Z. X/Z are actual widths,
approximately .31/.37 at the thigh; the boot is about .34 wide and .51 long.
Runtime scale is `(1,1.22,1)`, with hip placement at `bodyFloor+1.22*height`.
The original centred-box leg matrix must not be used unchanged. Downed/corpse
poses require the half-length hip offset in the already rotated local Y.
Leg UV2 IDs 0/1/2 identify thigh, shin and boot; they are separate from body IDs.

`COLOR_0.rgb` is a neutral multiplier; alpha carries an opaque **team-insignia
mask**, not transparency. All materials remain opaque. The shared atlas uses
olive fabric, webbing, armour, boots, skin, metal, optics and role markings.

## Maps and runtime preparation

Every map is 512x512. `infantry_atlas_{albedo,orm,normal}.RGBA8.bin` contains
tightly packed RGBA8 pixels in **top-to-bottom row order**, exactly matching
the companion PNG. Albedo is sRGB; packed ORM and normal maps are linear data.
The manifest records dimensions, row order, byte count and SHA-256. These raw
bytes allow runtime `DataTexture` creation without asynchronous image decoding.
Maps are identical across roles and LODs and should be shared by content hash.

`manifest.json` follows `models:[{key,lods,contract}], textures:[{name,rgba,width,height}]`
for the offline `compile_pack_v04.mjs` converter. `TEXCOORD_0` is atlas UV;
`TEXCOORD_1.x` must survive conversion as the rigid ID. Do not replace one with
the other. The current source was validated with Blender 4.5.14 LTS.

Measured first rifle body LOD counts are **1750 / 954 / 282 triangles**. Across
the full initial catalogue, body LOD0 is about 1.7–2.0k, LOD1 about 0.95k and
LOD2 about 0.28–0.34k; exact current counts are in `report.json`. A pair of legs
uses **488 / 192 / 72 triangles**, within the requested 500/200/80 limits.
These counts describe assets, not a measured 500-unit battle frame rate.

Walking, firing, reloading and digging must be driven by the original unit state
through the shared rigid shader. The exporter deliberately supplies no automatic
looping combat clips or per-actor Skeleton. Source damage, ammunition, cover,
unit IDs, selection and save state remain the responsibility of the game.
