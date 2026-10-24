# Recorded aircraft engines

Both recordings are released under **CC0 1.0 Universal**. They may be edited,
redistributed and used commercially. Attribution is not required, but the authors
and primary source pages are credited here. No account or API key is needed at runtime.

| Game asset        | Recording and author                                                                   | Primary source and license                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `fpv-rotor.wav`   | “Dji Mavic Mini 2 hover above ground UP-DOWN XY mic placement Zoom H5.wav”, Sadiquecat | [Freesound #683298](https://freesound.org/people/Sadiquecat/sounds/683298/), CC0 shown on the recording page |
| `prop-engine.wav` | “Small airplane moving away”, Joseph SARDIN                                            | [BigSoundBank #0501](https://bigsoundbank.com/sound-s0501.html), CC0 shown on the author's recording page    |

License: [CC0 dedication](https://creativecommons.org/publicdomain/zero/1.0/).
The accompanying `CC0-1.0.txt` contains its terms.

The FPV recording is an electric quadcopter. The second recording is a propeller
airplane, used for fixed-wing drones with a quiet synthetic piston layer. These are
sound design references, not claims to record the fictional aircraft themselves.

## Processing and provenance

Retrieved 2026-10-24 from the authors' public MP3 listening versions, rather than
their much larger original WAV files:

- FPV: `https://cdn.freesound.org/previews/683/683298_5287430-hq.mp3`;
  source SHA-256 `19b21284456fda2de414e8f9b25315b617e39098ce8d5543867efe822e518677`.
- Propeller: `https://bigsoundbank.com/UPLOAD/mp3/0501.mp3`;
  source SHA-256 `519b2b19c21a7333d0a0a68a0d335d6d1768128e78ffb159d58129ed8c15274e`.

Each asset contains a 2.56-second mono loop at 16 kHz / PCM16. Processing: take
2.68 seconds starting at 5.0 seconds (FPV) or 0.5 seconds (propeller), high-pass
85 Hz, low-pass 5800 Hz, remove DC, overlap the last 120 ms with the initial
120 ms using a cosine crossfade, then apply a constant gain capped at peak 0.8.
No generated voices, background music or unrelated recordings are included.

The small PCM modules under `src/audio/samples/` encode these WAV assets for
synchronous offline playback. They add no network request or media decoder at
game start. Regenerate them after editing the WAVs with:

```sh
node assets/audio/encode-samples.mjs
```

Derived WAV SHA-256:

- `fpv-rotor.wav`: `b19817880a28e990b4479a22a9710ee770e06803a8dd9c43494a1d01598e14f4`
- `prop-engine.wav`: `26e8d2d5ddb77a509d97983e2a7817491af8f4b15fe0e4d1c746be1b27ffcb2e`
