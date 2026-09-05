# Moon game: rendering and interaction notes

## Scientific model

The Sun is on the left. The orbital view always lights the left hemisphere of
the Moon. The Earth-facing view uses the surface-normal dot product with the
light vector `(sin(phase), 0, -cos(phase))`. New moon, first quarter, full moon,
and last quarter occur at 0, 90, 180, and 270 degrees. The northern-hemisphere
view shows waxing light on the right and waning light on the left.

The orbital diagram is explicitly viewed from the north-pole side. With the
Sun at the left, new/first-quarter/full/last-quarter positions are left/bottom/
right/top. Screen coordinates are `x = cx - r*cos(phase)` and
`y = cy + r*sin(phase)`: increasing phase moves counterclockwise. Dragging uses
the inverse `atan2(dy, -dx)`. The former negative-y mapping mirrored the orbit
relative to the northern-upright Earth view. Tests must check actual drawn
Moon positions, not just phase values or the separately rendered summary.
The orbit's sun-facing half remains lit on the left at every position; do not
substitute the Earth-view phase rendering for this top-down view.

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

Quiz phases are continuous angles across the entire lunar cycle, independently
of the traditional calendar-day picker. Each mode has a shuffled 20-question
deck: one random angle within each of 16 sectors, plus the four exact cardinal
phases. Angles are sampled afresh for each deck, not rounded to fixed shapes.
The visible `いまの形` mode asks the current Earth-view appearance for sampled angles and uses name
questions only for new/first-quarter/full/last-quarter anchors. The explicitly
selected `1週間後` mode asks about one week later for all angles. Future-shape questions never appear in
the current-shape mode. Each mode keeps its own question, deck, score and feedback; switching
modes restores that session, including incorrect-choice highlights.

Every question has eight question-local options, one retaining the exact
answer angle. Distractors are spaced by 0.25 along a length-2 illumination
coordinate: f for waxing, 2-f for waning, where f=(1-cos(angle))/2. For ideal
binary-lit disks this gives at least 25% disk-area symmetric difference, even
near new/full moon. Raster appearance is checked separately at thumbnail size.
Intermediate phases use descriptive shape names, not exact calendar-day names.
Accessible option names also include the approximate illuminated percentage.
Non-cardinal moons with less than 1% illumination are named just before/after
new moon, not new moon itself. Their accessible percentages say less than 1%,
never rounded to 0%; likewise near-full non-full moons are not announced as 100%.
Thumbnails are enlarged where layout permits, but the illuminated shape is not
artificially thickened. At finite screen resolution a very thin crescent can
still be subpixel; the phase angle and grading retain their exact values.
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
Boundary regressions cover exact new moon and both neighboring thin crescents
in both modes, including all incorrect options and unchanged source diagrams.
Moon option containment is checked at every supported test viewport.

`tests/orbit-check.cjs` locates the drawn Moon from canvas pixels, checks its
cardinal positions against the north-side view, and derives the Earth-view
lighting from that measured position. It also checks eight-direction dragging
and counterclockwise progression rather than trusting the phase label alone.

Run with Node and Playwright installed:

```sh
node tests/quality-check.cjs
node tests/quiz-check.cjs
node tests/orbit-check.cjs
```

Optional `PLAYWRIGHT_MODULE` selects an installed Playwright module path;
`CHROME_EXECUTABLE` selects a Chrome binary. Screenshots are written to output/.
The orbital test uses a temporary screenshot directory unless `ORBIT_ARTIFACTS`
is set. `ORBIT_MIRRORED_FIXTURE=1` serves the former mirrored geometry without
editing the app: that negative-control run must fail the position assertions.
These checks exercise desktop Chromium at mobile sizes, not a physical iPhone.
Device-specific audio routing, system voices, and fullscreen support still
depend on the browser and operating system. Fullscreen hides when unsupported.

## Local use

Open moon-phase-game.html alongside the existing character images and sounds/
folder. The lunar texture itself is embedded. index.html retains piano routing
and uses the full frame for the moon game. No build step or runtime CDN is used.
