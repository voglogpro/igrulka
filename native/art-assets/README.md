# Runtime art banks v04

`ground-v04.json` contains the fourteen existing ground types. `infantry-v04.json`
contains ten existing infantry roles and the shared normalized leg. These are
project-authored procedural models, not a claim of photorealistic replicas.
They are dedicated to the public domain under CC0-1.0; no downloaded models or
photographs are incorporated. The Three/Godot code retains its own licenses.

The JSON banks are checked in so a normal Windows build requires no Blender.
They hold binary attributes, three index LODs, named aiming joints, source
hardpoints and shared512px atlas bytes. Geometry/materials are shared between
instances; source collision, orders, ammunition and balance are unchanged.

Regenerate with the CPU Blender exporters documented in
`../art-source/README-ground-v04.md` and `README-infantry-v04.md`, then run:

```powershell
node native/art-source/compile_pack_v04.mjs artifacts/native/ground-pack-v04/manifest.json native/art-assets/ground-v04.json
node native/art-source/compile_pack_v04.mjs artifacts/native/infantry-v04/manifest.json native/art-assets/infantry-v04.json
```

The authoring GLBs/raw maps and local audit reports belong in ignored
`artifacts/native/`. The generator sources, compiled runtime banks and licenses
belong in Git. Do not edit base64 by hand. Renderer glue lives in
`native/parity/{model-pack,vehicle-art,infantry-art,model-transform,art-warmup}.mjs`.
The Godot infantry shader is `native/Skyfront.Client/Parity/infantry-art.gdshader`.

Vehicles use PBR albedo/normal/ORM maps. The infantry rigid shader currently uses
the albedo atlas and vertex team mask with a fixed roughness; its normal/ORM maps
are retained for a later material pass. Wheels follow the original drive phase;
continuous track-UV motion is not yet connected.
