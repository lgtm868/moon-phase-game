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

## Music and speech

Music starts off. The ON action invokes each selected HTML media element's
play method inside the user gesture, with real existing audio files and no
substitute synthesized character music. Selection changes do not restart
already-playing tracks. Stale play failures are ignored after a newer attempt
or OFF action. Backgrounding stops music, motion and queued quiz transitions.
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
five viewports (320x568, 375x667, 390x844, 844x390 and 1280x800), overflow, all
images, 16 phase selections, drag/keyboard control, phase pixel illumination,
30 character choices, actual media time progression, OFF, and quiz answers.
It also checks the index wrapper and piano navigation, delayed/rejected media
playback, and the file URL with external network blocked.

Run with Node and Playwright installed:

```sh
node tests/quality-check.cjs
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
