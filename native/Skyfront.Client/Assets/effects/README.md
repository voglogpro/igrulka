# Smoke particle source

`smoke.png` is an unchanged PNG from Kenney's **Particle Pack**.
Archive entry: `PNG (Transparent)/smoke_01.png`, Particle Pack 1.1.

- Author: Kenney
- Official source: https://kenney.nl/assets/particle-pack
- License: Creative Commons CC0 1.0 Universal
- License reference: https://creativecommons.org/publicdomain/zero/1.0/
- Retrieved: 2026-11-01, directly from the official site's signed download.
- PNG SHA-256: `e8724c219e8d35859167fc0a7e207e13c72ccf0c29704909b9bb3d3dc71c6cf7`
- Downloaded archive SHA-256: `b631d4b07f7002549fdcf155f01141ad482f79f3440e4e301eed49ce5f1d8958`

The source page describes an 80-asset pack and identifies its license as CC0.
The included original license notice is retained as `Kenney-License.txt`.
The game applies its own smoke tint and alpha fade at runtime; the PNG itself
is not generated, painted, resized or otherwise edited.

Smoke uses a shared textured quad with billboard orientation and existing pooled
materials. The 220-effect pool, six smoke puffs per explosion, depth testing and
fade lifetime remain bounded. Texture translucency still carries GPU overdraw;
this visual change is not a performance measurement.
