# Black and character release verification

Verified on 2026-09-12 using installed Chrome 152 and bundled Node 24.

## Passed

- Shared audio engine: next-bar joins, Black full one-shot natural end, continued looping stems, stale selection suppression, mute/hidden/dispose, failure recovery and simulated long-duration clock checks.
- Real Black playback: full approximately 17.46-second buffer, no loop truncation, natural end and continued companion track.
- Black UI: Moon and arithmetic selection, repeat intent, native completion and lifecycle cleanup.
- Piano roster: 25 images/choices; Black preview does not mutate the song clock or recordings; failed-start cleanup is idempotent and later Reset/start succeeds.
- Character registry: original twenty unchanged; five named MOD records have no fabricated music; arithmetic/guessing remain original-twenty banks.
- Asset audit: original twenty image/audio pairs plus all fifteen new PNGs. True alpha checked separately from visual likeness.
- Moon/Piano roster UI: eight direct/embedded tablet/phone cases, all 35/25 choices and image loading, with screenshots reviewed.
- Anpanman assets: ten alpha checks and actual draw-pixel changes, combined 35-character selection at 1024x600, 1180x820 and 390x844.
- Focused iPad integration: Moon/Piano/arithmetic, direct and embedded, 1024x600 and 1180x820 (12 cases, zero issues).
- Offline loading: seven games plus a prefixed Moon entry, eight cases, no external requests or missing referenced assets, decoded audio at 48 kHz.
- Seven-route navigation and publication-checkout MOD integration.

## Limits

These are desktop Chrome viewport tests, not physical iPad/iPhone Safari validation. Image generation is reference-based adaptation, not pixel-perfect official artwork. Some images have small nonzero-alpha edge specks or less than 10% padding; full silhouettes were visually checked. The five added MOD characters have no verified original recordings assigned. Existing recording provenance is not certified by playback or waveform tests.

Generated images, exact prompts, appearance comparisons and unsuccessful generation attempts are documented in the local output audit folders referenced by CHARACTER-ASSETS.md. Rollpanna's red/blue chest badges were corrected from hearts to circles after comparison with the official reference.
