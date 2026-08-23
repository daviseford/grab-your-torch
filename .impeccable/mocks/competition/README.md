# Competition family comps (On Air)

Static HTML comps for `/competitions` and `/competitions/:id` in the approved
"On Air" direction (`docs/brand/redesign-direction.md`, Operate mode: "the full
board"). They link the shared kit at `../comp-kit/base.css`; everything
option-specific is in `competition.css` (prefix `.cp-`). Open any page from the
repository root; asset paths are `../../../public/...`.

All three options share one synthetic dataset so every number agrees across
compositions: Season 50, watch-along, current episode 6 of 13, four
participants (Amanda, davis, Sarah, Billy; davis is the viewer and creator),
one accepted trade (davis sent Rick Devens, Sarah sent Benjamin Wade), two
castaways eliminated (episodes 1 and 2), seven active prop bets. Points are
computed from per-episode events with the repository's scoring values, so the
standings, scorebugs, Player scores, My Team, and Stats reconcile.

Spoiler rule as built: no episode beyond 6 appears as data anywhere. The reveal
strip shows 7 as the flagged "next to reveal" cell and 8 to 13 dashed; the
Player scores board has columns for episodes 1 to 6 only; no trade copy names
an episode (the trade's cutoff exists only inside the generator).

## Files

| Page | Files |
| --- | --- |
| Option A detail (Overview) | `option-a-detail.html`, `option-a-detail-dark.html` |
| Option A other tabs | `option-a-myteam.html`, `option-a-trades.html`, `option-a-stats.html` |
| Option A list | `option-a-list.html`, `option-a-list-empty.html`, `option-a-list-nomatch.html` |
| Option B | `option-b-detail.html`, `option-b-list.html` |
| Option C | `option-c-detail.html`, `option-c-list.html` |
| Captures | `<page>-desktop.png` (1280 x 800), `<page>-desktop-full.png` (1280 full page), `<page>-mobile.png` (375 x 812); dark: `option-a-detail-dark-desktop.png` |

## Option A: Full board

**Thesis.** The page is one broadcast rundown read top to bottom: a lower-third
carries the competition identity and the creator's two actions, the reveal strip
sits directly under it as the control that re-keys everything below, and the
Overview is a stack of full-width boards in the product's existing order
(Standings, Rosters, Prop bets, Player scores, Scoring reference collapsed).
Nothing competes for the first viewport except the name, the strip, and the
standings.

**Fixed.** Palette, type, the six kit components, the badge vocabulary
(Season / Watch-along / In progress), the tab set and order, the Player scores
columns (Rank, Castaway, Total, Pick, Ep 1..6), the "N on roster · N via trade ·
N eliminated" count line, the tooltip wording "Acquired from {participant} in a
trade".

**Varied.** Single column; the strip is a standalone board with the secondary
episode actions (Back one episode, Switch to Live) as ghost slates in its foot;
rosters are four participant boards with compact castaway slates (portrait
left, pick number or "Via trade" or "Out · Ep N" right); Player scores has four
sticky identity columns on desktop and plain local scroll on mobile.

**Do not literalize.** The snake-draft pick numbers; "Tuesday Night Torches";
the exact episode points; the "In the game" status badge wording on My Team
(the product shows status per elimination variant); the static tooltip drawn
open on the My Team capture; the Trade activity notice on My Team.

## Option B: Command center

**Thesis.** The viewer lands on a scoreboard: four participant scorebugs (rank
block, name, points, delta since the last revealed episode, tiny roster strip)
run under a header whose right side holds the reveal strip and the creator
actions, so the "what changed and where do I stand" answer is above the tabs.
Below, the page splits into a sticky left column of small boards (dense
Standings, Prop bets transposed to questions-as-rows) and a right column of the
large boards (Rosters, Player scores).

**Fixed.** Everything listed for Option A. The scoreboard is derived from the
same standings; the delta is the participant's own episode 6 total.

**Varied.** Reveal strip inside the header (small variant), no standalone strip
board; 5/12 + 7/12 columns with the left column sticky; Standings drops the
per-episode columns (the strip and scorebugs carry that) and keeps Roster,
Props, Points; Prop bets are rows-by-question so they fit a narrow column;
Player scores scrolls locally inside the right column even on desktop. The list
page puts the filters in the lower-third's right side.

**Do not literalize.** The delta label format "+10 Ep 6"; the two-column split
ratio; the sticky left column (it should release when the left column is taller
than the viewport); the scorebug "You" marker placement.

## Option C: Rundown rail

**Thesis.** The rundown becomes a left rail that owns navigation for the whole
competition: the four tabs plus in-page anchors for every Overview section,
with the active section marked in Signal Cyan. The header is compact because
the bug context in the top bar already carries season, episode, and mode; the
reveal strip is the first thing in the content column and the sections follow
as boards. On phones the rail collapses to a sticky horizontal rundown.

**Fixed.** Everything listed for Option A; the boards themselves are the same
as Option A's.

**Varied.** 216 px rail + content grid; compact header (h1 at 24 to 30 px, one
badge row, actions inline); strip board directly above the first section;
anchors in the rail. The list page reuses the rail for the filters (status with
counts, then seasons with counts) instead of a select plus segmented control.

**Do not literalize.** The section anchors' scroll-spy (the rail marks
Standings as the current location statically); the filter counts in the rail;
the rail's collapse into a top strip at 900 px (breakpoint is a placeholder).

## Kit gaps worked around (all in `competition.css`)

- `.oa-wordmark` is only styled under 420 px by the kit, so it rendered as
  plain text next to the lockup above that; hidden above 420 px here.
- No sticky column primitive: `.cp-sticky` plus fixed-width
  `.cp-col-rank/cast/total/pick` columns for Player scores; standings use
  `.cp-sticky` on the rank and participant cells. Sticky releases under 700 px
  so phones get native local scroll, per
  `docs/solutions/best-practices/shipping-survivor-ui-and-data-safely-2026-04-06.md`.
- No prop-bet status badges: `.oa-badge--correct` (semantic success),
  `--wrong` (semantic danger outline), `--leading` (semantic warning outline);
  Pending uses the kit's dashed `--pending`. None use brand Ember or Gold.
- No count badge for the Trades tab: `.oa-badge--count` (League Blue).
- No compact castaway slate: `.cp-cast` (44 x 56 portrait, name, meta, ember
  strike when eliminated, cyan trade marker).
- No scorebug: `.cp-bug` (navy plate, rank block, name, points, delta, xs
  roster strip `.oa-roster-strip--xs`).
- The top-bar context wraps at 375 px; it is hidden there for A and B, and C
  hides the wordmark instead so the context stays (C's header relies on it).

## Regenerating

The pages were emitted by a generator script kept outside the repository
(session scratchpad, `gen.mjs`); the HTML files are the deliverable and can be
edited directly.
