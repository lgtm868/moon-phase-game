# Moon Game Audit - 2026-09-06

## Scope and independent reference

This audit covers the Moon experience, not the unrelated arithmetic/piano games.
Previous passing tests were not treated as proof of scientific correctness.
The coordinate model was checked against an independent observer basis:
with world north N, Earth-to-Moon direction V, screen right is V cross N.
The Sun is distant and light is parallel; the diagram is not to scale.

References:
- [NAOJ: phases](https://eco.mtk.nao.ac.jp/koyomi/wiki/B7EEA4CECBFEA4C1B7E7A4B1.html)
- [NAOJ: lunar age and calendar dates](https://eco.mtk.nao.ac.jp/koyomi/topics/tex/topics2017_1.pdf)
- [NAOJ: orientation changes in the sky](https://www.nao.ac.jp/astro/sky/2021/03-topics01.html)
- [NASA: phase and orbital views](https://science.nasa.gov/moon/moon-phases/)
- [NASA: longitude/latitude lunar texture](https://svs.gsfc.nasa.gov/4720/)

## Findings and changes

| Finding | Resolution |
| --- | --- |
| Nearest named phase described 39% illumination as first quarter, or 67% as last quarter. Speech repeated the wrong label. | Continuous motion now uses the actual shape. Only exact selected samples retain picker names and highlighting. |
| Calendar names were treated as several-day geometric intervals. | Calendar samples are identified as approximate calendar names, separate from continuous shape descriptions. |
| Forward stepping after an arbitrary drag could skip an upcoming sample. | Select the next strictly forward angle, or previous strictly backward angle. |
| An upper orbital Moon could be hidden under the toolbar. | Toolbar, canvas and footer have separate layout tracks. Drawing and dragging use the actual canvas bounds. |
| The north-side camera reused the equatorial, Earth-facing texture. | It now samples the north-polar hemisphere with synchronous rotation toward Earth. |
| Nearby-looking Sun icon conflicted with the parallel-light assumption. | Parallel rays and a visible scale note make the schematic convention explicit. The physical phase model is unchanged. |
| A generic claim about the view from Japan implied a fixed local-horizon orientation. | The view is explicitly lunar-north-up; local orientation depends on time and place. |
| Coarsely quantized light-cache keys could reuse a neighboring angle's frame. | Cache keys preserve light direction and distinguish Earth/north cameras and orbital rotation. |
| The future quiz used a quarter turn: 7.38265 mean days. | It now advances seven mean-model days, approximately 85.335 degrees. The former approximation was not an arithmetic error, but was ambiguous. |
| Lost pointer capture could leave a drag active, and cancellation could speak after backgrounding. | All interruption paths discard the drag silently; a mouse hover cannot move the Moon. |
| A late media error could leave a failed track active and the music button ON. | Per-attempt failure handling removes failed tracks, reports errors and returns to OFF when all tracks fail. |

## Verification gates

- `tests/moon-audit-check.cjs`: real pointer interaction, all picker samples, continuous labels, hit testing and small-screen visibility.
- `tests/moon-texture-check.cjs`: independent camera/texture landmarks and rotation.
- `tests/orbit-check.cjs`: locate the drawn Moon from pixels, check north-view positions, dragging, progression and frozen quiz sources. Its mirrored negative control must fail.
- `tests/quiz-check.cjs`: full-cycle decks, exact seven-day targets, unique answers, boundary cases, source preservation and independent illumination masks.
- `tests/quality-check.cjs`: layout, images, actual media progression, controls, mode switching and offline file loading.
- Public HTML and wrapper version are checked after deployment; test artifacts are not published.

## Final local results

All five suites passed against the final implementation:

| Suite | Result |
| --- | --- |
| Independent browser audit | 6,866 checks, seven viewport sizes, zero failures. |
| Quiz | 1,520 canvas checks; 14 boundary cases across 280 additional questions; minimum rendered-mask separation 0.18049, above the required 0.15. |
| Orbital view | Four viewport sizes; cardinal positions, dragging, progression and frozen sources passed. |
| Texture | 162 assertions and four broken-projection/cache negative controls passed. |
| Quality | Seven viewport sizes, loaded images, real audio progression, file loading, seven drag-interruption/recovery paths and media-failure races passed. |

Independent scientific review also passed 201 boundary/model checks. Six
deliberate interruption/media regressions failed their intended assertions.
The earlier mirrored-orbit and quarter-turn-week fixtures are rejected by the
updated tests. The browser-audit total can vary with randomized question types.

## Explicit limits

This is a circular, uniform-speed teaching model using a 29.53059-day synodic
month, not a date-specific ephemeris. It omits orbital inclination, variable
speed, eclipses, libration, observer latitude/time and calibrated brightness.
Calendar names are representative examples, not dates inferred from shape.
Extremely thin crescents can be subpixel; their angles are not rounded to new
moon and their names/accessible percentages do not claim zero illumination.

Browser automation uses installed desktop Chromium at mobile viewport sizes,
not physical iPhone hardware. iOS voices, audio routing and app sharing require
device checks. The current hosted app also needs relative character images and
audio assets; it is not a wholly self-contained HTML attachment. Audio source
authenticity/licensing and beat-perfect mixing were not re-certified by this
lunar-science audit.
