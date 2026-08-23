---
version: 1
slug: "src-pages-admin-tsx"
primary_target: "src/pages/Admin.tsx"
related_targets: ["src/pages/SeasonAdmin.tsx"]
---

## Scope and mode
Admin dashboard (`/admin`) and season workspace (`/admin/:seasonId` with Episodes, Events, Challenges, Eliminations, Teams). Operate mode where accuracy and scanability outrank expression.

## Audience, job, action, proof, constraints
Administrators maintaining season records. Actions: find a season, create, edit, and delete records, assign tribes. Constraints: destructive actions name the target and say they are permanent; existing unsaved-state indicators stay; no new dirty-state tracking; delete controls separated from edit controls on touch screens; read-only audits never submit.

## Chosen direction and memorable moment
Approved comp: `.impeccable/mocks/admin/option-a-dashboard.html`, `option-a-episodes.html`, `option-a-teams.html` (Control room). Lower-third; one three-cell status board; a dense seasons board with a find bar and Manage; the competitions board with deletes; Data Tools collapsed. Workspace: navy season plate with the season switcher, the results-entered strip, rundown tabs with counts, a collapsible create panel above the CRUD board; delete as a modal; access denied as a standby slate.

## Unresolved decisions
The standby slate needs the derived dark stacked lockup. Whether the create panel stays expanded by default on desktop.
