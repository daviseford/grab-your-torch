# Admin family comps (On Air, Operate mode)

Static HTML comps for the admin dashboard (`/admin`) and the season admin
workspace (`/admin/:seasonId`, tabs Episodes, Events, Challenges,
Eliminations, Teams). Three compositions, each covering both pages. Every
page links `../comp-kit/base.css` (untouched) plus `admin.css` (option
topology and kit gaps). Light theme by default; one dark capture of option A's
Episodes page (`option-a-episodes-dark-desktop.png`) proves the tokens hold.

Data is real where the product has it: 50 seasons with their logos and
episode and castaway counts, Survivor 50's 13 episode titles and flags, 19
Survivor 50 castaways still in the game at episode 5 with their portraits,
and the Cila, Vatu, and Kalo tribes with the product's swatch colors.
Competition rows are synthetic. "Results entered through episode 6" is a
plausible mid-season data-entry state, not the live Firestore value.

Wording, permissions, and actions are the ones the current pages ship: the
non-admin message, the status trio, "Manage", the permanent competition
delete with "Keep it" / "Delete competition", the Add Episode and Add Team
forms, the per-episode assignment tools ("Copy from Ep N", Save, "You have
unsaved changes.", "Saved assignments loaded for episode N.", the
drag-and-drop fallback notice, Manual Assignment), and the Data Tools
restore buttons. The one vocabulary change is the seasons board column
header "Castaways" where the table today says "Players" (CONCEPTS.md).

## Fixed across all options

Navy topbar with the bug (context "Admin" or "Admin · S50") and the Ember
Admin badge; Space Grotesk for titles, tabular numbers, tracked labels;
Inter for everything operated; dense boards with 13 px rows that scroll
inside `.oa-board__scroll`; League Blue primary slates and the active rail;
Signal Cyan only on the strip's entered cells, the latest-season marker, and
the active rundown tab; Ember/Gold only on the Admin badge, the "next up"
flag, and the Finale marker; semantic danger red for every delete; row
actions as labeled text slates with Edit on the left, a hairline rule, and
Delete on the right (40 px targets and wider gaps under 600 px); one h1 per
page, landmarks, labeled inputs, table headers, visible League Blue focus.

## Option A: Control room

Thesis: the dashboard is one rundown. A lower-third introduces the page, a
single three-cell status board replaces the three cards, the seasons board
carries its own find bar and Manage actions, the competitions board carries
its deletes, and Data Tools collapses to a summary row. The workspace leads
with a navy season plate (logo, name, counts, season switcher), then the
reveal strip showing which episodes have results entered, then rundown tabs
with counts, then a collapsible create panel above the CRUD board.

Varied here: stacked full-width topology, the plate header, create as a
panel above the board, delete as a modal (`option-a-delete-confirm.html`).
Also in this option: the standby slate for non-admins (`option-a-denied.html`)
and loading / no-results states (`option-a-states.html`).

Do not literalize: the exact counts in the rundown tabs (derived, not stored
today); the "6 episodes with results" meta in the plate; the modal's
participant list, which is the product's existing "Season N · N participants"
line expanded.

## Option B: Split workspace

Thesis: seasons are a persistent, searchable left rail (sticky on desktop,
a horizontal chip strip under 900 px) with the active season filled League
Blue and the latest season dotted cyan. The workspace keeps a compact status
strip at the top, a lighter text header with the logo at the right, the
reveal strip, and the rundown. Editing happens inline in the board row being
edited (episode 6 is open in `option-b-episodes.html`), and the competition
delete confirmation is an inline danger band that replaces the row.

Varied here: two-pane topology; the rail is the season switcher (the
"Switch season" select is therefore absent on this option); inline edit and
inline confirm; Add Episode / Add Team panels collapsed by default to keep
the board first.

Do not literalize: the rail's "13 ep · 18" meta formatting; the chip strip
on mobile is one reasonable collapse of the rail, a select is another; the
"Editing" marker in the edit row is a label, not a new dirty-state system.

## Option C: Boards and sheets

Thesis: the dashboard is a stack of boards, including status as a
three-row board rather than cards, and the workspace keeps every board
full-width. Create and edit open as a right side sheet with the unsaved
indicator in its footer (`option-c-episodes-sheet.html`); the permanent
competition delete is a danger sheet (`option-c-delete-sheet.html`). Teams
assignment is two columns: the No Team list on the left and the tribes
stacked on the right, every castaway row carrying the drag handle and the
"Assign to" select so the manual alternative is visible beside the drag
affordance rather than in a separate list below.

Varied here: sheets instead of panels or inline rows; "Add Episode" / "Add
Team" become primary slates in the board heads; assignment merges the
columns and the manual list into one surface.

Do not literalize: the two-column assignment collapses the product's
separate Manual Assignment panel into per-row selects, which is a UI merge,
not a data change; the danger sheet's fact table is the existing
confirmation copy laid out as rows; sheet width 440 px is a comp choice.

## Kit gaps worked around (all in admin.css)

- Status row and status strip (`.ad-status`, `.ad-strip-status`).
- Find bar inside a board head (`.ad-find`, `.ad-board-tools`, `.ad-count`).
- Board density: nowrap headers and names, min-widths per board so boards
  scroll locally (`.ad-board-mid/narrow/full`), row identity for the latest
  season and the row being edited (`tr.is-latest`, `tr.is-editing`),
  monospace id cells, logo chips.
- Touch-safe row actions (`.ad-actions`, `.ad-del`).
- Collapsible panel (`<details class="ad-collapse">`) for Data Tools and the
  create forms.
- Form primitives the kit lacks: form grid, required marks, readonly fields,
  custom checkboxes, styled `<select>`, swatch row, color field, aside.
- Flag badges for Merge / Post-merge / Finale (`.ad-flag`).
- Season plate header, strip wrapper, rundown counts, tab panel spacing.
- Flat loading skeleton and loading line (no pulse; spinner honors
  reduced motion).
- Notices: `.oa-notice--row` (flex only when a notice carries a button,
  so inline `<b>` in prose notices no longer splits), `--success`, and the
  `.ad-unsaved` / `.ad-saved` indicators.
- Modal, inline confirm row, side sheet, standby slate.
- Tribe columns, castaway chips with a CSS drag grip (no gradient), manual
  assignment grid, two-column assignment.
- `.oa-lower-third .oa-actions` wraps under 700 px (two slates overflowed
  375 px); `.oa-strip__label` stacks under 600 px.
- Brand gap: `grab-your-torch-stacked.svg` sets "Grab Your" in navy, so it
  vanishes on the navy standby slate. The denied page composes the emblem
  SVG plus an HTML wordmark in the dark lockup's colors. A
  `grab-your-torch-stacked-dark.svg` export would remove the workaround.

## Captures

`option-*-desktop.png` (1280 x 800), `option-*-mobile.png` (375 x 812),
`option-*-desktop-full.png` (full page at 1280), and
`option-a-episodes-dark-desktop.png`. Every page passed
`scrollWidth <= innerWidth` at both viewports with no `<img>` at
naturalWidth 0 and both variable fonts loaded.
