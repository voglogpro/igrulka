# Native recording sources

Native output directory: `native/Skyfront.Client/Assets/audio` (capital `Assets`).
Godot resource paths: `res://Assets/audio/impact-recording.wav` and
`res://Assets/audio/rifle-recording.wav`.

The native prototype stages the existing game's recorded WAV/Opus assets and their
`LICENSE.md`, `CC0-1.0.txt`, `CC-BY-4.0.txt`, `ordnance-sources.json` and
`rain-sources.json` without changing those recordings. Their existing authors and
licences remain applicable. The native additions below do not modify browser audio.

## Additional recordings, retrieved 2026-11-01

**impact-recording.wav**: “Large explosion” by **SamsterBirdies**, Freesound #592000,
[primary source and CC0 licence statement](https://freesound.org/people/SamsterBirdies/sounds/592000/).
The author describes a firecracker recorded in a garage with Tascam DR-100mkIII,
then pitched down, layered and lengthened. This is a recording-based designed
effect; it is **not a recording of battlefield ordnance**. Our stage adds no layers,
oscillators, noise, pitch change or dynamics processing.

- Licence: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
- Downloaded file: the page's official [HQ MP3 preview](https://cdn.freesound.org/previews/592/592000_5487341-hq.mp3), not the login-only original FLAC.
- Frozen source: `native/audio-sources/impact-592000.mp3`, 249870 bytes.
- Source SHA-256: `fbc04a0bcbdba5647d5546d33c853d3ba2ef4cd2e24095bb62113202076f93ef`.
- Conversion: decode full preview, downmix stereo to mono, resample to 44100 Hz,
  PCM16 WAV; strip metadata. The event name is an in-game mapping, not a claim of source identity.

**rifle-recording.wav**: “Rifle Shooting” by **qubodup**, Freesound #238916,
[primary source and CC0 licence statement](https://freesound.org/people/qubodup/sounds/238916/).
The uploader describes automatic weapon fire extracted from a US Government-agency
video and releases it as CC0/public domain. The uploader does not name the original
agency on that page; no narrower attribution is invented here.

- Licence: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
- Downloaded file: the page's official [HQ MP3 preview](https://cdn.freesound.org/previews/238/238916_71257-hq.mp3), not the login-only original FLAC.
- Frozen source: `native/audio-sources/rifle-238916.mp3`, 98544 bytes.
- Source SHA-256: `5d0fdc6b392289ca0bc1f14092c2f027e53998f015c4c92ecb23e25d19dfc463`.
- Conversion: first 0.24 seconds of the preview (one initial shot), last 0.03 seconds
  faded out starting at 0.21 seconds; mono, 44100 Hz, PCM16 WAV; strip metadata.
  No generated attack, tone, noise or additional weapon layer is added.

The downloaded previews total 348414 bytes, below 10 MB. Their licence statements
and recording descriptions were checked on the authors' Freesound pages. This is
not a listening/subjective approval or hardware audio measurement.

## Reproduction

Run `node scripts/stage-native-audio.mjs` from the repository. The script verifies
the frozen MP3 checksums, copies existing recordings/licence manifests, and decodes
the two frozen MP3s using FFmpeg on PATH (or `FFMPEG_PATH`). No download happens at
build time. Already staged WAVs ship with the application; end users do not need FFmpeg.
`node scripts/stage-native-audio.mjs --check` verifies sources and staged WAV headers
without invoking FFmpeg or modifying files. The stage prints output SHA-256 hashes.

The original browser `blast`, `blastLarge`, `blastSmall` and gunshot presets are
runtime synthesis in `src/audio/synth.js`, not encoded field recordings. They were
not generated/exported by this stage. Existing `artillery-shot.wav` is artillery
gunfire and is not relabelled as an explosion. These new native recording mappings
are an explicitly scoped prototype addition, not preservation of the browser's exact mix.
