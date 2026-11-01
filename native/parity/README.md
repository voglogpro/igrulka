# Original game with a Godot drawing backend

This path preserves the browser application: `src/main.js`, UI/HTML/CSS,
simulation, commands, AI, networking, audio, camera, picking, geometry and
animation are compiled from their original modules. It does not run a browser
WebGL renderer. WebView2 owns the existing DOM and JavaScript; Godot owns 3D.

`scripts/build-native-parity-web.mjs` produces `native/build/parity-web/`.
`PARITY-BUILD.json` contains SHA256/size for original compiled source inputs,
styles and index, plus a list of the four host adaptations. Source files under
`src/` are not modified by this build.

The Three module alias reexports the actual CPU classes and replaces only
`WebGLRenderer`. Original `RTSWorld`, `FixedCamera`, model builders, instancing,
raycasts, selection, road snapping and callback payloads remain intact.
Post-processing changes to the native backend. Startup still prepares original
model caches and navigation, then waits for native readiness and successful
application of the first complete scene. There is no fake success on an absent
backend: errors block input, pause an already running campaign through its
existing controller, display the actual error and offer reload.

Optional CPU model/navigation preparation has the original 30-second ceiling.
Work runs normally until the deadline; unfinished navigation is closed cleanly.
The deadline does not replace the required native-ready/complete-scene ACK.

## Wire contract, version 1

UI posts `renderer-attached` with `protocol:1`; native responds
`native-ready` with `protocol:1` and optional `serverAddress`. The latter is
published to `globalThis.__SKYFRONT_NATIVE__.serverAddress` before readiness.
Only the virtual `skyfront.localhost` origin adapts the default game-server
address; real browser endpoints, invite validation and room protocols stay as
implemented in the original game.

Scene message:

```text
{ kind:"scene", protocol:1, seq, reset:seq===1,
  definitions:{ geometries:[], materials:[], textures:[] },
  frame:{ mode:"delta", time, camera, environment, lights:[],
          objects:[], removed:[], geometryUpdates:[],
          materialUpdates:[], textureUpdates:[] } }
```

Native sends `scene-ack` with `seq` only after applying the full packet. The UI
permits **one packet in flight**. Intermediate source render calls only retain
references to the latest actual scene; no expensive capture/base64/JSON work
runs until ACK. First packet resets the preceding page's resources, so new game
and imported campaigns can reload the original page safely.

`frame.objects` is a delta, not a visible-object snapshot. Omitted objects
remain as before. Only `frame.removed` deletes objects; appearance later sends
their descriptor and instance buffer again. `frame.lights` is a complete list.
Resource updates must refresh cached users even when `objects` is empty.

Resources use their original Three UUIDs. Geometry contains contiguous typed
attributes (`type`, `itemSize`, `count`, `normalized`, `instanced`, `version`,
`identity`, base64 `data`), optional index and original material groups. Interleaved Sprite
attributes are deinterleaved without losing normalization. Geometry buffers,
groups, object draw ranges and replaced attribute identities invalidate caches.
Matrices are original column-major Three matrices; translation is at 12–14.
There is no coordinate-system mirror; Godot must account for triangle winding.

Object types are mesh, instanced, sprite, line, segments and points. Attributes
and instance buffers retain source counts, colors and opacity. Resources are
sent once; dynamic instance buffers or attributes are resent only when their
version/identity/count changes. Static objects are not resent on idle frames.
Shared resource descriptors are inspected once per capture, regardless of the
number of leaves using the resource. A replaced attribute has a new `identity`
even when its source version and count match; the receiver compares all three.

Textures carry browser-generated PNG data once. Pixels are not pre-flipped;
`flipY`, repeat/offset/center/rotation/wrap/filter/colorSpace remain explicit.
UV transforms update without resending images. Material maps refer to texture
UUIDs. Material uniform textures use `{texture:uuid}`; numbers/vectors/colors
are primitive values/arrays.

## Custom shader families

| Family   | Attributes                  | Uniforms                                                   |
| -------- | --------------------------- | ---------------------------------------------------------- |
| particle | `aOpacity`, `aTint`         | `kind`, `clock`                                            |
| streak   | `aOpacity`, `aTint`         | —                                                          |
| scar     | `aOpacity`                  | —                                                          |
| weather  | `aSeed`, `aEnd`, `aDensity` | `time`, `center`, `box`, `amount`, `wind`, `drift`, `tint` |
| sky      | position                    | `daylight`, `overcast`                                     |

Rain constants remain those in `weather-style.js`: 2800 drops, box
1080×240×860, speed `92+aSeed.z*42`. The original water uses standard material
with animated normal-map UVs. Standard/basic/sprite/line materials retain
colors, vertex colors, sidedness, alpha, depth settings, emissive properties,
texture maps, fog flags and render order.

## Verification

```powershell
node --test tests/unit/native-scene-protocol.test.mjs
node scripts/build-native-parity-web.mjs
node scripts/native-parity-scene-fixture.mjs
```

Unit tests exercise original Three geometry and shader families, hidden-parent
removals/reappearance, resource deltas, counts and matrices, texture changes,
ACK backpressure, first-scene readiness, reload reset, host-server publication
and the complete original-application bundle. Synthetic scene fixture uses a
known-valid repository PNG and tests native resource decoding; it is not a
campaign, economic test or performance guarantee. The complete application
still needs native-host, gameplay, audio and multiplayer acceptance tests.

`window.skyfront.getWorld().renderer.diagnostics()` returns capture time,
postMessage time, end-to-end ACK latency, effective transfer frequency,
resource/object update counts and optional native `packetBytes`, `applyMs`,
`parseMs` ACK fields. Byte counting does not serialize the scene a second time.
These are measurements of the bridge, not a replacement for native frame/GPU
timings or proof that an active large battle meets a particular FPS target.
