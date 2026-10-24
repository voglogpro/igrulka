# Recorded aircraft engines, ground engine and footsteps

These recordings are released under **CC0 1.0 Universal**. They may be edited,
redistributed and used commercially. Attribution is not required, but the authors
and primary source pages are credited here. No account or API key is needed at runtime.

| Game asset                                | Recording and author                                                                   | Primary source and license                                                                                   |
| ----------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `fpv-rotor.wav`                           | “Dji Mavic Mini 2 hover above ground UP-DOWN XY mic placement Zoom H5.wav”, Sadiquecat | [Freesound #683298](https://freesound.org/people/Sadiquecat/sounds/683298/), CC0 shown on the recording page |
| `prop-engine.wav`                         | “Small airplane moving away”, Joseph SARDIN                                            | [BigSoundBank #0501](https://bigsoundbank.com/sound-s0501.html), CC0 shown on the author's recording page    |
| `footstep-1.wav` through `footstep-3.wav` | “Footsteps on gravels #1”, Joseph SARDIN                                               | [BigSoundBank #0510](https://bigsoundbank.com/steps-on-gravels-s0510.html), author explicitly publishes CC0  |
| `truck-engine.wav`                        | “Truck engine #1”, Joseph SARDIN                                                       | [BigSoundBank #1442](https://bigsoundbank.com/truck-engine-1-s1442.html), author explicitly publishes CC0    |

License: [CC0 dedication](https://creativecommons.org/publicdomain/zero/1.0/).
The accompanying `CC0-1.0.txt` contains its terms.

The FPV recording is an electric quadcopter. The second recording is a propeller
airplane, used for fixed-wing drones with a quiet synthetic piston layer. These are
sound design references, not claims to record the fictional aircraft themselves.

The ground recording is a real truck engine, used for wheeled armored vehicles and
the supply truck; tracked armor retains its distinct synthetic low diesel layer.
It is not presented as a recording of an actual tank or APC.

The two additional source previews were retrieved 2026-10-24 from
`https://bigsoundbank.com/UPLOAD/mp3/0510.mp3` (401,408 bytes) and
`https://bigsoundbank.com/UPLOAD/mp3/1442.mp3` (586,788 bytes).
Source SHA-256, respectively:
`eb640b57f9fd3ddd71657da35a6b447b49f99b07f3de4da17d55b6b3e731f2cb` and
`f7c774cf043e13f17b15f59528cea1ab811320b111ce8fb7c77395a5b29f686a`.
Footsteps are three 0.36-second mono crops beginning at 7.65, 0.38 and 1.19 seconds;
truck is a 4–6 second crop with an 80 ms crossfade. FFmpeg converts to PCM16 mono
16 kHz; each crop is peak-normalized to 0.65, footsteps have 10 ms attack/25 ms fade.
Runtime WAV total for these additions is below 100 KB; generated modules bundle
the same PCM without runtime network requests. Run `node assets/audio/encode-samples.mjs`
to reproduce the JavaScript modules from the checked-in WAVs.

Footstep playback selects up to four nearby moving, living, non-downed infantry,
excluding embarked passengers. Cadence is bounded to eight short starts per second,
with 460 ms between a given soldier's steps and no persistent soldier loops.
Existing gunfire, UAV engines and missile signatures are preserved.

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
