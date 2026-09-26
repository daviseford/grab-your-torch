# Castaway ids: survivoR vs the app

How the app identifies castaways, how that lines up with survivoR, and how to
move stored data when a provisional id turns out wrong. Season 51 is the
worked example: its cast was drafted on predicted ids, and survivoR published
different ones. Related issue: #279.

## Identity model

| Concept              | survivoR (`dev/json`)                                                                             | App                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Person key           | `castaway_id`, `US` + 4 digits, one per person for life                                           | `CastawayId` (`US${string}`), the same value; stored in every pick, trade and prop bet                   |
| Returning players    | Keep their original `castaway_id`                                                                 | Same; `previousSeasons` on `Player`                                                                      |
| Season key           | `version` = `US`, `season` = 51, `version_season` = `US51`                                        | `season_id` = `season_51`, `season_num` = 51                                                             |
| Full name            | `castaways.full_name` (per season) and `castaway_details.full_name` (per person); they can differ | `Player.full_name` = `castaways.full_name` once synced; the wiki name while provisional                  |
| Short name           | `castaways.castaway`                                                                              | `CastawayLookup[id].castaway`; `Player.nickname` when it is not the first name                           |
| New-castaway numbers | Sequential after the highest id, alphabetical by `castaway_details.full_name`                     | Predicted with the same rule, from wiki names, when a cast is bootstrapped with `--wiki-cast`            |
| Name stored with id  | n/a                                                                                               | Draft picks (`player_name`) and pool picks (`full_name`); prop bet answers and trades store the id alone |

The numbering rule is inferred, not documented upstream. Sorting new castaways
by `castaway_details.full_name` (case-insensitive) reproduces survivoR's ids
exactly for seasons 45 through 51 (Season 50 added no new castaways). Sorting
by `castaways.full_name` fails for Season 51.

## Season 51: what went wrong with the prediction

The prediction followed the right rule but sorted the wiki's names. survivoR
sorts `castaway_details.full_name`, and two of those differ from the wiki:

- Thien An Nguyen sorts as **An Nguyen** (US0754), ahead of Ana Sani.
- Jelly Loblack sorts as **Angelica Loblack** (US0756), ahead of Brady Booker.

That moved 19 of 21 ids. survivoR's ids are a **permutation of the same range**
(US0752 to US0772), so the same string now names a different person on each
side. US0754 is Ana Sani in the app and Thien An Nguyen in survivoR.

Source: [doehm/survivoR@7336413](https://github.com/doehm/survivoR/tree/7336413e39c34c31231b9fa17281a47f731837e0/dev/json)
(`castaways.json`, `castaway_details.json`; Season 51 first added in
`d4a75af`). A copy of the 21 rows is kept at
`scripts/__tests__/fixtures/survivor-us51-castaways.json`.

| Castaway                           | App (provisional) | survivoR | Changes | Matched by                    |
| ---------------------------------- | ----------------- | -------- | ------- | ----------------------------- |
| Aaliyah Puglia                     | US0752            | US0752   | no      | full name                     |
| Alexis Levine                      | US0753            | US0753   | no      | full name                     |
| Ana Sani                           | US0754            | US0755   | yes     | full name                     |
| Brady Booker                       | US0755            | US0757   | yes     | full name                     |
| Carter Krull                       | US0756            | US0758   | yes     | full name                     |
| Cristian Chavez                    | US0757            | US0759   | yes     | full name                     |
| Danny Kilby                        | US0758            | US0760   | yes     | full name                     |
| Devin Way                          | US0759            | US0761   | yes     | full name                     |
| Eric Macksoud                      | US0760            | US0762   | yes     | full name                     |
| Jelly Loblack (survivoR: Angelica) | US0761            | US0756   | yes     | short name "Jelly" + surname  |
| Jenna Doore                        | US0762            | US0763   | yes     | full name                     |
| Kristin Flickinger                 | US0763            | US0764   | yes     | full name                     |
| Lewis Kelly                        | US0764            | US0765   | yes     | full name                     |
| Linnea Capobianco                  | US0765            | US0766   | yes     | full name                     |
| Maggie Nestor                      | US0766            | US0767   | yes     | full name                     |
| Mike Pinsky                        | US0767            | US0768   | yes     | full name                     |
| Ori Jean-Charles                   | US0768            | US0769   | yes     | full name                     |
| Patt Cannaday                      | US0769            | US0770   | yes     | full name                     |
| Rob Antonson                       | US0770            | US0771   | yes     | full name                     |
| Sharonda Cox                       | US0771            | US0772   | yes     | full name                     |
| Thien An Nguyen                    | US0772            | US0754   | yes     | full name (`castaways` table) |

No Season 51 id appears in any other season upstream, and survivoR's highest
earlier US id is US0751, so there is no cross-season collision.

## Where the ids are stored

Every one of these must change together, or a user's picks point at someone
else. The dry run reads all of them.

| Store                                                                         | Fields                                                                                | Handled by                                                                                                         |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Firestore `competitions/{id}`                                                 | `draft_picks[].castaway_id` + `player_name`, castaway answers in `prop_bets[].values` | remap                                                                                                              |
| Firestore `competitions/{id}/trades/{id}`                                     | `offered_castaway_ids`, `requested_castaway_ids`                                      | remap                                                                                                              |
| RTDB `drafts/{id}`                                                            | `draft_picks` (keyed by pick number from 1), `prop_bets` (keyed by uid)               | remap, keeping both containers' keys                                                                               |
| Firestore `pools/pool_season_51`                                              | `roster`, `prop_bet_answers`                                                          | remap                                                                                                              |
| Firestore `pools/pool_season_51/entries/{uid}`                                | `picks`, `prop_bets`                                                                  | remap                                                                                                              |
| Firestore `seasons/season_51`                                                 | `players[]` ids and names, `castawayLookup` keys, names and short names               | remap (images and every other field stay with the person)                                                          |
| Firestore `team_assignments/season_51`                                        | castaway-id keys in each episode snapshot                                             | remap if it exists (it does not today)                                                                             |
| Firestore `castaway_adp/season_51_{pre_premiere,all_drafts}`                  | `castaways` keyed by id                                                               | remap; the ADP job then leaves `pre_premiere` alone (see below)                                                    |
| Firestore `challenges`, `eliminations`, `events`, `vote_history` `/season_51` | results keyed by id                                                                   | not remapped; the dry run reports a problem if any is non-empty, because results must be regenerated from survivoR |
| Bundled `src/data/season_51`                                                  | ids, names, short names                                                               | `--rewrite-season-file`, in a follow-up PR                                                                         |
| Pool standings                                                                | handles and totals only                                                               | nothing                                                                                                            |
| Browser `localStorage` pool entry drafts                                      | unsubmitted picks                                                                     | nothing: the pool froze at the premiere                                                                            |

The app reads a season's cast from `seasons/{id}` in Firestore. The bundled
file is read by the pool page (portraits), the curated bios (by name), the
Admin page and the scripts.

## Why the ids are remapped rather than aliased

The alternative was keeping the provisional ids forever and translating
survivoR's ids at ingestion. That avoids touching stored data now, but the
translation would be needed forever, by every script that reads survivoR, and
it breaks again the day a Season 51 castaway returns under survivoR's id.
Remapping once, while the season has aired a single episode and no scores
have been published, is the cheaper and more durable fix.

## Names

Two castaways read differently afterwards, because survivoR spells them
differently:

- Jelly Loblack becomes **Angelica Loblack** everywhere a full name is shown
  (draft boards, pool roster, season page). Her short name stays "Jelly" and
  her curated bio is kept by an alias in `src/utils/castawayBio.ts`.
- Thien An Nguyen keeps her full name; her short name becomes "Thien An"
  instead of "Thien".

Keeping the wiki names instead is a one-line change to the committed mapping
(`to_name`, `to_castaway`) before the remap is applied, at the cost of a
rename warning from the sync every day afterwards. Adopting survivoR's names
is the default because survivoR is the project's authoritative source.

## The remap tool

`yarn remap-castaway-ids` (`scripts/remap-castaway-ids.ts`, logic in
`scripts/lib/castaway-id-remap.ts`).

- **Committed mapping.** `scripts/castaway-id-remaps/season_51.json` holds the
  reviewed mapping, the survivoR commit it came from, and its hash
  (`fe734ff53fbaf8a3`, covering ids, names and short names). Every run
  re-derives it from that pinned commit and refuses if anything differs. It no
  longer depends on the season file, which changes during the cutover.
- **One lookup per value.** Remapping is never a chain of find-and-replace
  passes, which would move a person several times in a permutation.
- **At most once, atomically.** Because both sides use the same id range, an
  id alone cannot say whether it was remapped. So each document is marked
  applied in the same transaction that rewrites it: a ledger entry in
  `admin_migrations/castaway_id_remap_season_51` for Firestore documents
  (in the same Firestore transaction), and a `castaway_id_remap` marker inside
  the node for RTDB drafts (in the same RTDB transaction). An interrupted run
  leaves each document either remapped and marked, or untouched and unmarked,
  so a rerun never remaps anything twice.
- **Names cross-checked.** Documents that store names are checked against
  both casts. One that reads as already remapped but carries no mark, or
  mixes the two, is reported and never written.
- **Compare-and-set.** A document is written only if its fields still equal
  the plan's `before` (deep equality, key order ignored). A document that moved
  on is reported stale and re-planned by the next dry run.
- **Repair.** A pick taken after its draft was remapped but with a
  provisional id (a client still holding the old season document) is detected
  by its name and planned as a `repair` of that pick alone.
- **Write guards.** `--write` refuses unless all of these hold:
  - the plan's season and mapping hash match;
  - `plan.project_id`, `--project` and the service account's project are the same;
  - the ledger is empty or carries the same mapping;
  - the plan is at most 6 hours old (`--max-plan-age-hours`);
  - a fresh read of production plans exactly the reviewed changes;
  - there are no problems;
  - no draft is live, or each live draft is acknowledged with `--ack-live-draft drafts/<id>`.
- **Backup and rollback.** The plan file holds `before` and `after` for every
  changed field. `--rollback --plan <file>` restores `before` in reverse order
  wherever `after` is still in place, and clears the marks.

### Live drafts

A live draft is one users can still write castaway ids into: started and not
finished, or finished with prop bets still to come. The dry run on 2026-09-26
found five: one started with no picks, and four finished and waiting on prop
bets (none saved as a competition).

Picks carry names, so a pick taken during the cutover can be repaired. Prop
bet answers are ids alone, so an answer submitted to a remapped draft by a
client still on the old season document cannot be told apart afterwards.
That is why the write refuses while drafts are live. Acknowledging a live
draft accepts that risk for the minute or so the write takes. Waiting for
those drafts to finish, or confirming they are abandoned, avoids it.

### The ADP pre-premiere cohort

The ADP job excludes any competition written after the premiere, using
Firestore's `updateTime`. The remap rewrites every Season 51 competition, so
recomputing `pre_premiere` afterwards would publish an empty cohort. Instead,
the remap permutes both ADP documents in place, and `recompute-castaway-adp`
skips `pre_premiere` for any season whose remap ledger exists. `all_drafts`
keeps refreshing as before.

## Controls before any cutover

These are operational controls, not code gates. Each one is needed.

1. **Hold the sync.** Once the bundled file carries survivoR's ids, the
   nightly `Sync survivoR data` workflow would regenerate Season 51 from
   survivoR and push episode 1's results to Firestore. That is the separate
   #279 publication decision. Disable the workflow before runbook step 5 and
   keep it disabled until #279 is decided:
   `gh workflow disable "Sync survivoR data" -R daviseford/grab-your-torch`,
   then confirm with `gh workflow list -R daviseford/grab-your-torch --all`.
2. **Hold ADP refreshes during the write:**
   `gh variable set CASTAWAY_ADP_REFRESH --body disabled -R daviseford/grab-your-torch`,
   restored to `enabled` in runbook step 8.
3. **Pick a quiet time.** The write takes about a minute. During it, the pool
   page shows text cards instead of portraits for castaways whose id moved,
   because it only shows a portrait when the bundled name matches the roster.
   Draft boards read names from the stored picks.

## Runbook (needs Davis's explicit go-ahead; writes production)

1. Apply the controls above.
2. Snapshot: `yarn tsx scripts/snapshot-firestore.ts`.
3. Dry run: `yarn remap-castaway-ids 51`. It must report
   `Mapping fe734ff53fbaf8a3 ... verified` and 0 problems, and it lists any
   live drafts. Review the plan file under
   `data/migration-output/castaway-id-remap/`.
4. Prepare the follow-up code PR: `yarn remap-castaway-ids 51 --rewrite-season-file`,
   then `yarn format`. It changes only ids, names and short names, adds no
   episodes, and keeps every image. CI must be green. Do not merge yet.
5. Apply: `yarn remap-castaway-ids 51 --write --plan <file> --project survivor-fantasy-51c4b`,
   plus `--ack-live-draft` for each live draft you accept. This remaps every
   document above, including `seasons/season_51`, so the cast users see
   switches here.
6. Merge the follow-up PR straight away so the bundled portraits and the Admin
   page catch up.
7. Validate:
   - A dry run from main reports `Local season file: remapped`, 0 problems, and every document already applied. It should plan 0 changes; any `repair` changes it does plan are applied the same way as step 5.
   - `yarn repair-pool-picks 51` is clean.
   - Spot-check a draft board, a trade, and the pool entry page.
8. Restore ADP refreshes (`--body enabled`), then run
   `yarn recompute-castaway-adp 51 --cohort all_drafts --write --project survivor-fantasy-51c4b`.
   Leave the sync disabled until #279 is decided.

## Rollback

If validation fails after step 5:

1. Keep the sync disabled and set `CASTAWAY_ADP_REFRESH` to `disabled`.
2. If the follow-up PR merged, revert it on main so the bundle is provisional
   again.
3. Roll back every applied plan, newest first:
   `yarn remap-castaway-ids 51 --rollback --plan <file> --project survivor-fantasy-51c4b`.
   This restores `seasons/season_51`, the pool, every draft, competition and
   trade, and both ADP documents, and clears their marks. If a document is
   reported as no longer holding the plan's values, it changed after the
   write; inspect it against the plan file before touching it.
4. Validate: a dry run reports the same plan as step 3, with no document
   marked applied. The empty ledger document stays, and it keeps the ADP
   `pre_premiere` summary frozen. Delete it only after confirming nothing is
   marked.

## Guard

`scripts/lib/validate-season.ts` stops the nightly sync from regenerating a
season whose committed ids moved. It now also catches a castaway whose
committed name changed (an alias) at the same moment their id was handed to
someone else, which it used to report as a harmless rename.

## Residual risks

- Prop bet answers submitted to a live draft during the write (see Live
  drafts). Avoided by not acknowledging live drafts.
- The #279 gate is the disabled sync workflow. Re-enabling it publishes
  Season 51 results; nothing in code prevents that.
- The write is not one transaction across all documents. Each document is
  atomic with its mark; the freshness check, stale detection, repair and
  rollback exist because of that.
