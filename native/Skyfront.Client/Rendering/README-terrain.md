# World presentation

`TerrainView.ApplyWorld(JsonElement)` accepts `field: {x,z}` (centered extents),
`waterLevel`, `terrain: {cols,rows,step,originX,originZ,heights}` and optional
`trees: [{x,z,scale}]`. Heights are row-major, Y-up, in unchanged simulation
units. `GroundHeight(x,z)` performs bilinear sampling and clamps at the border.
The runtime bridge aliases `map: {width,depth}` and
`heightGrid: {columns,rows,step,originX,originZ,values}` are also accepted.
The controller should supply one complete world, not rebuild it every tick.

Terrain is indexed into 32-cell chunks with shared material, continuous sampled
normals and four vertex color zones. Sea uses the same height samples for shore
masking and foam; opaque shading avoids costly screen refraction/SSR and sorting.
The shader moves wave normals, not gameplay heights. Low-poly trees are two shared
meshes batched in spatial sectors; no individual tree or leaf scene nodes exist.
Lighting and environment belong to the parent scene. No gameplay physics is added.

This first visual implementation has not been GPU benchmarked. Tree visibility
distance and material colors remain tuning values. Oil/district visual markers are
owned by the client entity renderer, not this terrain layer.
