# Shared game navigation

`game-navigation.js` owns the seven-game catalogue, route selection, current-game state, dialog and desktop shortcuts. `index.html` hosts the shared header and game iframe. `game-navigation.css` owns only the shell and navigation styling.

- Normal HTTP game-file URLs redirect with `location.replace` to `index.html?game=<key>`, retaining query parameters and the hash. Game-specific parameters such as Baibain `t` are forwarded to its iframe.
- Embedded games never redirect. Direct `file:` URLs and explicit `?standalone=1` preserve the independent game view for offline use and game-focused checks.
- Switching games replaces the iframe instead of navigating a connected frame. Re-selecting the active game preserves play state. Back/Forward restore the route without adding a history entry.
- The current game uses `aria-current=page`. The game picker is a native dialog with close, Escape and focus restoration. The shared menu remains available in Moon's parent-shell fullscreen view.

## Optional integrations

Append extra actions to `#gameNavigation [data-game-nav-actions]`; do not replace the header. Check for this element immediately and listen for `game-navigation-ready` on `document` (event detail contains `actions`). `game-navigation-change` carries `{ game }`.

`window.MoonGamesNavigation` exposes `games`, `currentGame`, `selectGame(key)`, `openMenu()` and `closeMenu()`. Game definitions must be changed in the catalogue, not duplicated in each game.

## Checks

Run `node tests/navigation-check.cjs`. The optional `--browser` path checks actual navigation, history and responsive dialog behavior; use the existing `PLAYWRIGHT_MODULE` and `CHROME_EXECUTABLE` environment settings if needed. Set `NAVIGATION_ROOT` to validate a publication worktree.

Keep all seven game pages and shared JS/CSS in the same publication. Normal standalone-game browser checks should use `?standalone=1`; navigation checks should use the default routes.
