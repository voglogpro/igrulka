# Referenced geometry prefixes

`native/parity/geometry-prefix.mjs` reduces native transport buffers without changing source geometry or vertex/index IDs. It uses the geometry-global draw range, which is also the range emitted for every owner.

- Nonindexed geometry retains vertices `[0, start + count)`.
- Indexed geometry retains indices `[0, start + count)` and vertices `[0, maximumSelectedIndex + 1)`. Only the selected index window contributes to the maximum. Earlier retained indices are not drawn; native material groups intersect the original object range.
- Per-instance attributes always retain their entire instance bank, including interleaved instance attributes.
- Native LOD geometries and exact registered immutable authored banks retain complete banks. Invalid or unknown ranges/indices fall back to full transport.

The scan cache keys the exact geometry/index refs, index array/version/count, position count and original draw-range start/count. Repeated static captures do not rescan indices. Changed encoded prefix counts participate in normal attribute signatures, so growing or shrinking a range sends current data even without a producer version increment.

Groups and object ranges remain original. No index remapping, simulation, picking or source rendering changes occur. Native `BrowserGeometry` clamps/intersects surface ranges before reading the selected index window; this is why unused earlier retained indices do not require extra vertices.

Run `node --test tests/unit/native-geometry-prefix.test.mjs` for referenced-index, nonzero-start, shared-group, range-change, interleaved, instance-bank, LOD, invalid-data, reset and scan-cache regressions. The source-sized one-round tracer fixture sends 288 raw attribute bytes instead of 73728; this is a buffer comparison for that fixture, not an overall FPS or battle-packet claim. Particle instance banks remain complete.
