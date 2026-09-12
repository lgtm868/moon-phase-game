# Offline Audio Assets

## Status and Limits

19 waveform-reviewed candidate loops, not audition-certified or independently authenticated recordings. All 20 roster originals were inspected; Black was actually decoded with Edge Web Audio (48 kHz mono, 838147 frames, 17.461396 s). No audible monitoring or reliable listening interface was available. Envelope peaks are not note transcription: sustained sounds can produce false attacks. Garnold, Sky, Mr. Tree and other melodic/vocal phrase interpretations remain provisional pending human listening. Structural tests do not establish musical correctness.

**Black plays the full original once, without synchronized looping.** Its pack contains the original MP3 bytes, unchanged, with `loopable:false`, `beats:null`, `loopStart:0`, `loopEnd:838147/48000` (17.461395833333334 s) and conservative `gain:0.2`. The decoded onset is 0.332813 s; substantial energy continues to about 15 s with decay to 17.46 s. A 100 BPM phrase boundary is not verified. The engine accepts it in `setMusicSelection`, starts at the next bar with offset zero, and removes it from transport selection at natural end. Other loops continue. A stale selection resend cannot repeat it; omit and reselect it or explicitly stop before replaying. Never enable source.loop or infer a beat count for Black. This does not claim 20 verified synchronized loops.

The existing roster selects `simon.wav`. The alternate `sounds/simon.mp3` is untouched and unused. No sources were downloaded, replaced, renamed, or authenticated against an external reference.

## Rebuild and Analysis

Run `node tools/build-audio-assets.cjs` to rebuild packs, manifest and this report, offline with Node built-ins. Source SHA-256 pins reject unreviewed changes before writing outputs. Run `node tools/build-audio-assets.cjs --analyze` for full source metrics and real MP3 decode; this requires installed Playwright plus Edge (or `AUDIO_BROWSER` executable). Set `NODE_PATH` to the installed package directory or `AUDIO_PLAYWRIGHT` to its module path. No install/download is performed. Run `node tests/audio-assets-check.cjs`; additionally run `node tests/audio-assets-browser-check.cjs` with Playwright configured for file/HTTP script-loading and browser decode tests.

## Timing and Processing

100 BPM, 4 beats/bar. Each supported phrase uses 8 beats, exactly 230400 frames at 48000 Hz (4.8 s); shared beat = 28800 frames. No justified longer musical phrase was established in these 19 WAVs. Pinki and Jevin have long decreasing tails, not duration-derived 16-beat assignments. A future longer verified phrase must use its actual whole-bar beat count, not be cut to eight beats.

44.1 kHz originals use deterministic 48-tap Hann-windowed sinc sample-rate conversion to 48 kHz; existing 48 kHz PCM is retained before tail treatment. Playback rate must remain 1. No pitch shift, time stretch, onset alignment, or leading-rest removal. Stereo remains stereo. Sample-rate conversion is rounded to the nearest output frame (at most half a sample).

Samples after the phrase boundary are circularly overlap-added at their original modulo-4.8 s positions, including tails longer than one cycle. Only the final 5 ms of exported tail are cosine-tapered to suppress the export endpoint; no tail is simply discarded. A final 2 ms cosine endpoint correction matches the unchanged first sample exactly, without shortening the period or moving beat positions. This also places previous-cycle reverb at the first playback, an intentional steady-state loop approximation, not a pristine first entrance. Listen to isolated loops and combinations before declaring musical sign-off.

Output is 16-bit PCM WAV, rounded without random dither for reproducible builds. Clipping is rejected. Metadata gain targets RMS 0.04, capped at 2x and peak 0.8, and is not baked into PCM. It is not LUFS normalization or a multi-track limiter: the engine must supply master headroom for summed tracks.

## Integration Contract

Load `games-audio-manifest.js` as a classic script, then load a selected relative `file` with a script element after `window.MoonAudio.registerAsset` exists. Each pack makes exactly one synchronous registration with base64 data, MIME type, loopable, beats, loopStart, loopEnd and gain. The 19 candidate loops use WAV and loopable:true; Black uses original MP3 and loopable:false. No fetch, module import, eval, network library, or game/engine edits are included. Manifest and pack metadata agree. Schedule loopable tracks using their beat count, not source export duration.

**Decode contract:** use `new OfflineAudioContext(2, 1, 48000).decodeAudioData(bytes)` and retain the resulting 48000 Hz AudioBuffer for the playback source. The output context can then resample during playback. Edge direct `decodeAudioData` into 44100 Hz returned 211679 frames instead of 211680, so decoding straight into an arbitrary device-rate context is NOT sample-exact. Do not derive the transport period from that shortened buffer or compensate by changing playbackRate. The browser test checks the recommended 48 kHz buffer playing at both 48 and 44.1 kHz.

## Measured Metrics

Source threshold times use sample magnitude >= 0.001 (-60 dBFS); RMS is unweighted across channels. Tail RMS is measured after 4.8 s. Bridge is the maximum absolute endpoint correction before gain. Onset time is diagnostic only and is never trimmed.

| ID | Source s | Hz/ch | First/last >-60dB s | Source RMS | Tail RMS | Wrapped frames | Output peak | Gain | Bridge |
|---|---:|---|---|---:|---:|---:|---:|---:|---:|
| oren | 4.968753 | 44100/2 | 0.000748 / 4.755624 | 0.067099 | 0.000066 | 8100 | 0.534241 | 0.585936 | 0.000059 |
| raddy | 5.175011 | 44100/2 | 0.600748 / 4.971020 | 0.034193 | 0.003128 | 18001 | 0.557892 | 1.126646 | 0.003425 |
| clukr | 5.106250 | 48000/1 | 0.000812 / 4.906813 | 0.011944 | 0.000876 | 14700 | 0.113312 | 2 | 0.002350 |
| funbot | 4.806250 | 48000/1 | 0.000146 / 4.513771 | 0.032844 | 0.000000 | 300 | 0.298401 | 1.217072 | 0.000061 |
| vineria | 5.043741 | 44100/2 | 0.000862 / 4.849252 | 0.020208 | 0.000214 | 11700 | 0.285309 | 1.931073 | 0.000053 |
| gray | 4.818753 | 44100/2 | 0.000023 / 4.803175 | 0.088314 | 0.006624 | 900 | 0.332825 | 0.451984 | 0.001081 |
| brud | 4.812494 | 44100/2 | 0.000794 / 4.794603 | 0.023315 | 0.000000 | 600 | 0.114929 | 1.713394 | 0.000000 |
| garnold | 4.812479 | 48000/1 | 0.000750 / 4.795063 | 0.036870 | 0.000000 | 599 | 0.073364 | 1.083473 | 0.000000 |
| owakcx | 5.118750 | 48000/1 | 0.000021 / 3.624354 | 0.026970 | 0.000026 | 15300 | 0.329773 | 1.436193 | 0.000397 |
| sky | 6.143741 | 44100/2 | 0.000748 / 5.842041 | 0.049082 | 0.011865 | 64500 | 0.407532 | 0.720027 | 0.000233 |
| mrsun | 5.868753 | 44100/2 | 0.000023 / 5.463265 | 0.079225 | 0.009561 | 51300 | 0.407867 | 0.456771 | 0.002939 |
| durple | 4.818750 | 48000/1 | 2.701021 / 4.756938 | 0.036239 | 0.000015 | 900 | 0.366486 | 1.101627 | 0.000000 |
| mrtree | 5.275011 | 44100/2 | 0.000907 / 5.020249 | 0.067577 | 0.003071 | 22801 | 0.256866 | 0.564562 | 0.001551 |
| simon | 4.818750 | 48000/1 | 0.000000 / 4.802708 | 0.040861 | 0.003938 | 900 | 0.167725 | 0.976781 | 0.073700 |
| tunner | 4.926104 | 48000/1 | 0.006208 / 4.835646 | 0.036991 | 0.012103 | 6053 | 0.077667 | 1.067396 | 0.002106 |
| mrfun | 4.824979 | 48000/1 | 0.000042 / 4.807125 | 0.070561 | 0.002244 | 1199 | 0.521362 | 0.565415 | 0.000122 |
| wenda | 4.806250 | 48000/1 | 0.600646 / 4.417917 | 0.029595 | 0.000000 | 300 | 0.355865 | 1.350695 | 0.000000 |
| pinki | 9.675011 | 44100/2 | 0.000862 / 6.950726 | 0.043005 | 0.000917 | 234001 | 0.305084 | 0.655167 | 0.000421 |
| jevin | 8.493729 | 48000/1 | 0.001083 / 6.458312 | 0.048209 | 0.006164 | 177299 | 0.252167 | 0.623518 | 0.000122 |

Black (one-shot only): RMS 0.162238; peak 0.823391; first/last >-60dB 0.332813 / 17.414917 s. After gain 0.2: RMS about 0.032448, peak about 0.164678. MP3 decoder details can vary slightly with browser version; re-run analysis for current values.

## Per-Track Decisions

- **oren:** Kick attacks on the 0.15 s grid; final attack at 4.5 s, negligible export tail.
- **raddy:** Keep the 0.6 s opening rest; backbeats and final 4.65 s hit precede a decaying tail.
- **clukr:** Attacks every 0.6 s through 4.2 s; remaining material is decay.
- **funbot:** 0.15 s subdivision attacks repeat across two bars; exported trailing silence.
- **vineria:** Subdivision attacks through 4.65 s; quiet decay beyond the two-bar boundary.
- **gray:** Sustained bass, internal rests, release at 4.8 s; wrap the short release, not an onset trim.
- **brud:** 0.15 s attacks through 4.65 s; silence after 4.8 s.
- **garnold:** Continuous phrase ending before 4.8 s, then exact silence; musical meter is provisional without audition.
- **owakcx:** Early attacks on the shared grid; long diminishing decay, no later phrase detected.
- **sky:** Phrase attacks before 4.8 s with a sustained final note and decay to 6.14 s; tail classification provisional.
- **mrsun:** Active phrase through 4.8 s followed by rapid decay; no new phrase established in tail.
- **durple:** Keep 2.7 s opening rest; attacks at 2.7, 3.0, 3.9, 4.2, 4.5 s.
- **mrtree:** Sustained material through 4.8 s followed by release to 5.28 s; meter provisional without audition.
- **simon:** Existing roster selects WAV, not the alternate MP3; repeating figures and release at 4.8 s.
- **tunner:** Keep opening attack envelope and internal rests; final note release continues about 36 ms beyond 4.8 s.
- **mrfun:** Two-bar vocal activity with brief release beyond 4.8 s; no leading-silence removal.
- **wenda:** Four repeated bursts at 0.6, 1.8, 3.0, 4.2 s; keep intentional opening rest.
- **pinki:** Strong activity ends near 4.2 s; half-second RMS then decays monotonically through 9.67 s. Not evidence of a four-bar phrase.
- **jevin:** Sustained voice releases around 4.8 s; subsequent RMS decays through 8.49 s, not a new phrase.
- **black:** BLOCKED: decoded 17.461396 s, onset 0.332813 s, sustained non-grid material. No defensible 100 BPM phrase boundary; do not stretch, truncate, or pad into a fabricated loop.

## Source Integrity and Output Digests

| ID | Original SHA-256 | Packed audio SHA-256 |
|---|---|---|
| oren | 4fe337e4a079455c04b82513c227497073fec5ce8f59e47981b1fd272f0115b3 | b2b8dd4e828a2d041d018a2779b11a12c64358df9a5b9ce8ff2b1108f56f96e6 |
| raddy | da34b144dabca0366e675eacae169b0efb34c15be909a117f2b45d41ec870ac9 | df7efacab898d112e5b57c7a021e41fbdf011a9230ddfc492f1740eaa0c15259 |
| clukr | 711d493d8c6d63859d4f5755229506054ec070bcea5e15646c1ede7f25c7cb87 | 1bba95c96257dc64a3c3b7175d65e94d434f2dc15d5c0137042aa753bfd411bb |
| funbot | f10af7fb9ed16fcf4d92618b2e8c7108a8289efe18a5161ab7881822904f7e08 | c1a5a5962343d5c871bad9cf8e0a65e8138af256b5c00822d19a7b8e03625b41 |
| vineria | 19b2125774bf2d0fb5d303626cca47cbfa590ac1209946d6e25602a1c95f750d | 3cbadc451a7969b5c65396b6e038e538362bc5d843c9d9749ca235db8d173242 |
| gray | c1663a051b4223fc32f074c57e057317551a4a57753f7181891acb6fcb365e6d | 3802352ec7c0b39439c2454e266d665b57b4ca4e135e8cfa1e8026ca0cb3a317 |
| brud | 7f40c4ec53ab29318988973d892cb0e8f8df77619d286d0ccf11da22b9b540e2 | 2145e465592ba716aa0f59ef061ca3aa7e2e7a1a7ae276b06b648ca846a547c6 |
| garnold | d3b45937c2b3e8cb207853ce96a20de265c1f0c61aa5c2d0611ad0830c85114a | 3ee78657af3a7a6f3efaa57dedc2ac2dbc87847f5834acbdbb16520eaaffe246 |
| owakcx | aded5b7877561d17bb65c39e8c2f3e1859294bf3f758f687d898e486deedf3b2 | e389a1f712e1db24ade1413d21aec669be6d97c261f9267e0556510887b3b2ff |
| sky | a4210458091e9d6a1ad74d0037fa99e7ef504c6a3737e371cf2fc79fcd9ec8ad | fe0126b39fd5512fc8b746f2d2f6d7095d124dcc1cc09a0020c02cdb5cd16af0 |
| mrsun | 467a6def73cb6454849d760cec9d27b556861a7e15bf8ee03ff312f19547b64a | 3f6b061ed62d8a1280fb9c48eddf565bc44cc99fb25b6afe7d8066e2b6053e33 |
| durple | 27dbb510a246b203f5e000766f7cc22e895abf80d6c30876873bdd6fb044cc3f | fc277873b187454f873f7a6cf2db02e91eaec08484a17085f9712354365d3208 |
| mrtree | 1ebb52bd31d591f180a5d8444934f2506941630615c597495d13d219ccadfdcb | 67a7a12d7fcab9ab1fabfffa52644387149356b0a3fccc60ec363c07ba2adcd2 |
| simon | adb683c15852f94dc3d3cc16102515e34f3c4d60506f044ba364cd5d472f7e93 | ab38f71ccbd553b06808bc80182c8b072577e6ff4d6e47d6d16cec238f4cab37 |
| tunner | 99602abd610d2145dcb87e81f7eab0950710ba4fd1d4f29d3048e5e53e061716 | b67f8e6ba347e60f8b3cac12801dba4dcbad7125c3cee7dd10ed2645d7504f75 |
| mrfun | 37e0a38b4fedfe0f78feb4986a4f32276132e9c258a984b4ea13b890be146aae | 613683bfd9a6cdb57b075c10405c4845f79e710bec016395dd05cef313244af4 |
| wenda | 109d4242854796fac473278b57a9dc172ab508b486a1a8b2e3a8dda8a08a1b35 | 2ec3edbc0878785a55c0267f9ebe9deb18add385c7086c77ef04ab3ce8dcef9d |
| pinki | 2c102391c055dcc018d45532d9d4c5f70a051813513863a50c6de0a746a6670c | edf2fe1ec42811cb01a4fabadd25e250a25f70e3b5ca7092e7cff6c40a8e8039 |
| jevin | 9f6df9ed113de03dd719c99ff1fdcd2c3fa048630c9848062d93f9a72cc8eb66 | 80478b9ab50fad1084446dd282c12aecaac9c010972ffc899361759cda1af0e7 |
| black | 4757e4a2fbbad5a404cbcdcea0d77ceac55c37a2ec947d34b3e474ba79230f4b | 4757e4a2fbbad5a404cbcdcea0d77ceac55c37a2ec947d34b3e474ba79230f4b |

## Anpan10 Game-Original Music

These ten tracks are composed game-original music, NOT official songs, recordings, or arrangements of official songs. Character IDs identify game selections only. The manifest contains 30 tracks: the unchanged canonical 20 plus these ten game-original loops.

`tools/anpanman-score.cjs` exports `renderTracks()`. The builder validates all ten records and encodes their mono or stereo Float32 channels directly with writeWav: exactly 230400 frames at 48000 Hz, 8 beats at 100 BPM (4.8 seconds). No resampling, tail wrapping, endpoint correction, or gain normalization is applied to these compositions. Gain comes from each score record and is metadata only, not baked into the PCM. PCM must be finite and below full scale.

Each generated `sounds/<id>.wav` is the source for the identical WAV bytes embedded in `sounds/packed/<id>.js`. Both manifest and pack carry `provenance:game-original`, `loopable:true`, `beats:8`, `loopStart:0`, `loopEnd:4.8`, title, instrument and score gain. Canonical source SHA-256 pins and canonical pack generation remain unchanged. This report does not claim listening certification.

| ID | Title | Instrument | Gain | Source / packed WAV SHA-256 |
|---|---|---|---:|---|
| anpanman | Sunny steps | brass | 0.26 | e5c59197a3f24ed2112868f37d9203fcf93e4c71492a35046cb68bc9d68622f8 |
| baikinman | Tiptoe bounce | plucked | 0.26 | c59cb0be879fb2caa9cc50ecd688bc3cc94ced5b73d673dcb50e6e7a5c3a1c09 |
| dokinchan | Little sparkles | bell | 0.26 | 9ba06ec25cdd587870e50f3185810c4595ae531f16a2f0dfa0a61aa5913d9d4a |
| shokupanman | Soft morning | piano | 0.26 | 419cb2fe3531d8426e5de69f34ef0ea6e334984f1768c7516ee1bf8dbd615531 |
| currypanman | Round drum dance | drum | 0.26 | fba22352059dd40940d38e7c4720becaedcba5102cd4ac89200eb64c0bfed20a |
| melonpanna | Floating petals | musicbox | 0.26 | 2c59afed29d5bd940ebc95003db3a9624ad8b88aff3eacc2766cfbd6bfaf8b27 |
| rollpanna | Ribbon breeze | harp | 0.26 | 5daf6b423909b64b6a4261c221686754cbabaaa6aa2bc032b409e2b6578d0a5b |
| creampanda | Hop and smile | marimba | 0.26 | e90daf0f789333c7287dcbe17878ca3e2125c13b4f2b19f1f197a7ab3f8e9711 |
| jamojisan | Warm kitchen | bass | 0.26 | 9545f1606029a3324d25ed68e3ae44b844788a31398a4438fc384096368036dd |
| batakosan | Busy little hands | wood | 0.26 | f4e3ee69193f712837f035af36ade9bf5886d8fe06212f6bdd1b285ca1596bb9 |

## Generated Files

- `tools/build-audio-assets.cjs` (build/analysis implementation)
- `games-audio-manifest.js`
- `AUDIO-ASSETS.md` (this generated report)
- `sounds/packed/oren.js` (1229093 bytes)
- `sounds/packed/raddy.js` (1229094 bytes)
- `sounds/packed/clukr.js` (614687 bytes)
- `sounds/packed/funbot.js` (614695 bytes)
- `sounds/packed/vineria.js` (1229096 bytes)
- `sounds/packed/gray.js` (1229093 bytes)
- `sounds/packed/brud.js` (1229093 bytes)
- `sounds/packed/garnold.js` (614696 bytes)
- `sounds/packed/owakcx.js` (614695 bytes)
- `sounds/packed/sky.js` (1229092 bytes)
- `sounds/packed/mrsun.js` (1229094 bytes)
- `sounds/packed/durple.js` (614695 bytes)
- `sounds/packed/mrtree.js` (1229095 bytes)
- `sounds/packed/simon.js` (614694 bytes)
- `sounds/packed/tunner.js` (614695 bytes)
- `sounds/packed/mrfun.js` (614694 bytes)
- `sounds/packed/wenda.js` (614694 bytes)
- `sounds/packed/pinki.js` (1229094 bytes)
- `sounds/packed/jevin.js` (614694 bytes)
- `sounds/packed/black.js` (375333 bytes, original MP3 preview only)

Total pack bytes: 17584116. Each pack is separate for on-demand loading.

### Additional Game-Original Files

- `tools/anpanman-score.cjs` (composition renderer)
- `sounds/anpanman.wav`
- `sounds/packed/anpanman.js` (1229174 bytes)
- `sounds/baikinman.wav`
- `sounds/packed/baikinman.js` (1229179 bytes)
- `sounds/dokinchan.wav`
- `sounds/packed/dokinchan.js` (1229178 bytes)
- `sounds/shokupanman.wav`
- `sounds/packed/shokupanman.js` (1229178 bytes)
- `sounds/currypanman.wav`
- `sounds/packed/currypanman.js` (1229181 bytes)
- `sounds/melonpanna.wav`
- `sounds/packed/melonpanna.js` (1229183 bytes)
- `sounds/rollpanna.wav`
- `sounds/packed/rollpanna.js` (1229176 bytes)
- `sounds/creampanda.wav`
- `sounds/packed/creampanda.js` (1229180 bytes)
- `sounds/jamojisan.wav`
- `sounds/packed/jamojisan.js` (1229175 bytes)
- `sounds/batakosan.wav`
- `sounds/packed/batakosan.js` (1229180 bytes)

Game-original pack bytes: 12291784. Total across all 30 packs: 29875900.
