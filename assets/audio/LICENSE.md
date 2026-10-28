# Recorded rain, 8.13

"Rain, Moderate, A.wav" by InspectorJ (www.jshaw.co.uk), Freesound #401277.
Source: https://freesound.org/people/InspectorJ/sounds/401277/
License: Creative Commons Attribution 4.0 International (CC BY 4.0),
https://creativecommons.org/licenses/by/4.0/ (full text: CC-BY-4.0.txt).

The author describes a Zoom H1 field recording made in Witley, England on
2016-01-02. This game uses the public HQ MP3 preview, not the original WAV master.
Changes: trim to seconds 1-59; 1.5-second equal-power tail/head crossfade using
only recorded rain; attenuation by 2 dB; conversion to 56.5-second stereo Opus.
The derived asset is `rain-inspectorj.opus`, bundled in `rain-recording.js` for
offline playback. No generated rain was added. Credit does not imply endorsement.
Machine-readable source, modifications and checksum: `rain-sources.json`.

# Recorded aircraft engines, ground engine and footsteps

## Recorded rocket and artillery sounds, 8.11.2

The following additions use downloaded recordings, not synthesized weapon noises.
The publisher/source descriptions and licenses were checked on 2026-10-26.
Each fictional game weapon uses an edited recording as a sound-design reference;
this is not a claim that the game simulates that recording's exact weapon system.

| Game asset                                   | Actual recording and credit                                                                                    | Primary source / license                                                                                                                                                                                                                                                               |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rocket-launch.wav`                          | “Rocket Launch.flac”, qubodup, extracted from U.S. Government footage                                          | [Freesound #182794](https://freesound.org/people/qubodup/sounds/182794/), CC0 1.0                                                                                                                                                                                                      |
| `cruise-launch.wav`                          | “Tomahawk Missile Rocket Launch 2”, qubodup, extracted from U.S. Government footage of a BGM-109 launch        | [Freesound #162379](https://freesound.org/people/qubodup/sounds/162379/), CC0 1.0                                                                                                                                                                                                      |
| `artillery-shot.wav`                         | “Artillery Gunfire”, qubodup, extracted from ArmyVideoTube U.S. Government footage                             | [Freesound #239137](https://freesound.org/people/qubodup/sounds/239137/), CC0 1.0                                                                                                                                                                                                      |
| `missile-flight.wav`, `missile-approach.wav` | “Rocket Flight Loop”, qubodup, edited from NASA public-domain rocket footage                                   | [Freesound #171106](https://freesound.org/people/qubodup/sounds/171106/), CC0 1.0                                                                                                                                                                                                      |
| `ballistic-launch.wav`                       | Minuteman III test launch, 19 February 2025; Staff Sgt. Joshua LeRoi, U.S. Space Force / Space Launch Delta 30 | [DVIDS #952860, VIRIN 250219-X-VJ291-1003](https://www.dvidshub.net/video/952860/minuteman-iii-test-launch-showcases-readiness-us-nuclear-forces-safe-effective-deterrent-non-narrated), marked PUBLIC DOMAIN; [DVIDS public-use conditions](https://www.dvidshub.net/about/copyright) |

The flight loop and terminal approach cue contain recorded NASA rocket-engine
noise. They are **not** recordings of a military missile flying past a microphone
or of a ballistic warhead re-entering the atmosphere. The approach cue is a short
fade of that real engine recording; no generated whistle or oscillator is added.

For the DVIDS recording, no imagery, logos, identifiable people, speech or music
is included. The appearance of U.S. Department of War (DoW) visual information
does not imply or constitute DoW endorsement.

Exact public download URLs, source SHA-256 hashes and crop times are in
[`ordnance-sources.json`](ordnance-sources.json). The large source videos and
listening files stay outside the distribution. DVIDS #926058 was also inspected
but rejected because its audio track is silent; it is not a shipped asset.

Processing: 16 kHz mono PCM16, 35 Hz high-pass, 7 kHz low-pass, a 3 dB bass shelf
at 135 Hz, DC removal, edge fades and peak normalisation to 0.82. The flight loop
has a 20 ms seam crossfade. Six runtime WAV files total **616,264 bytes**. No new
weapon tone/noise synthesis is used. Existing rifle samples, UAV motors and
ambient presets are unchanged. The runtime mixer retains distance, stereo,
outdoor reverb, echo, the existing compressor and output ceiling.

Rebuild the audio from the verified sources (FFmpeg required, one encoding thread):

```sh
python assets/audio/prepare-ordnance.py
node assets/audio/encode-samples.mjs
```

Use `--sources-dir artifacts/qa` to reuse locally downloaded source files. The
JavaScript PCM modules are embedded in the portable HTML and prepared by the
existing audio Worker; playback does not fetch a file, decode an MP3 or allocate
another sample bank per soldier.

Derived WAV SHA-256:

- `rocket-launch.wav`: `4074ddecaffec8def740582d5cd109278cb810641230171df42aba692d5e31a9`
- `cruise-launch.wav`: `27902e9b852d8d7f89941d24612c55d129c56bc67645eb35906d7009f341e874`
- `ballistic-launch.wav`: `fa1377bb5130862b278095b9a71bdcdfc0a88faeaf1e39f78b445c08ac433b3e`
- `artillery-shot.wav`: `d73d5dc0b436d8a2201ef0f25845b5389aabf63fa610164db70a4f5dd5ac4f2f`
- `missile-flight.wav`: `c1e8ac895836da17cc6a17a6802258d6a4b030af49005c4e964fcaffb55a4239`
- `missile-approach.wav`: `fb9677befdfd4154a67bcd8341511f190eee1036a78095807196399cb64c700e`

## Earlier recordings

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
