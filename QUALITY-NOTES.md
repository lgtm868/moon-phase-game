# Moon game: rendering and interaction notes

## Scientific model

The Sun is on the left. The orbital view always lights the left hemisphere of
the Moon. The Earth-facing view uses the surface-normal dot product with the
light vector `(sin(phase), 0, -cos(phase))`. New moon, first quarter, full moon,
and last quarter occur at 0, 90, 180, and 270 degrees. The northern-hemisphere
view shows waxing light on the right and waning light on the left.

Traditional lunar-day names have approximate positions in a mean 29.53059-day
cycle, not 16 equal angular sectors. These are illustrative positions, not a
calendar or an ephemeris. Actual lunar age and traditional calendar dates vary.
The physical sizes and distances are not to scale. This is a phase model, not
an eclipse simulation.

Sources:
- NASA, Moon Phases: https://science.nasa.gov/moon/moon-phases/
- NAOJ, lunar age: https://eco.mtk.nao.ac.jp/koyomi/topics/tex/topics2017_1.pdf
- NASA's Scientific Visualization Studio, CGI Moon Kit (Ernie Wright):
  https://svs.gsfc.nasa.gov/4720/

The embedded lunar albedo image is the 2019 LROC WAC color mosaic from NASA SVS.
It is projected onto a sphere in Canvas. Geometry and texture samples are
cached separately from phase lighting. Cache sizes are bounded. The embedded
image avoids remote image requests and file-origin canvas restrictions.

## Quiz model

The quiz uses eight unambiguous astronomical representatives at 45-degree
intervals, independently of the traditional calendar-day picker. The default
Find tab has a shuffled 16-question deck: names/descriptions and the current
Earth-view appearance from orbital position. The separate Challenge tab has
eight questions about the shape one week later. Future-shape questions never
appear in Find. Each mode keeps its own question, deck, score and feedback;
switching modes restores that session, including incorrect-choice highlights.
One week is modeled as one quarter of the mean 29.53059-day cycle (7.38 days).
The displayed orientation is the same northern-hemisphere convention as the
main renderer; this is not an exact-date or observing-time prediction.

Questions and options are immutable. The diagram is frozen to the question,
not the previously explored Moon. Unsolved name/orbit questions mask the
Earth-view answer, including its accessible and spoken labels; sequence
questions show the source Moon. After answering a sequence question, both the
diagram and the "current Moon" summary still show the original source. The
answer is identified separately by the selected option and result label.
Replacing the source with the future answer would change the visible question
while retaining the old grading result, so tests explicitly forbid that change.
In particular, last quarter leads to new moon, and full moon leads to last
quarter after about one week. Summary speech always describes its shown Moon.
Only the explicit Next button advances. Tab changes and backgrounding retain
the question, result and score. Leaving the quiz restores the previous
exploration phase rather than leaking the quiz answer through the phase picker.
Duplicate and stale answer events cannot score, including events from options
detached during a mode change. Both quiz tabs share a panel whose accessible
label tracks the selected tab; keyboard navigation includes all four tabs.

## Music and speech

Music starts off. The ON action invokes each selected HTML media element's
play method inside the user gesture, with real existing audio files and no
substitute synthesized character music. Selection changes do not restart
already-playing tracks. Stale play failures are ignored after a newer attempt
or OFF action. Backgrounding stops music and motion, while preserving the quiz.
The read-aloud toggle is separate from music; character names use English for
Sprunki and Japanese for the existing Japanese characters.

The inherited recordings have different lengths and unverified musical loop
boundaries. Native looping is retained; it does not guarantee beat-perfect
mixing. The prior wall-clock seeks and silence-based speed changes were removed
because they interrupted playback and altered timing/pitch. A future exact
musical synchronizer needs validated per-recording bar/beat metadata or clean
loop stems, not a guess from file length or trailing silence.

## Verification

`tests/quality-check.cjs` uses Playwright and a temporary HTTP server. It checks
seven viewports (320x568, 375x667, 390x844, 667x375, 740x360, 844x390 and 1280x800), overflow, all
images, 16 phase selections, drag/keyboard control, phase pixel illumination,
30 character choices, actual media time progression, OFF, and quiz answers.
It also checks the index wrapper and piano navigation, delayed/rejected media
playback, and the file URL with external network blocked.

`tests/quiz-check.cjs` exercises complete quiz decks, every incorrect choice,
correct answers, rendered illumination and bright-side direction, duplicate
scoring, summary masking, frozen diagrams, tab/background persistence, and
explicit rather than timed advancement.

Run with Node and Playwright installed:

```sh
node tests/quality-check.cjs
node tests/quiz-check.cjs
```

Optional `PLAYWRIGHT_MODULE` selects an installed Playwright module path;
`CHROME_EXECUTABLE` selects a Chrome binary. Screenshots are written to output/.
These checks exercise desktop Chromium at mobile sizes, not a physical iPhone.
Device-specific audio routing, system voices, and fullscreen support still
depend on the browser and operating system. Fullscreen hides when unsupported.

## Local use

Open moon-phase-game.html alongside the existing character images and sounds/
folder. The lunar texture itself is embedded. index.html retains piano routing
and uses the full frame for the moon game. No build step or runtime CDN is used.
