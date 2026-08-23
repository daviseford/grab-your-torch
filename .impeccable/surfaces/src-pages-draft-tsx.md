---
version: 1
slug: "src-pages-draft-tsx"
primary_target: "src/pages/Draft.tsx"
related_targets: []
---

## Scope and mode
Live draft (`/seasons/:seasonId/draft/:draftId`): lobby, order reveal, active picking, prop bets, completion. Operate mode inside a consequential real-time event.

## Audience, job, action, proof, constraints
Participants drafting castaways in turn; the creator starts the draft and promotes it into a competition. Action: draft a castaway on your turn; submit prop bets; create the competition. Constraints: realtime state is authoritative; there is no pick timer; pick order is round-robin; motion belongs to state transitions, not snapshot refreshes.

## Chosen direction and memorable moment
Approved comp: `.impeccable/mocks/draft/option-b-active.html` and `option-b-lobby.html` (Board spine). A rounds-by-participants draft board on a navy plate fills live: your column in League Blue, the pick just made marked in Ember, the current cell pulsing Signal Cyan with "Your pick"; the current picker as a live badge in the top bar; the cast grid of castaway slates below with Draft slates enabled only on your turn. The lobby shows the empty board with participants as columns as they join. Option A's reveal, prop-bets, and completion states carry into this composition.

## Unresolved decisions
How the board scrolls on 375 px for casts of 18 to 24 (horizontal board scroll versus a per-round stack); whether the completion summary reuses the filled board as the Draft Results view.
