# Reproducible vehicle meshes

`vehicles.py` authors original stylized Leopard and wheeled MLRS meshes in Blender.
No downloaded third-party vehicle model or texture is used. The source and generated
assets belong to this repository under its existing terms; Blender itself is a
separate development tool, not a runtime dependency or bundled game asset.

Verified tool: Blender **4.5.14 LTS**, Windows x64 portable ZIP.
[Official release notes](https://www.blender.org/releases/4-5/) and
[official download archive](https://download.blender.org/release/Blender4.5/).
ZIP filename: `blender-4.5.14-windows-x64.zip`.
SHA256: `B9533D2397AC1984DB4466FB23A7A4649391CCA93F6E84209F9BCC60D071C8B9`.
The executable is extracted locally under ignored `.tools/blender`; no installation
or user Blender preferences are required.

From the repository root in PowerShell:

```powershell
& '.tools/blender/blender-4.5.14-windows-x64/blender.exe' --background --factory-startup --python assets/models/vehicles.py
npx.cmd prettier --write src/rendering/models/generated/vehicle-meshes.js
node --test tests/unit/blender-vehicles.test.mjs
```

The export is indexed position/normal/shade data with four decimal places. The
runtime expands shade into RGB vertex colors and multiplies them by side paint.
One immutable cached BufferGeometry per part and one material per paint serve all
instances. No GLTF loader, image texture, network fetch or runtime Blender is used.
Portable HTML includes the generated JS through ordinary module bundling.

`src/rendering/models/vehicles/blender-vehicles.js` exposes
`buildBlenderVehicle(world, unit, root, paint, accent, dynamic) -> boolean`.
Unsupported keys return false. Coordinates are game-native Y-up, +Z forward.
The named `turret`, `pitch`, and Leopard `recoil` groups retain independent
transforms. Muzzle positions are in pitch-local space. Existing Leopard animated
road wheels, spokes and track links keep their original instancing contract.
MLRS wheels use one shared exported mesh. Hull geometry has no moving children
baked into it; render batching can group each part independently.

CPU tests check finite data, valid indices, nondegenerate triangles, unit normals,
shared geometry/material identity, articulation, muzzle transforms, triangle
budget and assembled scale (width 4–12, height 4–10, length 10–20 game units).
These are stylized recognition models, not dimensionally exact engineering assets.

Actual Blender export: Leopard body 1,268 triangles, turret 780, mantlet 44,
recoiling barrel 324: **2,416** exported triangles, plus existing animated drive
instances. MLRS body 656, turret 168, launcher 1,140, wheel 116 reused six times:
**2,660** assembled triangles. Exported unique geometry totals **4,496** triangles.
