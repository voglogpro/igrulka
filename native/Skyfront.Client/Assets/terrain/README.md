# Shared ground materials

Two original 1K Poly Haven sets: **Brown Mud** by Rob Tuytel (1.3 m tile), and
**Dirt** by Charlotte Baglioni (2 m tile), licensed CC0 1.0. Source pages:
[Brown Mud](https://polyhaven.com/a/brown_mud), [Dirt](https://polyhaven.com/a/dirt),
[asset license](https://polyhaven.com/license). Textures and metadata powered by Poly Haven.

The six JPEG files are unchanged provider bytes, checked against provider size
and MD5; their SHA-256 hashes and direct URLs are recorded in `provenance.json`.
Only Brown Mud normal/ARM were downloaded for this implementation; the other
four maps reuse the previously reviewed candidate files. There is no runtime
download or live API integration. The CC0 legal text is included locally.

Albedo uses sRGB (`source_color`); GL normal and packed ARM are linear data.
ARM means red AO, green roughness, blue metalness; soil remains nonmetallic.
Both complete sets share their maps/material across the map and excavation
geometry. No height/displacement texture or runtime terrain displacement is used.
Default mipmaps and filtering are authored in the adjacent Godot import presets.

Six RGBA8 1K maps including mipmaps are about **32 MiB**, before driver compression
and staging. This is an estimate, not a GPU memory measurement. Native GPU A/B,
readability and performance acceptance remain required before release.
