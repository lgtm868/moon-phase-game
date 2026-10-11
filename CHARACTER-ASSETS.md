# Character illustrations and playback

## Scope

- Original Sprunki: the existing twenty records and assets are retained.
- Moon: ten Anpanman illustrations are replaced, and five named MOD characters are added; the expansion below adds 65 more (100 choices).
- Piano: all twenty original characters plus the five MOD characters (25 choices).
- Arithmetic and guessing: their original twenty-character question banks remain unchanged.
- Black uses the existing full recording as a one-shot, not a repeating stem. Other looping stems retain their shared clock.
- The five new MOD characters have no music recordings assigned. Piano notes are instrument synthesis, not claimed to be their original songs.
- The ten Anpanman selections have distinct game-original instrumental loops, not official songs or extracted recordings. Their scores live in `tools/anpanman-score.cjs`; all ten share the existing 100 BPM, eight-beat transport.

## References

The following sources were used for appearance and identity, not as proof of permission or endorsement:

- [Anpanman character directory](https://www.anpanman.jp/about/friend.html)
- [ACID, Pyramixed community reference](https://sprunki-pyramixed.fandom.com/wiki/ACID)
- [Tox, Pyramixed community reference](https://sprunki-pyramixed.fandom.com/wiki/Tox)
- [Sulfur, Pyramixed community reference](https://sprunki-pyramixed.fandom.com/wiki/Sulfur)
- [Mard, Retake community reference](https://sprunki-retake.fandom.com/wiki/Mard)
- [Mr. Bear, community reference with a Retake normal-form tab](https://sprunki-fanon.fandom.com/wiki/Mr._Bear)
- [Shifted Retake creator update listing Mard and Mr. Bear](https://nickyitch.itch.io/sprunki-shifted-retake/devlog/984689/update-11)
- [ACID supplementary appearance image](https://se.pinterest.com/pin/735071970473053517/)
- [Tox supplementary appearance image](https://id.pinterest.com/pin/838725130644357006/)
- [Pyramixed video thumbnail used for Sulfur's normal-form colors](https://www.youtube.com/watch?v=oqyG_7oi57Q)

MOD labels distinguish fan additions from the original twenty. Generated illustrations are adaptations, not extracted official sprites or official/licensed artwork.

## Image Generation

Built-in image generation was used, one character per call, with inspected appearance references. No CLI/API fallback or programmatic background removal was used.

Prompt set: depict the named character alone in its normal friendly form; preserve its identifying face, silhouette, clothing, accessories and colors; do not blend features from other characters; full-body clean 2D outlines; keep the complete silhouette inside the image; real transparent PNG background; no scenery, watermark, horror transformation or baked checkerboard.

Destinations:

- `assets/anpanman/`: anpanman, baikinman, dokinchan, shokupanman, currypanman, melonpanna, rollpanna, creampanda, jamojisan, batakosan.
- `assets/sprunki-mods/`: acid, tox, sulfur, mard, mrbear.

Detailed prompts, reference observations and generation failures are retained in the local `output/anpanman-reference-audit/` and `output/sprunki-mod-audit/` reports. Pixel/alpha tests establish rendering integrity, not exact likeness or authorization.

## Moon's 100-friend expansion (2026-10-11)

The existing 35 choices are followed by 65 Moon-only choices from `moon-friends.js`:
20 Sanrio characters, Doraemon, Dorami, Totoro, Kirby, Snoopy, and 40 Pokémon.
The added entries do not contain audio or music IDs and use Japanese speech.
Piano, arithmetic, and guessing retain their existing rosters.

- `assets/friends/*.svg`: simplified vector fan portraits drawn for this game,
  not official character artwork. The portraits retain distinguishing colors and
  features; they are not exact reproductions of official model sheets.
- `assets/friends/pokemon-<number>.png`: downloaded from the public
  [PokeAPI sprites collection](https://github.com/PokeAPI/sprites), path
  `sprites/pokemon/other/official-artwork/<number>.png`. The numbers are National
  Pokédex identifiers. The collection credits Pokémon/Nintendo/Game Freak;
  availability in that collection does not make those characters public domain.
- All images are stored locally; playing does not depend on an image host.

Validate the roster, image loading, scrolling and selection with
`CHROME_EXECUTABLE=/usr/bin/chromium node tests/moon-friends-check.cjs`.
