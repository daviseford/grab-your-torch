# Draft comps (On Air, Operate mode)

Static HTML comps for `/seasons/:seasonId/draft/:draftId` in every state:
lobby, order reveal, active picking, prop bets, and completion. Built on the
shared kit at `../comp-kit/base.css`; option-specific composition lives in
`draft.css`. Dark theme is the default (draft night); one light capture of
option A proves the studio scheme.

Synthetic but realistic data: Season 50 (24 real castaways, real portraits),
four participants (Amanda, davis, Sarah, Billy), round-robin order as the
product builds it (`buildTurnsMap`, not a snake). Round 3 is in progress, 9 of
24 picks made, pick 10 belongs to davis (the viewer). Pick 9 (Dee Valladares,
Amanda) is the "just picked" flame moment.

**There is no pick clock.** `src/pages/Draft.tsx` has no timer and no
countdown, so no comp shows one. The direction's "monumental clock" slot is
filled by the pick number instead (the `10 of 24` numeral in option A), which
is real state. If a timer is ever added, `.oa-clock` and `.oa-clock--warn`
from the kit are the intended home.

## Product truth preserved

Wording and permissions are taken from `Draft.tsx` verbatim: "Draft Lobby",
"Share the link to invite friends. The host starts the draft once everyone
has joined.", "Start Draft" (creator only), "Waiting for host to start..."
(non-creator participant, disabled), "Copy invite link", the four "How it
works" steps, "You're invited to this draft!" with "Create account" and "Sign
in" for the signed-out invitee, "Shuffling draft order..." / "Who picks first?
Let's find out!", "Your turn to pick!" / "<name> is picking...", "Pick N of
24", the "Draft" slate (disabled out of turn), "My Team", "Draft Results"
(Pick / Contestant / Drafted By), "Scoring Reference", "Place Your Bets" with
its sub line, the eleven prop bet questions with point values, "Enter an
answer", "Submit Prop Bets", "Waiting for prop bets: N of 4 submitted", "What
should we call your Competition?", the watch-along switch copy, and "Create
Competition". The stepper (Draft / Prop Bets / Summary) is kept as a rundown.

Two labels exist only in the comps and are flagged here rather than hidden:
"Waiting for the host to create the competition." (the product shows nothing
to a non-creator at that moment; the comp proposes a notice) and the small
state marks "Host", "Joined", "Locked", "Picks first", "Done", "Pending", and
"Open seat". The brief's "You're up, davis" and "Pick" were not used because
the product says "Your turn to pick!" and "Draft".

## Option A: Center stage

Thesis: the current picker is the broadcast's lower-third and the cast is the
stage. A cyan band (only on the viewer's turn; a cyan-ruled panel otherwise)
carries the pick number at monumental scale, the headline, and who is next;
the cast grid sits under it with Draft slates enabled; a right rail holds the
pick order, My Team, the live Draft Results board, and the invite link. At
375 the rail becomes a horizontal pick-order strip under the band, the grid
drops to two columns, and the first Draft slate is inside the first screen.

Fixed: kit tokens, the six package components, cyan as the live signal only,
blue for primary slates and your own picks, ember/gold only for pick 9 and the
"picks first" slot. Varied: the lower-third owns the top of the page; the
results live in a rail, not below the grid.

Also shown: lobby (creator and waiting variants), signed-out invite, order
reveal (two slots locked, two shuffling, with a reduced-motion comp note),
prop bets (one missing answer with inline and summary errors, then the frozen
Summary state with the submitted row), and completion (results as a board and
a table, the prop bets table, the host's naming plate with Create Competition,
and the non-creator notice).

Do not literalize: the "10" numeral is not a timer; the rail is sticky in the
comp but may scroll in product; the Scoring Reference is a collapsed details
block standing in for the existing accordion and table.

## Option B: Board spine

Thesis: the draft board is the spine of the page. A navy plate across the top
holds a rounds-by-participants grid that fills live (thumbnails and names in
each cell, your column outlined blue, pick 9 underlined ember, the current
cell pulsing cyan with "Your pick"). The current picker moves into the bug
area of the top bar as a live badge, so the signal travels with the header.
The cast grid follows. The lobby shows the same board empty, columns named as
friends join.

Fixed: same tokens, cells, and signal rules. Varied: the hierarchy leads with
the board rather than a headline; the header carries the live state; results
and scoring drop below the grid as a two-column footer.

Do not literalize: the pulse is a border-opacity loop and stops under reduced
motion; at 375 cells keep only the first name and the current cell's label,
not the pick numbers.

## Option C: Cast wall

Thesis: the whole screen is the cast, edge to edge, six across, names and
Draft slates on navy plates over the portraits. The current-picker state is a
fixed bottom bar (cyan on your turn, navy otherwise) with the pick number,
headline, the pick order as chips, and the "Pick order & results" control. The
pick order, My Team, Draft Results, and the invite link live in a side sheet
opened from the bar (`option-c-active-sheet.html` shows it open). The lobby
keeps the wall as a scouting surface, with the invite link and How it works
above it and the host's Start Draft in the bar.

Fixed: same slates and signal rules. Varied: no page gutter, no rail, no
rundown visible while picking; everything that is not a castaway is either
in the bar or behind the sheet.

Do not literalize: the wall's navy name plates are a composition choice, not
a new component; the sheet's scrim and width are placeholders; at 375 the bar
stacks and the order chips are hidden (they live in the sheet).

## Files and captures

`option-{a,b,c}-active.html`, `option-{a,b,c}-lobby.html`,
`option-a-lobby-waiting.html`, `option-a-invite-signed-out.html`,
`option-a-reveal.html`, `option-a-propbets.html`, `option-a-complete.html`,
`option-c-active-sheet.html`, `option-a-active-light.html` (light-theme copy),
`draft.css`. Each page has `-desktop.png` (1280 x 800), `-mobile.png`
(375 x 812), and `-desktop-full.png` (1280 full page); plus
`option-a-active-light-desktop.png`.

Kit gaps worked around in `draft.css`: the bug's text `.oa-wordmark` is only
styled for widths under 420 px but never hidden above it, so it rendered next
to the SVG lockup (hidden above 420 px here); the bug context wraps at 375 px
(hidden under 420 px, the page carries the state); `.oa-badge` is not
nowrap; the kit has no draft board, participant cards, numbered steps,
rundown, form field error state, or select styling, all added under `.dr-`.

Self-check: every page at 375 and 1280 reports `scrollWidth <= innerWidth`,
zero `<img>` with `naturalWidth 0`, exactly one `h1`, and both Space Grotesk
Variable and Inter Variable loaded.
