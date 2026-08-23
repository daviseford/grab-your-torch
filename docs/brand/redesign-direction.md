# Redesign direction: On Air

Status: direction approved 2026-08-22 (Impeccable direction seed `67cc3cac`,
mode Persuade, assigned index 3, user kept the assigned direction).
Comp approvals are recorded at the end of this document.

The Victory Flame identity (`docs/brand/brand-guidelines.md`) is fixed brand
authority: logo system, palette, Space Grotesk wordmark and display, Inter
product type. This document records the world every surface is built in.
`DESIGN.md` is written after the build from the shipped interface; until then
this file and the approved comps are the composition authority.

## Direction contract

**THESIS.** Grab Your Torch is the broadcast of your league. Every surface is
the graphics package laid over the game, so the product reads like live
coverage of your group's competition rather than a SaaS dashboard about it.
It refuses the gradient hero, the three feature cards, and the stats row.

**OWN-WORLD.** Flat broadcast ink. Dark is Night Navy broadcast glass; light
is the studio: Ice White ground with navy boards and bugs. League Blue owns
whole regions (team bars, the draft board, primary slates). Signal Cyan is the
signal: live dots, the active rail, the current-episode marker, nothing else.
Ember Orange and Victory Gold are reserved for the flame: points scored, the
winner, brand moments. Space Grotesk carries titles and every number that
matters, tabular; Inter carries everything you operate; labels are tracked
caps. Six components carry the package everywhere: the **bug** (corner lockup
with context), the **lower-third** (page intro), the **board** (tables with
rank blocks and row bands), the **slate** (buttons and badges, 4 px corners),
the **ticker** (live status strip), and the **reveal strip** (episode
progress). Hairline Mist rules. No gradients, no glow, no icon tiles; the
emblem is the only illustration.

**STORY.** A visitor sees a league being broadcast: real standings, real
castaways, and a reveal strip proving nothing past "now" is shown. They
believe this was built for their group's watch night and will not spoil it.
They pick a season and start a draft.

**FIRST VIEWPORT (homepage, 1280 x 800).** Full-bleed navy frame. Top-left
bug: emblem plus wordmark; top-right navigation and sign-in. Left column
(about 5/12): a cyan live ticker line ("Now playing · Season 50 · Episode 6
revealed"), a monumental Space Grotesk headline with the second line in italic
cyan, a two-line Inter sub in Mist Blue, then a blue primary slate "Pick a
season" and an outlined secondary "How scoring works". Right column (about
7/12): a standings board, labeled demo league, four participants with rank
blocks (gold for first), roster strips of real castaway portraits with one
struck and one "via trade" marker, points in monumental tabular digits. Below
both: the reveal strip, episodes 1 to 6 punched cyan, episode 7 flagged gold
"You are here", 8 to 13 dashed off-air. Bottom edge: a blue ticker band. At
375 px the bug shrinks to emblem plus wordmark, the headline leads, the primary
slate is above the fold, the reveal strip follows, then a compact board.

**FORM.** Live sports broadcast graphics package (scorebug, lower-third,
board, ticker). Candidate 3 of the ordered grounded list. Seed key 67cc3cac.

**FINISH.** Unreviewed and undocumented is unfinished; this build ends with
the finish review, the verdict, DESIGN.md, and every shipping raster carrying
its provenance.

## Signature interaction

The reveal strip. Advancing the episode (creator only, existing behavior)
moves the flag; standings, rosters, prop bets, scoring, and stats all re-key
from it; cells beyond the current episode stay off-air. On the homepage the
demo strip is interactive so the spoiler mechanic is proven inside the first
viewport. State is a mark, not a hue: punched (revealed), flagged (current),
dashed (off-air), struck (eliminated).

## Raises carried from the challengers

- **From Cutting Bench (competitive):** state is a mark, not a hue; the place
  you stopped is persisted and re-flagged on return.
- **From Risograph (competitive):** flat spot-ink commitment. Color fields own
  whole regions; the incumbent blue-to-cyan gradient retires; nothing glows.
- **From Fletcher wit poster (competitive):** the emblem is the only
  illustration; icon tiles are gone; each section leads with the board doing
  its job.
- **From Miura sheet (declined):** one control propagates across the sheet;
  the reveal strip drives every board.
- **From Alphabet storm (declined):** one monumental grotesk as matter; a
  single display face at monumental scale for the numbers that matter.
- **From Kiosk print (declined):** cyan is reserved for the live or active
  thing; empty states print as an outlined rule box, never a gray card.

## Surface modes and cross-surface reach

| Surface family                                       | Mode     | Expression                                                                                                                                          |
| ---------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Homepage                                             | Persuade | The broadcast frame: bug, lower-third headline, demo standings board, reveal strip, ticker.                                                         |
| Seasons, season detail                               | Operate  | The program guide: era rails, schedule-cell tiles for 50 seasons, a find bar, the live season in the on-air slot; cast as a roster board.           |
| Competitions, competition detail                     | Operate  | The full board: bug in the header (season, mode, episode), standings and scoring as boards, tabs as the rundown, the reveal strip under the header. |
| Draft                                                | Operate  | On the clock: a pick clock at monumental scale, the current picker as a lower-third, castaways as slates, the pick board filling live.              |
| Admin, season admin                                  | Operate  | The control room: compact rundown tables, the same lower-thirds, the reveal strip inside the season workspace.                                      |
| Scoring reference                                    | Read     | A grouped board with category colors kept semantic.                                                                                                 |
| Auth modal, reset, logout, not found, loading, error | Operate  | A standby slate: the stacked lockup on navy, one form, one action.                                                                                  |

## Honest risk

Broadcast graphics slide into ESPN pastiche or a generic dark dashboard when
the package is over-applied. The discipline: one bug, one lower-third per
surface, flat boards, a light mode that is a studio rather than inverted
darkness, and admin tables that stay Operate-mode plain inside the world.

## Decision record

- Direction round served as a private artifact decision board plus the
  structured question; the user kept the assigned direction, "On Air".
- Alternates offered: The Big Board (Impeccable's pick), The Select Rail, Spot
  Ink, The Pun Poster (competitive challengers), The Folding Sheet, Word
  Weather, Three-Ink Kiosk (declined), and The Fantasy App (standing exit).
- No image generation is available in the authoring environment, so comps are
  browser-rendered HTML mocks captured at 1280 x 800 and 375 x 812. The shared
  comp kit lives in `.impeccable/mocks/comp-kit/`; family comps live in
  `.impeccable/mocks/<family>/`.

## Comp approvals

Comp round served 2026-08-22 as a private artifact gallery plus structured
questions. Comps are HTML mocks on the shared kit (`.impeccable/mocks/`).

| Family      | Approved                                | Composition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Seasons     | Option A, Program guide                 | Lower-third; on-air slot with the two latest seasons as large cells; find bar plus segmented era control; 5-column tile grid. Season detail: lower-third with the Start slate, 6-column cast of castaway slates.                                                                                                                                                                                                                                                                                                                                                                               |
| Competition | Option B, Command center                | Header with the reveal strip and creator actions on its right; a scoreboard strip of participant scorebugs (rank, name, points, delta, roster strip); sticky left column with dense standings and prop bets; right column with rosters and player scores scrolling locally. List: filters in the lower-third's right side.                                                                                                                                                                                                                                                                     |
| Draft       | Option B, Board spine                   | A rounds-by-participants draft board on a navy plate filling live (your column blue, the current cell pulsing cyan), the current picker as a live badge in the top bar, the cast grid below; the lobby shows the empty board with participants as columns.                                                                                                                                                                                                                                                                                                                                     |
| Admin       | Option A, Control room                  | Lower-third; one three-cell status board; dense seasons board with find bar and Manage; competitions board with deletes; Data Tools collapsed. Workspace: navy season plate, results-entered strip, rundown tabs with counts, collapsible create panel above the CRUD board; delete as a modal; standby slate for access denied.                                                                                                                                                                                                                                                               |
| Homepage    | Option E, Headline only (revised round) | Options A to C were rejected as too busy. E: eyebrow "Fantasy Survivor for friends", the product headline "Grab your torch and draft your Survivor fantasy team", the existing sub, two slates, and the emblem as the only visual; no data in the hero. Sections below at half density. Spoiler constraint from the approval: the homepage shows no real competition results anywhere. The example standings use fictional participants and points only (no castaways, no season, no eliminations), and the reveal-strip example names no season. Season tiles are fine (catalog, no results). |

Shell, common to every approved comp: a navy top bar with the primary
lockup as the bug (emblem plus wordmark under 420 px), a context segment,
horizontal navigation with a cyan underline on the current item, account or
sign-in controls on the right, and a burger plus drawer on narrow screens.
