# Moon Games Local Polish - 2026-09-12

This is a local-only implementation. No GitHub Pages publication, ranking API
deployment, or production score submission was performed.

## Implemented

- All seven games use shared audio settings and neutral visual tokens, with
  touch-sized settings controls and separate music, effects and voice levels.
- Music uses one Web Audio transport per page. New stems join at the next bar
  with an epoch-relative phrase offset; existing stems are not restarted.
- Pack decoding is fixed at 48 kHz independently of the playback device rate.
  Scheduled gain changes follow the audible join, with L2 ensemble balancing,
  compressor headroom and speech ducking.
- Stop, hidden-page, interrupted-context, disposal and stale asynchronous-load
  paths release voices. One failing stem no longer stops the other stems.
- Speech volume changes cancel the current utterance. Settings interaction
  alone does not unlock audio. Returning to a page does not autoplay.
- Moon highlights newly collected phases; piano adds Japanese controls and
  timing-window hints; addition retains counting work after a wrong answer;
  guessing emphasizes hints; Baibain shows two equal groups after a correct
  doubling answer; food and English provide replayable end-of-round review.
- Existing scientific rules, scoring windows, automatic/manual next behavior,
  collections, recording limits and ranking semantics remain in place.

## Verification

| Check | Result |
| --- | --- |
| Seven games, six iPad-sized viewports, direct and embedded | 84 combinations; 1,764 checkpoints; 0 issues |
| Longest food clues and navigation | 36 clue checks; 9 navigation checks; 0 issues |
| Common volume settings | 28 route/entry/size combinations passed |
| Speech/media lifecycle | 225 checks passed; native utterance events simulated, real page navigation |
| Actual file-origin loading | 8 cases passed; all 20 packs decoded at 48 kHz; no external requests |
| Audio engine state and clock model | Next-bar joins, isolated failures, resume/load/dispose races and 1,800-second clock model passed |
| Real PCM epoch comparison | 132 cases; best phase lag 0 samples; maximum PCM error 3.58e-7 |
| Device-rate decode/repeat checks | 38 cases at 44.1/48 kHz output; fixed 48 kHz source buffers |
| Ensemble gain | 12 modeled render comparisons; 12 actual engine bus checks |
| Live-clock join | Existing stem retained; joining stem scheduled with 2.4-second phrase offset |
| Regression suites | Moon science/quiz/quality, piano, arithmetic, guessing, food, English, Baibain, navigation and ranking client checks passed |

The iPad matrix ran while nonvisual audio fixes were integrated. Final audio
state, lifecycle, settings and rendering tests were run separately against those
fixes. The visual matrix checks real controls and canvas/image output, not just
document scroll dimensions. Ranking focus assertions now wait for the native
asynchronous dialog-close event before checking the unchanged focus requirement.

## Evidence

- [Full layout report and adjacent screenshots](output/playwright/polish-ipad/report.json)
- [Volume settings report](output/playwright/audio-controls-ui/report.json)
- [Lifecycle report with source hashes](output/audio-polish/audio-lifecycle-report.json)
- [Audio render measurements, gain comparison and scope](output/audio-polish/audio-render-summary.md)
- [Audio source processing and provenance limits](AUDIO-ASSETS.md)

Primary checks are `tests/ipad-layout-check.cjs`, `tests/audio-engine-check.cjs`,
`tests/audio-render-check.cjs --live`, `tests/audio-offline-check.cjs`,
`tests/audio-controls-ui-check.cjs` and `tests/audio-lifecycle-check.cjs`.
Browser checks require the existing Playwright installation and Chrome/Edge;
their file headers describe environment overrides. The full layout run uses
`IPAD_FINAL_READY=1` and writes to a non-publication artifacts directory.

## Limits

The 19 synchronized loops are waveform-reviewed candidates, not authenticated
or audition-certified recordings. Black retains its unchanged MP3 as a
preview-only pack (`loopable:false`); it is unavailable for synchronized music.
The API can decode it, but a dedicated full-length Black preview UI was not added.
No new recordings were downloaded and no original source files were replaced.

Audio epoch checks render bounded excerpts at positions corresponding to 0,
600 and 1,800 seconds; they are not a live 30-minute listening session. The
gain-chain PCM is independently modeled, while actual-engine checks cover its
decoder, bus values and source schedule, not a full mixed-output recording.
Physical iPad/iPhone Safari, speaker output, Bluetooth routing, native voice
quality and musical authenticity still require real-device listening.
