# Homepage comps (On Air)

Three compositions of the homepage in the approved "On Air" world
(`docs/brand/redesign-direction.md`). Palette, type, components, copy, and
section content are held fixed across all three; only topology, hierarchy, and
density vary. Built on the shared kit (`../comp-kit/base.css`) plus
`home.css`. Open any `option-*.html` from disk; assets resolve relative to the
repository root.

Shared across every option: dark theme by default; the same top bar (bug, nav,
Sign in); the same demo standings board (4 participants, real Survivor 50
portraits, one struck-out and one via-trade marker, monumental tabular points);
the same 13-cell reveal strip (1 to 6 punched cyan, 7 flagged gold "You are
here", 8 to 13 dashed off-air, 13 outlined as the finale); the same blue ticker
band; and the same below-the-fold sections (How it works rundown, program guide
with 5 real season tiles, Watch at your own pace with a second strip, scoring
with the 5 category badges and 6 of the 54 real actions, all 11 prop bets with
the 44-point maximum, Draft night with a pick clock, trades, the closing slate,
and the footer with the verbatim disclaimer).

The hero strip is interactive in all three: selecting an episode moves the flag
and re-keys the demo board (points, per-episode delta, struck castaways, rank
order) from synthetic per-episode totals.

## Option A: Split frame

**Thesis.** The direction's first-viewport block, literally: copy on the left
five-twelfths (live line, monumental two-line headline with the italic cyan
second line, sub, two slates) and the demo standings board on the right seven-
twelfths, with the reveal strip running under both and the ticker closing the
frame. The visitor reads the pitch and the proof side by side.

**Holds fixed / varies.** Holds the kit verbatim. Below the fold every section
is a split (intro 5/12, board 7/12), alternating sides, so the whole page keeps
the hero's two-column rhythm. At 375 px the order becomes headline, slates,
strip, then the board in its two-line mobile row layout.

**Do not literalize.** The demo participants, points, deltas, and the "via
trade" marker are synthetic (labelled "Demo league"). The ticker crawl speed
and item list are illustrative. The strip's legend row is a comp aid and may be
dropped in the build. The rundown badges ("No account needed", "Free account",
"Live standings") restate Home.tsx facts but their placement is a suggestion.

## Option B: Strip spine

**Thesis.** The reveal strip is the spine of the page. The headline runs full
width at monumental scale on one line, the strip sits directly under it full
width with an explanatory label and the two slates at its right end, the sub
and a one-paragraph explanation hang off the strip, and the demo board follows
full width. The ticker moves to directly under the top bar, so the frame opens
with live status and closes with the board.

**Holds fixed / varies.** Same board, strip, ticker, and copy. Below the fold
every section is stacked full width (intro row with the action at the right
end, then the board), matching the spine's horizontal bands. Density is lower
than A; the page is longer.

**Do not literalize.** The explanatory paragraph beside the sub ("Standings,
rosters, prop bets, and scoring re-key from this strip...") is comp copy to
explain the mechanic; the build should say it once, in the product's words.
The headline is single-line at 1280 and wraps to two lines below about 900 px;
the cyan italic treatment is the spec, the exact break is not.

## Option C: Board-first

**Thesis.** The standings board is the hero. A full-width broadcast board opens
the frame, with the reveal strip inside its header row next to the title, and
the headline, sub, and slates arrive as a lower-third band anchored to the
board's bottom-left, overlapping its footer row. Nothing else competes in the
first viewport; the ticker closes the frame.

**Holds fixed / varies.** Same board data and strip, at compact scale in the
header (no "You are here" caption; the label carries "7 is next"). Below the
fold every section is board-first with the intro as a caption row beneath it,
so the page reads as a sequence of boards with captions. At 375 px the board
uses the one-line "tight" row (20 px portraits, no delta) so the headline and
primary slate still land in the first screen.

**Do not literalize.** The lower-third's overlap depth and width are comp
choices; what matters is that it is anchored bottom-left of the board. The
board footer text ("4 participants · 24 castaways drafted") is filler for the
overlap. The "Watch-along" badge in the header wraps to its own line on mobile
in the comp; the build can drop it there.

## Shared "do not literalize"

- Demo league standings, points, deltas, rank order, the via-trade marker, and
  which castaways are struck are all synthetic. The struck castaways happen to
  match Survivor 50's real episode 1 to 5 departures; the build should decide
  whether the homepage demo draws from real spoiler-filtered data or a fixed
  fixture, and label it accordingly.
- The pick-clock demo (Davis on the clock, 0:42, pick 7 of 24, the pick order)
  is illustrative.
- The Survivor 50 tile uses `season-50-logo.png` (transparent) rather than the
  `.webp` referenced in `seasons.ts`, which has a baked white field and does not
  sit on navy. `seasons.ts` points Survivor 46's `img` at an external URL; the
  comp uses the local `season-46-logo.png` that already exists in `public/`.
- The season tile meta lines ("Season 49 · New Era") are placeholders for
  whatever the seasons page exposes.
- Ticker content and crawl are illustrative; it respects `prefers-reduced-motion`.

## Facts verified against the data

- `src/data/scoring.ts` defines 54 actions across 5 categories (Challenges 5,
  Milestones 7, Idols 7, Advantages 25, Other 10). Home.tsx currently says 31;
  the comps say 54.
- `src/data/propbets.ts` defines 11 questions whose point values sum to 44.
- `src/data/season_50` has 13 episodes; the strip has 13 cells.

## Kit gaps worked around in `home.css`

- The kit's `.oa-bug .oa-wordmark` is only styled at 420 px and below, but the
  span renders at every width; `home.css` hides it above 420 px.
- Kit minimum sizes dip below the brand guideline on small screens (lockup
  150 px, emblem 30 x 38); `home.css` raises them to 164 px and 34 x 42.
- No roster strip with a strike mark exists in the kit (only a greyscale
  outline); `.hm-roster .is-out::after` adds the ember diagonal.
- No ranked-list board variant; `.hm-standings` is an `<ol>` laid out as a
  board so the row can reflow to two lines (or one tight line) on mobile.
- No caption slot on the strip's flagged cell; `.hm-strip--caption` adds the
  "You are here" caption via `::after`.
- The kit frame tokens do not re-point panel colors inside `.oa-frame` in
  light mode; `.hm-frame` redefines the panel, rule, and text tokens so the
  hero stays broadcast glass in both themes (see `option-a-light.html`).
- The ticker crawl (`.hm-ticker__track`) and its reduced-motion fallback.

## Revised round: Options D and E

A, B, and C were rejected as too busy ("Your league, on air" read as
meaningless and took up the hero; "You are here" made no sense for a visitor
who may be in several competitions across several seasons). D and E keep the
On Air world (navy frame, boards, slates, reveal strip, Space Grotesk numbers)
but change the composition. Built on the same kit plus the `hd-` block appended
to `home.css`; nothing used by A to C was changed.

Shared across D and E:

- **Calm first viewport.** No ticker band, no reveal strip, no live line, no
  legend, no badges in the hero. At most one proof element beside the headline.
- **The headline says what the product is.** Eyebrow "Fantasy Survivor for
  friends"; h1 "Grab your torch and draft your Survivor fantasy team" (the
  existing product headline, which the e2e suite asserts on "/"); sub verbatim
  from `Home.tsx`; primary slate "Pick a season to get started"; secondary
  "How scoring works". 54 px at 1280 (two lines), 38 px at 375 (four lines).
  No italic cyan word.
- **Nothing implies the visitor is inside a competition.** Every piece of
  game data on the page is captioned as an example ("Example standings,
  season 50, through episode 6"; "Example: a competition that has revealed
  episodes 1 to 6"). The spoiler proof lives in "Watch at your own pace"
  below the fold: one sentence explaining that every competition has its own
  current episode set by its creator, a strip with cells 1 to 6 cyan, 7 gold,
  8 to 13 dashed, and a three-item legend (Revealed, Next, Hidden). No "you".
- **One idea per section, half the density.** How it works is three plain
  steps (hairline, numeral, title, one line). The program guide is the 5 real
  tiles (S50 live, S49, S48, S47, S46) with one line and "Browse all seasons".
  Scoring is the 5 category badges plus a 4-row example board. Predictions is
  5 of the 11 questions as plain rows, with the 44-point maximum in the intro.
  Draft night is two sentences plus a 4-row example pick order (no clock; the
  product has no timer). Trades is two sentences. A quiet closing slate "Ready
  to play?" with "Browse seasons", then the footer with the verbatim
  disclaimer. No count chips on headings, no 01/02/03 blocks, no eyebrow
  labels on sections.

### Option D: Quiet frame

**Thesis.** The headline block sits left (about 6/12) and one compact example
standings board sits right (4 rows: rank block, name, points; no roster
strips, no deltas), captioned "Example standings, season 50, through episode
6". Nothing else is in the hero. The visitor reads what the product is and
sees, in one glance, the shape of what they would be playing for.

**Holds fixed / varies.** Board rows are the kit's rank block and tabular
points at 30 px. At 375 the board follows the copy and both slates are inside
the first screen (primary slate bottom at 480 px). `option-d-light.html` is
the same page with `data-theme="light"`: the hero frame stays navy, the body
is the studio.

**Do not literalize.** The four participants and their points are synthetic.
Whether the production homepage shows a fixed fixture or a real spoiler-safe
example is a build decision; either way it stays captioned as an example.

### Option E: Headline only

**Thesis.** The hero is only the eyebrow, headline, sub, and two slates on the
navy frame, with the full-color emblem (240 px tall, right-aligned) as the one
visual. No data in the hero at all. The first section below the fold is "A
competition in progress": a one-line intro and the example standings board,
here with the six real Survivor 50 portraits per roster (no strike or trade
markers) so the idea of a roster is shown once, quietly.

**Holds fixed / varies.** Identical below-the-fold sections to D after the
standings section. At 375 the emblem drops below the slates at 200 px tall so
the headline and primary slate stay in the first screen.

**Do not literalize.** The emblem size and right alignment are comp choices;
the rule is that it is the only illustration. Roster portrait order is
arbitrary.

### Self-check (D and E)

Per page at 1280 x 800 and 375 x 812: `scrollWidth <= innerWidth` true, no
`<img>` with `naturalWidth` 0, no image without `alt`, exactly one h1 matching
/Grab your torch/, heading order h1 then h2 only, landmarks header/nav/main/
footer present, both variable fonts loaded, and the page text contains neither
"You are here" nor "on air". Captures reviewed for clipping, overlap, and blank
regions; none found.

## Files

- `option-a.html`, `option-b.html`, `option-c.html`, `option-a-light.html`
- `option-d.html`, `option-e.html`, `option-d-light.html`
- `home.css`
- `option-{a,b,c}-desktop.png` (1280 x 800), `option-{a,b,c}-mobile.png`
  (375 x 812), `option-{a,b,c}-desktop-full.png` (1280 full page),
  `option-a-light-desktop.png`
- `option-{d,e}-desktop.png`, `option-{d,e}-mobile.png`,
  `option-{d,e}-desktop-full.png`, `option-d-light-desktop.png`
