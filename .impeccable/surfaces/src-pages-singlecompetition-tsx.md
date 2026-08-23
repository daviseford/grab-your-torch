---
version: 1
slug: "src-pages-singlecompetition-tsx"
primary_target: "src/pages/SingleCompetition.tsx"
related_targets: ["src/pages/Competitions.tsx"]
---

## Scope and mode
Competitions list (`/competitions`) and competition detail (`/competitions/:competitionId`, tabs Overview, My Team, Trades, Stats). Operate mode: participants read standings, rosters, prop bets, and scoring, manage trades, and (creators) advance the current episode.

## Audience, job, action, proof, constraints
Participants and creators of one competition. Action: reveal the next episode (creator), propose or respond to trades, read standings. Proof: results through the current episode only. Constraints: every result comes from episode-filtered inputs; roster ownership comes from accepted trades; trade copy never names an episode; wide boards scroll locally on touch devices.

## Chosen direction and memorable moment
Approved comp: `.impeccable/mocks/competition/option-b-detail.html` and `option-b-list.html` (Command center). Under the header, a scoreboard strip of participant scorebugs (rank, name, points, delta since the last episode, a small roster strip); the reveal strip and creator actions in the header's right side; a sticky left column with dense standings and prop bets; a right column with rosters and player scores scrolling locally. The list puts filters in the lower-third's right side and stacks rows on phones.

## Unresolved decisions
The comp's "Back one episode" and "Switch to Live" ghost actions and the "Episode 6 of 13" count must be checked against the existing EpisodeAdvanceControl before they ship; nothing new may be introduced. Whether the Player scores board keeps the sticky first column on desktop (current behavior) inside the narrower right column.
