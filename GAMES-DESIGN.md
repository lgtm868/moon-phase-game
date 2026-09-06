# Moon Games: shared design and landscape layout

## Shared shell

`index.html` uses the shared `game-navigation.js` registry for seven routes:
`moon`, `piano`, `addition`, `guess`, `baibain`, `food`, and `english`.
The menu, current game and wide-screen shortcuts occupy their own grid row;
the iframe gets the remaining viewport height. Safe-area insets are respected.
The full game menu is accessible at every size. See `NAVIGATION.md` for its
direct-link and history contract. Offline files and `?standalone=1` retain a
pure game viewport for independent play and regression checks.
Selecting the active game does not reload it or create duplicate history.
Deep links and back/forward navigation keep their existing route semantics.
Game changes create a fresh iframe instead of navigating the existing child:
this avoids a second joint-session-history entry for each top-level change.

`games-theme.css` is the shared source for neutral backgrounds, text, border,
mint primary controls, gold/coral/cyan accents, Japanese system fonts and focus
rings. `games-theme.js` identifies embedded pages before their layout is drawn.
Each game remains directly openable alongside these local files and its assets.

## Layout contract

Game layouts use their own viewport height, not the physical device screen or
the containing page's height. The shared navigation must never sit on top of
game controls. Each game retains its domain-specific arrangement and actual
visual assets while using the same typography and control styling.

The default iPad landscape verification matrix is 1024x600, 1024x768,
1133x744, 1180x820, 1194x834 and 1366x1024. The shorter 1024x600 viewport
reserves additional room for browser chrome. Both standalone pages and routed
iframe pages are tested. This covers responsive browser sizes, not a guarantee
for every iPad model, display zoom or accessibility text-size setting.

Do not hide overflow or scale the whole page to make a failing layout appear
to fit. Main gameplay, questions, answers and transport controls must remain
visible and usable. Long optional documents or song catalogs may use a bounded
dialog with an accessible close control and their own scrolling area.

## Regression tests

Run `node tests/ipad-layout-check.cjs` with Playwright available. It checks
navigation consistency, actual content rectangles, labels, controls, images,
canvas output and gameplay states, not only document scroll dimensions.
Set `PLAYWRIGHT_MODULE` and `CHROME_EXECUTABLE` to use an existing installation.
Screenshots and JSON reports are written beneath `output/playwright/ipad-layout`.

Diagnostic filters include `IPAD_ROUTES`, `IPAD_MODES`, `IPAD_VIEWPORTS` and
`IPAD_LAYOUT_ONLY=1`; `IPAD_PHONE=1` adds phone smoke checks. Keep the existing
Moon scientific/quiz tests and the arithmetic, guessing and Baibain model tests
as independent behavior regressions. Layout work must not change their rules.

Physical iPad Safari, system voices and external audio routing need an actual
device check. Desktop Chromium viewport emulation does not establish those.

## Earlier design verification (2026-09-06)

- Before the English/fun expansion: 72 route/viewport/entry combinations, 600 gameplay-state
  checkpoints and eight navigation/history checks; zero issues.
- Navigation regression: six routes at eight sizes, native back/forward,
  repeated-tab preservation, invalid routes and direct-page return passed.
- Existing arithmetic (15,000 questions), character guessing (2,500 questions)
  and food (2,500 questions) regressions passed.
- Moon quality/orbit/texture checks and Baibain model/browser checks passed.
- Detector self-tests reject blank canvases, clipped text/children and
  offscreen gameplay. Transparent canvas backgrounds are included when checking
  pixel variation, so a valid sparse piano playfield is not called blank.

The authoritative local report is `output/playwright/ipad-layout-verified/report.json`.
Screenshots, including intermediate diagnostic runs, remain under `output/`
and are not published. Optional 320x568 phone checks flag the Moon's compact
82/99-pixel orbital scene below the audit's recommended 110-pixel height;
phone controls and text remain usable. This optional size recommendation is
separate from the passing iPad layout gate.

## Seven-game verification (2026-09-07)

The expanded checker exercised 84 route/viewport/entry combinations and 1800
gameplay checkpoints. Thirteen combinations affected by changes during the run
were retested (354 checkpoints); eight additional theme smoke checks verified
cache-version-independent asset detection. No known layout failures remain.
The initial diagnostic report is retained with its original failures, not
rewritten as a single green run. See `output/playwright/ipad-final-seven/`,
`ipad-final-retry-direct/`, `ipad-final-retry-embedded/`, and
`ipad-final-theme-smoke/` for the original and follow-up evidence.

All three food levels include longest-clue checks at six sizes in both entry
modes (36 checks). Navigation covers seven routes, back/forward and seven HTTP
direct-link redirects. The new Moon album, piano recorder, hands-on subtraction,
guessing hints/collection, doubling prediction, food album and English review
were exercised through their actual controls. Existing Moon quality/orbit tests
passed, and the 320x568 scientific/interaction audit passed 976 checks after
the standalone toolbar was compacted. These remain Chrome viewport tests, not
physical iPad Safari or speaker/voice verification.
