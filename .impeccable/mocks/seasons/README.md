# Seasons family comps (On Air)

Static HTML comps for the season catalog (`/seasons`) and the season detail /
cast page (`/seasons/:id`, shown for Survivor 50). Three compositions; same
palette, type, and package components (`../comp-kit/base.css`), composed
differently. Option-specific CSS is in `seasons.css` (prefix `.sx-`). Every
page links the kit and uses real season logos, real Survivor 50 portraits, and
the names, locations, years, and castaway data from `src/data/`.

Open any page from the repository root (paths are relative). Light theme is
the default; `option-a-catalog-dark.html` is the same page with
`data-theme="dark"`.

| Page | Files |
| --- | --- |
| Catalog | `option-{a,b,c}-catalog.html`, `option-{a,b,c}-catalog-empty.html` (no-match state), `option-a-catalog-dark.html` |
| Season detail, signed in | `option-{a,b,c}-season.html` |
| Season detail, signed out | `option-{a,b,c}-season-signed-out.html` (dual slates: Create account / Sign in) |
| Captures | `<page>-desktop.png` (1280 x 800), `<page>-mobile.png` (375 x 812), `<page>-desktop-full.png` (1280 full page) |

## Option A: Program guide

**Thesis.** The catalog is a broadcast program guide read top to bottom: a
lower-third intro, an "On air" slot holding the two latest seasons as large
schedule cells (S50 carries the Live badge, S49 reads Complete), then one find
bar with a segmented era control and a flat 5-column tile grid for everything
else. The season detail keeps the same spine: a lower-third with the season
badge, "24 castaways", and the Start slate living permanently in the
lower-third actions, then the cast as a 6-column castaway-slate grid.

**Holds fixed.** One lower-third per page, tiles on navy plates, the Start
action in the page intro, the live signal only on S50.
**Varies.** Hierarchy is vertical and single-column; the two latest seasons
are promoted above the filter rather than living inside it.

**Do not literalize.** The 21:9 on-air plate ratio; the exact count label
("48 seasons" excludes the on-air pair, matching the current browse grid);
"How scoring works" as the only intro action; the 6-column cast density at
1280 (it is a ceiling, not a rule).

## Option B: Schedule rows

**Thesis.** The catalog is the schedule itself: four era bands, each with a
row header (era name, season range, count) and a 6-column tile row, newest
era first. The on-air S50 tile is inline at the head of the New Era band as a
two-slot cell whose height matches the single-slot tiles beside it, so the
row stays level. The find bar is sticky under the top bar and its era chips
jump to bands. The season detail is a navy plate header (logo on the plate,
name, location and year, Live and castaway count, Start slate inside the
plate), then the cast board with a small "find a castaway" input.

**Holds fixed.** Era vocabulary and ranges (Classic 1 to 8, Middle 9 to 20,
Modern 21 to 33, New Era 34 to 50), tile anatomy, one Start cluster.
**Varies.** Topology: grouping replaces filtering; density is highest here;
the detail header is a plate rather than a lower-third.

**Do not literalize.** The 3.26:1 two-slot plate ratio (derive it from the
live grid so rows stay level); the sticky bar's exact offset; the cast
search input (it is a composition affordance, not a promised feature);
the band order.

## Option C: Rundown list

**Thesis.** The catalog is a dense rundown board: a vertical era rail on the
left (sticky, counts per era, the active item marked with the cyan rail) and
a list on the right where each row is a number block, a logo thumbnail on a
navy plate, the name and era, location and year, cast count, and a Start
action. The on-air season is the highlighted first row. The season detail is
two columns: a sticky left rail with the season plate, a facts list, and the
Start cluster; the cast as a 4-column grid on the right.

**Holds fixed.** The same era vocabulary, the same badges, the same Start and
signed-out clusters, real counts from metadata.
**Varies.** Hierarchy favors scanning and comparison over artwork; the logo is
a thumbnail, the number is the lead; the detail page keeps the season facts
in view while scrolling the cast.

**Do not literalize.** The per-row "Start a draft" action routes to the
season page in the current product (the draft is created there); the facts
list labels ("Aired", "Status"); the 208 px rail width; the rail collapsing to
chips at 375 px is one of several acceptable mobile answers.

## Product truths carried into every option

- Eras, search placeholder, season display titles (`Survivor 41` vs
  `S29: San Juan del Sur: Blood vs. Water 2`), live detection (the highest
  incomplete season), and the missing-logo fallback all follow
  `src/pages/Seasons.tsx`. S17 Gabon is the deliberate fallback tile in every
  catalog (a styled navy plate with the number and subtitle, not a broken
  image); its logo does exist in the repo.
- Season 50 shows 24 castaways (the length of `SEASON_50_PLAYERS`, which is
  what the detail page renders); `season-metadata.ts` still says 18 for its
  `contestantCount` and should be refreshed.
- The Season 50 logo in the comps is `season-50-logo.png` (alpha) rather than
  the metadata's `.webp`, which is lossy with a white ground and prints as a
  white box on a navy plate. Consider switching the metadata path.
- Castaway slates show age and hometown; Season 50 data has no profession
  values, so none are invented.
- Signed-out copy keeps the existing sentence ("Start a draft with friends:
  create a free account or sign in.") and adds the continuation note ("Your
  draft starts automatically once you're in."), which describes the existing
  auth-intent behavior.
- "pick teams" in the current sub copy became "build their rosters" to match
  the canonical vocabulary in `CONCEPTS.md`.

## Kit gaps worked around (CSS in `seasons.css`)

- `.oa-bug .oa-wordmark` renders beside the lockup at desktop; hidden until
  420 px here.
- `.oa-season-tile__art img` uses percentage `max-height` inside an
  `aspect-ratio` plate whose grid row is indefinite, so large logos overflow
  and the tile clips its own body. The logo is absolutely positioned to the
  plate's padding box instead (also applied to `.sx-thumb` and
  `.sx-plate-head__art`).
- `.oa-badge--season` is navy on navy inside the art plate; `.sx-plate-num`
  is a mist-on-navy number marker for plates.
- No missing-logo fallback in the kit: `.sx-art--fallback`.
- `.oa-season-tile--onair` spans two columns; inside a 2-up on-air slot it is
  reset to one column, and inside Option B's 6-column band its plate ratio is
  widened so row heights stay level.
- `.oa-segmented` and `.oa-era-rail` wrap at 375 px; `.sx-scroller` makes
  them a horizontal scroller so the page never overflows.
- No find bar, era band header, rundown rail, rundown row, plate header with
  logo, facts list, or dual-slate signed-out cluster in the kit: all `.sx-`.
