---
version: 1
slug: "src-pages-seasons-tsx"
primary_target: "src/pages/Seasons.tsx"
related_targets: ["src/pages/SingleSeason.tsx"]
---

## Scope and mode
Season catalog (`/seasons`) and season detail (`/seasons/:seasonId`). Operate mode: the visitor finds a season, scouts its cast, and starts a draft.

## Audience, job, action, proof, constraints
Survivor fans choosing a season for a group competition. Action: Start a draft (signed-out visitors get Create account / Sign in and continue automatically). Proof: all 50 seasons with real artwork, search by name, number, or location, era filters. Constraints: account-free browsing; season logos sit on navy plates; missing artwork falls back to a numbered plate.

## Chosen direction and memorable moment
Approved comp: `.impeccable/mocks/seasons/option-a-catalog.html` and `option-a-season.html` (Program guide). The on-air slot with the two latest seasons as large cells, then the find bar with a segmented era control over a 5-column tile grid. Detail: lower-third with the persistent Start slate and a 6-column cast of castaway slates.

## Unresolved decisions
Whether the catalog keeps 48 browse tiles plus the two marquee cells (current behavior) or shows all 50 in the grid; the comp shows the marquee pair separately. `season-metadata.ts` lists 18 castaways for season 50 while the player data has 24; the page renders the player data.
